const { test } = require('node:test');
const assert = require('node:assert/strict');
const { KINDS, fullCounts, norm, DORA_NEXT, toCounts } = require('../tiles');

test('fullCounts sums to 136 with aka carve-outs', () => {
  const c = fullCounts();
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  assert.equal(total, 136);
  assert.equal(c['5m'], 3);
  assert.equal(c['0m'], 1);
  assert.equal(c['5p'], 3);
  assert.equal(c['0p'], 1);
  assert.equal(c['5s'], 3);
  assert.equal(c['0s'], 1);
  assert.equal(c['1m'], 4);
  assert.equal(c['7z'], 4);
});

test('KINDS has 34 normalized kinds', () => {
  assert.equal(KINDS.length, 34);
  assert.ok(KINDS.includes('1m') && KINDS.includes('9s') && KINDS.includes('7z'));
  assert.ok(!KINDS.includes('0m'));
});

test('norm maps aka to five', () => {
  assert.equal(norm('0m'), '5m');
  assert.equal(norm('0p'), '5p');
  assert.equal(norm('5m'), '5m');
});

test('DORA_NEXT wraps suits and honors', () => {
  assert.equal(DORA_NEXT('9m'), '1m');
  assert.equal(DORA_NEXT('1m'), '2m');
  assert.equal(DORA_NEXT('9s'), '1s');
  // Winds cycle 1z->2z->3z->4z->1z; dragons cycle 5z->6z->7z->5z.
  assert.equal(DORA_NEXT('3z'), '4z');
  assert.equal(DORA_NEXT('4z'), '1z');
  assert.equal(DORA_NEXT('6z'), '7z');
  assert.equal(DORA_NEXT('7z'), '5z');
  assert.equal(DORA_NEXT('0m'), '6m'); // aka -> five -> next
});

test('toCounts folds aka into 5-slot', () => {
  const c = toCounts(['0m', '5m', '1z']);
  assert.equal(c[0][4], 2); // two 5m
  assert.equal(c[3][0], 1);
});
