import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {TransactionReceipt} from 'viem';
import {createTransactionTracker} from '../src/transactions.ts';

const HASH = `0x${'ab'.repeat(32)}`;
const OTHER_HASH = `0x${'cd'.repeat(32)}`;
const receipt = (status: 'success' | 'reverted' = 'success', hash = HASH) =>
  ({transactionHash: hash, status, blockNumber: 42n} as TransactionReceipt);
const noOp = () => {};
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function tracker(overrides: Partial<Parameters<typeof createTransactionTracker>[0]> = {}) {
  return createTransactionTracker({waitForReceipt: async () => receipt(),
    getReceipt: async () => receipt(), onChange: noOp, onError: noOp, errorText, ...overrides});
}

test('a timed-out receipt is recovered by its original hash exactly once', async () => {
  let applications = 0;
  const requested: string[] = [];
  const tx = tracker({
    waitForReceipt: async () => {throw new Error('timeout');},
    getReceipt: async (hash) => {requested.push(hash); return receipt();},
  });
  tx.add(HASH, 'Deploy', async () => {applications += 1;});
  assert.equal(await tx.watch(HASH), null);
  assert.equal(tx.get(HASH)?.status, 'unknown');
  assert.equal(applications, 0);
  assert.equal(tx.remove(HASH), false);
  tx.clear();
  assert.equal(tx.records.length, 1);

  await tx.check(HASH);
  await tx.check(HASH);
  assert.equal(applications, 1);
  assert.equal(tx.get(HASH)?.status, 'success');
  assert.equal(tx.get(HASH)?.notified, true);
  assert.deepEqual(requested, [HASH, HASH]);
});

test('failed application verification stays recoverable after a successful receipt', async () => {
  let attempts = 0;
  const tx = tracker();
  tx.add(HASH, 'Deploy', async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('runtime verification RPC unavailable');
  });
  await tx.watch(HASH);
  assert.equal(tx.get(HASH)?.status, 'success');
  assert.equal(tx.get(HASH)?.notified, false);
  assert.match(tx.get(HASH)?.error ?? '', /runtime verification RPC unavailable/);
  assert.equal(tx.remove(HASH), false);
  tx.clear();
  assert.equal(tx.records.length, 1);

  await tx.check(HASH);
  await tx.check(HASH);
  assert.equal(attempts, 2);
  assert.equal(tx.get(HASH)?.error, null);
  assert.equal(tx.get(HASH)?.notified, true);
});

test('simultaneous watcher and manual checks share one application callback', async () => {
  let complete!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {complete = resolve;});
  const applying = new Promise<void>((resolve) => {started = resolve;});
  let applications = 0;
  const tx = tracker();
  tx.add(HASH, 'Create', async () => {applications += 1; started(); await gate;});
  const watching = tx.watch(HASH);
  await applying;
  const checking = tx.check(HASH);
  complete();
  await Promise.all([watching, checking]);
  assert.equal(applications, 1);
  assert.equal(tx.get(HASH)?.processing, false);
  assert.equal(tx.get(HASH)?.notified, true);
});

test('a reverted transaction never applies success state', async () => {
  let applications = 0;
  const tx = tracker({waitForReceipt: async () => receipt('reverted')});
  tx.add(HASH, 'Stake', async () => {applications += 1;});
  await tx.watch(HASH);
  assert.equal(applications, 0);
  assert.equal(tx.get(HASH)?.status, 'reverted');
  assert.equal(tx.remove(HASH), true);
});

test('more than six pending transactions retain their recovery callbacks', async () => {
  let applications = 0;
  const tx = tracker({getReceipt: async (hash) => receipt('success', hash)});
  for (let i = 0; i < 8; i += 1) {
    tx.add(`0x${i.toString(16).padStart(64, '0')}`, 'Stake', async () => {applications += 1;});
  }
  tx.clear();
  assert.equal(tx.records.length, 8);
  const oldest = tx.records.at(-1)!;
  await tx.check(oldest.hash);
  assert.equal(applications, 1);
  tx.clear();
  assert.equal(tx.records.length, 7);
});

test('a receipt for another hash cannot activate a deployment', async () => {
  let applications = 0;
  const tx = tracker({getReceipt: async () => receipt('success', OTHER_HASH)});
  tx.add(HASH, 'Deploy', async () => {applications += 1;});
  await assert.rejects(() => tx.check(HASH), /transaction hash mismatch/);
  assert.equal(applications, 0);
  assert.equal(tx.get(HASH)?.status, 'pending');
});

test('a late watcher timeout cannot overwrite a successful manual recovery', async () => {
  let rejectWait!: (error: Error) => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {started = resolve;});
  const tx = tracker({waitForReceipt: () => {
    started();
    return new Promise((_, reject) => {rejectWait = reject;});
  }});
  let applications = 0;
  tx.add(HASH, 'Stake', async () => {applications += 1;});
  const watch = tx.watch(HASH);
  assert.equal(tx.watch(HASH), watch);
  await waiting;
  await tx.check(HASH);
  rejectWait(new Error('timeout'));
  await watch;
  assert.equal(tx.get(HASH)?.status, 'success');
  assert.equal(tx.get(HASH)?.error, null);
  assert.equal(applications, 1);
});
