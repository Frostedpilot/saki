const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createYuuHooks, isWarmTile, MANZU_CHUN_BIAS } = require('../powers/rosters/achiga');
const { createTable, scriptHand, runTurn, runRounds } = require('./helpers/sim');

function tableWithYuu() {
  return createTable({ seed: 11, roster: [[0, createYuuHooks]] });
}

test('Yuu hot tiles: Manzu (incl. aka 0m) and the Red Dragon (7z) are boosted', () => {
  assert.equal(isWarmTile('1m'), true);
  assert.equal(isWarmTile('9m'), true);
  assert.equal(isWarmTile('0m'), true);
  assert.equal(isWarmTile('7z'), true);
  assert.equal(isWarmTile('1p'), false);
  assert.equal(isWarmTile('5s'), false);
  assert.equal(isWarmTile('1z'), false);
});

test('Yuu passive weight: x1.35 on warm tiles, neutral everywhere else', () => {
  const table = tableWithYuu();
  const state = table.state;
  const hooks = createYuuHooks(0);
  state.powers.register(0, hooks);
  state.players[0].hand = ['1m', '2m', '3m', '1p', '2p', '3p', '1s', '2s', '3s', '1z', '2z', '3z', '7z'];

  assert.equal(hooks.onPowerDraw('5m', state), MANZU_CHUN_BIAS);
  assert.equal(hooks.onPowerDraw('0m', state), MANZU_CHUN_BIAS);
  assert.equal(hooks.onPowerDraw('7z', state), MANZU_CHUN_BIAS);
  assert.equal(hooks.onPowerDraw('4p', state), 1.0);
  assert.equal(hooks.onPowerDraw('1z', state), 1.0);
});

test('Yuu is always at full strength — the Flow gauge is irrelevant', () => {
  const table = tableWithYuu();
  const state = table.state;
  const hooks = createYuuHooks(0);
  state.powers.register(0, hooks);
  state.players[0].hand = ['1m', '2m', '3m', '1p', '2p', '3p', '1s', '2s', '3s', '1z', '2z', '3z', '7z'];

  state.flow.set(0, 0);
  assert.equal(hooks.onPowerDraw('5m', state), MANZU_CHUN_BIAS);
  state.flow.set(0, 150);
  assert.equal(hooks.onPowerDraw('5m', state), MANZU_CHUN_BIAS);
});

test('Yuu never consumes or acquires Flow — she lives outside the economy', () => {
  const table = tableWithYuu();
  const state = table.state;
  scriptHand(state, 0, ['1m', '2m', '3m', '1p', '2p', '3p', '1s', '2s', '3s', '1z', '2z', '3z', '7z']);

  assert.equal(state.flow.isNormal(0), true);
  assert.equal(state.flow.get(0), 0);

  const { drawn } = runTurn(state, 0, 1, {});
  void drawn;
  assert.equal(state.flow.get(0), 0, 'normal seat must never bank Flow');

  runRounds(state, [0], 4, {});
  assert.equal(state.flow.get(0), 0);
});
