'use strict';
// helpers.js — pure riichi rule helpers extracted from engine/game.js so the
// bridge server can reuse the exact same logic (scoring, waits, furiten,
// bot discards/calls). Single source of truth stays in engine/game.js + the
// riichi/syanten libraries; these are thin reuse functions.

const syanten = require('syanten');
const { KINDS, norm, same, toCounts } = require('../engine/tiles');
const { scoreHand } = require('../engine/scoring');

// ---------------------------------------------------------------- shanten
const shantenOf = (h) => {
  try { return syanten(toCounts(h)); } catch { return 99; }
};
const hairiOf = (h) => {
  try { return syanten.hairi(toCounts(h)); } catch { return {}; }
};

// Waits of a 13-tile (minus melds) hand: every tile completing the shape.
// Shape-only (han ignored) so furiten/tenpai work for open hands too.
function getWaits(player, players, dead, ctxBase) {
  const waits = [];
  for (const k of KINDS) {
    const ctx = { ...ctxBase, riichi: false, doubleRiichi: false, ippatsu: false, kanFlag: false, lastFlag: false, tenhou: false };
    let r;
    try { r = scoreHand(player.hand, player.melds, k, false, ctx); } catch { continue; }
    if (r.isAgari) waits.push(norm(k));
  }
  return waits;
}

const isDiscardFuriten = (player, waits) => {
  const disc = new Set(player.discards.map(norm));
  return waits.some((w) => disc.has(w));
};

// Temp furiten clears on your own draw — UNLESS in riichi, where passing a
// winning tile means permanent furiten for the remainder of the kyoku
// (reference: furiten.majs keeps furiten while status riichi is set).
function clearTempFuritenOnDraw(player) {
  if (!player.riichi && !player.doubleRiichi) player.tempFuriten = false;
}
// Ron attempt on a discard with furiten enforcement.
// opts: {chankan, minHan}
function tryRon(qp, disc, ctxShoot, players, dead, opts = {}) {
  const minHan = opts.minHan || 1;
  const r = scoreHand(qp.hand, qp.melds, disc, false, ctxShoot);
  if (!r.isAgari || !(r.yakuman > 0 || r.han >= minHan)) return { win: false };
  const waits = getWaits(qp, players, dead, ctxShoot);
  if (qp.tempFuriten) return { win: false, blocked: true, reason: 'temp', r };
  if (isDiscardFuriten(qp, waits)) return { win: false, blocked: true, reason: 'discard', r };
  return { win: true, r, waits };
}

// ------------------------------------------------------------- bot brains
// rand: function returning [0,1) for decision randomness (default Math.random).
function botDiscard(hand, riichiLocked, banned = [], rand = Math.random) {
  if (riichiLocked) return hand.length - 1;
  const legal = hand.map((_, i) => i).filter((i) => !banned.includes(norm(hand[i])));
  const pool = legal.length ? legal : hand.map((_, i) => i);
  if (rand() < 0.15) return pool[Math.floor(rand() * pool.length)];
  const seen = new Set(), uniqIdx = [];
  for (const i of pool) { const k = norm(hand[i]); if (!seen.has(k)) { seen.add(k); uniqIdx.push(i); } }
  let best = [], bestS = 99;
  for (const idx of uniqIdx) {
    const rest = hand.filter((_, i) => i !== idx);
    const s = shantenOf(rest);
    if (s < bestS) { bestS = s; best = [idx]; }
    else if (s === bestS) best.push(idx);
  }
  return best[Math.floor(rand() * best.length)];
}

// afterShantenGain < 0 means the call worsens the hand → only accidental.
function botWantsCall(afterShantenGain, closedOnly, rand = Math.random) {
  if (closedOnly) return false;
  if (afterShantenGain < 0) return rand() < 0.05;
  return rand() < 0.55;
}

// Chi sequence options pair of ranks (numbers) using two hand tiles.
function chiOptions(hand, tile) {
  const t = norm(tile);
  if (t[1] === 'z' || t[0] === '0') return [];
  const n = parseInt(t[0], 10), s = t[1];
  const has = (x) => hand.some((h) => norm(h) === x + s);
  const opts = [];
  if (n >= 3 && has(n - 2) && has(n - 1)) opts.push([n - 2, n - 1]);
  if (n >= 2 && n <= 8 && has(n - 1) && has(n + 1)) opts.push([n - 1, n + 1]);
  if (n <= 7 && has(n + 1) && has(n + 2)) opts.push([n + 1, n + 2]);
  return opts;
}

