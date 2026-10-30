#!/usr/bin/env node
/** Independent verification of the ORAKL P1 LOCAL selected deployment.
 *
 *  This script does NOT trust the deploy script's output. It re-reads every
 *  claim from the manifest, re-queries the isolated chain, re-hashes the
 *  artifacts and re-runs the immutable-patched runtime comparison, then writes
 *  a verification report.
 *
 *  Guard rails: refuses any chain id other than 31337, holds no private key.
 *
 *  Usage: node scripts/p1/verify-local-deployment.mjs [--manifest <path>]
 */
import {keccak256} from 'viem';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {
  LOCAL_CHAIN_ID,
  LOCAL_RPC_URL,
  REPO_ROOT,
  assert,
  log,
  makeClients,
  requireLocalChain,
  sha256,
  verifyRuntimeCode,
} from './lib.mjs';

const args = process.argv.slice(2);
const manifestArgIndex = args.indexOf('--manifest');
const manifestPath =
  manifestArgIndex >= 0
    ? resolve(process.cwd(), args[manifestArgIndex + 1])
    : resolve(REPO_ROOT, 'frontend/public/deployments/local-selected.json');

const {publicClient, request} = makeClients();
const read = (address, abi, functionName, functionArgs = []) =>
  publicClient.readContract({address, abi, functionName, args: functionArgs});

function artifactByName(name) {
  const path = resolve(REPO_ROOT, 'contracts', 'out', `${name}.sol`, `${name}.json`);
  const raw = readFileSync(path);
  return {parsed: JSON.parse(raw.toString('utf8')), raw};
}

