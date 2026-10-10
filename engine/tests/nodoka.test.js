const { test } = require('node:test');
const assert = require('node:assert/strict');
const N = require('../powers/rosters/nodoka');
const { createMatchState, setupDeadWall } = require('../core');
const { shantenOf } = require('../powers/trajectoryPlanner');

function nodokaState(hand, seed = 101, flow = 0) {
  const s = createMatchState({ seed });
  for (const t of hand) s.pool.decrement(t);
  s.players[0].hand = [...hand];
  setupDeadWall(s);
  for (let k = 0; k < 13; k++) for (let seat = 1; seat < 4; seat++) s.players[seat].hand.push(s.pool.sample());
  s.scores = [25000, 25000, 25000, 25000];
  s.flow.set(0, flow);
  return s;
}

// T1 hand: terminal-heavy (isolated 1m, 9s, 1z can be filtered)
const T1_HAND = ['1m', '2m', '3m', '4p', '5p', '6p', '7s', '8s', '1z', '2z', '3z', '5m', '7m'];

// T3 hand: 1-shanten needing bridges
const T3_HAND = ['2m', '3m', '5p', '6p', '7p', '2s', '3s', '5s', '6s', '1z', '1z', '2z', '2z'];

test('isNodocchi returns true at 50+', () => {
  assert.equal(N.isNodocchi(49), false);
  assert.equal(N.isNodocchi(50), true);
  assert.equal(N.isNodocchi(100), true);
});

test('isDeadTerminalOrHonor: isolated terminal/honor => true, pair => false', () => {
  const hand = ['1m', '1m', '2m', '3m', '5p', '5p', '5p', '9s', '1z', '2z'];
  assert.equal(N.isDeadTerminalOrHonor('1m', hand), false); // pair
  assert.equal(N.isDeadTerminalOrHonor('9s', hand), true); // isolated
  assert.equal(N.isDeadTerminalOrHonor('1z', hand), true); // isolated
  assert.equal(N.isDeadTerminalOrHonor('5m', hand), false); // not terminal/honor
  assert.equal(N.isDeadTerminalOrHonor('2m', hand), false); // not terminal
});

test('T1: statistical filter blocks isolated terminals/honors (weight 0.0)', () => {
  const s = nodokaState(T1_HAND, 1, 100);
  const hooks = N.createNodokaHooks(0);
  const res = hooks.tryActivateTier1(s);
  assert.equal(res.ok, true);
  // After activation, next 3 draws filter dead terminals
  const w1m = hooks.onPowerDraw('1m', s);
  const w1z = hooks.onPowerDraw('1z', s);
  const w5m = hooks.onPowerDraw('5m', s);
  assert.equal(w1m, 0.0); // isolated terminal filtered
  assert.equal(w1z, 0.0); // isolated honor filtered
  assert.ok(w5m > 0); // suited tile not filtered
});

test('T1: insufficient flow rejected', () => {
  const s = nodokaState(T1_HAND, 2, 10);
  const hooks = N.createNodokaHooks(0);
  assert.equal(hooks.tryActivateTier1(s).ok, false);
});

test('T2: optimal discard matrix activates', () => {
  const s = nodokaState(T1_HAND, 3, 100);
  const hooks = N.createNodokaHooks(0);
  const res = hooks.tryActivateTier2(s);
  assert.equal(res.ok, true);
  assert.equal(hooks._state().tier2Active, true);
  assert.equal(s.flow.get(0), 50); // 100 - 50
});

test('T3: shanten compression — precondition requires shanten 1–2', () => {
  const s = nodokaState(T3_HAND, 4, 150);
  const hooks = N.createNodokaHooks(0);
  const sh = shantenOf(T3_HAND);
  assert.ok(sh >= 1 && sh <= 2, `shanten ${sh}`);
  const res = hooks.tryActivateTier3(s);
  assert.equal(res.ok, true);
  assert.equal(s.flow.get(0), 50); // 150 - 100
});

test('T3: bridge tiles get 15.0 weight during compression', () => {
  const s = nodokaState(T3_HAND, 5, 150);
  const hooks = N.createNodokaHooks(0);
  hooks.tryActivateTier3(s);
  const { getOptimalBridges } = require('../powers/trajectoryPlanner');
  const bridges = getOptimalBridges(T3_HAND, s.pool, 2);
  assert.ok(bridges.length > 0);
  const w = hooks.onPowerDraw(bridges[0], s);
  assert.equal(w, 15.0);
});

