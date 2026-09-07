const { test } = require('node:test');
const assert = require('node:assert/strict');
const Y = require('../powers/rosters/yuuki');
const { createMatchState, setupDeadWall } = require('../core');

function yuukiState(hand, seed = 101, flow = 0, bakaze = 1) {
  const s = createMatchState({ seed });
  for (const t of hand) s.pool.decrement(t);
  s.players[0].hand = [...hand];
  s.bakaze = bakaze;
  setupDeadWall(s);
  for (let k = 0; k < 13; k++) for (let seat = 1; seat < 4; seat++) s.players[seat].hand.push(s.pool.sample());
  s.scores = [25000, 25000, 25000, 25000];
  s.flow.set(0, flow);
  return s;
}

const SIMPLE_HAND = ['2m', '3m', '4m', '2p', '3p', '4p', '2s', '3s', '4s', '5m', '6m', '7m', '1z'];

test('isSpeedTile: simples + East wind => true, others => false', () => {
  assert.equal(Y.isSpeedTile('2m'), true);
  assert.equal(Y.isSpeedTile('8p'), true);
  assert.equal(Y.isSpeedTile('1z'), true);
  assert.equal(Y.isSpeedTile('1m'), false);
  assert.equal(Y.isSpeedTile('9s'), false);
  assert.equal(Y.isSpeedTile('5z'), false);
});

test('isEastRound / isSouthRound', () => {
  assert.equal(Y.isEastRound({ bakaze: 1 }), true);
  assert.equal(Y.isEastRound({ bakaze: 2 }), false);
  assert.equal(Y.isEastRound({}), true); // default East
  assert.equal(Y.isSouthRound({ bakaze: 2 }), true);
  assert.equal(Y.isSouthRound({ bakaze: 1 }), false);
});

test('East round: speed tiles get 1.30x affinity', () => {
  const s = yuukiState(SIMPLE_HAND, 1, 0, 1);
  const hooks = Y.createYuukiHooks(0);
  assert.equal(hooks.onPowerDraw('2m', s), 1.30);
  assert.equal(hooks.onPowerDraw('1z', s), 1.30);
  assert.equal(hooks.onPowerDraw('9z', s), 1.0); // honor, not East wind
  assert.equal(hooks.onPowerDraw('1m', s), 1.0); // terminal, not simple
});

test('South round: speed tiles NOT boosted (passive off)', () => {
  const s = yuukiState(SIMPLE_HAND, 2, 0, 2);
  const hooks = Y.createYuukiHooks(0);
  assert.equal(hooks.onPowerDraw('2m', s), 1.0);
});

test('T1: quick bite — connector tiles at 8.0', () => {
  // Hand with a gap wait: 2m 3m _m (need 4m or 1m)
  const hand = ['2m', '3m', '5p', '6p', '7p', '2s', '3s', '5s', '6s', '1z', '2z', '3z', '4z'];
  const s = yuukiState(hand, 3, 100, 1);
  const hooks = Y.createYuukiHooks(0);
  const res = hooks.tryActivateTier1(s, 3);
  assert.equal(res.ok, true);
  assert.equal(s.flow.get(0), 75); // 100 - 25
  // After activation, bridge tiles should get 8.0
  const { getOptimalBridges } = require('../powers/trajectoryPlanner');
  const bridges = getOptimalBridges(hand, s.pool, 4);
  if (bridges.length > 0) {
    assert.equal(hooks.onPowerDraw(bridges[0], s), 8.0);
  }
});

test('T1: turn gate — fails after turn 5', () => {
  const s = yuukiState(SIMPLE_HAND, 4, 100, 1);
  const hooks = Y.createYuukiHooks(0);
  assert.equal(hooks.tryActivateTier1(s, 6).ok, false);
  assert.equal(hooks.tryActivateTier1(s, 5).ok, true);
});

test('T2: spicy defense — cleanses sugar crash in South', () => {
  const s = yuukiState(SIMPLE_HAND, 5, 100, 2);
  const hooks = Y.createYuukiHooks(0);
  const res = hooks.tryActivateTier2(s);
  assert.equal(res.ok, true);
  assert.equal(hooks._state().sugarCrashCleansed, true);
  assert.equal(hooks._state().tier2Active, true);
  assert.equal(s.flow.get(0), 50); // 100 - 50
});

test('T2: fails in East round', () => {
  const s = yuukiState(SIMPLE_HAND, 6, 100, 1);
  const hooks = Y.createYuukiHooks(0);
  assert.equal(hooks.tryActivateTier2(s).ok, false);
});