async function main() {
  await requireLocalChain(request);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  log('manifest', manifestPath.replace(`${REPO_ROOT}/`, ''));

  const checks = [];
  const record = (name, ok, detail) => {
    checks.push({name, ok: Boolean(ok), detail: String(detail)});
    log(`check ${name}`, `${ok ? 'PASS' : 'FAIL'} ${detail}`);
  };

  // --- manifest self-description -------------------------------------------
  assert(manifest.schemaVersion === 1, 'manifest schemaVersion mismatch');
  assert(manifest.status === 'LOCAL_SIMULATION', 'manifest status is not LOCAL_SIMULATION');
  assert(manifest.mode === 'local-selected', 'manifest mode mismatch');
  assert(manifest.safety.publicDeployment === false, 'manifest claims publicDeployment');
  assert(manifest.safety.productionApproval === false, 'manifest claims productionApproval');
  assert(manifest.network.chainId === LOCAL_CHAIN_ID, 'manifest chainId mismatch');
  assert(manifest.network.rpcUrl === LOCAL_RPC_URL, 'manifest rpcUrl mismatch');
  record('manifest-safety', true, 'LOCAL_SIMULATION, no public deployment, no production approval');

  // --- contract linkage, re-read from chain --------------------------------
  const factory = manifest.contracts.selectedMarketFactory;
  const config = manifest.contracts.protocolConfig;
  const {parsed: factoryArtifactParsed, raw: factoryArtifactRaw} = artifactByName('SelectedMarketFactory');
  const {parsed: configArtifactParsed, raw: configArtifactRaw} = artifactByName('ProtocolConfig');
  const factoryAbi = factoryArtifactParsed.abi;
  const configAbi = configArtifactParsed.abi;

  const linkage = await read(factory.address, factoryAbi, 'protocolConfig');
  const binding = await read(config.address, configAbi, 'factory');
  const linkageOk =
    linkage.toLowerCase() === config.address.toLowerCase() && binding.toLowerCase() === factory.address.toLowerCase();
  record('factory-config-linkage', linkageOk, `factory.protocolConfig()=${linkage} config.factory()=${binding}`);
  assert(linkageOk, 'factory/config linkage broken');

  // --- financial state ------------------------------------------------------
  const financialActive = await read(config.address, configAbi, 'financialActive');
  const paused = await read(config.address, configAbi, 'paused');
  const activityEpoch = await read(config.address, configAbi, 'activityEpoch');
  const approvedDigest = await read(config.address, configAbi, 'approvedDigest');
  record('financial-active', financialActive === true && paused === false, `financialActive=${financialActive} paused=${paused}`);
  assert(financialActive === true && paused === false, 'protocol is not in the active local state');
  record('release-digest', approvedDigest === manifest.release.digest, `approvedDigest=${approvedDigest}`);
  assert(approvedDigest === manifest.release.digest, 'approved release digest mismatch');
  record('activity-epoch', Number(activityEpoch) === manifest.state.activityEpoch, `activityEpoch=${activityEpoch}`);

  const deploymentChainId = await read(config.address, configAbi, 'deploymentChainId');
  record('deployment-chain-id', Number(deploymentChainId) === LOCAL_CHAIN_ID, `deploymentChainId=${deploymentChainId}`);

  // --- role mocks -----------------------------------------------------------
  const governanceState = await read(config.address, configAbi, 'governance');
  const complianceState = await read(config.address, configAbi, 'complianceApprover');
  const guardianState = await read(config.address, configAbi, 'guardian');
  record(
    'role-mocks',
    governanceState.toLowerCase() === manifest.roleMocks.governance.address.toLowerCase() &&
      complianceState.toLowerCase() === manifest.roleMocks.compliance.address.toLowerCase() &&
      guardianState.toLowerCase() === manifest.roles.guardian.toLowerCase(),
    `governance=${governanceState} compliance=${complianceState} guardian=${guardianState}`,
  );

  // --- economic parameters, re-read ----------------------------------------
  const parameters = await read(config.address, configAbi, 'parameters');
  const expected = manifest.parameters;
  record(
    'parameters',
    parameters.feeBps === expected.feeBps &&
      parameters.creationBond === BigInt(expected.creationBond) &&
      parameters.proposalBond === BigInt(expected.proposalBond) &&
      parameters.challengeBond === BigInt(expected.challengeBond) &&
      parameters.minContribution === BigInt(expected.minContribution) &&
      parameters.poolCap === BigInt(expected.poolCap) &&
      parameters.challengePeriod === expected.challengePeriod &&
      parameters.arbitrationPeriod === expected.arbitrationPeriod,
    `feeBps=${parameters.feeBps} poolCap=${parameters.poolCap}`,
  );

  const pilotPoolCap = await read(factory.address, factoryAbi, 'pilotPoolCap');
  const globalCap = await read(factory.address, factoryAbi, 'globalUnresolvedCap');
  const perArbCap = await read(factory.address, factoryAbi, 'perArbitratorUnresolvedCap');
  record(
    'exposure-caps',
    pilotPoolCap === BigInt(expected.poolCap) &&
      globalCap === BigInt(expected.globalUnresolvedCap) &&
      perArbCap === BigInt(expected.perArbitratorUnresolvedCap),
    `pilot=${pilotPoolCap} global=${globalCap} perArb=${perArbCap}`,
  );

  const marketCount = await read(factory.address, factoryAbi, 'marketCount');
  record('market-count', Number(marketCount) === manifest.state.marketCount, `marketCount=${marketCount}`);

  // --- runtime code, re-fetched and re-verified ----------------------------
  const factoryCode = await request('eth_getCode', [factory.address, 'latest']);
  const configCode = await request('eth_getCode', [config.address, 'latest']);
  const factoryKeccak = keccak256(factoryCode);
  const configKeccak = keccak256(configCode);
  record(
    'runtime-code-hash',
    factoryKeccak === factory.runtimeCodeKeccak256 && configKeccak === config.runtimeCodeKeccak256,
    `factory=${factoryKeccak} config=${configKeccak}`,
  );

  verifyRuntimeCode('SelectedMarketFactory', factoryCode, [
    BigInt(config.address),
    BigInt(expected.poolCap),
    BigInt(expected.globalUnresolvedCap),
    BigInt(expected.perArbitratorUnresolvedCap),
  ]);
  record('runtime-immutable-patch', true, 'SelectedMarketFactory template patched with known immutables matches on-chain code');

  verifyRuntimeCode('ProtocolConfig', configCode, [
    BigInt(manifest.roleMocks.governance.address),
    BigInt(manifest.roleMocks.compliance.address),
    BigInt(manifest.roles.guardian),
    BigInt(LOCAL_CHAIN_ID),
  ]);
  record('runtime-immutable-patch-config', true, 'ProtocolConfig template patched with known immutables matches on-chain code');

  // --- artifact identity, re-hashed ----------------------------------------
  const factoryArtifactSha = sha256(factoryArtifactRaw);
  const configArtifactSha = sha256(configArtifactRaw);
  const factoryAbiSha = sha256(Buffer.from(JSON.stringify(factoryArtifactParsed.abi)));
  const configAbiSha = sha256(Buffer.from(JSON.stringify(configArtifactParsed.abi)));
  record(
    'artifact-identity',
    factoryArtifactSha === factory.artifactSha256 &&
      configArtifactSha === config.artifactSha256 &&
      factoryAbiSha === factory.abiSha256 &&
      configAbiSha === config.abiSha256,
    'artifact + abi sha256 match manifest',
  );

  // --- candidate ABI interface gate ----------------------------------------
  const candidateManifestPath = resolve(REPO_ROOT, 'contracts/abi/orakl-v1-selected-candidate/interface-manifest.json');
  const candidateManifest = JSON.parse(readFileSync(candidateManifestPath, 'utf8'));
  // The candidate interface manifest stores hex WITHOUT the 0x prefix.
  const candidateAbiChecks = ['SelectedMarketFactory', 'ProtocolConfig'].map((name) => {
    const entry = candidateManifest.contracts[name];
    const abiPath = resolve(REPO_ROOT, entry.abiFile);
    const actualSha = sha256(readFileSync(abiPath)).replace(/^0x/, '');
    const expectedSha = String(entry.abiSha256).replace(/^0x/, '');
    return {name, ok: actualSha === expectedSha, actualSha, expectedSha};
  });
  record(
    'candidate-abi',
    candidateAbiChecks.every((c) => c.ok),
    candidateAbiChecks.map((c) => `${c.name}=${c.ok ? 'match' : `MISMATCH actual=${c.actualSha} expected=${c.expectedSha}`}`).join(' '),
  );

  const report = {
    schemaVersion: 1,
    verifiedAt: new Date().toISOString(),
    mode: 'local-selected',
    chainId: LOCAL_CHAIN_ID,
    rpcUrl: LOCAL_RPC_URL,
    manifest: manifestPath.replace(`${REPO_ROOT}/`, ''),
    factory: factory.address,
    config: config.address,
    checks,
    allPassed: checks.every((c) => c.ok),
  };

  const reportPath = resolve(REPO_ROOT, 'docs/p1/evidence/local-deployment-verification.json');
  mkdirSync(resolve(reportPath, '..'), {recursive: true});
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  log('report', reportPath.replace(`${REPO_ROOT}/`, ''));

  process.stdout.write(`${JSON.stringify({status: report.allPassed ? 'VERIFY_OK' : 'VERIFY_FAILED', checks: checks.length}, null, 2)}\n`);
  if (!report.allPassed) process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`[p1-local] VERIFY FAILED: ${error.stack ?? error}\n`);
  process.exit(1);
});
