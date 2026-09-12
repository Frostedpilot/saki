const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../powers/rosters/kiyosumi');
const { createMatchState, setupDeadWall, dealHands } = require('../core');
const { PowerDispatcher } = require('../powers/index');
const { createRNG } = require('../rng');

const TENPAI_13 = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '2p', '2p', '2p', '3p'];

function sakiState(seed = 42, score = 25000, hand = null) {
  const s = createMatchState({ seed });
  if (hand) {
    // scripted hand is taken from the FULL pool first, so its tiles are
    // guaranteed available; dead wall + other seats are dealt afterwards.
    for (const t of hand) s.pool.decrement(t);
    s.players[0].hand = [...hand];
    setupDeadWall(s);
    for (let k = 0; k < 13; k++) for (let seat = 1; seat < 4; seat++) s.players[seat].hand.push(s.pool.sample());
  } else {
    setupDeadWall(s); dealHands(s);
  }
  s.scores = [25000, 25000, 25000, 25000];
  s.scores[0] = score;
  return s;
}

// --- Spec §7.1: Equilibrium Boundary ---
test('equilibrium active at 25000 -> 1.35 on pair-completer', () => {
  const hand = ['7p', '7p', '1m', '2m', '3m', '4p', '5p', '6p', '2s', '3s', '4s', '1z', '1z'];
  assert.equal(S.passiveWeight('7p', hand, 25000), 1.35);
});

test('equilibrium inactive at 27000 -> 1.0', () => {
  const hand = ['7p', '7p', '1m', '2m', '3m', '4p', '5p', '6p', '2s', '3s', '4s', '1z', '1z'];
  assert.equal(S.passiveWeight('7p', hand, 27000), 1.0);
});

test('band edges: ±1500 active, ±1501 inactive', () => {
  const hand = ['7p', '7p'];
  assert.equal(S.evaluateEquilibrium(23500), true);
  assert.equal(S.evaluateEquilibrium(26500), true);
  assert.equal(S.evaluateEquilibrium(23499), false);
  assert.equal(S.evaluateEquilibrium(26501), false);
  assert.equal(S.passiveWeight('7p', hand, 23500), 1.35);
  assert.equal(S.passiveWeight('7p', hand, 23499), 1.0);
});

test('passive fires only on exactly 2 copies (0/1/3 -> 1.0)', () => {
  assert.equal(S.passiveWeight('7p', [], 25000), 1.0);
  assert.equal(S.passiveWeight('7p', ['7p'], 25000), 1.0);
  assert.equal(S.passiveWeight('7p', ['7p', '7p', '7p'], 25000), 1.0);
  assert.equal(S.passiveWeight('7p', ['7p', '7p', '7p', '7p'], 25000), 1.0);
});

test('aka-aware: hand 5m+0m counts as pair for 5m candidate', () => {
  const hand = ['5m', '0m', '1p', '2p'];
  assert.equal(S.passiveWeight('5m', hand, 25000), 1.35);
  assert.equal(S.passiveWeight('0m', hand, 25000), 1.35);
});

test('dispatcher integration: pair-completer weighted 1.35 via computeDrawWeights', () => {
  const d = new PowerDispatcher();
  const hooks = S.createSakiHooks(0);
  d.register(0, hooks);
  const s = sakiState(1, 25000, ['7p', '7p', '1m', '2m', '3m', '4p', '5p', '6p', '2s', '3s', '4s', '1z', '1z']);
  s.powers = d;
  const traj = { bridges: [] };
  const w = d.computeDrawWeights(0, s, traj);
  assert.equal(w['7p'], 1.35);
  assert.equal(w['1m'], 1.0);
  assert.equal(d.drawWeight(1, '7p', s, traj), 1.0); // other seats unaffected
});

// --- Tier 1: Ridge Glimmer (guaranteed rinshan) ---
test('T1 tenpai branch: pins exact live win, consumes 25 flow', () => {
  const s = sakiState(10, 25000, TENPAI_13);
  s.flow.set(0, 100);
  const hooks = S.createSakiHooks(0);
  const res = hooks.tryActivateTier1(s);
  assert.equal(res.ok, true);
  assert.equal(res.branch, 'win');
  assert.equal(res.pinned, true);
  assert.ok(res.pin, 'must pin a tile');
  assert.equal(s.deadWall[0], res.pin, 'on-deck slot holds the pinned win');
  assert.ok(res.waits.length > 0);
  assert.equal(res.weightOf('3p'), 10.0);
  assert.equal(res.weightOf('1z'), 1.0);
  assert.equal(s.flow.get(0), 75);
  assert.deepEqual(res.event, { type: 'RINSHAN_RESONANCE_TRIGGER', tier: 1 });
});

