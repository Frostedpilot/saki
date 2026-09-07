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
  const n = sakiHand.filter(t => norm(t) === norm(tile)).length;
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
    const live = waits.filter(w => isLive(pool, w));
    if (live.length) {
      const boosted = new Set(live.flatMap(expandAka).map(norm));
      return {
        branch: 'wait',
        weightOf: t => (boosted.has(norm(t)) ? RINSHAN_WAIT_WEIGHT : 1.0),
        waits: live,
      };
    }
  }
  const liveUke = waits.filter(w => isLive(pool, w));
  const boosted = new Set(liveUke.flatMap(expandAka).map(norm));
  return {
    branch: 'ukeire',
    weightOf: t => (boosted.has(norm(t)) ? UKEIRE_WEIGHT : 1.0),
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
  return Object.entries(kindCounts(hand)).filter(([, n]) => n >= 3).map(([k]) => k).sort();
}
// Kinds held exactly 2 (excludes triplet kinds).
function closedPairs(hand) {
  return Object.entries(kindCounts(hand)).filter(([, n]) => n === 2).map(([k]) => k).sort();
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
  const waits = h && h.wait ? Object.keys(h.wait).filter(w => isLive(pool, w)) : [];
  const boosted = new Set(waits.flatMap(expandAka).map(norm));
  return { waits, weightOf: t => (boosted.has(norm(t)) ? boost : 1.0) };
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
  const waits = h && h.wait ? Object.keys(h.wait).filter(w => isLive(pool, w)) : [];
  const boosted = new Set(waits.flatMap(expandAka).map(norm));
  let w = 1.0;
  if (pool && waits.length) {
    let n = 0;
    for (const b of boosted) n += pool.get(b) || 0;
    const others = pool.total() - n;
    w = weightForProbability(p, n, others);
  }
  return { waits, weight: w, weightOf: t => (boosted.has(norm(t)) ? w : 1.0) };
}

