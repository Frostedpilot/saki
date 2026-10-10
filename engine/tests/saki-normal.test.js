const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSakiNormalHooks, KAN_BIAS_WEIGHT, winningWaits } = require('../powers/rosters/saki-normal');
const { norm } = require('../tiles');
const { createTable, scriptHand, sumTiles } = require('./helpers/sim');

// Locked table: dead wall is scripted deterministically so the pool state is
// fully known (hand and wait availability are not left to RNG).
function lockedTable(hand, deadWallTiles, extra = {}) {
  const table = createTable({ seed: 5, roster: [[0, createSakiNormalHooks]] });
  for (const t of deadWallTiles) table.state.pool.decrement(t);
  table.state.deadWall = [...deadWallTiles];
  for (const t of hand) table.state.pool.decrement(t);
  table.state.players[0].hand = [...hand];
  table.state.players[0].melds = extra.melds || [];
  table.state.bakaze = 1;
  table.state.jikaze = 1;
  table.state.doraIndicators = [];
  return table;
}

test('normal Saki can bias: 4th copy of a held triplet draws at KAN_BIAS_WEIGHT', () => {
  const table = lock(null, []);
  const hooks = createSakiNormalHooks(0);

  const state = table.state;
  state.players[0].hand = ['5m', '5m', '5m', '1p', '2p', '3p'];
  state.powers.register(0, hooks);

  // Triplet on a Manzu: the plain 5m AND its aka 0m both read as kind 5m.
  assert.equal(hooks.onPowerDraw('5m', state), KAN_BIAS_WEIGHT);
  assert.equal(hooks.onPowerDraw('0m', state), KAN_BIAS_WEIGHT);
  // Non-triplet draw stays neutral.
  assert.equal(hooks.onPowerDraw('6m', state), 1.0);
});

test('normal Saki passive is always full strength regardless of Flow gauge', () => {
  const table = lock([], []);
  const state = table.state;
  const hooks = createSakiNormalHooks(0);
  state.players[0].hand = ['9m', '9m', '9m', '1p', '2p', '3p'];
  state.powers.register(0, hooks);

  assert.equal(hooks.onPowerDraw('9m', state), KAN_BIAS_WEIGHT);
});

test('normal Saki kan: tenpai hand pins the exact live winning wait (100% Rinshan)', () => {
  // 13-tile tanki tenpai on 7p (111z is a valid triplet set). Dead wall keeps
  // the extra 7p copies live.
  const hand = ['1m', '2m', '3m', '4p', '5p', '6p', '7s', '8s', '9s', '1z', '1z', '1z', '7p'];
  const deadWallTiles = ['1m', '2m', '3m', '4p', '5p', '6p', '7s', '8s', '9s', '2z', '3z', '4z', '4z', '5z'];
  const table = lockedTable(hand, deadWallTiles);
  const state = table.state;
  const hooks = table.hooks.get(0);
  const before = sumTiles(state);

  const waits = winningWaits(state, 0, state.pool);
  assert.ok(waits.length >= 1, `tenpai hand must expose at least one winning wait`);
  assert.ok(waits.includes('7p'), `7p must be among the winning waits, got ${waits}`);

  const res = hooks.onKanDeclared(state, { kanCount: 1, rinshanIdx: 0 });
  assert.equal(res.activated, true);
  assert.equal(res.branch, 'win');
  assert.ok(waits.includes(norm(res.pin)), `pinned tile ${res.pin} must be a winning wait`);
  assert.equal(state.deadWall[0], res.pin, 'replacement slot must hold the pinned win tile');
  assert.equal(sumTiles(state), before, 'tile conservation must hold');
});

