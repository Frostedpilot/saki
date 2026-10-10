// rosters/nodoka.js — Nodoka Haramura (full skill tree).
// Archetype: Trajectory Shaper + Perception Warper.
// Primary Window: Row 2 (Turns 7–11).
// Pattern: READS state, RETURNS weights/events. Never mutates directly.
const { norm } = require('../../tiles');
const { shantenOf, hairiOf, ukeire, getOptimalBridges } = require('../trajectoryPlanner');
const { getEvaluator } = require('../mjaiAdapter');

const TIER1_COST = 25;
const TIER2_COST = 50;
const TIER3_COST = 100;
const TIER4_COST = 150;
const OPTIMAL_DISCARD_FLOW = 3.5; // bonus for max-ukeire discard
const SUBOPTIMAL_PENALTY = -10.0; // flow drain for bad discard
const SUBOPTIMAL_THRESHOLD = 3; // uke-ire gap to trigger penalty
const NODOCCHI_MODE_THRESHOLD = 50; // flow >= 50 enters Nodocchi Mode
const NODOCCHI_BASE_FLOW = 2.0; // flow per turn in Nodocchi Mode

function getHand(state, seat) {
  return (state.players[seat] && state.players[seat].hand) || [];
}

function isNodocchi(flow) {
  return flow >= NODOCCHI_MODE_THRESHOLD;
}

// Find the discard from a 14-tile hand that maximizes uke-ire.
// Returns { tile, uke } or { tile: null, uke: -1 } when not 14 tiles.
function findOptimalDiscard(hand, pool) {
  if (!hand || hand.length < 14) return { tile: null, uke: -1 };
  let bestTile = null,
    bestUke = -1;
  const tried = new Set();
  for (const t of hand) {
    const k = norm(t);
    if (tried.has(k)) continue;
    tried.add(k);
    const rest = hand.filter((_, i) => i !== hand.indexOf(t));
    const u = ukeire(rest, pool);
    if (u > bestUke) {
      bestUke = u;
      bestTile = k;
    }
  }
  return { tile: bestTile, uke: bestUke };
}

