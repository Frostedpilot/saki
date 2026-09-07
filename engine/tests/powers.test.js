const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PowerDispatcher } = require('../powers/index');
const { DynamicPool } = require('../powers/dynamicPool');
const { createRNG } = require('../rng');

function fakeState(pool) {
  return { pool, players: [{ hand: [] }] };
}

test('defaults with empty registry: weight 1.0, clock 10s, null hooks', () => {
  const d = new PowerDispatcher();
  const pool = DynamicPool.full(createRNG(1));
  assert.equal(d.drawWeight(0, '1m', fakeState(pool), {}), 1.0);
  assert.deepEqual(d.onPreDeal(0, {}), null);
  assert.deepEqual(d.onWallSetup(0, {}), null);
  assert.equal(d.getTurnClock(0, {}), 10);
  const w = { '1m': 2 };
  assert.equal(d.applyFieldAura(0, w, {}), w);
  assert.doesNotThrow(() => d.onSettlement({ type: 'tsumo' }, {}));
  assert.doesNotThrow(() => d.onPostDraw(0, '1m', fakeState(pool)));
});

test('computeDrawWeights defaults to all 1.0', () => {
  const d = new PowerDispatcher();
  const pool = DynamicPool.full(createRNG(1));
  const w = d.computeDrawWeights(0, fakeState(pool), {});
  assert.ok(Object.keys(w).length > 30);
  assert.ok(Object.values(w).every(v => v === 1.0));
});

test('registered hook controls weights', () => {
  const d = new PowerDispatcher();
  d.register(0, { onPowerDraw: () => 3.0 });
  const pool = DynamicPool.full(createRNG(1));
  assert.equal(d.drawWeight(0, '5p', fakeState(pool), {}), 3.0);
  assert.equal(d.drawWeight(1, '5p', fakeState(pool), {}), 1.0); // other seat unaffected
});

test('throwing / NaN hooks fall back to 1.0', () => {
  const d = new PowerDispatcher();
  d.register(0, { onPowerDraw: () => { throw new Error('x'); } });
  d.register(1, { onPowerDraw: () => NaN });
  d.register(2, { onPowerDraw: () => -1 });
  const pool = DynamicPool.full(createRNG(1));
  assert.equal(d.drawWeight(0, '1m', fakeState(pool), {}), 1.0);
  assert.equal(d.drawWeight(1, '1m', fakeState(pool), {}), 1.0);
  assert.equal(d.drawWeight(2, '1m', fakeState(pool), {}), 1.0); // negative rejected -> 1.0
});

test('clear() removes hooks', () => {
  const d = new PowerDispatcher();
  d.register(0, { onPowerDraw: () => 9.0 });
  d.clear(0);
  assert.equal(d.drawWeight(0, '1m', fakeState(DynamicPool.full(createRNG(1))), {}), 1.0);
});

test('biased hook actually biases sampling (statistical, seeded)', () => {
  const d = new PowerDispatcher();
  d.register(0, { onPowerDraw: tile => (tile === '7z' ? 50.0 : 1.0) });
  let hits = 0;
  const N = 60;
  for (let i = 0; i < N; i++) {
    const pool = DynamicPool.full(createRNG(1000 + i));
    const w = d.computeDrawWeights(0, fakeState(pool), {});
    const t = pool.sample(w);
    if (t === '7z') hits++;
  }
  // P(7z) baseline = 4/136 ≈ 3%; at 50x ≈ 60%. Require >40% to avoid flake.
  assert.ok(hits > N * 0.4, `biased hits ${hits}/${N}`);
});

test('field aura + turn clock + settlement hooks fire', () => {
  const d = new PowerDispatcher();
  let settled = 0;
  d.register(2, {
    applyFieldAura: w => ({ ...w, X: 1 }),
    getTurnClock: () => 6,
    onSettlement: () => { settled++; },
  });
  assert.equal(d.getTurnClock(2, {}), 6);
  assert.deepEqual(d.applyFieldAura(2, {}, {}), { X: 1 });
  d.onSettlement({ type: 'ron' }, {});
  assert.equal(settled, 1);
});