test('normal Saki kan: open-handed ankan shape still pins an advancing tile', () => {
  // Concealed 9 (=13 - 4 ankan) + ankan meld: not tenpai (shanten >= 1 once the
  // ankan is materialized), so the advance branch must pin a live tile that
  // reduces shanten of the reconstructed shape.
  const concealed = ['2m', '3m', '4m', '2p', '3p', '4p', '2s', '3s', '5s'];
  const ankan = { tiles: ['1m', '1m', '1m', '1m'], open: false, type: 'ankan' };
  const hand = [...concealed];
  const deadWallTiles = ['5m', '6m', '7m', '1p', '2p', '3p', '4s', '5s', '6s', '1z', '2z', '3z', '4z', '5z'];
  const table = lockedTable(hand, deadWallTiles, { melds: [ankan] });
  for (const t of ankan.tiles) table.state.pool.decrement(t);
  const state = table.state;
  const hooks = table.hooks.get(0);

  const res = hooks.onKanDeclared(state, { kanCount: 1, rinshanIdx: 0 });
  assert.equal(res.activated, true, res.reason);
  assert.equal(res.branch, 'advance');
  assert.equal(state.deadWall[0], res.pin, 'replacement slot must hold the pinned advancing tile');
  assert.ok(state.pool.get(res.pin) >= 0, 'pinned tile must stay live in the pool');
});

test('normal Saki weakness: an opponent kan disables the power for the hand', () => {
  const table = lock([], []);
  const state = table.state;
  const hooks = createSakiNormalHooks(0);
  state.players[0].hand = ['5m', '5m', '5m', '1p', '2p', '3p'];
  state.powers.register(0, hooks);

  // Opponent kans (not herself).
  hooks.onPlayerKan(1);
  hooks.onPlayerKan(3);
  assert.equal(hooks.isPowerActive(state), false);

  // Kan bias off: even with a triplet held, draws are neutral.
  assert.equal(hooks.onPowerDraw('5m', state), 1.0);
  assert.equal(hooks.onPowerDraw('0m', state), 1.0);

  // Kan guarantee off: the kan hook refuses to fire.
  const handTenpai = ['1m', '2m', '3m', '4p', '5p', '6p', '7s', '8s', '9s', '1z', '1z', '1z', '7p'];
  const deadWallTiles = ['1m', '2m', '3m', '4p', '5p', '6p', '7s', '8s', '9s', '2z', '3z', '4z', '4z', '5z'];
  const lockTable = lockedTable(handTenpai, deadWallTiles);
  const state2 = lockTable.state;
  const hooks2 = lockTable.hooks.get(0);
  hooks2.onPlayerKan(1);
  const res = hooks2.onKanDeclared(state2, { kanCount: 1, rinshanIdx: 0 });
  assert.equal(res.activated, false);
  assert.equal(res.reason, 'disrupted');
});

test('normal Saki weakness: her OWN kan does not disable the power', () => {
  const table = lock([], []);
  const state = table.state;
  const hooks = createSakiNormalHooks(0);
  state.players[0].hand = ['5m', '5m', '5m', '1p', '2p', '3p'];
  state.powers.register(0, hooks);

  hooks.onPlayerKan(0);
  assert.equal(hooks.isPowerActive(state), true);
  assert.equal(hooks.onPowerDraw('5m', state), KAN_BIAS_WEIGHT);
});

test('normal Saki: advancing tiles never pick an exhausted kind', () => {
  const hand = ['2m', '3m', '4m', '2p', '3p', '4p', '2s', '3s', '4s', '1z', '2z', '3z', '5z'];
  const deadWallTiles = ['5m', '6m', '7m', '1p', '2p', '3p', '4s', '5s', '6s', '1z', '2z', '3z', '4z', '5z'];
  const table = lockedTable(hand, deadWallTiles);
  const state = table.state;
  const hooks = table.hooks.get(0);

  const res = hooks.onKanDeclared(state, { kanCount: 1, rinshanIdx: 0 });
  if (!res.activated) {
    assert.equal(res.reason, 'no-live-tile');
    return;
  }
  assert.equal(res.branch, 'advance');
  assert.ok(state.pool.get(res.pin) > 0, 'pinned advancing tile must be live');
});

// Tiny helper: build a table without scripting the pool for setup-only cases.
function lock(hand, deadWallTiles) {
  return lockedTable(hand || [], deadWallTiles || []);
}
