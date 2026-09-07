const { test } = require('node:test');
const assert = require('node:assert/strict');
const K = require('../powers/rosters/koromo');
const { createMatchState, setupDeadWall } = require('../core');
const { shantenOf } = require('../powers/trajectoryPlanner');

function koromoState(hand, seed = 101, flow = 0) {
  const s = createMatchState({ seed });
  for (const t of hand) s.pool.decrement(t);
  s.players[0].hand = [...hand];
  setupDeadWall(s);
  for (let k = 0; k < 13; k++) for (let seat = 1; seat < 4; seat++) s.players[seat].hand.push(s.pool.sample());
  s.scores = [25000, 25000, 25000, 25000];
  s.flow.set(0, flow);
  return s;
}

// Tenpai hand for T3/T4
const TENPAI_HAND = ['1m', '1m', '1m', '2p', '2p', '2p', '3s', '3s', '3s', '4p', '5p', '6p', '7s'];

// 1-shanten hand for T2 testing
const SHANTEN1_HAND = ['2m', '3m', '5p', '6p', '7p', '2s', '3s', '5s', '6s', '1z', '1z', '2z', '2z'];

test('lunarPhase: hands 1–2 => crescent, 3+ => full', () => {
  assert.equal(K.lunarPhase(1), 'crescent');
  assert.equal(K.lunarPhase(2), 'crescent');
  assert.equal(K.lunarPhase(3), 'full');
  assert.equal(K.lunarPhase(4), 'full');
});

test('lunarFlowMultiplier: crescent 0.75x, full 1.50x', () => {
  assert.equal(K.lunarFlowMultiplier(1), 0.75);
  assert.equal(K.lunarFlowMultiplier(3), 1.50);
});

test('flow generation: crescent => 1.125, full => 2.25', () => {
  const s = koromoState(TENPAI_HAND, 1);
  const hooks = K.createKoromoHooks(0);
  const crescentFlow = hooks.onFlowGeneration(s, 1, 1);
  const fullFlow = hooks.onFlowGeneration(s, 1, 3);
  assert.equal(crescentFlow, 1.125); // 1.5 * 0.75
  assert.equal(fullFlow, 2.25);     // 1.5 * 1.50
});

test('T1: chilling gaze — hesitation drain activates', () => {
  const s = koromoState(TENPAI_HAND, 2, 100);
  const hooks = K.createKoromoHooks(0);
  const res = hooks.tryActivateTier1(s, 10);
  assert.equal(res.ok, true);
  assert.equal(hooks._state().tier1TurnsLeft, 3);
  assert.equal(s.flow.get(0), 75); // 100 - 25
});

test('T1: hesitation drain — 7 seconds => 10% drain', () => {
  const s = koromoState(TENPAI_HAND, 3, 100);
  const hooks = K.createKoromoHooks(0);
  hooks.tryActivateTier1(s, 10);
  const r = hooks.onOpponentHesitation(1, 7);
  assert.equal(r.flowDelta, -10); // (7-5) * 5 = 10 drain
  assert.equal(r.koromoGain, 10);
});

test('T1: no drain under 5 seconds', () => {
  const s = koromoState(TENPAI_HAND, 4, 100);
  const hooks = K.createKoromoHooks(0);
  hooks.tryActivateTier1(s, 10);
  const r = hooks.onOpponentHesitation(1, 4);
  assert.equal(r.flowDelta, 0);
});

test('T1: turn gate 7–15', () => {
  const s = koromoState(TENPAI_HAND, 5, 100);
  const hooks = K.createKoromoHooks(0);
  assert.equal(hooks.tryActivateTier1(s, 6).ok, false);
  assert.equal(hooks.tryActivateTier1(s, 16).ok, false);
});

test('T2: oceanic mire — opponent draw weight 0.60 on advancing tiles', () => {
  const s = koromoState(TENPAI_HAND, 6, 100);
  s.players[1].hand = [...SHANTEN1_HAND]; // 1-shanten
  const hooks = K.createKoromoHooks(0);
  hooks.tryActivateTier2(s, 10);
  // A bridge tile for seat 1 should get 0.60
  const { getOptimalBridges } = require('../powers/trajectoryPlanner');
  const bridges = getOptimalBridges(SHANTEN1_HAND, s.pool, 4);
  if (bridges.length > 0) {
    const w = hooks.onPowerDraw(bridges[0], s, 1); // drawSeat=1
    assert.equal(w, 0.60);
  }
});

test('T2: Koromo herself not affected by mire', () => {
  const s = koromoState(TENPAI_HAND, 7, 100);
  const hooks = K.createKoromoHooks(0);
  hooks.tryActivateTier2(s, 10);
  const w = hooks.onPowerDraw('7s', s, 0); // drawSeat=0 (Koromo)
  assert.equal(w, 1.0);
});

test('T2: turn gate 8–14', () => {
  const s = koromoState(TENPAI_HAND, 8, 100);
  const hooks = K.createKoromoHooks(0);
  assert.equal(hooks.tryActivateTier2(s, 7).ok, false);
  assert.equal(hooks.tryActivateTier2(s, 15).ok, false);
});