test('T1 fallback: non-tenpai -> pins best ukeire tile', () => {
  const hand = ['2m', '3m', '5m', '6m', '2p', '4p', '6p', '7p', '3s', '5s', '7s', '1z', '2z'];
  const s = sakiState(11, 25000, hand);
  s.flow.set(0, 50);
  const res = S.createSakiHooks(0).tryActivateTier1(s);
  assert.equal(res.ok, true);
  assert.equal(res.branch, 'advance');
  assert.equal(res.pinned, true);
  assert.equal(s.deadWall[0], res.pin, 'on-deck slot holds best ukeire');
  // every boosted tile is a genuine ukeire tile; non-ukeire stays 1.0
  const { hairiOf } = require('../powers/trajectoryPlanner');
  const uke = new Set(Object.keys(hairiOf(hand).wait || {}).map(t => (t[0] === '0' ? '5' + t[1] : t)));
  assert.ok(res.waits.every(w => uke.has(w)));
  assert.equal(s.flow.get(0), 25);
});

test('T1 exhaustion fallback: waits dead in pool -> safe ukeire branch, no throw', () => {
  const s = sakiState(12, 25000, TENPAI_13);
  s.flow.set(0, 100);
  // exhaust all tenpai waits from the live pool
  const { hairiOf } = require('../powers/trajectoryPlanner');
  for (const w of Object.keys(hairiOf(TENPAI_13).wait)) {
    while (s.pool.get(w)) s.pool.decrement(w);
    const aka = w.replace(/^5/, '0');
    if (aka !== w) while (s.pool.get(aka)) s.pool.decrement(aka);
  }
  const res = S.createSakiHooks(0).tryActivateTier1(s);
  assert.equal(res.ok, true);
  assert.equal(res.branch, 'ukeire');
  assert.deepEqual(res.waits, []);
  // sampling with exhausted waits never conjures a ghost tile
  for (let i = 0; i < 20 && s.pool.total() > 0; i++) {
    const t = s.pool.sample(res.weightOf);
    assert.ok(t === null || !res.waits.includes(t));
  }
});

test('T1 insufficient flow -> rejected, flow untouched', () => {
  const s = sakiState(13, 25000, TENPAI_13);
  s.flow.set(0, 24.9);
  const res = S.createSakiHooks(0).tryActivateTier1(s);
  assert.equal(res.ok, false);
  assert.equal(s.flow.get(0), 24.9);
});

test('T1 weights conserve: boosted rinshan draw keeps audit clean', () => {
  const s = sakiState(20, 25000, TENPAI_13);
  s.flow.set(0, 100);
  const res = S.createSakiHooks(0).tryActivateTier1(s);
  assert.equal(res.ok, true);
  const drawn = s.pool.sample(res.weightOf);
  assert.ok(typeof drawn === 'string');
  s.players[0].hand.push(drawn);
  const parts = [...s.players.flatMap(p => [p.hand, p.discards]), s.deadWall];
  assert.deepEqual(s.pool.audit(parts), []);
});

test('T1 deterministic weights: same hand+pool state -> same branch', () => {
  const mk = () => {
    const s = sakiState(30, 25000, TENPAI_13);
    s.flow.set(0, 100);
    return S.createSakiHooks(0).tryActivateTier1(s);
  };
  const a = mk(), b = mk();
  assert.equal(a.branch, b.branch);
  assert.deepEqual(a.waits, b.waits);
});

// --- Settlement ---
test('settlement: RINSHAN tsumo consumes all flow; other wins untouched', () => {
  const hooks = S.createSakiHooks(0);
  const s = sakiState(40);
  s.flow.set(0, 120);
  hooks.onSettlement({ type: 'tsumo', winner: 0, tag: 'RINSHAN KAIHOU' }, s);
  assert.equal(s.flow.get(0), 0);
  s.flow.set(0, 120);
  hooks.onSettlement({ type: 'tsumo', winner: 0, tag: 'MENZEN TSUMO' }, s);
  assert.equal(s.flow.get(0), 120);
  hooks.onSettlement({ type: 'tsumo', winner: 1, tag: 'RINSHAN' }, s);
  assert.equal(s.flow.get(0), 120); // another seat's win: untouched
});

test('equilibrium HUD event shape', () => {
  assert.deepEqual(S.equilibriumEvent(25000), { type: 'SAKI_EQUILIBRIUM_STATE', active: true, delta: 0 });
  assert.deepEqual(S.equilibriumEvent(27000), { type: 'SAKI_EQUILIBRIUM_STATE', active: false, delta: 2000 });
});
