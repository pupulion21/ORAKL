#!/usr/bin/env node
/** Offline candidate ABI export/check; never modifies the legacy ABI/frontend or selects a deployment. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { keccak256, toFunctionSelector, toEventSelector } from 'viem';

const check = process.argv[2] === '--check';
if (!check && process.argv[2] !== '--write') throw new Error('Specify --write or --check');
const directory = 'contracts/abi/orakl-v1-candidate';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = p => p.type.startsWith('tuple')
  ? `(${p.components.map(canonical).join(',')})${p.type.slice(5)}` : p.type;
const signature = entry => `${entry.name}(${entry.inputs.map(canonical).join(',')})`;
const fileText = value => JSON.stringify(value, null, 2) + '\n';
const expect = (ok, reason) => { if (!ok) throw new Error(reason); };
const files = new Map();
const contracts = {};
const sources = {};
const structures = {};
const typeSource = readFileSync('contracts/src/libraries/ProtocolTypes.sol', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const enums = Object.fromEntries([...typeSource.matchAll(/enum\s+(\w+)\s*\{([^}]+)\}/g)].map(([, name, body]) => {
  const members = body.split(',').map(x => x.trim()).filter(Boolean);
  expect(members.every(x => /^[A-Za-z_]\w*$/.test(x)), `Review enum grammar for ${name}`);
  return [name, members];
}));
expect(['Side', 'Outcome', 'State', 'BondType'].every(name => enums[name]), 'Missing expected protocol enums');
function recordStructure(param) {
  if (!param.components) return;
  const name = param.internalType?.replace(/\[.*$/, '');
  if (name?.startsWith('struct ')) {
    const body = param.components;
    expect(!structures[name] || fileText(structures[name]) === fileText(body), `Inconsistent struct ${name}`);
    structures[name] = body;
  }
  for (const component of param.components) recordStructure(component);
}
for (const name of ['MarketFactory', 'ProtocolConfig']) {
  const artifact = JSON.parse(readFileSync(`contracts/out/${name}.sol/${name}.json`, 'utf8'));
  const metadata = typeof artifact.metadata === 'string' ? JSON.parse(artifact.metadata) : artifact.metadata;
  expect(metadata.compiler.version === '0.8.37+commit.f401782d', `${name}: compiler drift`);
  expect(metadata.settings.evmVersion === 'paris' && metadata.settings.optimizer.enabled &&
    metadata.settings.optimizer.runs === 50 && !metadata.settings.viaIR &&
    metadata.settings.metadata.bytecodeHash === 'none', `${name}: build settings drift`);
  for (const path of Object.keys(metadata.sources)) {
    const bytes = readFileSync(`contracts/${path}`);
    expect(keccak256(bytes) === metadata.sources[path].keccak256, `Stale artifact source ${path}; rebuild first`);
    sources[`contracts/${path}`] = sha256(bytes);
  }
  const abi = artifact.abi;
  const abiText = fileText(abi);
  files.set(`${directory}/${name}.abi.json`, abiText);
  const functions = abi.filter(e => e.type === 'function').map(e => ({
    signature: signature(e), selector: toFunctionSelector(signature(e)), stateMutability: e.stateMutability,
    inputs: e.inputs, outputs: e.outputs,
  }));
  const errors = abi.filter(e => e.type === 'error').map(e => ({
    signature: signature(e), selector: toFunctionSelector(signature(e)), inputs: e.inputs,
  }));
  for (const entries of [functions, errors]) {
    const seen = new Map();
    for (const entry of entries) {
      expect(!seen.has(entry.selector), `${name}: selector collision ${entry.selector}`);
      seen.set(entry.selector, entry.signature);
    }
  }
  const events = abi.filter(e => e.type === 'event').map(e => ({
    signature: signature(e), topic0: toEventSelector(signature(e)), anonymous: e.anonymous,
    inputs: e.inputs,
  }));
  for (const entry of abi) {
    for (const p of [...(entry.inputs ?? []), ...(entry.outputs ?? [])]) recordStructure(p);
  }
  contracts[name] = {
    abiFile: `${directory}/${name}.abi.json`, abiSha256: sha256(abiText),
    compiler: metadata.compiler.version, settings: metadata.settings,
    creationBytecodeKeccak256: keccak256(artifact.bytecode.object),
    runtimeTemplateKeccak256: keccak256(artifact.deployedBytecode.object),
    runtimeBytes: (artifact.deployedBytecode.object.length - 2) / 2,
    runtimeHasImmutablePatches: Object.keys(artifact.deployedBytecode.immutableReferences ?? {}).length > 0,
    functions, events, errors, specialEntries: abi.filter(e => !['function', 'event', 'error'].includes(e.type)),
  };
}
const manifest = {
  schemaVersion: 1, status: 'CANDIDATE_NOT_FROZEN', economicPolicy: 'FULL_RETURN_NO_SLASHING',
  financialActivationAuthorized: false, deploymentAuthorized: false,
  baselineCommit: '8d850ae42ebc77acaf2323cd50f63f08e57f1b66',
  protocolRevision: 'P0.3', securityCandidateRequiresFinalProtocolApproval: true,
  scope: 'Current P0.3 candidate interface and unpatched artifact templates; not a deployed-address manifest',
  productionNetworkConfiguration: null, productionAddresses: null,
  enums,
  sourceSha256: Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b))),
  structures, contracts,
};
files.set(`${directory}/interface-manifest.json`, fileText(manifest));
let md = '# ORAKL v1 candidate interface — generated\n\n';
md += '**CANDIDATE_NOT_FROZEN, P0.3 security candidate; final protocol approval required.** Full-return bonds only. No deployment or activation authorized.\n\n';
md += 'Generated from compiler artifacts; tuple definitions, full outputs, indexed event fields, errors, hashes and source identity are in [interface-manifest.json](interface-manifest.json).\n\n';
md += 'Refresh offline: `node scripts/export-orakl-candidate-interface.mjs --write`; verify: `--check`. Read the [P0.3 interface changes](../../../docs/migration/P0_3_INTERFACE_CHANGES.md) before using these ABIs.\n\n';
for (const [name, c] of Object.entries(contracts)) {
  md += `## ${name}\n\nABI: [${name}.abi.json](${name}.abi.json). SHA256: \`${c.abiSha256}\`.\n\n`;
  md += '| Function (canonical ABI types) | Selector | Mutability |\n| --- | --- | --- |\n';
  for (const f of c.functions) md += `| \`${f.signature}\` | \`${f.selector}\` | ${f.stateMutability} |\n`;
  md += '\n| Event (canonical ABI types) | topic0 | Indexed fields |\n| --- | --- | --- |\n';
  for (const e of c.events) md += `| \`${e.signature}\` | \`${e.topic0}\` | ${e.inputs.filter(p => p.indexed).map(p => p.name).join(', ') || 'None'} |\n`;
  md += '\n';
}
files.set(`${directory}/INTERFACE.md`, md);
if (!check) mkdirSync(directory, { recursive: true });
for (const [path, expected] of files) {
  if (check) expect(readFileSync(path, 'utf8') === expected, `Candidate interface drift: ${path}`);
  else writeFileSync(path, expected);
}
console.log(`${check ? 'Checked' : 'Exported'} ${files.size} candidate interface files; artifact/source/settings identity and selector uniqueness PASS. No legacy/frontend writes.`);
