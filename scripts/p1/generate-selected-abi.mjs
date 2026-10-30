#!/usr/bin/env node
/** Generate (or check) the frontend selected-protocol ABI module.
 *
 *  Source of truth: contracts/abi/orakl-v1-selected-candidate/*.abi.json.
 *  The generated TypeScript module is a pure copy — no legacy MarketFactory
 *  ABI is ever emitted. `--check` fails if the generated file is stale.
 *
 *  Usage:
 *    node scripts/p1/generate-selected-abi.mjs          # write
 *    node scripts/p1/generate-selected-abi.mjs --check  # verify
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {REPO_ROOT, sha256} from './lib.mjs';

const CANDIDATE_DIR = resolve(REPO_ROOT, 'contracts/abi/orakl-v1-selected-candidate');
const OUT_PATH = resolve(REPO_ROOT, 'frontend/src/selected/abi.ts');

const targets = [
  {name: 'SelectedMarketFactory', file: 'SelectedMarketFactory.abi.json', constName: 'SELECTED_FACTORY_ABI'},
  {name: 'ProtocolConfig', file: 'ProtocolConfig.abi.json', constName: 'SELECTED_CONFIG_ABI'},
];

const checkMode = process.argv.includes('--check');

const parts = [];
parts.push(`/** GENERATED FILE — do not edit by hand.
 *
 *  Source: contracts/abi/orakl-v1-selected-candidate/*.abi.json
 *  Regenerate: node scripts/p1/generate-selected-abi.mjs
 *  Verify:     node scripts/p1/generate-selected-abi.mjs --check
 *
 *  This module contains ONLY the selected-protocol candidate ABIs. The legacy
 *  QIE Testnet MarketFactory ABI is intentionally absent.
 */`);

const hashes = {};
for (const target of targets) {
  const raw = readFileSync(resolve(CANDIDATE_DIR, target.file));
  const abi = JSON.parse(raw.toString('utf8'));
  if (!Array.isArray(abi)) throw new Error(`${target.file}: ABI is not an array`);
  hashes[target.name] = sha256(raw).replace(/^0x/, '');
  parts.push('');
  parts.push(`/** sha256(${target.file}) = ${hashes[target.name]} */`);
  parts.push(`export const ${target.constName} = ${JSON.stringify(abi, null, 2)} as const;`);
}

parts.push('');
parts.push('/** Candidate ABI identity, used to fail closed on an ABI mismatch. */');
parts.push('export const SELECTED_ABI_SHA256 = {');
for (const target of targets) {
  parts.push(`  ${target.name}: '${hashes[target.name]}',`);
}
parts.push('} as const;');
parts.push('');

const output = `${parts.join('\n')}\n`;

if (checkMode) {
  let current;
  try {
    current = readFileSync(OUT_PATH, 'utf8');
  } catch {
    process.stderr.write(`generate-selected-abi: ${OUT_PATH} is missing; run without --check\n`);
    process.exit(1);
  }
  if (current !== output) {
    process.stderr.write('generate-selected-abi: generated ABI module is stale; run without --check\n');
    process.exit(1);
  }
  process.stdout.write(`generate-selected-abi: OK (${targets.map((t) => `${t.name}=${hashes[t.name].slice(0, 12)}`).join(' ')})\n`);
} else {
  mkdirSync(dirname(OUT_PATH), {recursive: true});
  writeFileSync(OUT_PATH, output);
  process.stdout.write(`generate-selected-abi: wrote ${OUT_PATH.replace(`${REPO_ROOT}/`, '')}\n`);
}
