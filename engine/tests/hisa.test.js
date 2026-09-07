const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../powers/rosters/hisa');
const { createMatchState, setupDeadWall } = require('../core');
const { shantenOf } = require('../powers/trajectoryPlanner');

function hisaState(hand, seed = 101, flow = 0) {
  const s = createMatchState({ seed });
  for (const t of hand) s.pool.decrement(t);
  s.players[0].hand = [...hand];
  setupDeadWall(s);
  for (let k = 0; k < 13; k++) for (let seat = 1; seat < 4; seat++) s.players[seat].hand.push(s.pool.sample());
  s.scores = [25000, 25000, 25000, 25000];
  s.flow.set(0, flow);
  return s;
}

// Tenpai ryanmen: 234m 567m 234p 45s 22z — waits 3s/6s (diff 3, live 8)
const RYANMEN_HAND = ['2m', '3m', '4m', '5m', '6m', '7m', '2p', '3p', '4p', '4s', '5s', '2z', '2z'];
// Tenpai tanki: 111m 222p 333s 456p + 7z — waits 7z (single)
const TANKI_HAND = ['1m', '1m', '1m', '2p', '2p', '2p', '3s', '3s', '3s', '4p', '5p', '6p', '7z'];
// 1-shanten hand for T1: 777p 333s 123m 46p 1z 2z
const SHANTEN1_HAND = ['7p', '7p', '7p', '3s', '3s', '3s', '1m', '2m', '3m', '4p', '6p', '1z', '2z'];

// Exhaust all but 1 copy of a wait everywhere except the live pool scan
// (keep conservation honest by leaving 1 copy in the pool).
function makeHellWait(s, wait) {
  while (s.pool.get(wait) > 1) s.pool.decrement(wait);
}

test('hand sanity: RYANMEN_HAND is tenpai + TANKI_HAND is tenpai', () => {
  assert.equal(shantenOf(RYANMEN_HAND), 0);
  assert.equal(shantenOf(TANKI_HAND), 0);
  const { hairiOf } = require('../powers/trajectoryPlanner');
  assert.deepEqual(Object.keys(hairiOf(RYANMEN_HAND).wait).sort(), ['3s', '6s']);
  assert.deepEqual(Object.keys(hairiOf(TANKI_HAND).wait).sort(), ['7z']);
});

test('classifyWait: ryanmen (2-sided) => ryanmen', () => {
  const info = H.classifyWait(RYANMEN_HAND, null);
  assert.equal(info.type, 'ryanmen');
  assert.deepEqual(info.waits, ['3s', '6s']);
});

test('classifyWait: tanki single wait => ugly', () => {
  const info = H.classifyWait(TANKI_HAND, null);
  assert.equal(info.type, 'ugly');
  assert.deepEqual(info.waits, ['7z']);
});

test('classifyWait: hell when <=2 live', () => {
  const s = hisaState(TANKI_HAND, 1);
  makeHellWait(s, '7z');
  const info = H.classifyWait(TANKI_HAND, s.pool);
  assert.equal(info.type, 'hell');
});

test('classifyWait: non-tenpai => none', () => {
  const hand = ['1m', '2m', '3m', '4p', '5p', '6p', '7s', '8s', '9s', '1z', '2z', '3z', '4z'];
  assert.equal(H.classifyWait(hand, null).type, 'none');
});

test('passive: ryanmen wait penalty 0.70x', () => {
  const s = hisaState(RYANMEN_HAND, 2, 0);
  const hooks = H.createHisaHooks(0);
  const info = H.classifyWait(RYANMEN_HAND, s.pool);
  assert.equal(info.type, 'ryanmen');
  assert.equal(hooks.onPowerDraw('3s', s), 0.70);
  assert.equal(hooks.onPowerDraw('6s', s), 0.70);
});

test('passive: hell wait boost 3.0x', () => {
  const s = hisaState(TANKI_HAND, 3, 0);
  makeHellWait(s, '7z');
  const hooks = H.createHisaHooks(0);
  const info = H.classifyWait(TANKI_HAND, s.pool);
  assert.equal(info.type, 'hell');
  assert.equal(hooks.onPowerDraw('7z', s), 3.0);
});

test('T1: phantom intimidation — precondition requires 1-shanten', () => {
  const s = hisaState(SHANTEN1_HAND, 4, 100);
  assert.equal(shantenOf(SHANTEN1_HAND), 1);
  const hooks = H.createHisaHooks(0);
  const res = hooks.tryActivateTier1(s, 8);
  assert.equal(res.ok, true);
  assert.equal(hooks._state().tier1Active, true);
  assert.equal(s.flow.get(0), 75); // 100 - 25
});

