// rosters/kiyosumi.js — Saki Miyanaga (full skill tree).
// Pattern: character code only READS state and RETURNS weights/events/plans.
// It never mutates pool.counts, hands, scores, or RNG directly, except through
// two sanctioned engine mutations:
//   - pool.reserveSlot (abstract anchors) — unused by Saki (she uses dead-wall
//     slots below instead),
//   - core.exchangeDeadWallSlot / core.sampleRinshan (physical rinshan slots,
//     wanpai stays exactly 14 tiles),
//   - flow.consume (FlowManager).
// Sampling itself always happens engine-side and stays deterministic.
const { norm, DORA_NEXT, KINDS } = require('../../tiles');
const { shantenOf, hairiOf } = require('../trajectoryPlanner');
const { scalePassiveWeight } = require('../awakening');
const { scoreHand } = require('../../scoring');

const START_SCORE = 25000;
const EQUILIBRIUM_BAND = 1500;
const TRIPLET_AFFINITY = 1.35;
const RINSHAN_WAIT_WEIGHT = 10.0;
const UKEIRE_WEIGHT = 3.0;
const TWIN_WAIT_WEIGHT = 5.0;
const SUMMIT_WIN_PROBABILITY = 0.8;
const TIER1_COST = 25;
const TIER2_COST = 50;
const TIER2_REFUND = 10; // 20% of T2 cost back when the 4th copy is exhausted
const TIER3_COST = 100;
const TIER4_COST = 150;

function evaluateEquilibrium(score, startScore = START_SCORE) {
  return Math.abs(score - startScore) <= EQUILIBRIUM_BAND;
}

function getScore(state, seat) {
  if (state.scores && state.scores[seat] !== undefined) return state.scores[seat];
  if (state.players[seat] && state.players[seat].score !== undefined) return state.players[seat].score;
  return START_SCORE;
}

function getHand(state, seat) {
  return (state.players[seat] && state.players[seat].hand) || [];
}

// Pure: 1.35 when equilibrium active AND exactly 2 copies held (norm-aware).
function passiveWeight(tile, sakiHand, score) {
  if (!evaluateEquilibrium(score)) return 1.0;
  const n = sakiHand.filter((t) => norm(t) === norm(tile)).length;
  return n === 2 ? TRIPLET_AFFINITY : 1.0;
}

function isLive(pool, wait) {
  if (!pool) return true;
  if ((pool.get(wait) || 0) > 0) return true;
  const aka = wait.replace(/^5/, '0');
  if (aka !== wait && (pool.get(aka) || 0) > 0) return true;
  return false;
}

// Both norm variants of a wait get the boost (5m + 0m).
function expandAka(wait) {
  if (/^5[mps]$/.test(wait)) return [wait, wait.replace(/^5/, '0')];
  return [wait];
}

// Pure: Tier 1 rinshan weights for a hand + pool.
// Branch A (tenpai + live wait): 10.0 on live waits, else 1.0.
// Branch B (fallback): 3.0 on live ukeire tiles, else 1.0.
function rinshanWeights(sakiHand, pool) {
  const h = hairiOf(sakiHand);
  const waits = h && h.wait ? Object.keys(h.wait) : [];
  const tenpai = shantenOf(sakiHand) === 0 && waits.length > 0;
  if (tenpai) {
    const live = waits.filter((w) => isLive(pool, w));
    if (live.length) {
      const boosted = new Set(live.flatMap(expandAka).map(norm));
      return {
        branch: 'wait',
        weightOf: (t) => (boosted.has(norm(t)) ? RINSHAN_WAIT_WEIGHT : 1.0),
        waits: live,
      };
    }
  }
  const liveUke = waits.filter((w) => isLive(pool, w));
  const boosted = new Set(liveUke.flatMap(expandAka).map(norm));
  return {
    branch: 'ukeire',
    weightOf: (t) => (boosted.has(norm(t)) ? UKEIRE_WEIGHT : 1.0),
    waits: liveUke,
  };
}

function equilibriumEvent(score) {
  return { type: 'SAKI_EQUILIBRIUM_STATE', active: evaluateEquilibrium(score), delta: score - START_SCORE };
}

