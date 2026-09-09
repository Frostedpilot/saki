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
  if (total !== expected) throw new Error(`scores not conserved: ${scores.join('/')} + pool ${riichiPool} = ${total} != ${expected}`);
}

module.exports = { checkConservation, assertConservation, assertDeadWall, assertHandSize, assertScoresConserved };
