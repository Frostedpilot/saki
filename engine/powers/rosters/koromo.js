// rosters/koromo.js — Koromo Amae (full skill tree).
// Archetype: Slot Reserver + Field Enforcer.
// Primary Window: Row 3 (Turns 13–18 / Last 15 tiles).
const { norm } = require('../../tiles');
const { shantenOf, hairiOf } = require('../trajectoryPlanner');

const TIER1_COST = 25;
const TIER2_COST = 50;
const TIER3_COST = 100;
const TIER4_COST = 150;
const CRESCENT_FLOW_MULT = 0.75;   // -25% during Hands 1–2
const FULL_MOON_FLOW_MULT = 1.50;  // +50% during Hands 3–4
const FULL_MOON_THRESHOLD = 50;    // flow >= 50: reveal opponent shanten/tenpai
const HESITATION_DRAIN = 5;        // T1: 5% per second over 5s
const OCEANIC_MIRE_MULT = 0.60;    // T2: -40% draw weight for opponents
const OCEANIC_MIRE_TURNS = 4;      // T2 lasts 4 turns
const HAITEI_GRAVITY_MULT = 2.5;   // T3: 2.5x hand-advancing draw
const HAITEI_FINAL_WEIGHT = 15.0;  // T3: 75% on final draw
const ABYSS_OPPONENT_MULT = 0.20;  // T4: -80% for opponents
const MANGAN_CAP = 8000;           // T3: Ron payout cap

function getHand(state, seat) {
  return (state.players[seat] && state.players[seat].hand) || [];
}

function getScore(state, seat) {
  if (state.scores && state.scores[seat] !== undefined) return state.scores[seat];
  return 25000;
}

// Lunar phase: 'crescent' (hands 1–2) or 'full' (hands 3–4).
function lunarPhase(handNumber) {
  if (handNumber <= 2) return 'crescent';
  return 'full';
}

// Flow multiplier based on lunar phase.
function lunarFlowMultiplier(handNumber) {
  return lunarPhase(handNumber) === 'crescent' ? CRESCENT_FLOW_MULT : FULL_MOON_FLOW_MULT;
}

