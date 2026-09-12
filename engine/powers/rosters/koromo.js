// rosters/koromo.js — Koromo Amae (full skill tree).
// Archetype: Slot Reserver + Field Enforcer.
// Primary Window: Row 3 (Turns 13–18 / Last 15 tiles).
const { norm, DORA_NEXT } = require('../../tiles');
const { shantenOf, hairiOf, calculateUkeireGain } = require('../trajectoryPlanner');
const { scoreHand } = require('../../scoring');
const { scalePassiveWeight } = require('../awakening');

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

// Secret winning anchor selection for Haitei / Submerged Abyss.
// Evaluates all live waits:
//   1. Verifies guaranteed win status (agari under Haitei).
//   2. Maximizes winning Han value and unique wait variety.
//   3. Minimizes opponent utility (avoids tiles opponents are waiting on or need).
function selectSecretWinningAnchor(hand, pool, players = [], ctx = {}) {
  const h = hairiOf(hand);
  if (!h || !h.wait) return null;
  const allWaits = Object.keys(h.wait);
  if (!allWaits.length) return null;

  const liveWaits = pool ? allWaits.filter(w => (pool.get(w) || 0) > 0 || (pool.get(w.replace(/^5/, '0')) || 0) > 0) : allWaits;
  const candidates = liveWaits.length ? liveWaits : allWaits;

  let bestTile = candidates[0];
  let bestScore = -Infinity;

  for (const w of candidates) {
    let han = 1;
    let isAgari = true;
    try {
      const scoringCtx = {
        dora: ctx.dora || [],
        bakaze: ctx.bakaze || 1,
        jikaze: ctx.jikaze || 1,
        riichi: false,
        doubleRiichi: false,
        ippatsu: false,
        kanFlag: false,
        lastFlag: true,
        tenhou: false,
      };
      const r = scoreHand([...hand, w], ctx.melds || [], null, true, scoringCtx);
      if (r && r.isAgari) {
        han = r.yakuman ? 13 : (r.han || 1);
      } else {
        isAgari = false;
      }
    } catch {
      han = 1;
    }

    if (!isAgari) continue;

    let oppUtility = 0;
    const seat = ctx.seat !== undefined ? ctx.seat : -1;
    for (const p of players) {
      if (!p || p.seat === seat) continue;
      const oppHand = p.hand || [];
      if (!oppHand.length) continue;

      const oppH = hairiOf(oppHand);
      if (oppH && oppH.wait && oppH.wait[w]) {
        oppUtility += 50;
      } else if (calculateUkeireGain(oppHand, w) > 0) {
        oppUtility += 10;
      }

      if (p.discards && p.discards.some(d => norm(d) === norm(w))) {
        oppUtility -= 5;
      }
    }

    const score = (han * 10) + (candidates.length * 2) - (oppUtility * 2);
    if (score > bestScore) {
      bestScore = score;
      bestTile = w;
    }
  }

  return bestTile;
}

