'use strict';
// turn-core.js — the single-turn decisions both front-ends must agree on.
//
// This is phase 3 of the turn-loop merge (see docs/turn-loop-merge.md): the
// *rules* of one turn are shared here, while each driver still owns its I/O,
// its draw model and its settlement shapes. Nothing in this module awaits,
// prompts, broadcasts or mutates a hand; it only answers "what may happen?".
//
// The two drivers used to duplicate these decisions inline:
//
//   own kan      engine/game.js ~700 and server/table.js ~1000
//   call window  engine/game.js collectRon/pon/chi and table.js resolveCallWindow
//
// The call window is the larger duplicate and the one with real arbitration
// rules (riichi seats cannot call, daiminkan needs three copies and kan budget,
// chi is shimocha-only, ron beats pon/kan beats chi, nearest-in-turn-order wins
// a pon/kan tie). Keeping one definition here is what makes phase 4 — a shared
// `playHand(adapter)` — possible without re-deriving the rules.
const { norm, same } = require('./tiles');
const { tryRon, chiOptions } = require('./helpers');
const { RULES } = require('./rules-config');

// Turn-start bookkeeping. Both drivers ask the same questions before a draw:
// may this seat claim tenhou/chihou (the first four uninterrupted draws), is
// this the last draw of the wall, and what tsumo flags does scoring need?
//
// `wallLeft` is the live-wall count *before* the draw. `tenhouWindow` is
// explicit because it is the one place the two drivers historically differed;
// both now use four (server `isFirstDraw`, CLI `firstDrawOfKyoku`), so the
// default is the shared rule, not a per-driver policy.
function beginTurn(me, opts = {}) {
  const callsMade = opts.callsMade ?? 0;
  const drawsThisKyoku = opts.drawsThisKyoku ?? 0;
  const wallLeft = opts.wallLeft ?? 0;
  const tenhouWindow = opts.tenhouWindow ?? 4;
  const firstDraw =
    !!me &&
    (me.discards || []).length === 0 &&
    (me.melds || []).length === 0 &&
    callsMade === 0 &&
    drawsThisKyoku <= tenhouWindow;
  const isLastDraw = wallLeft === 1;
  return {
    firstDraw,
    isLastDraw,
    tsumoFlags: { tsumo: true, kan: false, last: isLastDraw, tenhou: firstDraw },
  };
}

// Discard bookkeeping. The first-lap accumulator feeds suufon-renda: the first
// discard of each seat, only while no call has been made. Ippatsu expires on
// the declarer's first discard *after* the declaring discard: the declaring
// discard itself must not clear it (`ippatsuJustDeclared`), and any call clears
// it earlier through `clearAllIppatsu`.
//
// Pure: the caller writes the returned flags back onto its player object.
function resolveDiscard(input = {}) {
  const firstLap = (input.callsMade ?? 0) === 0 && (input.discardsCount ?? 0) === 1 && !input.suufonDone;
  const justDeclared = !!input.ippatsuJustDeclared;
  return {
    firstLap,
    ippatsu: justDeclared ? !!input.ippatsu : false,
    ippatsuJustDeclared: false,
  };
}

// Own-turn kan availability. `me.hand` is the 14-tile hand (the draw included).
// The kan budget is checked before the hand is inspected because both drivers
// treat "limit reached" as "no kan offer at all", not as an illegal choice.
//
// Returns { ankanTile, ponUp, kakanTile, canKan, blocked }, where `ponUp` is the
// pon meld that can be upgraded and `kakanTile` is the tile to add to it.
function kanOptions(me, opts = {}) {
  const kanCount = opts.kanCount ?? 0;
  const rinshanIdx = opts.rinshanIdx ?? 0;
  const maxKan = opts.maxKan ?? RULES.maxKan;
  const rinshanSlots = opts.rinshanSlots ?? RULES.rinshanSlots;

  if (kanCount >= maxKan) return { ankanTile: null, ponUp: null, kakanTile: null, canKan: false, blocked: 'kan-limit' };
  if (rinshanIdx >= rinshanSlots)
    return { ankanTile: null, ponUp: null, kakanTile: null, canKan: false, blocked: 'rinshan-exhausted' };

  const counts = {};
  for (const tile of me.hand) {
    const k = norm(tile);
    counts[k] = (counts[k] || 0) + 1;
  }
  const ankanTile = Object.keys(counts).find((k) => counts[k] === 4) || null;
  const ponUp = (me.melds || []).find((m) => m.type === 'pon' && me.hand.some((h) => same(h, m.tiles[0]))) || null;
  const kakanTile = ponUp ? norm(ponUp.tiles[0]) : null;

  return { ankanTile, ponUp, kakanTile, canKan: !!(ankanTile || kakanTile), blocked: null };
}

// Every legal pair of hand tiles that can pon `tile`, as actual hand tiles (the
// server converts them to protocol codes when it builds the wire options).
function ponOptions(hand, tile) {
  const held = hand.filter((x) => same(x, tile));
  const opts = [];
  for (let i = 0; i < held.length; i++) {
    for (let j = i + 1; j < held.length; j++) opts.push([held[i], held[j]]);
  }
  return opts;
}