function createKoromoHooks(seat) {
  let tier1TurnsLeft = 0;
  let tier2TurnsLeft = 0;
  let tier3Active = false;
  let tier4Active = false;
  let counterplayCalls = 0;

  return {
    seat,
    meta: {
      name: 'Koromo Amae',
      school: 'Ryuumonbuchi',
      tiers: {
        passive: 0,
        chillingGaze: TIER1_COST,
        oceanicMire: TIER2_COST,
        haiteiGravity: TIER3_COST,
        submergedAbyss: TIER4_COST,
      },
    },

    // Phase 1: flow generation modifier — lunar phase scaling.
    onFlowGeneration(state, turn, handNumber) {
      const mult = lunarFlowMultiplier(handNumber || 1);
      return 1.5 * mult; // base 1.5 * phase multiplier
    },

    // Phase 2: draw weight hook.
    onPowerDraw(tile, state, drawSeat) {
      const n = norm(tile);
      const hand = getHand(state, drawSeat);
      const wallLeft = state.pool ? state.pool.total() : 100;
      const isKoromo = drawSeat === seat;

      // T4: Submerged Abyss — opponent -80% on shanten-decreasing tiles
      if (tier4Active && !isKoromo) {
        const sh = shantenOf(hand);
        if (sh >= 1) {
          const after = shantenOf([...hand, tile]);
          if (after < sh) return ABYSS_OPPONENT_MULT;
        }
      }

      // T3: Haitei Gravity — Koromo's hand-advancing tiles at 2.5x
      if (tier3Active && isKoromo && wallLeft <= 20) {
        const h = hairiOf(hand);
        const waits = h && h.wait ? Object.keys(h.wait) : [];
        if (waits.includes(n)) {
          // Final draw: 75% weight
          if (wallLeft <= 1) return HAITEI_FINAL_WEIGHT;
          return HAITEI_GRAVITY_MULT;
        }
      }

      // T2: Oceanic Shanten Mire — opponent -40% on shanten-decreasing tiles
      if (tier2TurnsLeft > 0 && !isKoromo) {
        const sh = shantenOf(hand);
        if (sh >= 1) {
          const after = shantenOf([...hand, tile]);
          if (after < sh) return OCEANIC_MIRE_MULT;
        }
      }

      return 1.0;
    },

    // Opponent hesitation drain (T1): called per-opponent per-draw.
    // Returns flowDelta if opponent hesitated (>5s), else 0.
    onOpponentHesitation(opponentSeat, hesitationSeconds) {
      if (tier1TurnsLeft <= 0) return { flowDelta: 0 };
      if (hesitationSeconds <= 5) return { flowDelta: 0 };
      const drain = (hesitationSeconds - 5) * HESITATION_DRAIN;
      return { flowDelta: -drain, koromoGain: drain };
    },

    // Open meld counterplay: reduces T4 win rate by 25% per call.
    onOpponentMeld(opponentSeat) {
      if (tier4Active) counterplayCalls++;
    },

    // Late wall tenpai bonus: +25% flat flow.
    onEnterTenpai(state, wallLeft) {
      if (wallLeft <= 20) {
        if (state.flow) state.flow.addFlow(seat, 25);
        return { event: { type: 'LATE_TENPAI_BONUS' } };
      }
      return {};
    },

    // T1: Chilling Gaze — hesitation drain for 3 turns.
    tryActivateTier1(state, turn) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER1_COST)) return { ok: false, reason: 'insufficient-flow' };
      if (turn < 7 || turn > 15) return { ok: false, reason: 'turn-gate' };
      flow.consume(seat, TIER1_COST);
      tier1TurnsLeft = 3;
      return { ok: true, event: { type: 'CHILLING_GAZE', tier: 1 } };
    },

    // T2: Oceanic Shanten Mire — opponent -40% for 4 turns.
    tryActivateTier2(state, turn) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER2_COST)) return { ok: false, reason: 'insufficient-flow' };
      if (turn < 8 || turn > 14) return { ok: false, reason: 'turn-gate' };
      flow.consume(seat, TIER2_COST);
      tier2TurnsLeft = OCEANIC_MIRE_TURNS;
      return { ok: true, event: { type: 'OCEANIC_MIRE', tier: 2 } };
    },

    // T3: Haitei Gravity — 2.5x draws, 75% final, mangan cap.
    tryActivateTier3(state, wallLeft) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER3_COST)) return { ok: false, reason: 'insufficient-flow' };
      if (wallLeft === undefined || wallLeft > 20) return { ok: false, reason: 'wall-gate' };
      flow.consume(seat, TIER3_COST);
      tier3Active = true;
      return { ok: true, payoutCap: MANGAN_CAP, event: { type: 'HAITEI_GRAVITY', tier: 3 } };
    },

    // T4: Submerged Abyss — opponent freeze + Haitei anchor.
    tryActivateTier4(state, wallLeft) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER4_COST)) return { ok: false, reason: 'insufficient-flow' };
      if (wallLeft === undefined || wallLeft > 14) return { ok: false, reason: 'wall-gate' };
      const hand = getHand(state, seat);
      if (shantenOf(hand) !== 0) return { ok: false, reason: 'precondition' };
      flow.consume(seat, TIER4_COST);
      tier4Active = true;
      counterplayCalls = 0;
      // Return the Haitei anchor tile (winning wait) for engine reservation
      const h = hairiOf(hand);
      const waits = h && h.wait ? Object.keys(h.wait) : [];
      const anchorTile = waits.length ? waits[0] : null;
      return { ok: true, anchorTile, event: { type: 'SUBMERGED_ABYSS', tier: 4, anchorTile } };
    },

    // Settlement: check Haitei anchor win rate vs counterplay calls.
    onSettlement(result, state) {
      if (tier4Active) {
        // Each meld call reduces the win rate by 25%; 3+ calls steal the tile.
        const stolen = counterplayCalls >= 3;
        return {
          haiteiWinRate: stolen ? 0 : Math.max(0, 1.0 - counterplayCalls * 0.25),
          counterplayCalls,
        };
      }
      return {};
    },

    // Lifecycle: decrement durations.
    onTurnEnd(state) {
      if (tier1TurnsLeft > 0) tier1TurnsLeft--;
      if (tier2TurnsLeft > 0) tier2TurnsLeft--;
    },

    _state: () => ({ tier1TurnsLeft, tier2TurnsLeft, tier3Active, tier4Active, counterplayCalls }),
    _resetTiers: () => { tier1TurnsLeft = 0; tier2TurnsLeft = 0; tier3Active = false; tier4Active = false; counterplayCalls = 0; },
  };
}

module.exports = {
  createKoromoHooks,
  lunarPhase,
  lunarFlowMultiplier,
  KOROMO: {
    TIER1_COST, TIER2_COST, TIER3_COST, TIER4_COST,
    CRESCENT_FLOW_MULT, FULL_MOON_FLOW_MULT, FULL_MOON_THRESHOLD,
    HESITATION_DRAIN, OCEANIC_MIRE_MULT, OCEANIC_MIRE_TURNS,
    HAITEI_GRAVITY_MULT, HAITEI_FINAL_WEIGHT, ABYSS_OPPONENT_MULT,
    MANGAN_CAP,
  },
};
