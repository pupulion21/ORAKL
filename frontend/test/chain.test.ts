import assert from 'node:assert/strict';
import {test} from 'node:test';
import {encodeAbiParameters, encodeEventTopics, keccak256, type TransactionReceipt} from 'viem';
import {QIE_PREDICTION_MARKET_ABI} from '../src/abi.ts';
import {marketIdFromReceipt, verifyContractRuntime} from '../src/chain.ts';
import {publicClient} from '../src/config.ts';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const OTHER_ADDRESS = '0x2222222222222222222222222222222222222222';
const CODE = '0x6000';

test('verification reads runtime, accounting and balance at one fresh block', async (t) => {
  const observations: Array<{method: string; blockNumber?: bigint}> = [];
  const snapshot: Record<string, bigint> = {marketCount: 2n, totalStakeReceived: 100n,
    totalPaidOut: 20n, totalEscrow: 80n, unaccountedBalance: 5n};
  t.mock.method(publicClient, 'getChainId', async () => 1983);
  const blocks = t.mock.method(publicClient, 'getBlockNumber', async (args: {cacheTime?: number}) => {
    assert.equal(args.cacheTime, 0);
    return 100n;
  });
  t.mock.method(publicClient, 'getCode', async (args: {blockNumber?: bigint}) => {
    observations.push({method: 'code', blockNumber: args.blockNumber});
    return CODE;
  });
  t.mock.method(publicClient, 'readContract', async (args: {functionName: string; blockNumber?: bigint}) => {
    observations.push({method: args.functionName, blockNumber: args.blockNumber});
    // Simulate a stake advancing latest state between independent requests.
    return args.blockNumber === 100n ? snapshot[args.functionName] : 999n;
  });
  t.mock.method(publicClient, 'getBalance', async (args: {blockNumber?: bigint}) => {
    observations.push({method: 'balance', blockNumber: args.blockNumber});
    return args.blockNumber === 100n ? 85n : 999n;
  });

  const result = await verifyContractRuntime(ADDRESS, keccak256(CODE));
  assert.equal(result.blockNumber, 100n);
  assert.equal(result.marketCount, 2n);
  assert.equal(result.stats.totalStakeReceived - result.stats.totalPaidOut, result.stats.totalEscrow);
  assert.equal(result.stats.contractBalance - result.stats.totalEscrow, result.stats.unaccountedBalance);
  assert.equal(blocks.mock.callCount(), 1);
  assert.equal(observations.length, 7);
  assert.ok(observations.every((entry) => entry.blockNumber === 100n));
});

test('verification stops on a wrong-chain RPC before looking up the contract', async (t) => {
  t.mock.method(publicClient, 'getChainId', async () => 1);
  const code = t.mock.method(publicClient, 'getCode', async () => CODE);
  await assert.rejects(() => verifyContractRuntime(ADDRESS, keccak256(CODE)), /chain 1, instead of 1983/);
  assert.equal(code.mock.callCount(), 0);
});

test('historical read failure is reported without silently retrying latest state', async (t) => {
  t.mock.method(publicClient, 'getChainId', async () => 1983);
  t.mock.method(publicClient, 'getBlockNumber', async () => 100n);
  const code = t.mock.method(publicClient, 'getCode', async () => {throw new Error('historical reads unavailable');});
  await assert.rejects(() => verifyContractRuntime(ADDRESS, keccak256(CODE)), /historical reads unavailable/);
  assert.equal(code.mock.callCount(), 1);
});

test('market ID comes from the target contract event rather than another log or latest count', () => {
  const log = (address: typeof ADDRESS | typeof OTHER_ADDRESS, marketId: bigint) => ({
    address,
    topics: encodeEventTopics({abi: QIE_PREDICTION_MARKET_ABI, eventName: 'MarketCreated',
      args: {marketId, creator: ADDRESS, resolver: ADDRESS}}),
    data: encodeAbiParameters([{type: 'uint64'}, {type: 'uint64'}], [100n, 200n]),
  });
  const scoped = {logs: [log(OTHER_ADDRESS, 99n), log(ADDRESS, 7n)]} as unknown as TransactionReceipt;
  assert.equal(marketIdFromReceipt(scoped, ADDRESS), 7n);
  assert.equal(marketIdFromReceipt({logs: [log(OTHER_ADDRESS, 99n)]} as unknown as TransactionReceipt, ADDRESS), null);
});
