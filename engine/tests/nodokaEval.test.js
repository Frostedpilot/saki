const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateNodokaHand } = require('../powers/nodokaEval');
const { getEvaluator, BuiltinNodokaEvaluator } = require('../powers/mjaiAdapter');
const { createNodokaHooks } = require('../powers/rosters/nodoka');
const { createMatchState, setupDeadWall } = require('../core');

function createNodokaTestState(hand, flow = 100) {
  const s = createMatchState({ seed: 777 });
  for (const t of hand) s.pool.decrement(t);
  s.players[0].hand = [...hand];
  setupDeadWall(s);
  for (let k = 0; k < 13; k++) {
    for (let seat = 1; seat < 4; seat++) {
      s.players[seat].hand.push(s.pool.sample());
    }
  }
  s.scores = [25000, 25000, 25000, 25000];
  s.flow.set(0, flow);
  return s;
}

test('evaluateNodokaHand: evaluates 14-tile hand and identifies optimal discard', () => {
  // 1-shanten hand with floating 9p: discarding 9p yields wide 20-ukeire 1-shanten
  const hand = ['2m', '3m', '4m', '2p', '3p', '4p', '5m', '6m', '5s', '6s', '1z', '1z', '9p', '2z'];
  const res = evaluateNodokaHand(hand);

  assert.equal(res.discard, '9p');
  assert.equal(res.shanten, 1);
  assert.equal(res.ukeire, 20);
  assert.ok(res.winProb > 0);
  assert.ok(res.expPt > 0);
  assert.ok(res.summary.includes('Nodocchi: Cut 9p'));
});

test('evaluateNodokaHand: recognizes Tenpai hand and estimates points', () => {
  // Tenpai on 1-4m / 9p with floating 9s: discarding 9s achieves Tenpai
  const hand = ['1m', '1m', '1m', '2p', '3p', '4p', '5s', '6s', '7s', '9p', '9p', '2m', '3m', '9s'];
  const res = evaluateNodokaHand(hand);

  assert.equal(res.discard, '9s');
  assert.equal(res.shanten, 0);
  assert.equal(res.isTenpai, true);
  assert.ok(res.waits.includes('1m'));
  assert.ok(res.waits.includes('4m'));
  assert.ok(res.expPt >= 1000);
  assert.ok(res.summary.includes('Tenpai'));
});

test('evaluateNodokaHand: prioritizes genbutsu defense under opponent Riichi', () => {
  // Hand with two possible discards having equal/similar uke-ire:
  // Tile A (9s) is completely unsafe.
  // Tile B (1m) is in Opponent 1's discard river (genbutsu).
  const hand = ['2m', '3m', '4m', '2p', '3p', '4p', '2s', '3s', '4s', '5s', '6s', '1m', '9s', '8s'];

  const opponents = [
    { seat: 1, riichi: true, discards: ['1m', '4p', '9p'] },
    { seat: 2, riichi: false, discards: [] },
    { seat: 3, riichi: false, discards: [] },
  ];

  const res = evaluateNodokaHand(hand, null, opponents);

  // Evaluator should prefer the 100% safe genbutsu 1m over dangerous 9s
  assert.equal(res.discard, '1m');
  assert.ok(res.summary.includes('Nodocchi: Cut 1m'));
});

test('BuiltinNodokaEvaluator integration: getEvaluator returns active evaluator', () => {
  const evaluator = getEvaluator();
  assert.ok(evaluator instanceof BuiltinNodokaEvaluator);

  const hand = ['1m', '1m', '1m', '2p', '3p', '4p', '5s', '6s', '7s', '9p', '9p', '2m', '3m', '9s'];
  const state = createNodokaTestState(hand);

  const advice = evaluator.evaluate(state, 0);
  assert.equal(advice.discard, '9s');
  assert.equal(advice.isTenpai, true);
});

test('Nodoka HUD advice channel: getHudAdvice produces real-time string for UI', () => {
  const hand = ['1m', '1m', '1m', '2p', '3p', '4p', '5s', '6s', '7s', '9p', '9p', '2m', '3m', '9s'];
  const state = createNodokaTestState(hand);
  const hooks = createNodokaHooks(0);

  const hudText = hooks.getHudAdvice(state);
  assert.ok(typeof hudText === 'string');
  assert.ok(hudText.startsWith('Nodocchi: Cut 9s'));
  assert.ok(hudText.includes('Tenpai'));
});

test('Nodoka T3: bridge boost applies toward evaluator preferred discard line', () => {
  // Hand needing bridge tiles: 2m 3m, 5p 6p 7p, 2s 3s, 5s 6s, 1z 1z, 2z 2z, + 1m
  const hand = ['2m', '3m', '5p', '6p', '7p', '2s', '3s', '5s', '6s', '1z', '1z', '2z', '2z', '1m'];
  const state = createNodokaTestState(hand, 150);
  const hooks = createNodokaHooks(0);

  hooks.tryActivateTier3(state);
  const { getOptimalBridges } = require('../powers/trajectoryPlanner');
  const keptHand = hand.filter(t => t !== '1m');
  const bridges = getOptimalBridges(keptHand, state.pool, 2);

  assert.ok(bridges.length > 0);
  const w = hooks.onPowerDraw(bridges[0], state);
  assert.equal(w, 15.0);
});
