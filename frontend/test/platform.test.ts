import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MARKET_IDEAS, categoryForQuestion, filterIdeas, marketBookmarkKey, parseBookmarks} from '../src/platform.ts';

test('discovery ideas filter by category and case-insensitive text together', () => {
  assert.equal(filterIdeas('BITCOIN', 'crypto').length, 1);
  assert.equal(filterIdeas('bitcoin', 'sports').length, 0);
  assert.equal(filterIdeas('  ', 'all').length, MARKET_IDEAS.length);
  assert.ok(filterIdeas('', 'sports').every((idea) => idea.category === 'sports'));
});

test('on-chain questions receive a topic without changing their market data', () => {
  assert.equal(categoryForQuestion('Bitcoin menyentuh rekor?'), 'crypto');
  assert.equal(categoryForQuestion('Final sepak bola lewat penalti?'), 'sports');
  assert.equal(categoryForQuestion('Model AI baru dirilis?'), 'technology');
  assert.equal(categoryForQuestion('Harga emas turun?'), 'economy');
});

test('saved market IDs are isolated by deployment and normalize address casing', () => {
  const a = `0x${'aB'.repeat(20)}`;
  const b = `0x${'cc'.repeat(20)}`;
  assert.equal(marketBookmarkKey(a, 1n), marketBookmarkKey(a.toLowerCase(), 1n));
  assert.notEqual(marketBookmarkKey(a, 1n), marketBookmarkKey(b, 1n));
  const saved = parseBookmarks(JSON.stringify([marketBookmarkKey(a, 1n), 'idea:bitcoin-120k']));
  assert.ok(saved.has(marketBookmarkKey(a.toLowerCase(), 1n)));
  assert.equal(saved.has(marketBookmarkKey(b, 1n)), false);
});

test('corrupt or unrelated stored values do not break discovery', () => {
  assert.equal(parseBookmarks('broken JSON').size, 0);
  assert.equal(parseBookmarks('{"key":"value"}').size, 0);
  assert.equal(parseBookmarks(JSON.stringify([null, 12, 'javascript:alert(1)', 'idea:bitcoin-120k', 'idea:bitcoin-120k'])).size, 1);
});

test('ideas have distinct identities and do not carry invented stakes or probabilities', () => {
  assert.equal(new Set(MARKET_IDEAS.map((idea) => idea.id)).size, MARKET_IDEAS.length);
  for (const idea of MARKET_IDEAS) {
    assert.ok(idea.days > 0);
    assert.equal('yesStake' in idea, false);
    assert.equal('probability' in idea, false);
    assert.equal('volume' in idea, false);
  }
});