test('T3: east wind onslaught — East wind + Dora at 3.0x', () => {
  const s = yuukiState(SIMPLE_HAND, 7, 150, 1);
  const hooks = Y.createYuukiHooks(0);
  const res = hooks.tryActivateTier3(s, true);
  assert.equal(res.ok, true);
  assert.equal(hooks.onPowerDraw('1z', s), 3.0);
});

test('T3: fails if not dealer', () => {
  const s = yuukiState(SIMPLE_HAND, 8, 150, 1);
  const hooks = Y.createYuukiHooks(0);
  assert.equal(hooks.tryActivateTier3(s, false).ok, false);
});

test('T3: fails in South round', () => {
  const s = yuukiState(SIMPLE_HAND, 9, 150, 2);
  const hooks = Y.createYuukiHooks(0);
  assert.equal(hooks.tryActivateTier3(s, true).ok, false);
});

test('T4: ultimate fiesta — turn 1 blitz in East', () => {
  const tenpaiHand = ['1m', '1m', '1m', '2p', '2p', '2p', '3s', '3s', '3s', '4p', '5p', '6p', '7s'];
  const s = yuukiState(tenpaiHand, 10, 150, 1);
  const hooks = Y.createYuukiHooks(0);
  const res = hooks.tryActivateTier4(s, 1);
  assert.equal(res.ok, true);
  assert.equal(hooks._state().tier4TurnsLeft, 4);
});

test('T4: fails on turn 2+', () => {
  const s = yuukiState(SIMPLE_HAND, 11, 150, 1);
  const hooks = Y.createYuukiHooks(0);
  assert.equal(hooks.tryActivateTier4(s, 2).ok, false);
});

test('T4: winning wait boosted during blitz', () => {
  const tenpaiHand = ['1m', '1m', '1m', '2p', '2p', '2p', '3s', '3s', '3s', '4p', '5p', '6p', '7s'];
  const s = yuukiState(tenpaiHand, 12, 150, 1);
  const hooks = Y.createYuukiHooks(0);
  hooks.tryActivateTier4(s, 1);
  const { hairiOf } = require('../powers/trajectoryPlanner');
  const h = hairiOf(tenpaiHand);
  const waits = h && h.wait ? Object.keys(h.wait) : [];
  assert.ok(waits.length > 0);
  assert.equal(hooks.onPowerDraw(waits[0], s), 3.0);
});

test('tier durations decrement on turn end', () => {
  const s = yuukiState(SIMPLE_HAND, 13, 100, 1);
  const hooks = Y.createYuukiHooks(0);
  hooks.tryActivateTier1(s, 1);
  assert.equal(hooks._state().tier1TurnsLeft, 1);
  hooks.onTurnEnd(s);
  assert.equal(hooks._state().tier1TurnsLeft, 0);
});

test('open meld hook: +10% flow on turns 1–5', () => {
  const s = yuukiState(SIMPLE_HAND, 14, 50, 1);
  const hooks = Y.createYuukiHooks(0);
  const r1 = hooks.onOpenMeld(s, 3);
  assert.equal(r1.flowDelta, 10);
  const r2 = hooks.onOpenMeld(s, 6);
  assert.equal(r2.flowDelta, 0);
});

test('flow generation: East => 3.0, South => 0.75', () => {
  const s = yuukiState(SIMPLE_HAND, 15, 0, 1);
  const hooks = Y.createYuukiHooks(0);
  assert.equal(hooks.onFlowGeneration(s), 3.0);
  const s2 = yuukiState(SIMPLE_HAND, 16, 0, 2);
  assert.equal(hooks.onFlowGeneration(s2), 0.75);
});

test('settlement: South deal-in drains 25% flow', () => {
  const s = yuukiState(SIMPLE_HAND, 17, 50, 2);
  const hooks = Y.createYuukiHooks(0);
  const r = hooks.onSettlement({ type: 'ron', from: 0 }, s);
  assert.equal(r.scoreMultiplier, 1.15);
  assert.equal(s.flow.get(0), 25); // 50 - 25
});

test('insufficient flow rejected for all tiers', () => {
  const s = yuukiState(SIMPLE_HAND, 18, 10, 1);
  const hooks = Y.createYuukiHooks(0);
  assert.equal(hooks.tryActivateTier1(s, 1).ok, false);
  assert.equal(hooks.tryActivateTier2(s).ok, false);
  assert.equal(hooks.tryActivateTier3(s, true).ok, false);
  assert.equal(hooks.tryActivateTier4(s, 1).ok, false);
});
