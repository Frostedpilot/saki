const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../powers/rosters/mako');
const { createMatchState, setupDeadWall } = require('../core');
const { shantenOf } = require('../powers/trajectoryPlanner');

function makoState(hand, seed = 101, flow = 0, turn = 7) {
  const s = createMatchState({ seed });
  for (const t of hand) s.pool.decrement(t);
  s.players[0].hand = [...hand];
  setupDeadWall(s);
  for (let k = 0; k < 13; k++) for (let seat = 1; seat < 4; seat++) s.players[seat].hand.push(s.pool.sample());
  s.scores = [25000, 25000, 25000, 25000];
  s.flow.set(0, flow);
  s._turn = turn;
  return s;
}

// 1-shanten hand needing bridges for T3
const SHANTEN1_HAND = ['2m', '3m', '5p', '6p', '7p', '2s', '3s', '5s', '6s', '1z', '1z', '2z', '2z'];

// Tenpai hand for T4
const TENPAI_HAND = ['1m', '1m', '1m', '2p', '2p', '2p', '3s', '3s', '3s', '4p', '5p', '6p', '7s'];

test('computeFlowPerTurn: 0 for turns 1–6, ramp from turn 7', () => {
  assert.equal(M.computeFlowPerTurn(1), 0);
  assert.equal(M.computeFlowPerTurn(6), 0);
  assert.equal(M.computeFlowPerTurn(7), 2.5);
  assert.equal(M.computeFlowPerTurn(8), 3.0);
  assert.equal(M.computeFlowPerTurn(9), 3.5);
  assert.equal(M.computeFlowPerTurn(12), 5.0);
});

test('isSafeAgainst: tile in opponent river => safe', () => {
  assert.equal(M.isSafeAgainst('3m', ['3m', '5p', '7s']), true);
  assert.equal(M.isSafeAgainst('4m', ['3m', '5p', '7s']), false);
  assert.equal(M.isSafeAgainst('0m', ['5m']), true); // aka = norm 5m
});

test('T1: match recognition — identifies safe tiles, costs 25 flow', () => {
  const s = makoState(TENPAI_HAND, 1, 100, 7);
  // Give seat 1 two melds and a discard river containing 5p (in TENPAI_HAND)
  s.players[1].melds = [{ type: 'chi' }, { type: 'pon' }];
  s.players[1].discards = ['3m', '5p'];
  const hooks = M.createMakoHooks(0);
  const res = hooks.tryActivateTier1(s, 7);
  assert.equal(res.ok, true);
  assert.ok(res.safeTiles.includes('5p')); // safe against seat 1 (in hand + river)
  assert.equal(s.flow.get(0), 75); // 100 - 25
  assert.equal(hooks._state().tier1TurnsLeft, 3);
});

test('T1: fails before turn 7', () => {
  const s = makoState(TENPAI_HAND, 2, 100, 6);
  const hooks = M.createMakoHooks(0);
  assert.equal(hooks.tryActivateTier1(s, 6).ok, false);
});

test('T2: flow reroute — +40% uke-ire boost for 3 draws', () => {
  const s = makoState(SHANTEN1_HAND, 3, 100, 8);
  const hooks = M.createMakoHooks(0);
  const res = hooks.tryActivateTier2(s, 8);
  assert.equal(res.ok, true);
  assert.equal(hooks._state().tier2TurnsLeft, 3);
  assert.equal(s.flow.get(0), 50);
});

test('T2: fails outside turns 7–12', () => {
  const s = makoState(SHANTEN1_HAND, 4, 100, 13);
  const hooks = M.createMakoHooks(0);
  assert.equal(hooks.tryActivateTier2(s, 13).ok, false);
});

test('T3: river mirroring — steals opponent bridge tiles at 5.0x', () => {
  const s = makoState(SHANTEN1_HAND, 5, 150, 9);
  // Give seat 1 a hand with some bridge tiles
  s.players[1].hand = ['2m', '3m', '4m', '5p', '6p', '7p', '8s', '9s', '1z', '2z', '3z', '4z', '5z'];
  const hooks = M.createMakoHooks(0);
  const res = hooks.tryActivateTier3(s, 1);
  assert.equal(res.ok, true);
  assert.equal(res.target, 1);
  assert.equal(hooks._state().tier3Target, 1);
  assert.equal(hooks._state().tier3TurnsLeft, 4);
  // Draw a bridge tile for seat 1
  const { getOptimalBridges } = require('../powers/trajectoryPlanner');
  const bridges = getOptimalBridges(s.players[1].hand, s.pool, 4);
  if (bridges.length > 0) {
    const w = hooks.onPowerDraw(bridges[0], s, 0); // drawSeat=0 (Mako)
    assert.equal(w, 5.0);
  }
});