// Phase 2: onPowerDraw — draw-step weight adjustments.
// Nodocchi Mode: uke-ire boost (1.0 + gain*0.25).
// T1 active: filter isolated terminals/honors.
// T3 active: bridge tile boost 15.0.
// T4 active: safe draw + winning wait magnet.
function createNodokaHooks(seat) {
  // Per-draw-turn state for tier durations
  let tier1TurnsLeft = 0;
  let tier3TurnsLeft = 0;
  let tier4TurnsLeft = 0;
  let tier2Active = false;

  return {
    seat,
    meta: {
      type: 'flow',
      name: 'Nodoka Haramura',
      school: 'Kiyosumi',
      tiers: {
        passive: 0,
        statisticalFilter: TIER1_COST,
        optimalDiscardMatrix: TIER2_COST,
        shantenCompression: TIER3_COST,
        evSingularity: TIER4_COST,
      },
    },

    // Phase 2: draw weight hook.
    onPowerDraw(tile, state) {
      const hand = getHand(state, seat);
      const flow = state.flow ? state.flow.get(seat) : 0;
      const n = norm(tile);

      // T4: EV Singularity — safe draw shielding + winning wait magnet
      if (tier4TurnsLeft > 0) {
        const h = hairiOf(hand);
        const waits = h && h.wait ? Object.keys(h.wait) : [];
        if (waits.includes(n)) return 4.0; // winning wait magnet
        // Safe draw: prefer tiles NOT in any opponent's known wait set
        // (simplified: return 1.0 for non-wait tiles; engine handles safety)
        return 1.0;
      }

      // T3: Machine Shanten Compression — evaluator decides optimal discard;
      // bridge tiles preserving that optimal line get 15.0
      if (tier3TurnsLeft > 0) {
        if (hand.length >= 14) {
          const evalRes = getEvaluator().evaluate(state, seat);
          if (evalRes && evalRes.discard) {
            const keptHand = withoutOne(hand, evalRes.discard);
            const bridges = getOptimalBridges(keptHand, state.pool, 2);
            if (bridges.includes(n)) return 15.0;
          }
        }
        const bridges = getOptimalBridges(hand, state.pool, 2);
        if (bridges.includes(n)) return 15.0;
      }

      // T1: Statistical Filter — isolated terminals/honors get 0.0
      if (tier1TurnsLeft > 0) {
        if (isDeadTerminalOrHonor(tile, hand)) return 0.0;
      }

      // Nodocchi Mode passive: uke-ire boost
      if (isNodocchi(flow) && hand.length >= 13) {
        const gain = calculateUkeireGainLocal(hand, tile);
        return 1.0 + gain * 0.25;
      }

      return 1.0;
    },

    // Phase 2: discard hook — flow adjustments based on discard quality.
    // Called with the FULL 14-tile hand (13 + drawn) that still contains the
    // discarded tile. In Human Stance the max-ukeire discard nets +2.0 flow
    // beyond the base; a sub-optimal gap > 3 drains 10 flow.
    onDiscard(discard, state) {
      const hand = getHand(state, seat); // 14-tile pre-discard hand
      const flow = state.flow ? state.flow.get(seat) : 0;
      const { tile: optimal, uke: optUke } = findOptimalDiscard(hand, state.pool);
      if (optimal !== null && norm(discard) === optimal) {
        if (isNodocchi(flow)) return { flowDelta: 0 }; // Nodocchi base is already 2.0
        return { flowDelta: OPTIMAL_DISCARD_FLOW - 1.5 }; // +2.0 beyond base 1.5
      }
      const rest = withoutOne(hand, discard);
      const myUke = ukeire(rest, state.pool);
      if (optimal !== null && optUke - myUke > SUBOPTIMAL_THRESHOLD) {
        return { flowDelta: SUBOPTIMAL_PENALTY };
      }
      return { flowDelta: 0 };
    },

    // T1: Statistical Filter — next 3 draws filter isolated terminals/honors.
    tryActivateTier1(state) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER1_COST)) return { ok: false, reason: 'insufficient-flow' };
      flow.consume(seat, TIER1_COST);
      tier1TurnsLeft = 3;
      return { ok: true, event: { type: 'STATISTICAL_FILTER', tier: 1 } };
    },

    // T2: Optimal Discard Matrix — highlights safe tiles, genbutsu sampling.
    tryActivateTier2(state) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER2_COST)) return { ok: false, reason: 'insufficient-flow' };
      flow.consume(seat, TIER2_COST);
      tier2Active = true;
      return { ok: true, event: { type: 'OPTIMAL_DISCARD_MATRIX', tier: 2 } };
    },

    // T3: Machine Shanten Compression — next 2 draws: bridge tiles at 15.0.
    tryActivateTier3(state) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER3_COST)) return { ok: false, reason: 'insufficient-flow' };
      const hand = getHand(state, seat);
      const sh = shantenOf(hand);
      if (sh < 1 || sh > 2) return { ok: false, reason: 'precondition' };
      flow.consume(seat, TIER3_COST);
      tier3TurnsLeft = 2;
      return { ok: true, event: { type: 'SHANTEN_COMPRESSION', tier: 3 } };
    },

    // T4: Absolute EV Singularity — 3 turns of safe draw + 4.0x winning wait.
    tryActivateTier4(state) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER4_COST)) return { ok: false, reason: 'insufficient-flow' };
      const hand = getHand(state, seat);
      if (shantenOf(hand) !== 0) return { ok: false, reason: 'precondition' };
      flow.consume(seat, TIER4_COST);
      tier4TurnsLeft = 3;
      return { ok: true, event: { type: 'EV_SINGULARITY', tier: 4 } };
    },

    getTierInfo(state) {
      const flow = state.flow ? state.flow.get(seat) : 0;
      const hand = getHand(state, seat);
      const sh = shantenOf(hand);

      const t1Pre = true;
      const t2Pre = true;
      const t3Pre = sh >= 1 && sh <= 2;
      const t4Pre = sh === 0;

      return [
        {
          tier: 1,
          name: 'Statistical Filter',
          cost: TIER1_COST,
          canAfford: flow >= TIER1_COST,
          canActivate: flow >= TIER1_COST && t1Pre,
        },
        {
          tier: 2,
          name: 'Optimal Discard Matrix',
          cost: TIER2_COST,
          canAfford: flow >= TIER2_COST,
          canActivate: flow >= TIER2_COST && t2Pre,
        },
        {
          tier: 3,
          name: 'Shanten Compression',
          cost: TIER3_COST,
          canAfford: flow >= TIER3_COST,
          canActivate: flow >= TIER3_COST && t3Pre,
        },
        {
          tier: 4,
          name: 'EV Singularity',
          cost: TIER4_COST,
          canAfford: flow >= TIER4_COST,
          canActivate: flow >= TIER4_COST && t4Pre,
        },
      ];
    },

    activateTier(state, tier) {
      switch (tier) {
        case 1:
          return this.tryActivateTier1(state);
        case 2:
          return this.tryActivateTier2(state);
        case 3:
          return this.tryActivateTier3(state);
        case 4:
          return this.tryActivateTier4(state);
        default:
          return { ok: false, reason: 'invalid-tier' };
      }
    },

    onTurnStart(state, { armedTier = 0 } = {}) {
      if (armedTier === 0) return { activated: false, reason: 'conserve' };
      if (armedTier === 'auto') {
        for (const t of [4, 3, 2, 1]) {
          const r = this.activateTier(state, t);
          if (r && r.ok) return { activated: true, tier: t, result: r };
        }
        return { activated: false, reason: 'no-tier-eligible' };
      }
      if (armedTier >= 1 && armedTier <= 4) {
        const r = this.activateTier(state, armedTier);
        if (r && r.ok) return { activated: true, tier: armedTier, result: r };
        return { activated: false, reason: (r && r.reason) || 'activation-failed' };
      }
      return { activated: false, reason: 'invalid-tier' };
    },

    // Lifecycle: decrement tier durations per turn.
    onTurnEnd(_state) {
      if (tier1TurnsLeft > 0) tier1TurnsLeft--;
      if (tier3TurnsLeft > 0) tier3TurnsLeft--;
      if (tier4TurnsLeft > 0) tier4TurnsLeft--;
    },

    // Settlement: consume all flow on EV Singularity win.
    onSettlement(result, state) {
      if (
        result &&
        result.type === 'tsumo' &&
        result.winner === seat &&
        typeof result.tag === 'string' &&
        result.tag.includes('EV_SINGULARITY')
      ) {
        if (state.flow) state.flow.consumeAll(seat);
      }
      tier2Active = false;
    },

    // HUD Advice channel: real-time expected value recommendation
    getHudAdvice(state) {
      const evalRes = getEvaluator().evaluate(state, seat);
      return evalRes && evalRes.summary ? evalRes.summary : 'Nodocchi: Awaiting draw';
    },

    // Expose internal state for testing
    _state: () => ({ tier1TurnsLeft, tier2Active, tier3TurnsLeft, tier4TurnsLeft }),
    _resetTiers: () => {
      tier1TurnsLeft = 0;
      tier2Active = false;
      tier3TurnsLeft = 0;
      tier4TurnsLeft = 0;
    },
  };
}