// Kan-dora seeding (T3/T4): swap the kan-dora indicator at
// deadWall[4 + kanCount*2] with an unseen pool tile whose Dora points at a
// tile Saki already holds. Conservation-preserving swap; null when no
// candidate (engine keeps the dealt indicator).
function seedKanDora(state, kanCount = 1, seat = 0) {
  const idx = 4 + kanCount * 2;
  if (!state.deadWall || idx >= state.deadWall.length) return null;
  const handNorms = new Set(getHand(state, seat).map(norm));
  if (!handNorms.size) return null;
  for (const key of Object.keys(state.pool.counts)) {
    if (handNorms.has(norm(DORA_NEXT(key)))) {
      const old = state.deadWall[idx];
      state.pool.decrement(key);
      state.deadWall[idx] = key;
      state.pool.counts[old] = (state.pool.counts[old] || 0) + 1;
      return { index: idx, from: old, to: key, dora: norm(DORA_NEXT(key)) };
    }
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
      if (!guard.has(k)) { guard.add(k); tripKinds.push(k); }
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
      if (remaining > 0) { ok = false; break; }
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
      name: 'Saki Miyanaga',
      school: 'Kiyosumi',
      tiers: { passive: 0, ridgeGlimmer: TIER1_COST, twinRidges: TIER2_COST, tripleSummit: TIER3_COST, suukantsu: TIER4_COST },
    },

    // Phase 2: Trajectory Shaper — pure weight, no mutation.
    onPowerDraw(tile, state) {
      return passiveWeight(tile, getHand(state, seat), getScore(state, seat));
    },

    // Tier 1 entry point. Engine calls this on Kan declaration; it checks
    // flow, computes weights via helpers, consumes flow. Returns weights +
    // branch for the engine's rinshan sample. Never draws itself.
    tryActivateTier1(state) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER1_COST)) return { ok: false, reason: 'insufficient-flow' };
      const hand = getHand(state, seat);
      const { branch, weightOf, waits } = rinshanWeights(hand, state.pool);
      flow.consume(seat, TIER1_COST);
      return { ok: true, branch, waits, weightOf, event: { type: 'RINSHAN_RESONANCE_TRIGGER', tier: 1 } };
    },

    // Tier 2 (50): Twin Ridges. Pins the 4th copy of triplet #2 into
    // deadWall[0] (Kan #2 tile), then weighted-samples deadWall[1] with a 5x
    // winning-wait boost. Exhausted 4th copy -> Tier 1 fallback + 20% refund.
    tryActivateTier2(state) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER2_COST)) return { ok: false, reason: 'insufficient-flow' };
      const hand = getHand(state, seat);
      const trips = closedTriplets(hand);
      if (trips.length < 2) return { ok: false, reason: 'precondition' };
      const { exchangeDeadWallSlot, sampleRinshan } = require('../../core');
      const pin = physicalCopy(state.pool, trips[1]);
      if (pin === null) {
        // Fallback: Tier 1 behavior, 20% of the T2 cost refunded (net 40).
        const { branch, weightOf, waits } = rinshanWeights(hand, state.pool);
        flow.consume(seat, TIER2_COST - TIER2_REFUND);
        return { ok: true, fallback: 'tier1', branch, waits, weightOf, event: { type: 'RINSHAN_RESONANCE_TRIGGER', tier: 2 } };
      }
      exchangeDeadWallSlot(state, 0, pin);
      const { weightOf, waits } = waitBoostWeights(hand, state.pool, TWIN_WAIT_WEIGHT);
      const placed = sampleRinshan(state, 1, weightOf);
      flow.consume(seat, TIER2_COST);
      return { ok: true, kanTile: pin, rinshanSlot1: placed, waits, weightOf, event: { type: 'RINSHAN_RESONANCE_TRIGGER', tier: 2 } };
    },

    // Tier 3 (100): Triple Summit. Pins 4th copies of triplets #2/#3 into
    // deadWall[0..1], seeds kan-dora indicators toward held tiles, and places
    // deadWall[2] under an 80%-win-probability weight for the winning wait.
    tryActivateTier3(state, kanCount = 1) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER3_COST)) return { ok: false, reason: 'insufficient-flow' };
      const hand = getHand(state, seat);
      const trips = closedTriplets(hand);
      const pairs = closedPairs(hand);
      if (trips.length < 2 || pairs.length < 1) return { ok: false, reason: 'precondition' };
      const { exchangeDeadWallSlot, sampleRinshan } = require('../../core');
      const pins = [];
      for (const idx of [0, 1]) {
        const kind = trips[(idx + 1) % trips.length];
        const copy = physicalCopy(state.pool, kind);
        if (copy !== null && exchangeDeadWallSlot(state, idx, copy)) pins.push(copy);
      }
      const dora = seedKanDora(state, kanCount, seat);
      const { weightOf, waits } = winProbabilityWeights(hand, state.pool, SUMMIT_WIN_PROBABILITY);
      const placed = sampleRinshan(state, 2, weightOf);
      flow.consume(seat, TIER3_COST);
      return { ok: true, pins, dora, rinshanSlot2: placed, waits, weightOf, event: { type: 'RINSHAN_RESONANCE_TRIGGER', tier: 3 } };
    },

    // Tier 4 (150): Suukantsu Bounded Climax. Requires 3 closed triplets.
    // Branch A (wait live): winning wait pinned into deadWall[3] (double
    // yakuman path). Branch B (wait exhausted): stops at Kan #3 with a live
    // sequence-completer in deadWall[2] (San Kantsu Baiman path).
    tryActivateTier4(state, kanCount = 1) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER4_COST)) return { ok: false, reason: 'insufficient-flow' };
      const hand = getHand(state, seat);
      const trips = closedTriplets(hand);
      if (trips.length < 3) return { ok: false, reason: 'precondition' };
      const { exchangeDeadWallSlot, sampleRinshan } = require('../../core');
      const pins = [];
      for (const idx of [0, 1]) {
        const copy = physicalCopy(state.pool, trips[(idx + 1) % trips.length]);
        if (copy !== null && exchangeDeadWallSlot(state, idx, copy)) pins.push(copy);
      }
      const dora = seedKanDora(state, kanCount, seat);
      const h = hairiOf(hand);
      const waits = h && h.wait ? Object.keys(h.wait) : [];
      const liveWaits = waits.filter(w => isLive(state.pool, w));
      if (liveWaits.length) {
        const w = liveWaits[0];
        const copy = physicalCopy(state.pool, w);
        exchangeDeadWallSlot(state, 3, copy);
        const mid = winProbabilityWeights(hand, state.pool, SUMMIT_WIN_PROBABILITY);
        const placed = sampleRinshan(state, 2, mid.weightOf);
        flow.consume(seat, TIER4_COST);
        return { ok: true, branch: 'win', pins, dora, rinshanSlot2: placed, haiteiSlot3: copy, waits: liveWaits, weightOf: mid.weightOf, event: { type: 'RINSHAN_RESONANCE_TRIGGER', tier: 4 } };
      }
      const completer = firstLiveUkeire(hand, state.pool) || firstLivePoolTile(state.pool);
      if (completer !== null) exchangeDeadWallSlot(state, 2, completer);
      flow.consume(seat, TIER4_COST);
      return { ok: true, branch: 'fallback', pins, dora, rinshanSlot2: completer, waits: [], event: { type: 'RINSHAN_RESONANCE_TRIGGER', tier: 4 } };
    },

    // Phase 3: Settlement Modifier hook — consumes all flow on rinshan win.
    onSettlement(result, state) {
      if (result && result.type === 'tsumo' && result.winner === seat && typeof result.tag === 'string' && result.tag.includes('RINSHAN')) {
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
  firstLiveUkeire,
  shapeSakiStartingHand,
  createSakiHooks,
  SAKI: {
    START_SCORE, EQUILIBRIUM_BAND, TRIPLET_AFFINITY, RINSHAN_WAIT_WEIGHT,
    UKEIRE_WEIGHT, TWIN_WAIT_WEIGHT, SUMMIT_WIN_PROBABILITY,
    TIER1_COST, TIER2_COST, TIER2_REFUND, TIER3_COST, TIER4_COST,
  },
};