test('T4: ev singularity — precondition requires tenpai', () => {
  const tenpaiHand = ['1m', '1m', '1m', '2p', '2p', '2p', '3s', '3s', '3s', '4p', '5p', '6p', '7s'];
  assert.equal(shantenOf(tenpaiHand), 0);
  const s = nodokaState(tenpaiHand, 6, 150);
  const hooks = N.createNodokaHooks(0);
  const res = hooks.tryActivateTier4(s);
  assert.equal(res.ok, true);
  assert.equal(s.flow.get(0), 0);
});

test('T4: winning wait gets 4.0x weight', () => {
  const tenpaiHand = ['1m', '1m', '1m', '2p', '2p', '2p', '3s', '3s', '3s', '4p', '5p', '6p', '7s'];
  const s = nodokaState(tenpaiHand, 7, 150);
  const hooks = N.createNodokaHooks(0);
  hooks.tryActivateTier4(s);
  const { hairiOf } = require('../powers/trajectoryPlanner');
  const h = hairiOf(tenpaiHand);
  const waits = h && h.wait ? Object.keys(h.wait) : [];
  assert.ok(waits.length > 0);
  const w = hooks.onPowerDraw(waits[0], s);
  assert.equal(w, 4.0);
});

test('T4: non-wait tile gets normal weight 1.0', () => {
  const tenpaiHand = ['1m', '1m', '1m', '2p', '2p', '2p', '3s', '3s', '3s', '4p', '5p', '6p', '7s'];
  const s = nodokaState(tenpaiHand, 8, 150);
  const hooks = N.createNodokaHooks(0);
  hooks.tryActivateTier4(s);
  const w = hooks.onPowerDraw('9z', s); // definitely not a wait
  assert.equal(w, 1.0);
});

test('T4: precondition fails if not tenpai', () => {
  const s = nodokaState(T3_HAND, 9, 150);
  const hooks = N.createNodokaHooks(0);
  assert.equal(hooks.tryActivateTier4(s).ok, false);
});

test('Nodocchi Mode: uke-ire boost on draw', () => {
  const s = nodokaState(T3_HAND, 10, 60); // >= 50
  const hooks = N.createNodokaHooks(0);
  const bridges = require('../powers/trajectoryPlanner').getOptimalBridges(T3_HAND, s.pool, 2);
  if (bridges.length > 0) {
    const w = hooks.onPowerDraw(bridges[0], s);
    assert.ok(w >= 1.0, `nodocchi weight ${w}`);
  }
});

test('tier durations decrement on turn end', () => {
  const s = nodokaState(T1_HAND, 11, 100);
  const hooks = N.createNodokaHooks(0);
  hooks.tryActivateTier1(s);
  assert.equal(hooks._state().tier1TurnsLeft, 3);
  hooks.onTurnEnd(s);
  assert.equal(hooks._state().tier1TurnsLeft, 2);
  hooks.onTurnEnd(s);
  assert.equal(hooks._state().tier1TurnsLeft, 1);
  hooks.onTurnEnd(s);
  assert.equal(hooks._state().tier1TurnsLeft, 0);
});

test('findOptimalDiscard returns a max-ukeire discard (ties allowed)', () => {
  const hand = ['2m', '3m', '5p', '6p', '7p', '2s', '3s', '5s', '6s', '1z', '1z', '2z', '2z', '1m'];
  const { tile, uke } = N.findOptimalDiscard(hand, null);
  assert.ok(tile !== null && uke > 0);
  // Recompute the true max across all discards and verify consistency
  let max = -1;
  const { ukeire } = require('../powers/trajectoryPlanner');
  for (const t of [...new Set(hand)]) {
    const rest = hand.filter((_, i) => i !== hand.indexOf(t));
    max = Math.max(max, ukeire(rest, null));
  }
  assert.equal(uke, max);
});

test('settlement resets tier2', () => {
  const s = nodokaState(T1_HAND, 12, 100);
  const hooks = N.createNodokaHooks(0);
  hooks.tryActivateTier2(s);
  assert.equal(hooks._state().tier2Active, true);
  hooks.onSettlement({ type: 'tsumo', winner: 0, tag: 'test' }, s);
  assert.equal(hooks._state().tier2Active, false);
});

test('flow audit: T1 consume leaves correct remainder', () => {
  const s = nodokaState(T1_HAND, 13, 30);
  const hooks = N.createNodokaHooks(0);
  const res = hooks.tryActivateTier1(s);
  assert.equal(res.ok, true);
  assert.equal(s.flow.get(0), 5); // 30 - 25
});