// --- Closed-shape census (norm-aware; aka folds into its five) ---
function kindCounts(hand) {
  const c = {};
  for (const t of hand) {
    const k = norm(t);
    c[k] = (c[k] || 0) + 1;
  }
  return c;
}
// Kinds held 3+ (closed koutsu candidates), sorted for determinism.
function closedTriplets(hand) {
  return Object.entries(kindCounts(hand))
    .filter(([, n]) => n >= 3)
    .map(([k]) => k)
    .sort();
}
// Kinds held exactly 2 (excludes triplet kinds).
function closedPairs(hand) {
  return Object.entries(kindCounts(hand))
    .filter(([, n]) => n === 2)
    .map(([k]) => k)
    .sort();
}

// Physical 4th-copy selection: prefer the exact kind, else its aka variant.
// Returns a pool key with count > 0, or null when fully exhausted.
function physicalCopy(pool, normKind) {
  if (!pool) return normKind;
  if ((pool.get(normKind) || 0) > 0) return normKind;
  if (/^5[mps]$/.test(normKind)) {
    const aka = normKind.replace(/^5/, '0');
    if ((pool.get(aka) || 0) > 0) return aka;
  }
  return null;
}

// Fixed-boost weight fn over live waits (T2: 5.0x).
function waitBoostWeights(sakiHand, pool, boost) {
  const h = hairiOf(sakiHand);
  const waits = h && h.wait ? Object.keys(h.wait).filter((w) => isLive(pool, w)) : [];
  const boosted = new Set(waits.flatMap(expandAka).map(norm));
  return { waits, weightOf: (t) => (boosted.has(norm(t)) ? boost : 1.0) };
}

// Multiplier w so that P(wait) ~= p under the current pool:
//   n*w / (n*w + others) = p  ->  w = p*others / ((1-p)*n).
function weightForProbability(p, targetCopies, otherMass) {
  if (targetCopies <= 0 || otherMass <= 0) return 1.0;
  return (p * otherMass) / ((1 - p) * targetCopies);
}

// Win-probability weight fn (T3/T4 80%): live waits share one multiplier
// calibrated so their combined draw probability ~= p.
function winProbabilityWeights(sakiHand, pool, p) {
  const h = hairiOf(sakiHand);
  const waits = h && h.wait ? Object.keys(h.wait).filter((w) => isLive(pool, w)) : [];
  const boosted = new Set(waits.flatMap(expandAka).map(norm));
  let w = 1.0;
  if (pool && waits.length) {
    let n = 0;
    for (const b of boosted) n += pool.get(b) || 0;
    const others = pool.total() - n;
    w = weightForProbability(p, n, others);
  }
  return { waits, weight: w, weightOf: (t) => (boosted.has(norm(t)) ? w : 1.0) };
}

// Kan-dora seeding: swap the kan-dora indicator at
// deadWall[4 + kanCount*2] with the BEST unseen pool tile whose Dora points at
// a tile Saki already holds. Best = most copies held (triplet > pair > single),
// tie-break by wait membership then kind order. Conservation-preserving swap;
// null when no candidate (engine keeps the dealt indicator).
function seedKanDora(state, kanCount = 1, seat = 0) {
  const idx = 4 + kanCount * 2;
  if (!state.deadWall || idx >= state.deadWall.length || !state.pool) return null;
  const hand = getHand(state, seat);
  if (!hand.length) return null;
  const counts = kindCounts(hand);
  let h;
  try {
    h = hairiOf(hand);
  } catch {
    h = null;
  }
  const waitSet = new Set(h && h.wait ? Object.keys(h.wait).map(norm) : []);
  let best = null;
  let bestScore = -Infinity;
  for (const key of Object.keys(state.pool.counts)) {
    if ((state.pool.get(key) || 0) <= 0) continue;
    const dora = norm(DORA_NEXT(key));
    const held = counts[dora] || 0;
    if (held <= 0) continue;
    const score = held * 10 + (waitSet.has(dora) ? 5 : 0);
    if (score > bestScore || (score === bestScore && (best === null || key < best))) {
      bestScore = score;
      best = key;
    }
  }
  if (best === null) return null;
  const old = state.deadWall[idx];
  state.pool.decrement(best);
  state.deadWall[idx] = best;
  state.pool.counts[old] = (state.pool.counts[old] || 0) + 1;
  return { index: idx, from: old, to: best, dora: norm(DORA_NEXT(best)) };
}