test('T3: haitei gravity — 2.5x draw, 15.0 final, mangan cap', () => {
  const s = koromoState(TENPAI_HAND, 9, 150);
  s.pool.counts = { '7s': 5, '1z': 3 }; // minimal pool for testing
  const hooks = K.createKoromoHooks(0);
  const res = hooks.tryActivateTier3(s, 15);
  assert.equal(res.ok, true);
  assert.equal(res.payoutCap, 8000);
  // Mid-wall: 2.5x
  const w1 = hooks.onPowerDraw('7s', s, 0);
  assert.equal(w1, 2.5);
});

test('T3: final draw => 15.0 weight', () => {
  const s = koromoState(TENPAI_HAND, 10, 150);
  s.pool.counts = { '7s': 1 }; // exactly 1 tile left in the wall
  const hooks = K.createKoromoHooks(0);
  hooks.tryActivateTier3(s, 1);
  const w = hooks.onPowerDraw('7s', s, 0);
  assert.equal(w, 15.0);
});

test('T3: wall gate <= 20', () => {
  const s = koromoState(TENPAI_HAND, 11, 150);
  const hooks = K.createKoromoHooks(0);
  assert.equal(hooks.tryActivateTier3(s, 21).ok, false);
});

test('T4: submerged abyss — opponent freeze at -80%', () => {
  const s = koromoState(TENPAI_HAND, 12, 150);
  s.players[1].hand = [...SHANTEN1_HAND]; // 1-shanten
  const hooks = K.createKoromoHooks(0);
  hooks.tryActivateTier4(s, 10);
  // A shanten-decreasing tile for seat 1
  const { getOptimalBridges } = require('../powers/trajectoryPlanner');
  const bridges = getOptimalBridges(SHANTEN1_HAND, s.pool, 4);
  if (bridges.length > 0) {
    const w = hooks.onPowerDraw(bridges[0], s, 1);
    assert.equal(w, 0.20);
  }
});

test('T4: Haitei anchor tile returned', () => {
  const s = koromoState(TENPAI_HAND, 13, 150);
  const hooks = K.createKoromoHooks(0);
  const res = hooks.tryActivateTier4(s, 10);
  assert.equal(res.ok, true);
  assert.ok(typeof res.anchorTile === 'string');
});

test('T4: wall gate <= 14', () => {
  const s = koromoState(TENPAI_HAND, 14, 150);
  const hooks = K.createKoromoHooks(0);
  assert.equal(hooks.tryActivateTier4(s, 15).ok, false);
});

test('T4: precondition requires tenpai', () => {
  const s = koromoState(SHANTEN1_HAND, 15, 150);
  const hooks = K.createKoromoHooks(0);
  assert.equal(hooks.tryActivateTier4(s, 10).ok, false);
});

test('T4: counterplay calls reduce win rate by 25% each', () => {
  const s = koromoState(TENPAI_HAND, 16, 150);
  const hooks = K.createKoromoHooks(0);
  hooks.tryActivateTier4(s, 10);
  hooks.onOpponentMeld(1); // 1 call
  hooks.onOpponentMeld(2); // 2 calls
  const r = hooks.onSettlement({ type: 'tsumo', winner: 0 }, s);
  assert.equal(r.haiteiWinRate, 0.50); // 1 - 2*0.25
  assert.equal(r.counterplayCalls, 2);
});

test('T4: 3 calls = 0% win rate', () => {
  const s = koromoState(TENPAI_HAND, 17, 150);
  const hooks = K.createKoromoHooks(0);
  hooks.tryActivateTier4(s, 10);
  hooks.onOpponentMeld(1);
  hooks.onOpponentMeld(2);
  hooks.onOpponentMeld(3);
  const r = hooks.onSettlement({ type: 'tsumo', winner: 0 }, s);
  assert.equal(r.haiteiWinRate, 0); // capped at 0
});

test('late tenpai bonus: +25% flow when wall <= 20', () => {
  const s = koromoState(TENPAI_HAND, 18, 50);
  const hooks = K.createKoromoHooks(0);
  const r = hooks.onEnterTenpai(s, 15);
  assert.equal(r.event.type, 'LATE_TENPAI_BONUS');
  assert.equal(s.flow.get(0), 75); // 50 + 25
});

test('late tenpai bonus: no bonus when wall > 20', () => {
  const s = koromoState(TENPAI_HAND, 19, 50);
  const hooks = K.createKoromoHooks(0);
  const r = hooks.onEnterTenpai(s, 25);
  assert.equal(r.event, undefined);
  assert.equal(s.flow.get(0), 50);
});

test('tier durations decrement on turn end', () => {
  const s = koromoState(TENPAI_HAND, 20, 100);
  const hooks = K.createKoromoHooks(0);
  hooks.tryActivateTier1(s, 10);
  hooks.tryActivateTier2(s, 10);
  assert.equal(hooks._state().tier1TurnsLeft, 3);
  assert.equal(hooks._state().tier2TurnsLeft, 4);
  hooks.onTurnEnd(s);
  assert.equal(hooks._state().tier1TurnsLeft, 2);
  assert.equal(hooks._state().tier2TurnsLeft, 3);
});

test('insufficient flow rejected', () => {
  const s = koromoState(TENPAI_HAND, 21, 10);
  const hooks = K.createKoromoHooks(0);
  assert.equal(hooks.tryActivateTier1(s, 10).ok, false);
  assert.equal(hooks.tryActivateTier2(s, 10).ok, false);
  assert.equal(hooks.tryActivateTier3(s, 15).ok, false);
  assert.equal(hooks.tryActivateTier4(s, 10).ok, false);
});
