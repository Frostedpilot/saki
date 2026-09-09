// input.js — human discard-index parsing (extracted from game.js).
// Always returns a valid in-range index; invalid input falls back to
// tsumogiri (last tile) so callers can never splice undefined.
const { norm } = require('./tiles');

function parseDiscardIndex(input, hand) {
  const last = hand.length - 1;
  if (!hand.length) return -1;
  const a = String(input === undefined || input === null ? '' : input).trim();
  const exact = hand.findIndex(x => x === a || norm(x) === a);
  if (exact >= 0) return exact;
  const nn = parseInt(a, 10);
  if (!isNaN(nn) && nn >= 0 && nn < hand.length) return nn;
  return last;
}

module.exports = { parseDiscardIndex };
