// invariants.test.js — the tile-conservation invariant (engine/invariants.js).
//
// The wanpai (dead wall) is a fixed 14-slot window in this engine: a rinshan
// draw reads `dead[rinshanIdx++]` and leaves the slot in the array, so the drawn
// tile is in a hand *and* still in `dead`. A naive partition of
// [hands, melds, discards, wall, dead] therefore double-counts every rinshan
// tile and would report bogus violations all over a normal hand. `wanpaiPartition`
// takes a `deadFrom` (rinshanIdx) so only the still-present slots are counted.
// `game.js` `main()` asserts this after every discard.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildWall } = require('../game.js');
const {
  checkConservation,
  checkStateConservation,
  assertStateConservation,
  wanpaiPartition,
} = require('../invariants');
const { fullCounts } = require('../tiles');

// Mirror game.js's deal: 14 to the wanpai, 13 to each seat, rest live.
function dealtTable() {
  const wall = buildWall();
  const dead = wall.splice(0, 14);
  const players = [0, 1, 2, 3].map(() => ({ hand: [], melds: [], discards: [] }));
  for (let k = 0; k < 13; k++) for (const p of players) p.hand.push(wall.pop());
  return { wall, dead, players };
}

test('a freshly dealt table conserves all 136 tiles', () => {
  const { wall, dead, players } = dealtTable();
  assert.deepEqual(checkStateConservation(players, wall, dead, 0), []);
});

test('wanpaiPartition flattens melds and slices the dead wall at deadFrom', () => {
  const players = [
    { hand: ['1m'], melds: [{ tiles: ['2m', '2m', '2m'] }], discards: ['3m'] },
    { hand: [], melds: [], discards: [] },
  ];
  const parts = wanpaiPartition(players, ['9m'], ['a', 'b', 'c'], 2);
  assert.deepEqual(parts, [['9m'], ['c'], ['1m'], ['2m', '2m', '2m'], ['3m'], [], []]);
});

test('a rinshan draw is double-counted only when the drawn slot is still included', () => {
  const { wall, dead, players } = dealtTable();
  // The rinshan block is dead[0..3]; drawing dead[0] hands it out but leaves the slot.
  const rinshan = dead[0];
  players[0].hand.push(rinshan);

  const naive = checkStateConservation(players, wall, dead, 0); // deadFrom = 0: slot counted
  assert.ok(
    naive.some((p) => p.startsWith(rinshan)),
    `expected a double-count of ${rinshan}, got ${JSON.stringify(naive)}`
  );

  // Advancing rinshanIdx drops the drawn slot from the partition — now conserved.
  assert.deepEqual(checkStateConservation(players, wall, dead, 1), []);
});

test('an extra tile or a dropped tile is reported as a violation', () => {
  const { wall, dead, players } = dealtTable();
  players[1].hand.push('5z'); // a 5th copy that was never removed from the wall
  assert.ok(checkStateConservation(players, wall, dead, 0).some((p) => p.startsWith('5z')));
});

test('checkConservation flags unknown tiles', () => {
  const full = fullCounts();
  const missing = checkConservation([[]]);
  assert.ok(missing.length > 0);
  // Every kind is short by its full count when the partition is empty.
  assert.equal(missing.length, Object.keys(full).length);

  const ghost = checkConservation([['notatile']]);
  assert.ok(ghost.some((p) => p.includes('unknown tile')));
});

test('assertStateConservation throws with a label, and passes when conserved', () => {
  const { wall, dead, players } = dealtTable();
  assert.doesNotThrow(() => assertStateConservation(players, wall, dead, 0, 'deal'));
  players[2].hand.pop(); // silently lose a tile
  assert.throws(() => assertStateConservation(players, wall, dead, 0, 'after P2 discard'), /after P2 discard/);
});