// --- Guaranteed-rinshan helpers (all tiers pin win-if-live else best ukeire) ---
function defaultScoreCtx(state, seat) {
  const p = state.players[seat] || {};
  return {
    dora: (state.doraIndicators || state.doraInd || []).map(DORA_NEXT),
    bakaze: state.bakaze || 1,
    jikaze: p.wind || state.jikaze || 1,
    riichi: !!p.riichi,
    doubleRiichi: !!p.doubleRiichi,
    ippatsu: false,
    kanFlag: true, // Rinshan Kaihou covers a yakuless shape
    lastFlag: false,
    tenhou: false,
  };
}

// Exact live winning waits (scoreHand-validated, rinshan-legal).
function winningWaitsExact(state, seat) {
  const p = state.players[seat];
  const hand = (p && p.hand) || [];
  const melds = (p && p.melds) || [];
  const pool = state.pool;
  const ctx = defaultScoreCtx(state, seat);
  const out = [];
  for (const k of KINDS) {
    if (!isLive(pool, k)) continue;
    try {
      const r = scoreHand([...hand, k], melds, k, true, ctx);
      if (r && r.isAgari && (r.yakuman > 0 || r.han >= 1)) out.push(k);
    } catch {
      /* not this kind */
    }
  }
  return out.sort();
}

