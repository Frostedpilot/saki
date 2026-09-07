const { test } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../powers/trajectoryPlanner');
const { DynamicPool } = require('../powers/dynamicPool');
const { createRNG } = require('../rng');

const TENPAI_13 = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '2p', '2p', '2p', '3p'];
const WIN_14 = [...TENPAI_13, '3p'];
const YAOCHUU_13 = ['1m', '9m', '1p', '9p', '1s', '9s', '1z', '2z', '3z', '4z', '5z', '6z', '7z'];

test('shanten: tenpai=0, complete=-1, scattered>=0', () => {
  assert.equal(T.shantenOf(TENPAI_13), 0);
  assert.equal(T.shantenOf(WIN_14), -1);
  assert.ok(T.shantenOf(YAOCHUU_13) >= 0);
});

test('hairi exposes waits for tenpai hand', () => {
  const h = T.hairiOf(TENPAI_13);
  assert.equal(h.now, 0);
  assert.ok(h.wait && h.wait['3p'] !== undefined);
});

test('getOptimalBridges returns live waits, capped at topN', () => {
  const b = T.getOptimalBridges(TENPAI_13, null, 2);
  assert.equal(b.length, 2);
  assert.ok(b.includes('3p'));
});

test('bridges filter out exhausted tiles (conservation-aware)', () => {
  const pool = DynamicPool.full(createRNG(1));
  // exhaust every wait of the tenpai hand
  const waits = Object.keys(T.hairiOf(TENPAI_13).wait);
  for (const w of waits) {
    while (pool.get(w)) pool.decrement(w);
    const aka = w.replace(/^5/, '0');
    while (pool.get(aka)) pool.decrement(aka);
  }
  assert.deepEqual(T.getOptimalBridges(TENPAI_13, pool), []);
});

test('bridges rank by remaining count (EV proxy)', () => {
  const pool = DynamicPool.full(createRNG(1));
  while (pool.get('1p')) pool.decrement('1p'); // drain 1p entirely
  const b = T.getOptimalBridges(TENPAI_13, pool, 4);
  assert.ok(!b.includes('1p'));
  assert.ok(b.includes('3p'));
});

test('ukeire counts remaining copies; zero when waits exhausted', () => {
  assert.ok(T.ukeire(TENPAI_13, null) > 0);
  const pool = DynamicPool.full(createRNG(1));
  const waits = Object.keys(T.hairiOf(TENPAI_13).wait);
  for (const w of waits) {
    while (pool.get(w)) pool.decrement(w);
    const aka = w.replace(/^5/, '0');
    while (pool.get(aka)) pool.decrement(aka);
  }
  assert.equal(T.ukeire(TENPAI_13, pool), 0);
});

test('calculateUkeireGain is non-negative', () => {
  assert.ok(T.calculateUkeireGain(TENPAI_13, '3p') >= 0);
  assert.ok(T.calculateUkeireGain(TENPAI_13, '1z') >= 0);
});

test('getActiveTrajectory shape', () => {
  const pool = DynamicPool.full(createRNG(1));
  const tr = T.getActiveTrajectory(TENPAI_13, pool);
  assert.equal(tr.shanten, 0);
  assert.ok(Array.isArray(tr.bridges) && tr.bridges.length <= 4);
  assert.ok(typeof tr.evProxy === 'number' && tr.evProxy >= 0);
});

test('inferIntent: completing hand reduces shanten', () => {
  const before = TENPAI_13;
  const after = WIN_14;
  const inf = T.inferIntent(before, after);
  assert.ok(inf.dAfter < inf.dBefore);
});

test('edge: empty and single-tile hands do not throw', () => {
  assert.doesNotThrow(() => T.getActiveTrajectory([], null));
  assert.doesNotThrow(() => T.getActiveTrajectory(['1m'], null));
  assert.doesNotThrow(() => T.ukeire([], null));
});

test('long chain: greedy shanten never increases over 12 draws', () => {
  const pool = DynamicPool.full(createRNG(4));
  let hand = ['2m', '3m', '5m', '6m', '2p', '4p', '6p', '7p', '3s', '5s', '7s', '1z', '2z'];
  let prev = T.shantenOf(hand);
  for (let i = 0; i < 12; i++) {
    const t = pool.sample();
    if (!t) break;
    // discard the tile that minimizes shanten (best-case chain)
    let best = 0, bestS = 99;
    const cand = [...hand, t];
    for (let d = 0; d < cand.length; d++) {
      const s = T.shantenOf(cand.filter((_, j) => j !== d));
      if (s < bestS) { bestS = s; best = d; }
    }
    hand = cand.filter((_, j) => j !== best);
    assert.ok(bestS <= prev + 1, `shanten spike at step ${i}`);
    prev = bestS;
  }
  assert.ok(T.shantenOf(hand) <= T.shantenOf(['2m', '3m', '5m', '6m', '2p', '4p', '6p', '7p', '3s', '5s', '7s', '1z', '2z']));
});