// Enumerate the call window for one discard, for all three other seats, in
// turn order. This returns one entry per seat (even a seat with no claim) so a
// driver can still report furiten; filter with `isCall` for the actual claims.
//
//   ron       tryRon result when the seat may ron, else null
//   ronBlocked tryRon result when the seat was furiten (for the CLI's log)
//   pon       array of hand-tile pairs, or null
//   daiminkan true when the same seat has three copies and the kan budget allows
//   chi       rank pairs from helpers.chiOptions, or null (shimocha only)
//
// `scoreCtxFor(seat)` builds the scoring context; it is required unless
// `ron: false`, which the CLI uses for its second pass after collectRon has
// already resolved the ron window. `canOpen(seat, player)` decides whether a
// seat may make an open call at all (the CLI's --closed-only demo flag lets
// humans open but not bots); it defaults to allowing everyone. `chankan`
// suppresses every open call as well (only a ron applies).
function callCandidates(input) {
  const from = input.from;
  const tile = input.tile;
  const players = input.players;
  const dead = input.dead;
  const wantRon = input.ron !== false;
  const minHan = input.minHan ?? 1;
  const chankan = !!input.chankan;
  const canOpen = typeof input.canOpen === 'function' ? input.canOpen : () => true;
  const allowChi = input.allowChi !== false;
  const kanCount = input.kanCount ?? 0;
  const rinshanIdx = input.rinshanIdx ?? 0;
  const maxKan = input.maxKan ?? RULES.maxKan;
  const rinshanSlots = input.rinshanSlots ?? RULES.rinshanSlots;

  if (wantRon && typeof input.scoreCtxFor !== 'function')
    throw new TypeError('callCandidates: scoreCtxFor is required unless ron is false');

  const out = [];
  for (let k = 1; k <= 3; k++) {
    const seat = (from + k) % 4;
    const qp = players[seat];

    let ron = null;
    let ronBlocked = null;
    if (wantRon) {
      const att = tryRon(qp, tile, input.scoreCtxFor(seat), players, dead, { chankan, minHan });
      if (att.win) ron = att;
      else if (att.blocked) ronBlocked = att;
    }

    let pon = null;
    let daiminkan = false;
    let chi = null;
    if (!chankan && canOpen(seat, qp) && !qp.riichi) {
      const nSame = qp.hand.filter((x) => same(x, tile)).length;
      if (nSame >= 2) {
        pon = ponOptions(qp.hand, tile);
        if (nSame >= 3 && kanCount < maxKan && rinshanIdx < rinshanSlots) daiminkan = true;
      }
      // Chi is shimocha only (the seat immediately after the discarder).
      if (allowChi && seat === (from + 1) % 4 && qp.hand.length > 0) {
        const opts = chiOptions(qp.hand, tile);
        if (opts.length) chi = opts;
      }
    }

    out.push({ seat, qp, ron, ronBlocked, pon, daiminkan, chi });
  }
  return out;
}

function isCall(candidate) {
  return !!(candidate && (candidate.ron || candidate.pon || candidate.chi));
}

// Resolve a simultaneous call window. `candidates` is the callCandidates array
// or a Map keyed by seat; `responses` is the drivers' array of
// { seat, type, tiles? } (response order is not turn order).
//
// Priority is standard riichi:
//   1. every valid ron claimant wins (double/triple ron is the caller's policy)
//   2. the nearest pon/daiminkan claimant in turn order
//   3. chi (shimocha only, so at most one seat)
//
// `passers` lists candidates who could have ronned but did not; the caller must
// mark them temporary furiten. This function deliberately does not mutate: the
// server and the CLI keep furiten on different objects.
//
// Returns { type, claims?, seat?, tiles?, passers } where type is
// 'ron' | 'pon' | 'daiminkan' | 'chi' | null.
function arbitrateCalls({ from, candidates, responses }) {
  const bySeat = candidates instanceof Map ? candidates : new Map(candidates.map((c) => [c.seat, c]));
  const turnRank = (seat) => (seat - from + 4) % 4;
  const ordered = [...responses].sort((a, b) => turnRank(a.seat) - turnRank(b.seat));

  const passers = ordered
    .filter((r) => r.type !== 'Ron' && bySeat.get(r.seat) && bySeat.get(r.seat).ron)
    .map((r) => r.seat);

  const ronClaims = ordered.filter((r) => r.type === 'Ron' && bySeat.get(r.seat) && bySeat.get(r.seat).ron);
  if (ronClaims.length > 0) {
    return { type: 'ron', claims: ronClaims.map((r) => ({ seat: r.seat })), passers };
  }

  const open = ordered.find(
    (r) =>
      (r.type === 'Pon' && bySeat.get(r.seat) && bySeat.get(r.seat).pon) ||
      (r.type === 'Kan' && bySeat.get(r.seat) && bySeat.get(r.seat).daiminkan)
  );
  if (open) {
    return { type: open.type === 'Kan' ? 'daiminkan' : 'pon', seat: open.seat, passers };
  }

  const chiClaim = ordered.find((r) => r.type === 'Chi' && bySeat.get(r.seat) && bySeat.get(r.seat).chi);
  if (chiClaim) {
    const candidate = bySeat.get(chiClaim.seat);
    let chosen = chiClaim.tiles;
    if (!Array.isArray(chosen) || chosen.length !== 2) chosen = candidate.chi[0];
    return { type: 'chi', seat: chiClaim.seat, tiles: chosen, passers };
  }

  return { type: null, passers };
}

module.exports = {
  beginTurn,
  resolveDiscard,
  kanOptions,
  ponOptions,
  callCandidates,
  isCall,
  arbitrateCalls,
};
