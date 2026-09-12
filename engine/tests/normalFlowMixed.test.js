const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSakiNormalHooks } = require('../powers/rosters/saki-normal');
const { createYuuHooks } = require('../powers/rosters/achiga');
const { createSakiHooks } = require('../powers/rosters/kiyosumi');
const { createHisaHooks } = require('../powers/rosters/hisa');
const { createTable, scriptHand, runTurn, weightsSnapshot } = require('./helpers/sim');

function mixedTable() {
  return createTable({
    seed: 21,
    roster: [
      [0, createSakiNormalHooks], // normal — extreme Saki
      [1, createHisaHooks],       // flow — Hisa
      [2, createYuuHooks],        // normal — Yuu
      [3, createSakiHooks],       // flow — Saki
    ],
  });
}

test('mixed table: power types classify per roster meta', () => {
  const { state, hooks } = mixedTable();
  assert.equal(state.powers.powerTypeOf(0), 'normal');
  assert.equal(state.powers.powerTypeOf(1), 'flow');
  assert.equal(state.powers.powerTypeOf(2), 'normal');
  assert.equal(state.powers.powerTypeOf(3), 'flow');
  assert.equal(hooks.get(0).meta.type, 'normal');
  assert.equal(hooks.get(1).meta.type, 'flow');
});

test('mixed table: normal gauges stay pinned at 0 while flow seats bank income', () => {
  const { state } = mixedTable();
  assert.equal(state.flow.isNormal(0), true);
  assert.equal(state.flow.isNormal(2), true);
  assert.equal(state.flow.get(0), 0);
  assert.equal(state.flow.get(2), 0);

  scriptHand(state, 0, ['2s', '3s', '4s', '2p', '3p', '4p', '6p', '6p', '6p', '1z', '2z', '3z', '7z']);
  scriptHand(state, 1, ['1m', '2m', '3m', '1p', '2p', '3p', '1s', '2s', '3s', '5z', '5z', '6z', '1z']);
  scriptHand(state, 2, ['2s', '3s', '4s', '2p', '3p', '4p', '5m', '6m', '7m', '5z', '6z', '7z', '1z']);
  scriptHand(state, 3, ['7p', '7p', '1m', '2m', '3m', '4p', '5p', '6p', '2s', '3s', '4s', '9m', '9m']);

  runTurn(state, 0, 1, {});
  runTurn(state, 1, 2, {});
  assert.equal(state.flow.get(0), 0, 'normal Saki seat never banks Flow');
  assert.ok(state.flow.get(1) > 0, 'Hisa (flow) still banks Flow income');
  assert.equal(state.flow.get(2), 0, 'Yuu (normal) never banks Flow');
});

test('mixed table: normal passive weights flow through the same dispatcher path', () => {
  const { state } = mixedTable();
  scriptHand(state, 0, ['5m', '5m', '5m', '1p', '2p', '3p', '4p', '5p', '6p', '1s', '2s', '3s', '7z']);

  const weights = weightsSnapshot(state, 0);
  // Her own kan bias must be visible even with Hisa's aura composed in.
  const boostSeen = (weights['5m'] || 0) !== 1.0 || (weights['0m'] || 0) !== 1.0;
  assert.equal(boostSeen, true, 'kan bias should survive field aura composition');
  assert.ok(Object.values(weights).filter((v) => v !== 1.0).length >= 1);
});

test('mixed table: opponent kan broadcast disables normal Saki but leaves Yuu and flow alone', () => {
  const { state } = mixedTable();
  const sakiNormal = state.powers.hooksFor(0);
  const yuu = state.powers.hooksFor(2);
  const sakiFlow = state.powers.hooksFor(3);

  assert.equal(sakiNormal.isPowerActive(state), true);
  assert.equal(yuu.isPowerActive(state), true);

  // Hisa (seat 1) declares a kan — the normal-type Saki is severed for the hand.
  state.powers.broadcastPlayerKan(1, state);

  assert.equal(sakiNormal.isPowerActive(state), false, 'normal Saki severed by opponent kan');
  assert.equal(yuu.isPowerActive(state), true, 'Yuu has no kan weakness');
  assert.equal(typeof sakiFlow.onPlayerKan, 'undefined', 'flow rosters do not observe kans');
});