// --- Helpers ---

// Is the tile an isolated terminal or honor (not part of a pair/triplet)?
function isDeadTerminalOrHonor(tile, hand) {
  const n = norm(tile);
  const isTerminal = /^[19][mps]$/.test(n);
  const isHonor = /[z]$/.test(n);
  if (!isTerminal && !isHonor) return false;
  const count = hand.filter((t) => norm(t) === n).length;
  return count <= 1; // isolated (not part of pair+)
}

// Local uke-ire gain estimate (pool-free approximation for weight fn).
function calculateUkeireGainLocal(hand, tile) {
  const before = ukeire(hand, null);
  const after = ukeire([...hand, tile].slice(-14), null);
  return Math.max(0, after - before);
}

// Remove one physical copy of `tile` (norm-sensitive) from a hand.
function withoutOne(hand, tile) {
  const idx = hand.findIndex((t) => norm(t) === norm(tile));
  if (idx < 0) return [...hand];
  return [...hand.slice(0, idx), ...hand.slice(idx + 1)];
}

module.exports = {
  createNodokaHooks,
  isNodocchi,
  findOptimalDiscard,
  isDeadTerminalOrHonor,
  NODOKA: {
    TIER1_COST,
    TIER2_COST,
    TIER3_COST,
    TIER4_COST,
    OPTIMAL_DISCARD_FLOW,
    SUBOPTIMAL_PENALTY,
    SUBOPTIMAL_THRESHOLD,
    NODOCCHI_MODE_THRESHOLD,
    NODOCCHI_BASE_FLOW,
  },
};
