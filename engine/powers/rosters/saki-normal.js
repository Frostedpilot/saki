// rosters/saki-normal.js — Saki Miyanaga (EXTREME normal-type variant).
// type: 'normal' — a fully automatic power outside the Flow economy: always at
// full strength, no tiers, no gauge, no cost, and nothing the player can opt
// into or out of. Conditions are evaluated purely by the engine at each trigger.
//
//   Passive (Ridge Bias): while enabled, draws of the 4th copy of a triplet she
//     already holds get KAN_BIAS_WEIGHT. (aka-aware: 0m folds into 5m.)
//   Kan (Ridge Resonance): whenever she declares a kan, the replacement slot on
//     the dead wall is pinned to a tile that advances her hand. If she is tenpai
//     the exact live winning wait is pinned — 100% Rinshan Kaihou.
//   Weakness: any kan declared by another player in the same hand disables the
//     power for the rest of that hand (bias and guarantees all off).
const { KINDS, norm, DORA_NEXT } = require('../../tiles');
const { shantenOf, hairiOf } = require('../trajectoryPlanner');
const { exchangeDeadWallSlot } = require('../../core');
const { scoreHand } = require('../../scoring');

const KAN_BIAS_WEIGHT = 4.0;

function getHand(state, seat) {
  return (state.players[seat] && state.players[seat].hand) || [];
}

// Norm-kind census (aka folds into its five).
function kindCounts(hand) {
  const c = {};
  for (const t of hand) {
    const k = norm(t);
    c[k] = (c[k] || 0) + 1;
  }
  return c;
}

// Whether the drawn tile is the 4th copy of a kind she already holds 3+ of.
function isFourthCopyOfTriplet(tile, hand) {
  return (kindCounts(hand)[norm(tile)] || 0) >= 3;
}

// Physical pool key for a norm kind (aka variant if the plain 5 is gone).
function physicalCopy(pool, normKind) {
  if (!pool) return normKind;
  if ((pool.get(normKind) || 0) > 0) return normKind;
  if (/^5[mps]$/.test(normKind)) {
    const aka = normKind.replace(/^5/, '0');
    if ((pool.get(aka) || 0) > 0) return aka;
  }
  return null;
}

function isLive(pool, kind) {
  if (!pool) return true;
  if ((pool.get(kind) || 0) > 0) return true;
  if (/^5[mps]$/.test(kind)) {
    const aka = kind.replace(/^5/, '0');
    if ((pool.get(aka) || 0) > 0) return true;
  }
  return false;
}

// Closed 13/14-tile-equivalent of an open hand (melds materialized into the
// analysis hand) so the concealed syanten/hairi libs can score it. Used only
// for directional shanten work; exact wins are verified via scoreHand instead.
function reconstructAnalysisHand(state, seat) {
  const p = state.players[seat];
  const hand = (p && p.hand) || [];
  const melds = (p && p.melds) || [];
  const tiles = [...hand];
  for (const m of melds) {
    if (Array.isArray(m.tiles)) tiles.push(...m.tiles.slice(0, 4).map(norm));
  }
  return tiles.slice(0, 14);
}

function defaultCtx(state, seat) {
  const p = state.players[seat] || {};
  return {
    dora: (state.doraIndicators || state.doraInd || []).map(DORA_NEXT),
    bakaze: state.bakaze || 1,
    jikaze: p.wind || state.jikaze || 1,
    riichi: !!p.riichi,
    doubleRiichi: !!p.doubleRiichi,
    ippatsu: false,
    kanFlag: true, // the Rinshan Kaihou yaku covers a yaku-less complete shape
    lastFlag: false,
    tenhou: false,
  };
}

