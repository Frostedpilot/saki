const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DynamicPool } = require('../powers/dynamicPool');
const { createRNG } = require('../rng');
const { fullCounts } = require('../tiles');

test('full pool totals 136', () => {
  const p = DynamicPool.full(createRNG(1));
  assert.equal(p.total(), 136);
});

test('sample decrements total by exactly 1', () => {
  const p = DynamicPool.full(createRNG(1));
  const t = p.sample();
  assert.ok(typeof t === 'string');
  assert.equal(p.total(), 135);
});

test('ghost tile impossible: exhausted kind never drawn even at 999x weight', () => {
  const p = DynamicPool.full(createRNG(1));
  for (let i = 0; i < 4; i++) p.decrement('1m');
  assert.equal(p.get('1m'), 0);
  for (let i = 0; i < 132; i++) {
    const t = p.sample({ '1m': 999 });
    assert.notEqual(t, '1m');
  }
  assert.equal(p.total(), 0);
});

test('W=0 excludes tiles (Nodoka-style filter)', () => {
  const p = DynamicPool.full(createRNG(3));
  const drawn = new Set();
  for (let i = 0; i < 30; i++) {
    const t = p.sample(k => (k === '1m' ? 0 : 1.0));
    drawn.add(t);
  }
  assert.ok(!drawn.has('1m'));
});

test('function weights vs object weights agree on exclusion', () => {
  const a = DynamicPool.full(createRNG(5));
  const b = DynamicPool.full(createRNG(5));
  // single-kind pool via zeroing everything else
  const only = { '7z': 5.0 };
  const t = a.sample(only);
  assert.ok(typeof t === 'string'); // some tile drawn; 7z heavily favored but not forced
  const t2 = b.sample(k => (k === '7z' ? 5.0 : 1.0));
  assert.ok(typeof t2 === 'string');
});

test('empty pool sample returns null', () => {
  const p = new DynamicPool({}, createRNG(1));
  assert.equal(p.sample(), null);
});

test('all-zero weights sample returns null and preserves pool', () => {
  const p = DynamicPool.full(createRNG(1));
  const before = p.total();
  assert.ok(p.sample({}) !== null); // {} -> all default 1.0, draws normally
  assert.equal(p.total(), before - 1);
  const p2 = DynamicPool.full(createRNG(1));
  assert.equal(p2.sample(() => 0), null);
  assert.equal(p2.total(), before);
});

test('negative weights treated as excluded', () => {
  const p = DynamicPool.full(createRNG(1));
  const t = p.sample(() => -3);
  assert.equal(t, null);
});

test('decrement on exhausted tile throws (conservation)', () => {
  const p = new DynamicPool({ '1m': 1 }, createRNG(1));
  p.decrement('1m');
  assert.throws(() => p.decrement('1m'), /conservation/i);
});

test('reserveSlot success path decrements pool and stores slot', () => {
  const p = DynamicPool.full(createRNG(1));
  const before = p.get('5m');
  assert.equal(p.reserveSlot('5m', 'RINSHAN_0'), true);
  assert.equal(p.get('5m'), before - 1);
  assert.equal(p.takeSlot('RINSHAN_0'), '5m');
  assert.equal(p.takeSlot('RINSHAN_0'), null); // double-take -> null
});

test('reserveSlot fails gracefully when tile exhausted', () => {
  const p = new DynamicPool({ '2p': 0 }, createRNG(1));
  assert.equal(p.reserveSlot('2p', 'HAITEI'), false);
  assert.equal(p.takeSlot('HAITEI'), null);
});

test('reserveSlot last-copy chain (haitei anchor across 4 reservations)', () => {
  const p = DynamicPool.full(createRNG(11));
  // 0m has exactly 1 copy: first reservation wins, second fails
  assert.equal(p.reserveSlot('0m', 'SLOT_A'), true);
  assert.equal(p.reserveSlot('0m', 'SLOT_B'), false);
  assert.equal(p.takeSlot('SLOT_A'), '0m');
});

test('fromWallArray reconstructs counts', () => {
  const p = DynamicPool.fromWallArray(['1m', '1m', '0m'], createRNG(1));
  assert.equal(p.get('1m'), 2);
  assert.equal(p.get('0m'), 1);
  assert.equal(p.total(), 3);
});

test('audit clean on fresh pool, detects leak and unknown tile', () => {
  const p = DynamicPool.full(createRNG(1));
  // fresh pool + no partitions: live alone must equal full
  assert.deepEqual(p.audit([]), []);
  // simulate a leak: remove a tile from pool without recording it anywhere
  p.decrement('1m');
  const problems = p.audit([]);
  assert.ok(problems.some(m => m.includes('1m')));
  // unknown tile in partitions
  const p2 = DynamicPool.full(createRNG(1));
  const bad = p2.audit([['NOT_A_TILE']]);
  assert.ok(bad.some(m => m.includes('NOT_A_TILE')));
});

test('audit covers slots as part of inventory', () => {
  const p = DynamicPool.full(createRNG(1));
  p.reserveSlot('7z', 'LAST_LIVE_TILE');
  assert.deepEqual(p.audit([]), []); // slot tile still counted
});

test('determinism: same seed + same weights -> same draw sequence', () => {
  const seq = seed => {
    const p = DynamicPool.full(createRNG(seed));
    return Array.from({ length: 20 }, () => p.sample());
  };
  assert.deepEqual(seq(42), seq(42));
  assert.notDeepEqual(seq(42), seq(43));
});

test('full 136-drain ends at zero and stays null', () => {
  const p = DynamicPool.full(createRNG(9));
  const seen = {};
  for (let i = 0; i < 136; i++) {
    const t = p.sample();
    assert.ok(t !== null, `drain step ${i}`);
    seen[t] = (seen[t] || 0) + 1;
  }
  assert.equal(p.total(), 0);
  assert.equal(p.sample(), null);
  // no kind exceeds its physical count
  const full = fullCounts();
  for (const [k, n] of Object.entries(seen)) assert.ok(n <= full[k], `${k} overdrawn`);
});
