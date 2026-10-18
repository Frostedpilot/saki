// invariants.js — per-turn match invariants (Fix plan Phase 4).
// Pure checks over plain tile arrays; usable by game.js dev runs,
// server Table, tests, and replay verification.
const { fullCounts } = require('./tiles');

function checkConservation(partitions) {
  const full = fullCounts();
  const seen = {};
  for (const arr of partitions) for (const t of arr) seen[t] = (seen[t] || 0) + 1;
  const problems = [];
  for (const k of Object.keys(full)) {
    if ((seen[k] || 0) !== full[k]) problems.push(`${k}: seen ${seen[k] || 0} != full ${full[k]}`);
  }
  for (const k of Object.keys(seen)) {
    if (full[k] === undefined) problems.push(`${k}: unknown tile (seen ${seen[k]})`);
  }
  return problems;
}

function assertConservation(partitions, label = '') {
  const problems = checkConservation(partitions);
  if (problems.length) throw new Error(`conservation violated${label ? ` (${label})` : ''}: ${problems.join('; ')}`);
}

/**
 * Build a conservation partition that is **wanpai-aware**.
 *
 * The dead wall is a fixed 14-slot window, but a rinshan draw does not remove
 * the slot it draws from — `game.js` reads `dead[rinshanIdx++]` and leaves the
 * array untouched (the same shape `Table.doOwnKan` uses). The drawn tile is
 * therefore physically in a hand while its slot is still in `dead`, so counting
 * the whole array double-counts every rinshan tile. Only `dead.slice(deadFrom)`
 * is still on the table; `deadFrom` is `rinshanIdx`.
 *
 * Revealed dora/ura indicators live above the rinshan block and stay in the
 * array, so they are counted once here — correctly, since they belong to no
 * hand.
 */
function wanpaiPartition(players, wall, dead, deadFrom = 0) {
  const parts = [wall, dead.slice(deadFrom)];
  for (const p of players) {
    parts.push(p.hand);
    for (const m of p.melds) parts.push(m && m.tiles ? m.tiles : m);
    parts.push(p.discards);
  }
  return parts;
}

function checkStateConservation(players, wall, dead, deadFrom = 0) {
  return checkConservation(wanpaiPartition(players, wall, dead, deadFrom));
}

function assertStateConservation(players, wall, dead, deadFrom = 0, label = '') {
  assertConservation(wanpaiPartition(players, wall, dead, deadFrom), label);
}

function assertDeadWall(dead, length = 14) {
  if (dead.length !== length) throw new Error(`dead wall length ${dead.length} != ${length}`);
}

// Live hand is 13 tiles, or 14 just after a draw / before a discard.
function assertHandSize(hand, label = '') {
  if (hand.length !== 13 && hand.length !== 14) {
    throw new Error(`hand size ${hand.length} not 13/14${label ? ` (${label})` : ''}`);
  }
}

// Scores + riichi pool are conserved against 4x start score.
function assertScoresConserved(scores, riichiPool, startScore = 25000) {
  const total = scores.reduce((a, b) => a + b, 0) + riichiPool;
  const expected = startScore * scores.length;
  if (total !== expected)
    throw new Error(`scores not conserved: ${scores.join('/')} + pool ${riichiPool} = ${total} != ${expected}`);
}

module.exports = {
  checkConservation,
  assertConservation,
  wanpaiPartition,
  checkStateConservation,
  assertStateConservation,
  assertDeadWall,
  assertHandSize,
  assertScoresConserved,
};