// Exact live winning waits for the current open hand (mirrors the server's own
// post-rinshan scoring, one tile early): for each kind, score the hand as if it
// drew it. Returns normalized kinds that form a legal win.
function winningWaits(state, seat, pool) {
  const p = state.players[seat];
  const hand = (p && p.hand) || [];
  const melds = (p && p.melds) || [];
  const ctx = defaultCtx(state, seat);
  const out = [];
  for (const k of KINDS) {
    if (!isLive(pool, k)) continue;
    try {
      const r = scoreHand([...hand, k], melds, k, true, ctx);
      if (r && r.isAgari && (r.yakuman > 0 || r.han >= 1)) out.push(k);
    } catch {
      /* just not this kind */
    }
  }
  return out.sort();
}

// Live candidate tiles that reduce shanten vs the current hand.
function advancingTiles(state, seat, pool) {
  const analysis = reconstructAnalysisHand(state, seat);
  const before = shantenOf(analysis);
  const h = hairiOf(analysis);
  const candidates = h && h.wait ? Object.keys(h.wait) : [];
  const hits = [];
  for (const kind of candidates) {
    const copy = physicalCopy(pool, kind);
    if (!copy) continue;
    const after = shantenOf([...analysis, kind]);
    if (after < before && after >= 0) hits.push({ kind, copy, gain: before - after });
  }
  // Deterministic: strongest gain first, then tile order.
  hits.sort((a, b) => b.gain - a.gain || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
  return hits;
}

function createSakiNormalHooks(seat) {
  let disabled = false;

  return {
    seat,
    meta: {
      type: 'normal',
      name: 'Saki Miyanaga (Extreme)',
      school: 'Kiyosumi',
      passiveName: 'Ridge Bias / Ridge Resonance (Normal)',
      tiers: {},
    },
    getTierInfo() {
      return [];
    },

    // Phase 2: passive kan bias — the 4th copy of a held triplet draws hot.
    onPowerDraw(tile, state) {
      if (disabled) return 1.0;
      return isFourthCopyOfTriplet(tile, getHand(state, seat)) ? KAN_BIAS_WEIGHT : 1.0;
    },

    // Every kan on the table leaks into the registry (Spec §5.3 field channel).
    // Another player's kan in this hand severs the resonance.
    onPlayerKan(kanSeat) {
      if (kanSeat !== seat) disabled = true;
    },

    // Her own kan: pin the on-deck replacement slot. Tenpai → exact live win
    // tile (100% Rinshan Kaihou). Otherwise → a live tile that lowers shanten.
    onKanDeclared(state, opts = {}) {
      if (disabled) return { activated: false, reason: 'disrupted' };
      const pool = state.pool;
      const slotIdx = typeof opts.rinshanIdx === 'number' ? opts.rinshanIdx : 0;
      if (slotIdx < 0 || !state.deadWall || slotIdx >= state.deadWall.length) {
        return { activated: false, reason: 'slot-unavailable' };
      }

      let pin = null;
      let branch = 'advance';
      const waits = winningWaits(state, seat, pool);
      if (waits.length) {
        const live = waits.filter((w) => isLive(pool, w));
        if (live.length) {
          pin = physicalCopy(pool, live[0]);
          branch = 'win';
        }
      }
      if (pin === null) {
        const advances = advancingTiles(state, seat, pool);
        if (advances.length) {
          pin = advances[0].copy;
          branch = 'advance';
        }
      }
      if (pin === null) {
        return { activated: false, reason: 'no-live-tile' };
      }

      const swapped = exchangeDeadWallSlot(state, slotIdx, pin);
      if (!swapped) return { activated: false, reason: 'swap-failed' };

      const eventObj = { type: 'RIDGE_RESONANCE_NORMAL', branch, pin, slotIdx };
      return {
        activated: true,
        branch,
        pin,
        slotIdx,
        event: eventObj,
        result: { event: eventObj },
      };
    },

    isPowerActive() {
      return !disabled;
    },

    getHudAdvice() {
      return disabled
        ? 'Ridge Resonance severed by an opponent kan (this hand).'
        : 'Ridge Resonance active — kan replacement is pinned to an advancing tile (100% Rinshan at tenpai); 4th copies of held triplets draw hot.';
    },
  };
}

module.exports = { createSakiNormalHooks, KAN_BIAS_WEIGHT, winningWaits, advancingTiles };