// Live tiles that reduce shanten (deterministic: strongest gain, then kind).
function advancingTilesExact(state, seat) {
  const p = state.players[seat] || {};
  const hand = p.hand || [];
  const melds = p.melds || [];
  const tiles = [...hand];
  for (const m of melds) {
    if (Array.isArray(m.tiles)) tiles.push(...m.tiles.slice(0, 4).map(norm));
  }
  const analysis = tiles.slice(0, 14);
  let before;
  try {
    before = shantenOf(analysis);
  } catch {
    return [];
  }
  let h;
  try {
    h = hairiOf(analysis);
  } catch {
    h = null;
  }
  const candidates = h && h.wait ? Object.keys(h.wait) : [];
  const hits = [];
  for (const kind of candidates) {
    const copy = physicalCopy(state.pool, kind);
    if (!copy) continue;
    let after;
    try {
      after = shantenOf([...analysis, kind]);
    } catch {
      continue;
    }
    if (after < before && after >= 0) hits.push({ kind, copy, gain: before - after });
  }
  hits.sort((a, b) => b.gain - a.gain || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
  return hits;
}

// Pin the on-deck rinshan slot: exact live win if any, else best live
// advancing/ukeire tile, never an exhausted kind. Returns {pin, branch} or null.
function guaranteeRinshanSlot(state, seat, rinshanIdx) {
  const slotIdx = Number.isInteger(rinshanIdx) ? rinshanIdx : 0;
  if (!state.deadWall || slotIdx < 0 || slotIdx >= state.deadWall.length) return null;
  const { exchangeDeadWallSlot } = require('../../core');
  const waits = winningWaitsExact(state, seat);
  const live = waits.filter((w) => isLive(state.pool, w));
  if (live.length) {
    const pin = physicalCopy(state.pool, live[0]);
    if (pin !== null && exchangeDeadWallSlot(state, slotIdx, pin)) {
      return { pin, branch: 'win', slotIdx };
    }
  }
  const advances = advancingTilesExact(state, seat);
  if (advances.length && exchangeDeadWallSlot(state, slotIdx, advances[0].copy)) {
    return { pin: advances[0].copy, branch: 'advance', slotIdx };
  }
  const uke = firstLiveUkeire(getHand(state, seat), state.pool);
  if (uke !== null && exchangeDeadWallSlot(state, slotIdx, uke)) {
    return { pin: uke, branch: 'advance', slotIdx };
  }
  return null;
}

// First live ukeire tile (norm kind), or null when none remain live.
function firstLiveUkeire(sakiHand, pool) {
  const h = hairiOf(sakiHand);
  const waits = h && h.wait ? Object.keys(h.wait) : [];
  for (const w of waits) {
    const copy = physicalCopy(pool, w);
    if (copy !== null) return copy;
  }
  return null;
}

function firstLivePoolTile(pool) {
  const keys = Object.keys(pool.counts).sort();
  return keys.length ? keys[0] : null;
}

// Phase 0: Saki starting-hand shaping (flow >= 100 only; else null).
// Takes 13 tiles from the pool forming >= 2 closed triplets + >= 1 pair with
// integer shanten in [2,3]. Rejection-samples random kind-sets deterministically
// via pool.rng; falls back to null (engine deals normally) after 50 tries.
function shapeSakiStartingHand(pool, minShanten = 2, maxShanten = 3) {
  const rng = pool.rng;
  for (let attempt = 0; attempt < 50; attempt++) {
    const tripKinds = [];
    const guard = new Set();
    while (tripKinds.length < 2) {
      const k = KINDS[Math.floor(rng.next() * KINDS.length)];
      if (!guard.has(k)) {
        guard.add(k);
        tripKinds.push(k);
      }
    }
    let pairKind = null;
    for (let i = 0; i < 20 && pairKind === null; i++) {
      const k = KINDS[Math.floor(rng.next() * KINDS.length)];
      if (!guard.has(k)) pairKind = k;
    }
    const need = {};
    for (const k of tripKinds) need[k] = 3;
    need[pairKind] = 2;
    // 5 filler tiles: distinct isolated kinds (no accidental pairs).
    const fillers = [];
    for (let i = 0; i < 40 && fillers.length < 5; i++) {
      const k = KINDS[Math.floor(rng.next() * KINDS.length)];
      if (!guard.has(k) && !fillers.includes(k)) fillers.push(k);
    }
    if (fillers.length < 5) continue;
    for (const k of fillers) need[k] = (need[k] || 0) + 1;
    // availability check against the live pool (norm-aware for 5/aka)
    let ok = true;
    const take = [];
    for (const [k, n] of Object.entries(need)) {
      let remaining = n;
      const cands = /^5[mps]$/.test(k) ? [k, k.replace(/^5/, '0')] : [k];
      for (const c of cands) {
        const use = Math.min(pool.get(c) || 0, remaining);
        for (let i = 0; i < use; i++) take.push(c);
        remaining -= use;
      }
      if (remaining > 0) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    // shanten check on the physical tiles
    const s = shantenOf(take);
    if (s < minShanten || s > maxShanten) continue;
    if (closedTriplets(take).length < 2 || closedPairs(take).length < 1) continue;
    for (const t of take) pool.decrement(t);
    return take;
  }
  return null;
}

function createSakiHooks(seat) {
  return {
    seat,
    meta: {
      type: 'flow',
      name: 'Saki Miyanaga',
      school: 'Kiyosumi',
      tiers: {
        passive: 0,
        ridgeGlimmer: TIER1_COST,
        twinRidges: TIER2_COST,
        tripleSummit: TIER3_COST,
        suukantsu: TIER4_COST,
      },
    },

    // Phase 2: Trajectory Shaper — pure weight, no mutation.
    onPowerDraw(tile, state) {
      const base = passiveWeight(tile, getHand(state, seat), getScore(state, seat));
      if (state && state.enableAwakening) {
        const flow = state.flow ? state.flow.get(seat) : 0;
        return scalePassiveWeight(base, flow, state, seat);
      }
      return base;
    },

    // Tier 1 entry point. Guarantees rinshan: exact live winning wait pinned
    // to the on-deck slot when possible, else best live ukeire tile. Also
    // seeds a maximally useful kan-dora. weightOf kept for compat/audit.
    tryActivateTier1(state, kanCount = 1, rinshanIdx = 0) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER1_COST)) return { ok: false, reason: 'insufficient-flow' };
      const hand = getHand(state, seat);
      const { branch: wBranch, weightOf, waits } = rinshanWeights(hand, state.pool);
      const deck = Number.isInteger(rinshanIdx) ? rinshanIdx : 0;
      const g = guaranteeRinshanSlot(state, seat, deck);
      const dora = seedKanDora(state, Number.isInteger(kanCount) ? kanCount : 1, seat);
      flow.consume(seat, TIER1_COST);
      if (g) {
        return {
          ok: true,
          branch: g.branch,
          waits,
          weightOf,
          event: { type: 'RINSHAN_RESONANCE_TRIGGER', tier: 1 },
          pin: g.pin,
          slotIdx: g.slotIdx,
          pinned: true,
          dora,
        };
      }
      return {
        ok: true,
        branch: wBranch,
        waits,
        weightOf,
        event: { type: 'RINSHAN_RESONANCE_TRIGGER', tier: 1 },
        pinned: false,
        dora,
      };
    },

    // Tier 2 (50): Twin Ridges. Guarantees the CURRENT rinshan (win if live,
    // else best ukeire) and chains the NEXT slot with the 4th copy of triplet
    // #2 when available. Exhausted chain tile -> Tier 1 fallback + 20% refund.
    tryActivateTier2(state, kanCount = 1, rinshanIdx = 0) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER2_COST)) return { ok: false, reason: 'insufficient-flow' };
      const hand = getHand(state, seat);
      const trips = closedTriplets(hand);
      if (trips.length < 2) return { ok: false, reason: 'precondition' };
      const { exchangeDeadWallSlot, sampleRinshan } = require('../../core');
      const deck = Number.isInteger(rinshanIdx) ? rinshanIdx : 0;
      const kCount = Number.isInteger(kanCount) ? kanCount : 1;
      const g = guaranteeRinshanSlot(state, seat, deck);
      const dora = seedKanDora(state, kCount, seat);
      const nextIdx = deck + 1;
      let kanTile = null;
      if (state.deadWall && nextIdx < state.deadWall.length) {
        const pin = physicalCopy(state.pool, trips[1]);
        if (pin !== null && exchangeDeadWallSlot(state, nextIdx, pin)) kanTile = pin;
      }
      if (g === null && kanTile === null) {
        // Fallback: Tier 1 behavior, 20% of the T2 cost refunded (net 40).
        const { branch, weightOf, waits } = rinshanWeights(hand, state.pool);
        flow.consume(seat, TIER2_COST - TIER2_REFUND);
        return {
          ok: true,
          fallback: 'tier1',
          branch,
          waits,
          weightOf,
          event: { type: 'RINSHAN_RESONANCE_TRIGGER', tier: 2 },
          pinned: false,
          dora,
        };
      }
      const { weightOf, waits } = waitBoostWeights(hand, state.pool, TWIN_WAIT_WEIGHT);
      // Keep a weighted sample only on the chained NEXT slot when it was not
      // deterministically pinned; never overwrite the guaranteed current slot.
      let rinshanSlot1 = kanTile;
      if (kanTile === null && state.deadWall && nextIdx < state.deadWall.length) {
        rinshanSlot1 = sampleRinshan(state, nextIdx, weightOf);
      }
      flow.consume(seat, TIER2_COST);
      return {
        ok: true,
        kanTile,
        rinshanSlot1,
        waits,
        weightOf,
        event: { type: 'RINSHAN_RESONANCE_TRIGGER', tier: 2 },
        pin: g ? g.pin : null,
        slotIdx: g ? g.slotIdx : deck,
        branch: g ? g.branch : 'chain',
        pinned: !!g,
        dora,
      };
    },

    // Tier 3 (100): Triple Summit. Guarantees CURRENT rinshan (win if live,
    // else best ukeire), chains next slots with 4th copies, and seeds the BEST
    // kan-dora (most copies held). Keeps 80% weight for compat.
    tryActivateTier3(state, kanCount = 1, rinshanIdx = 0) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER3_COST)) return { ok: false, reason: 'insufficient-flow' };
      const hand = getHand(state, seat);
      const trips = closedTriplets(hand);
      const pairs = closedPairs(hand);
      if (trips.length < 2 || pairs.length < 1) return { ok: false, reason: 'precondition' };
      const { exchangeDeadWallSlot } = require('../../core');
      const deck = Number.isInteger(rinshanIdx) ? rinshanIdx : 0;
      const kCount = Number.isInteger(kanCount) ? kanCount : 1;
      const g = guaranteeRinshanSlot(state, seat, deck);
      const pins = [];
      if (g) pins.push(g.pin);
      for (let o = 1; o <= 2; o++) {
        const idx = deck + o;
        if (!state.deadWall || idx >= state.deadWall.length) break;
        const kind = trips[o % trips.length];
        const copy = physicalCopy(state.pool, kind);
        if (copy !== null && exchangeDeadWallSlot(state, idx, copy) && !pins.includes(copy)) pins.push(copy);
      }
      const dora = seedKanDora(state, kCount, seat);
      const { weightOf, waits } = winProbabilityWeights(hand, state.pool, SUMMIT_WIN_PROBABILITY);
      flow.consume(seat, TIER3_COST);
      return {
        ok: true,
        pins,
        dora,
        rinshanSlot2: pins[1] || null,
        waits,
        weightOf,
        event: { type: 'RINSHAN_RESONANCE_TRIGGER', tier: 3 },
        pin: g ? g.pin : null,
        slotIdx: deck,
        branch: g ? g.branch : 'chain',
        pinned: !!g,
      };
    },

    // Tier 4 (150): Suukantsu Bounded Climax. Requires 3 closed triplets.
    // Guarantees CURRENT rinshan via exact scoreHand-validated wait; dora is
    // best-useful; far slot pinned to live wait when possible (double yakuman
    // path), else best completer (San Kantsu Baiman path).
    tryActivateTier4(state, kanCount = 1, rinshanIdx = 0) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER4_COST)) return { ok: false, reason: 'insufficient-flow' };
      const hand = getHand(state, seat);
      const trips = closedTriplets(hand);
      if (trips.length < 3) return { ok: false, reason: 'precondition' };
      const { exchangeDeadWallSlot } = require('../../core');
      const deck = Number.isInteger(rinshanIdx) ? rinshanIdx : 0;
      const kCount = Number.isInteger(kanCount) ? kanCount : 1;
      const g = guaranteeRinshanSlot(state, seat, deck);
      const pins = [];
      if (g) pins.push(g.pin);
      for (let o = 1; o <= 2; o++) {
        const idx = deck + o;
        if (!state.deadWall || idx >= state.deadWall.length) break;
        const copy = physicalCopy(state.pool, trips[o % trips.length]);
        if (copy !== null && exchangeDeadWallSlot(state, idx, copy) && !pins.includes(copy)) pins.push(copy);
      }
      const dora = seedKanDora(state, kCount, seat);
      const liveExact = winningWaitsExact(state, seat);
      if (liveExact.length) {
        const farIdx = Math.min(deck + 3, state.deadWall.length - 1);
        const copy = physicalCopy(state.pool, liveExact[0]);
        if (copy !== null) exchangeDeadWallSlot(state, farIdx, copy);
        const mid = winProbabilityWeights(hand, state.pool, SUMMIT_WIN_PROBABILITY);
        flow.consume(seat, TIER4_COST);
        return {
          ok: true,
          branch: 'win',
          pins,
          dora,
          rinshanSlot2: pins[1] || null,
          haiteiSlot3: copy,
          waits: liveExact,
          weightOf: mid.weightOf,
          event: { type: 'RINSHAN_RESONANCE_TRIGGER', tier: 4 },
          pin: g ? g.pin : null,
          slotIdx: deck,
          pinned: !!g,
        };
      }
      const completer = firstLiveUkeire(hand, state.pool) || firstLivePoolTile(state.pool);
      if (completer !== null && state.deadWall && deck + 2 < state.deadWall.length)
        exchangeDeadWallSlot(state, deck + 2, completer);
      flow.consume(seat, TIER4_COST);
      return {
        ok: true,
        branch: g ? g.branch : 'fallback',
        pins,
        dora,
        rinshanSlot2: completer,
        waits: [],
        event: { type: 'RINSHAN_RESONANCE_TRIGGER', tier: 4 },
        pin: g ? g.pin : null,
        slotIdx: deck,
        pinned: !!g,
      };
    },

    getTierInfo(state) {
      const flow = state.flow ? state.flow.get(seat) : 0;
      const hand = getHand(state, seat);
      const trips = closedTriplets(hand);
      const pairs = closedPairs(hand);

      const t1Pre = true;
      const t2Pre = trips.length >= 2;
      const t3Pre = trips.length >= 2 && pairs.length >= 1;
      const t4Pre = trips.length >= 3;

      return [
        {
          tier: 1,
          name: 'Ridge Glimmer',
          cost: TIER1_COST,
          canAfford: flow >= TIER1_COST,
          canActivate: flow >= TIER1_COST && t1Pre,
        },
        {
          tier: 2,
          name: 'Twin Ridges',
          cost: TIER2_COST,
          canAfford: flow >= TIER2_COST,
          canActivate: flow >= TIER2_COST && t2Pre,
        },
        {
          tier: 3,
          name: 'Triple Summit',
          cost: TIER3_COST,
          canAfford: flow >= TIER3_COST,
          canActivate: flow >= TIER3_COST && t3Pre,
        },
        {
          tier: 4,
          name: 'Suukantsu Climax',
          cost: TIER4_COST,
          canAfford: flow >= TIER4_COST,
          canActivate: flow >= TIER4_COST && t4Pre,
        },
      ];
    },

    activateTier(state, tier, kanCount = 1, rinshanIdx = 0) {
      switch (tier) {
        case 1:
          return this.tryActivateTier1(state, kanCount, rinshanIdx);
        case 2:
          return this.tryActivateTier2(state, kanCount, rinshanIdx);
        case 3:
          return this.tryActivateTier3(state, kanCount, rinshanIdx);
        case 4:
          return this.tryActivateTier4(state, kanCount, rinshanIdx);
        default:
          return { ok: false, reason: 'invalid-tier' };
      }
    },

    onKanDeclared(state, { armedTier = 0, kanCount = 1, rinshanIdx = 0 } = {}) {
      if (armedTier === 0) return { activated: false, reason: 'conserve' };
      if (armedTier === 'auto') {
        for (const t of [4, 3, 2, 1]) {
          const r = this.activateTier(state, t, kanCount, rinshanIdx);
          if (r && r.ok) return { activated: true, tier: t, result: r };
        }
        return { activated: false, reason: 'no-tier-eligible' };
      }
      if (armedTier >= 1 && armedTier <= 4) {
        const r = this.activateTier(state, armedTier, kanCount, rinshanIdx);
        if (r && r.ok) return { activated: true, tier: armedTier, result: r };
        return { activated: false, reason: (r && r.reason) || 'activation-failed' };
      }
      return { activated: false, reason: 'invalid-tier' };
    },

    onTurnStart(_state, _opts) {
      // Saki is a Kan-reactive specialist; turn-start triggers are inactive
      return { activated: false, reason: 'kan-only' };
    },

    // Phase 3: Settlement Modifier hook — consumes all flow on rinshan win.
    onSettlement(result, state) {
      if (
        result &&
        result.type === 'tsumo' &&
        result.winner === seat &&
        typeof result.tag === 'string' &&
        result.tag.includes('RINSHAN')
      ) {
        if (state.flow) state.flow.consumeAll(seat);
      }
    },
  };
}

module.exports = {
  evaluateEquilibrium,
  passiveWeight,
  rinshanWeights,
  equilibriumEvent,
  closedTriplets,
  closedPairs,
  physicalCopy,
  waitBoostWeights,
  weightForProbability,
  winProbabilityWeights,
  seedKanDora,
  winningWaitsExact,
  advancingTilesExact,
  guaranteeRinshanSlot,
  firstLiveUkeire,
  shapeSakiStartingHand,
  createSakiHooks,
  SAKI: {
    START_SCORE,
    EQUILIBRIUM_BAND,
    TRIPLET_AFFINITY,
    RINSHAN_WAIT_WEIGHT,
    UKEIRE_WEIGHT,
    TWIN_WAIT_WEIGHT,
    SUMMIT_WIN_PROBABILITY,
    TIER1_COST,
    TIER2_COST,
    TIER2_REFUND,
    TIER3_COST,
    TIER4_COST,
  },
};
