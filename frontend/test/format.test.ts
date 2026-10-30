import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  contractErrorText,
  countdownText,
  escapeHtml,
  estimatePayoutForStake,
  formatBps,
  formatDateTime,
  formatQie,
  formatUnits,
  marketPhase,
  parseQie,
  parseUnits,
  phaseLabel,
  phaseTone,
  poolShareBps,
  toDateTimeLocal,
} from '../src/format.ts';

test('formatUnits and parseUnits keep integer accounting exact', () => {
  assert.equal(formatUnits(1_500_000n, 6), '1.5');
  assert.equal(formatUnits(1n, 6), '0.000001');
  assert.equal(formatUnits(10n ** 18n, 18), '1');
  assert.equal(formatUnits(123n * 10n ** 16n, 18), '1.23');
  assert.equal(formatUnits(0n, 18), '0');

  assert.equal(parseUnits('1.5', 6), 1_500_000n);
  assert.equal(parseUnits('0.000001', 6), 1n);
  assert.equal(parseUnits('2', 18), 2n * 10n ** 18n);
  assert.equal(parseQie('0.000000000000000001'), 1n);
  assert.throws(() => parseUnits('-1', 18));
  assert.throws(() => parseUnits('abc', 18));
  assert.throws(() => parseUnits('1.0000001', 6));
});

test('formatQie truncates for display and keeps dust visible', () => {
  assert.equal(formatQie(0n), '0');
  assert.equal(formatQie(10n ** 18n), '1');
  assert.equal(formatQie(1_234_567n * 10n ** 12n), '1.234567');
  assert.equal(formatQie(1n), '<0.000001');
});

test('untrusted uint64 timestamps cannot crash market rendering', () => {
  const maxUint64 = (1n << 64n) - 1n;
  assert.equal(formatDateTime(maxUint64 - 1n), '—');
  assert.equal(formatDateTime(maxUint64), '—');
  assert.equal(formatDateTime(8_640_000_000_001n), '—');
  assert.equal(toDateTimeLocal(maxUint64), '');
  assert.notEqual(formatDateTime(1_800_000_000n), '—');
  assert.notEqual(toDateTimeLocal(1_800_000_000n), '');
});

test('poolShareBps is a pool proportion, not a price', () => {
  assert.equal(poolShareBps(30n, 100n), 3000);
  assert.equal(poolShareBps(30n, 70n), 4285);
  assert.equal(poolShareBps(0n, 0n), null);
  assert.equal(poolShareBps(5n, 0n), null);
  assert.equal(poolShareBps(1n, 3n), 3333);
  assert.equal(formatBps(3333), '33.33%');
  assert.equal(formatBps(null), '—');
});

test('market phases split stake, resolve and cancel windows exactly', () => {
  const m = {closeTime: 1000n, resolveDeadline: 2000n, outcome: 0, cancelled: false};
  assert.equal(marketPhase(m, 999), 'OPEN');
  assert.equal(marketPhase(m, 1000), 'AWAITING_RESOLUTION');
  assert.equal(marketPhase(m, 1999), 'AWAITING_RESOLUTION');
  assert.equal(marketPhase(m, 2000), 'EXPIRED_UNRESOLVED');
  assert.equal(marketPhase({...m, outcome: 1}, 1000), 'RESOLVED');
  assert.equal(marketPhase({...m, cancelled: true}, 999), 'RESOLVED');
  assert.equal(phaseLabel('OPEN'), 'Open');
  assert.equal(phaseLabel('EXPIRED_UNRESOLVED'), 'Expired · cancellation available');
  assert.equal(phaseTone('AWAITING_RESOLUTION'), 'wait');
});

test('estimatePayoutForStake uses floor division on the post-stake pool', () => {
  assert.equal(estimatePayoutForStake(100n, 100n, 0, 100n), 150n);
  assert.equal(estimatePayoutForStake(100n, 100n, 1, 100n), 150n);
  assert.equal(estimatePayoutForStake(0n, 0n, 0, 10n), 10n);
  assert.equal(estimatePayoutForStake(0n, 0n, 0, 0n), 0n);
  assert.equal(estimatePayoutForStake(1n, 1n, 0, 1n), 1n);
});

test('human and machine errors are mapped to actionable text', () => {
  assert.match(contractErrorText('execution reverted: MarketClosed()'), /is closed/);
  assert.match(contractErrorText('reverted with custom error NotResolver'), /Only this market’s resolver/);
  assert.match(contractErrorText('InvalidRecipient'), /Invalid recipient/);
  assert.equal(contractErrorText('some unexpected rpc text'), 'some unexpected rpc text');
  assert.equal(escapeHtml('<script>&"'), '&lt;script&gt;&amp;&quot;');
  assert.equal(countdownText(100, 40), '1m');
  assert.equal(countdownText(100, 100), 'elapsed');
});
