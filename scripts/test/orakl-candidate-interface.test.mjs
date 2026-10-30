import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, symlinkSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { encodeFunctionData, decodeFunctionData, encodeEventTopics, encodeAbiParameters, decodeEventLog } from 'viem';

const root = resolve(import.meta.dirname, '../..');
const candidate = 'contracts/abi/orakl-v1-candidate';
const abi = JSON.parse(readFileSync(join(root, candidate, 'MarketFactory.abi.json')));
function sandbox(run) {
  const path = mkdtempSync(join(tmpdir(), 'orakl-candidate-check-'));
  try {
    mkdirSync(join(path, 'contracts'), { recursive: true });
    cpSync(join(root, 'contracts/src'), join(path, 'contracts/src'), { recursive: true });
    for (const dir of ['lib', 'out']) symlinkSync(join(root, 'contracts', dir), join(path, 'contracts', dir), 'dir');
    cpSync(join(root, candidate), join(path, candidate), { recursive: true });
    const check = () => spawnSync(process.execPath, [join(root, 'scripts/export-orakl-candidate-interface.mjs'), '--check'],
      { cwd: path, encoding: 'utf8' });
    run(path, check);
  } finally { rmSync(path, { recursive: true, force: true }); }
}

test('candidate encodes the exact new native contribution selector and Side enum', () => {
  const data = encodeFunctionData({ abi, functionName: 'predict', args: [42n, 0] });
  assert.equal(data.slice(0, 10), '0x84ec1ed2');
  assert.deepEqual(decodeFunctionData({ abi, data }), { functionName: 'predict', args: [42n, 0] });
  const create = encodeFunctionData({ abi, functionName: 'createMarket', args:
    ['0x' + '12'.repeat(32), 'ipfs://candidate', 1800000000n, 1800000100n, 1801000000n] });
  assert.equal(create.slice(0, 10), '0x6b250e4d');
});

test('indexer decodes a binary FINALIZED event with refund eligibility', () => {
  const topics = encodeEventTopics({ abi, eventName: 'MarketFinalized', args: { marketId: 3n } });
  assert.equal(topics[0], '0x85b170884be76a0add832e558e917cd38e321c9a134222ca90c62e5d25e80513');
  const data = encodeAbiParameters([{ type: 'uint8' }, { type: 'bool' }], [1, true]);
  const decoded = decodeEventLog({ abi, topics, data, strict: true });
  assert.deepEqual(decoded.args, { marketId: 3n, outcome: 1, refundable: true });
  assert.throws(() => decodeEventLog({ abi, topics, data: '0x', strict: true }));
});

test('candidate identity check rejects changed ABI instead of silently regenerating', () => sandbox((path, check) => {
  assert.equal(check().status, 0, 'untampered candidate check');
  const file = join(path, candidate, 'MarketFactory.abi.json');
  writeFileSync(file, readFileSync(file, 'utf8').replace('"name": "predict"', '"name": "unsafePredict"'));
  const result = check();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Candidate interface drift/);
}));

test('candidate identity check rejects stale compiler artifacts after a source edit', () => sandbox((path, check) => {
  const file = join(path, 'contracts/src/MarketFactory.sol');
  writeFileSync(file, readFileSync(file, 'utf8') + '\n// source changed after build\n');
  const result = check();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale artifact source/);
}));