// ------------------------------------------------------------------ rules
// Kuikae ban: after chi with hand tiles a+b, tiles completing the new
// sequence with the same two hand tiles are illegal to discard.
function kuikaeBannedChi(a, b) {
  a = norm(a); b = norm(b);
  const suit = a[1];
  const nums = [parseInt(a[0], 10), parseInt(b[0], 10)].sort((x, y) => x - y);
  const d = nums[1] - nums[0], out = [];
  if (d === 1) {
    if (nums[0] > 1) out.push((nums[0] - 1) + suit);
    if (nums[1] < 9) out.push((nums[1] + 1) + suit);
  } else if (d === 2) out.push((nums[0] + 1) + suit);
  return out;
}

// Suufon-renda: first-lap discards, all four the same wind (1z-4z).
function isSuufonRenda(discards) {
  if (discards.length !== 4) return false;
  const w = discards.map(norm);
  return ['1z', '2z', '3z', '4z'].includes(w[0]) && w.every((x) => x === w[0]);
}
// Suukaikan: 4+ kans abort unless one player declared them all.
function isSuukaikanAbort(kansBy) {
  const total = kansBy.reduce((a, b) => a + b, 0);
  if (total < 4) return false;
  return !kansBy.some((n) => n === total && total >= 4);
}
// Nagashi mangan: fully closed hand (ankan ok), non-empty discards,
// every discard terminal/honor.
function isNagashi(pl) {
  if (!pl.discards.length) return false;
  if (!pl.melds.every((m) => !m.open)) return false;
  return pl.discards.every((d) => { const k = norm(d); return k[1] === 'z' || k[0] === '1' || k[0] === '9'; });
}
// Terminals + honors count (aka 0m counts as 5m, not a terminal).
function countYaochuu(hand) {
  return hand.filter((t) => { const k = norm(t); return k[1] === 'z' || k[0] === '1' || k[0] === '9'; }).length;
}

function canRiichi(score, wallLeft) { return score >= 1000 && wallLeft >= 4; }

function bakazeOf(kyoku) { return kyoku < 4 ? 1 : 2; }
function roundLabel(kyoku) { return `${bakazeOf(kyoku) === 1 ? 'EAST' : 'SOUTH'} ${(kyoku % 4) + 1}`; }

function clearAllIppatsu(P) { for (const p of P) p.ippatsu = false; }

// Ankan after riichi changes waits → chombo; only legal if waits unchanged.
function waitsSetEq(a, b) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}
function ankanKeepsWaits(pl, kanTile) {
  // Fail closed: unknown waits or missing copies => treat as wait-changing
  // (caller rejects the kan with a message instead of crashing or chomboing).
  if (!pl.riichiWaits) return false;
  const rest = [...pl.hand];
  for (let c = 0; c < 4; c++) {
    const i = rest.findIndex((x) => same(x, kanTile));
    if (i < 0) return false;
    rest.splice(i, 1);
  }
  const kanMeld = { tiles: pl.hand.filter((x) => same(x, kanTile)), open: false, type: 'kan' };
  const after = getWaits({ hand: rest, melds: [...pl.melds, kanMeld] }, [], [], { dora: [], bakaze: 1, jikaze: 1 });
  return waitsSetEq([...pl.riichiWaits].sort(), [...after].sort());
}

// Oka/uma placement (points, zero-sum, ties share averaged uma). Not used by
// the current prototype (GameOver sends raw scores) but kept for parity.
function applyOkaUma(scores) {
  const UMA = [20, 10, -10, -20], OKA = 20;
  const order = [0, 1, 2, 3].sort((a, b) => scores[b] - scores[a]);
  const rows = [0, 1, 2, 3].map((seat) => ({ seat, score: scores[seat], uma: 0, oka: 0, total: 0, place: 0 }));
  const bySeat = Object.fromEntries(rows.map((r) => [r.seat, r]));
  let rank = 0, i = 0;
  while (i < 4) {
    let j = i;
    while (j + 1 < 4 && scores[order[j + 1]] === scores[order[i]]) j++;
    const group = order.slice(i, j + 1);
    const avgUma = group.reduce((s, _, k) => s + UMA[rank + k], 0) / group.length;
    for (const seat of group) {
      bySeat[seat].uma = avgUma;
      bySeat[seat].place = rank + 1;
      if (rank === 0) bySeat[seat].oka = OKA / group.length;
      bySeat[seat].total = (scores[seat] - 30000) / 1000 + bySeat[seat].uma + bySeat[seat].oka;
    }
    rank += group.length; i = j + 1;
  }
  return rows.sort((a, b) => b.total - a.total || a.seat - b.seat);
}

module.exports = {
  shantenOf,
  hairiOf,
  getWaits,
  isDiscardFuriten,
  tryRon,
  botDiscard,
  botWantsCall,
  chiOptions,
  kuikaeBannedChi,
  countYaochuu,
  canRiichi,
  bakazeOf,
  roundLabel,
  clearAllIppatsu,
  ankanKeepsWaits,
  clearTempFuritenOnDraw,
  isSuufonRenda,
  isSuukaikanAbort,
  isNagashi,
  applyOkaUma,
};