test('T1: fails if not 1-shanten', () => {
  const s = hisaState(RYANMEN_HAND, 5, 100); // tenpai (0-shanten)
  const hooks = H.createHisaHooks(0);
  assert.equal(hooks.tryActivateTier1(s, 8).ok, false);
});

test('T1: turn gate 7–12', () => {
  const s = hisaState(SHANTEN1_HAND, 6, 100);
  const hooks = H.createHisaHooks(0);
  assert.equal(hooks.tryActivateTier1(s, 6).ok, false);
  assert.equal(hooks.tryActivateTier1(s, 13).ok, false);
});

test('T2: jigoku trap forge — precondition requires hell wait', () => {
  const s = hisaState(TANKI_HAND, 7, 100);
  makeHellWait(s, '7z');
  const hooks = H.createHisaHooks(0);
  const res = hooks.tryActivateTier2(s);
  assert.equal(res.ok, true);
  assert.equal(res.trapTile, '7z');
  assert.equal(s.flow.get(0), 50); // 100 - 50
});

test('T2: fails if not hell wait', () => {
  const s = hisaState(RYANMEN_HAND, 8, 100);
  const hooks = H.createHisaHooks(0);
  assert.equal(hooks.tryActivateTier2(s).ok, false);
});

test('T3: chaos slap — hell wait + 12.0 weight for 3 turns', () => {
  const s = hisaState(TANKI_HAND, 9, 150);
  makeHellWait(s, '7z');
  const hooks = H.createHisaHooks(0);
  const res = hooks.tryActivateTier3(s);
  assert.equal(res.ok, true);
  assert.equal(hooks._state().tier3TurnsLeft, 3);
  assert.equal(hooks.onPowerDraw('7z', s), 12.0);
});

test('T3: fails on ryanmen wait', () => {
  const s = hisaState(RYANMEN_HAND, 10, 150);
  const hooks = H.createHisaHooks(0);
  assert.equal(hooks.tryActivateTier3(s).ok, false);
});

test('T4: hell dominance — hell wait + wall <= 25', () => {
  const s = hisaState(TANKI_HAND, 11, 150);
  makeHellWait(s, '7z');
  const hooks = H.createHisaHooks(0);
  const res = hooks.tryActivateTier4(s, 20);
  assert.equal(res.ok, true);
  assert.equal(hooks._state().tier4Active, true);
  assert.equal(hooks.onPowerDraw('7z', s), 17.0);
});

test('T4: fails if wall > 25', () => {
  const s = hisaState(TANKI_HAND, 12, 150);
  makeHellWait(s, '7z');
  const hooks = H.createHisaHooks(0);
  assert.equal(hooks.tryActivateTier4(s, 30).ok, false);
});

test('Riichi Showmanship Slam: drains 10% from each opponent', () => {
  const s = hisaState(RYANMEN_HAND, 13, 50);
  s.flow.set(1, 50);
  s.flow.set(2, 50);
  s.flow.set(3, 50);
  const hooks = H.createHisaHooks(0);
  hooks.onDeclareRiichi(s);
  assert.equal(s.flow.get(1), 40);
  assert.equal(s.flow.get(2), 40);
  assert.equal(s.flow.get(3), 40);
});

test('tier durations decrement on turn end', () => {
  const s = hisaState(SHANTEN1_HAND, 14, 100);
  const hooks = H.createHisaHooks(0);
  hooks.tryActivateTier1(s, 8);
  assert.equal(hooks._state().tier1TurnsLeft, 3);
  hooks.onTurnEnd(s);
  assert.equal(hooks._state().tier1TurnsLeft, 2);
});

test('settlement: T4 deal-in damage mitigation 50%', () => {
  const s = hisaState(TANKI_HAND, 15, 150);
  makeHellWait(s, '7z');
  const hooks = H.createHisaHooks(0);
  hooks.tryActivateTier4(s, 20);
  const r = hooks.onSettlement({ type: 'ron', from: 0 }, s);
  assert.equal(r.scoreMultiplier, 0.50);
});

test('insufficient flow rejected', () => {
  const s = hisaState(SHANTEN1_HAND, 16, 10);
  const hooks = H.createHisaHooks(0);
  assert.equal(hooks.tryActivateTier1(s, 8).ok, false);
});