test('T3: invalid target rejected', () => {
  const s = makoState(SHANTEN1_HAND, 6, 150, 9);
  const hooks = M.createMakoHooks(0);
  assert.equal(hooks.tryActivateTier3(s, 0).ok, false); // self
  assert.equal(hooks.tryActivateTier3(s, 5).ok, false); // out of range
});

test('T4: omnipresent recall — wait knowledge returned', () => {
  const s = makoState(TENPAI_HAND, 7, 150, 10);
  const hooks = M.createMakoHooks(0);
  const res = hooks.tryActivateTier4(s, 10);
  assert.equal(res.ok, true);
  assert.equal(hooks._state().tier4Active, true);
  assert.equal(s.flow.get(0), 0);
  // Should contain wait info for opponents
  assert.ok(typeof res.waitsBySeat === 'object');
});

test('T4: winning wait gets 4.0x weight', () => {
  const s = makoState(TENPAI_HAND, 8, 150, 10);
  const hooks = M.createMakoHooks(0);
  hooks.tryActivateTier4(s, 10);
  const { hairiOf } = require('../powers/trajectoryPlanner');
  const h = hairiOf(TENPAI_HAND);
  const waits = h && h.wait ? Object.keys(h.wait) : [];
  assert.ok(waits.length > 0);
  assert.equal(hooks.onPowerDraw(waits[0], s, 0), 4.0);
});

test('T4: precondition — must be tenpai', () => {
  const s = makoState(SHANTEN1_HAND, 9, 150, 10);
  const hooks = M.createMakoHooks(0);
  assert.equal(hooks.tryActivateTier4(s, 10).ok, false);
});

test('T4: turn gate 8–16', () => {
  const s = makoState(TENPAI_HAND, 10, 150, 7);
  const hooks = M.createMakoHooks(0);
  assert.equal(hooks.tryActivateTier4(s, 7).ok, false);
  assert.equal(hooks.tryActivateTier4(s, 17).ok, false);
});

test('flow generation: delayed ignition (0 for turns 1–6)', () => {
  const s = makoState(TENPAI_HAND, 11, 0, 5);
  const hooks = M.createMakoHooks(0);
  assert.equal(hooks.onFlowGeneration(s, 5), 0);
  assert.equal(hooks.onFlowGeneration(s, 7), 2.5);
  assert.equal(hooks.onFlowGeneration(s, 8), 3.0);
});

test('tier durations decrement on turn end', () => {
  const s = makoState(TENPAI_HAND, 12, 150, 8);
  const hooks = M.createMakoHooks(0);
  hooks.tryActivateTier1(s, 8);
  hooks.tryActivateTier2(s, 8);
  assert.equal(hooks._state().tier1TurnsLeft, 3);
  assert.equal(hooks._state().tier2TurnsLeft, 3);
  hooks.onTurnEnd(s);
  assert.equal(hooks._state().tier1TurnsLeft, 2);
  assert.equal(hooks._state().tier2TurnsLeft, 2);
});

test('safe discard bonus: +15% when discarding safe tile vs multi-meld opponent', () => {
  const s = makoState(TENPAI_HAND, 13, 50, 8);
  s.players[1].melds = [{ type: 'chi' }, { type: 'pon' }];
  s.players[1].discards = ['3m'];
  const hooks = M.createMakoHooks(0);
  hooks.tryActivateTier1(s, 8); // activate safe tile mode
  const r = hooks.onDiscard('3m', s); // safe against seat 1
  assert.equal(r.flowDelta, 15);
});

test('insufficient flow rejected', () => {
  const s = makoState(TENPAI_HAND, 14, 10, 8);
  const hooks = M.createMakoHooks(0);
  assert.equal(hooks.tryActivateTier1(s, 8).ok, false);
  assert.equal(hooks.tryActivateTier2(s, 8).ok, false);
  assert.equal(hooks.tryActivateTier3(s, 1).ok, false);
  assert.equal(hooks.tryActivateTier4(s, 10).ok, false);
});