function createKoromoHooks(seat, persistent = {}) {
  const p = persistent;
  if (p.lunarHandCount === undefined) {
    p.lunarHandCount = 1;
  } else {
    p.lunarHandCount++;
  }
  let tier1TurnsLeft = 0;
  let tier2TurnsLeft = 0;
  let tier3Active = false;
  let tier4Active = false;
  let counterplayCalls = 0;

  return {
    seat,
    meta: {
      type: 'flow',
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

    // Phase 2: draw weight hook — SELF effects (Koromo's own draws only).
    onPowerDraw(tile, state) {
      const n = norm(tile);
      const hand = getHand(state, seat);
      const wallLeft = state.pool ? state.pool.total() : 100;

      // T3: Haitei Gravity — Koromo's hand-advancing tiles at 2.5x
      if (tier3Active && wallLeft <= 20) {
        const h = hairiOf(hand);
        const waits = h && h.wait ? Object.keys(h.wait) : [];
        if (waits.includes(n)) {
          // Final draw: 75% weight
          if (wallLeft <= 1) return HAITEI_FINAL_WEIGHT;
          return HAITEI_GRAVITY_MULT;
        }
      }

      // Passive Trajectory Shaper (when awakening enabled):
      // Guides Koromo toward high-han and multi-wait tenpai shapes
      if (state && state.enableAwakening && wallLeft > 20) {
        const curShanten = shantenOf(hand);
        if (curShanten > 0 && curShanten <= 2) {
          const testHand = [...hand, n].slice(-14);
          const newShanten = shantenOf(testHand);
          if (newShanten < curShanten) {
            const h = hairiOf(testHand);
            const waitCount = (h && h.wait) ? Object.keys(h.wait).length : 0;
            const base = 1.0 + 0.15 * Math.min(waitCount, 3);
            const flow = state.flow ? state.flow.get(seat) : 0;
            return scalePassiveWeight(base, flow, state, seat);
          }
        }
      }

      return 1.0;
    },

    // Phase 2b: Field Enforcer — opponent draw suppression (cross-seat).
    // Applied by the dispatcher to EVERY drawing seat's weight map. Leaves
    // Koromo's own turn untouched (no drowning in her own mire).
    // Optimized: O(1) lookup via hairi waits instead of 34 shanten calculations.
    applyFieldAura(drawSeat, weights, state) {
      if (drawSeat === seat) return weights;
      if (tier2TurnsLeft <= 0 && !tier4Active) return weights;
      const hand = getHand(state, drawSeat);
      if (!hand || hand.length < 13) return weights; // not a live draw seat yet
      const h = hairiOf(hand);
      if (!h || !h.wait || h.now < 1) return weights; // tenpai immunity: cannot dampen finished / tenpai opponent hand
      const waitSet = new Set(Object.keys(h.wait).map(norm));
      if (!waitSet.size) return weights;

      let factor = 1.0;
      if (tier2TurnsLeft > 0) factor *= OCEANIC_MIRE_MULT;
      if (tier4Active) factor *= ABYSS_OPPONENT_MULT;
      if (factor === 1.0) return weights;

      for (const k of Object.keys(weights)) {
        if (waitSet.has(norm(k))) {
          weights[k] = (weights[k] || 1.0) * factor;
        }
      }
      return weights;
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
      const curTurn = turn !== undefined ? turn : ((state.players && state.players[seat] && state.players[seat].discards) ? state.players[seat].discards.length + 1 : 1);
      if (curTurn < 7 || curTurn > 15) return { ok: false, reason: 'turn-gate' };
      flow.consume(seat, TIER1_COST);
      tier1TurnsLeft = 3;
      return { ok: true, event: { type: 'CHILLING_GAZE', tier: 1 } };
    },

    // T2: Oceanic Shanten Mire — opponent -40% for 4 turns.
    tryActivateTier2(state, turn) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER2_COST)) return { ok: false, reason: 'insufficient-flow' };
      const curTurn = turn !== undefined ? turn : ((state.players && state.players[seat] && state.players[seat].discards) ? state.players[seat].discards.length + 1 : 1);
      if (curTurn < 8 || curTurn > 14) return { ok: false, reason: 'turn-gate' };
      flow.consume(seat, TIER2_COST);
      tier2TurnsLeft = OCEANIC_MIRE_TURNS;
      return { ok: true, event: { type: 'OCEANIC_MIRE', tier: 2 } };
    },

    // T3: Haitei Gravity — 2.5x draws, 75% final, mangan cap.
    tryActivateTier3(state, wallLeft) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER3_COST)) return { ok: false, reason: 'insufficient-flow' };
      const curWall = wallLeft !== undefined ? wallLeft : (state.pool ? state.pool.total() : 0);
      if (curWall > 20) return { ok: false, reason: 'wall-gate' };
      flow.consume(seat, TIER3_COST);
      tier3Active = true;
      return { ok: true, payoutCap: MANGAN_CAP, event: { type: 'HAITEI_GRAVITY', tier: 3 } };
    },

    // T4: Submerged Abyss — opponent freeze + Haitei anchor.
    tryActivateTier4(state, wallLeft) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER4_COST)) return { ok: false, reason: 'insufficient-flow' };
      const curWall = wallLeft !== undefined ? wallLeft : (state.pool ? state.pool.total() : 0);
      if (curWall > 14) return { ok: false, reason: 'wall-gate' };
      const hand = getHand(state, seat);
      if (shantenOf(hand) !== 0) return { ok: false, reason: 'precondition' };
      flow.consume(seat, TIER4_COST);
      tier4Active = true;
      counterplayCalls = 0;
      // Return the Haitei anchor tile (winning wait) for engine reservation
      const anchorTile = selectSecretWinningAnchor(hand, state.pool, (state && state.players) || [], {
        seat,
        melds: (state && state.players && state.players[seat]) ? state.players[seat].melds : [],
        bakaze: (state && state.bakaze) || 1,
        jikaze: ((seat - ((state && state.dealer) || 0) + 4) % 4) + 1,
        dora: ((state && state.doraIndicators) || []).map(DORA_NEXT),
      });
      p.secretAnchor = anchorTile;
      return { ok: true, anchorTile, event: { type: 'SUBMERGED_ABYSS', tier: 4, anchorTile } };
    },

    getTierInfo(state) {
      const flow = state.flow ? state.flow.get(seat) : 0;
      const turn = (state.players && state.players[seat] && state.players[seat].discards) ? state.players[seat].discards.length + 1 : 1;
      const wallLeft = state.pool ? state.pool.total() : 0;
      const hand = getHand(state, seat);
      const isTenpai = shantenOf(hand) === 0;

      const t1Pre = turn >= 7 && turn <= 15;
      const t2Pre = turn >= 8 && turn <= 14;
      const t3Pre = wallLeft <= 20;
      const t4Pre = wallLeft <= 14 && isTenpai;

      return [
        { tier: 1, name: 'Chilling Gaze', cost: TIER1_COST, canAfford: flow >= TIER1_COST, canActivate: flow >= TIER1_COST && t1Pre },
        { tier: 2, name: 'Oceanic Mire', cost: TIER2_COST, canAfford: flow >= TIER2_COST, canActivate: flow >= TIER2_COST && t2Pre },
        { tier: 3, name: 'Haitei Gravity', cost: TIER3_COST, canAfford: flow >= TIER3_COST, canActivate: flow >= TIER3_COST && t3Pre },
        { tier: 4, name: 'Submerged Abyss', cost: TIER4_COST, canAfford: flow >= TIER4_COST, canActivate: flow >= TIER4_COST && t4Pre },
      ];
    },

    activateTier(state, tier, extraArg) {
      switch (tier) {
        case 1: return this.tryActivateTier1(state, extraArg);
        case 2: return this.tryActivateTier2(state, extraArg);
        case 3: return this.tryActivateTier3(state, extraArg);
        case 4: return this.tryActivateTier4(state, extraArg);
        default: return { ok: false, reason: 'invalid-tier' };
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
  selectSecretWinningAnchor,
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
