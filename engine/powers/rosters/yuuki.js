// rosters/yuuki.js — Yuuki Kataoka (full skill tree).
// Archetype: Tempo Economist + Trajectory Shaper.
// Primary Window: Row 1 (Turns 1–6) in East Rounds.
const { norm, DORA_NEXT } = require('../../tiles');
const { hairiOf, getOptimalBridges } = require('../trajectoryPlanner');
const { scalePassiveWeight } = require('../awakening');

const TIER1_COST = 25;
const TIER2_COST = 50;
const TIER3_COST = 100;
const TIER4_COST = 150;
const EAST_FLOW_PER_DISCARD = 3.0; // +100% boost in East
const SOUTH_FLOW_PER_DISCARD = 0.75; // -50% penalty in South
const OPEN_MELD_FLOW = 10; // +10% for calling melds turns 1–5
const DEALER_WIN_FLOW = 25; // +25% for winning as Dealer in East
const SOUTH_DAMAGE_MULTIPLIER = 1.15; // +15% payout in South
const SOUTH_DRAIN = 25; // 25% flow drain on deal-in South
const SPEED_AFFINITY = 1.3; // +30% for simples + East wind in East

function getHand(state, seat) {
  return (state.players[seat] && state.players[seat].hand) || [];
}

function isEastRound(state) {
  // bakaze: 1=East, 2=South, 3=West, 4=North
  return !state.bakaze || state.bakaze === 1;
}

function isSouthRound(state) {
  return state.bakaze === 2;
}

function isDora(tile, state) {
  if (!state.doraIndicators || !state.doraIndicators.length) return false;
  const dora = DORA_NEXT(state.doraIndicators[0]);
  return norm(tile) === norm(dora);
}

function isSpeedTile(tile) {
  const n = norm(tile);
  if (/^[2-8][mps]$/.test(n)) return true;
  if (n === '1z') return true;
  return false;
}

function createYuukiHooks(seat) {
  let tier1TurnsLeft = 0;
  let tier2Active = false;
  let tier3Active = false;
  let tier4TurnsLeft = 0;
  let sugarCrashCleansed = false;

  return {
    seat,
    meta: {
      type: 'flow',
      name: 'Yuuki Kataoka',
      school: 'Kiyosumi',
      tiers: {
        passive: 0,
        quickBite: TIER1_COST,
        spicyDefense: TIER2_COST,
        eastWindOnslaught: TIER3_COST,
        ultimateFiesta: TIER4_COST,
      },
    },

    // Phase 2: draw weight hook.
    onPowerDraw(tile, state) {
      const n = norm(tile);
      const hand = getHand(state, seat);
      void hand;

      // T4: Ultimate Fiesta — Blitzkrieg: 75% win on turns 4–7 (East only)
      if (tier4TurnsLeft > 0 && isEastRound(state)) {
        const h = hairiOf(hand);
        const waits = h && h.wait ? Object.keys(h.wait) : [];
        if (waits.includes(n)) return 3.0; // boosted winning wait
      }

      // T3: East Wind Onslaught — East wind + Dora at 3.0x
      if (tier3Active && isEastRound(state)) {
        if (n === '1z' || isDora(tile, state)) return 3.0;
      }

      // T1: Quick Bite — connector tiles at 8.0
      if (tier1TurnsLeft > 0) {
        const bridges = getOptimalBridges(hand, state.pool, 4);
        if (bridges.includes(n)) return 8.0;
      }

      // Passive: East round speed tile affinity
      if (isEastRound(state)) {
        if (isSpeedTile(tile)) {
          if (state && state.enableAwakening) {
            const flow = state.flow ? state.flow.get(seat) : 0;
            return scalePassiveWeight(SPEED_AFFINITY, flow, state, seat);
          }
          return SPEED_AFFINITY;
        }
      }

      return 1.0;
    },

    // Phase 1: flow generation modifier.
    // Returns the flow-per-turn for this seat (replaces base if non-standard).
    onFlowGeneration(state) {
      if (isSouthRound(state) && !sugarCrashCleansed) {
        return SOUTH_FLOW_PER_DISCARD; // -50% penalty
      }
      if (isEastRound(state)) {
        return EAST_FLOW_PER_DISCARD; // +100% boost
      }
      return undefined; // use engine default
    },

    // Open meld hook: +10% flow on turns 1–5.
    onOpenMeld(state, turn) {
      if (turn >= 1 && turn <= 5) {
        return { flowDelta: OPEN_MELD_FLOW };
      }
      return { flowDelta: 0 };
    },

    // T1: Quick Bite — connector bias for next draw.
    tryActivateTier1(state, turn) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER1_COST)) return { ok: false, reason: 'insufficient-flow' };
      const curTurn =
        turn !== undefined
          ? turn
          : state.players && state.players[seat] && state.players[seat].discards
            ? state.players[seat].discards.length + 1
            : 1;
      if (curTurn > 5) return { ok: false, reason: 'turn-gate' };
      flow.consume(seat, TIER1_COST);
      tier1TurnsLeft = 1; // affects next draw only
      return { ok: true, event: { type: 'QUICK_BITE', tier: 1 } };
    },

    // T2: Spicy Southward Defense — cleanse sugar crash + filter dangerous tiles.
    tryActivateTier2(state) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER2_COST)) return { ok: false, reason: 'insufficient-flow' };
      if (!isSouthRound(state)) return { ok: false, reason: 'not-south' };
      flow.consume(seat, TIER2_COST);
      tier2Active = true;
      sugarCrashCleansed = true;
      return { ok: true, event: { type: 'SPICY_DEFENSE', tier: 2 } };
    },

    // T3: East Wind Onslaught — East wind + Dora at 3.0x (East round dealer only).
    tryActivateTier3(state, isDealer) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER3_COST)) return { ok: false, reason: 'insufficient-flow' };
      if (!isEastRound(state)) return { ok: false, reason: 'not-east' };
      const curDealer = isDealer !== undefined ? isDealer : state.dealer === seat;
      if (!curDealer) return { ok: false, reason: 'not-dealer' };
      flow.consume(seat, TIER3_COST);
      tier3Active = true;
      return { ok: true, event: { type: 'EAST_WIND_ONSLAUGHT', tier: 3 } };
    },

    // T4: Ultimate Fiesta — Turn-1 blitz. Lasts for 4 draws.
    tryActivateTier4(state, turn) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER4_COST)) return { ok: false, reason: 'insufficient-flow' };
      if (!isEastRound(state)) return { ok: false, reason: 'not-east' };
      const curTurn =
        turn !== undefined
          ? turn
          : state.players && state.players[seat] && state.players[seat].discards
            ? state.players[seat].discards.length + 1
            : 1;
      if (curTurn !== 1) return { ok: false, reason: 'turn-gate' };
      flow.consume(seat, TIER4_COST);
      tier4TurnsLeft = 4;
      return { ok: true, event: { type: 'ULTIMATE_FIESTA', tier: 4 } };
    },

    getTierInfo(state) {
      const flow = state.flow ? state.flow.get(seat) : 0;
      const turn =
        state.players && state.players[seat] && state.players[seat].discards
          ? state.players[seat].discards.length + 1
          : 1;
      const isDealer = state.dealer === seat;

      const t1Pre = turn <= 5;
      const t2Pre = isSouthRound(state);
      const t3Pre = isEastRound(state) && isDealer;
      const t4Pre = isEastRound(state) && turn === 1;

      return [
        {
          tier: 1,
          name: 'Quick Bite',
          cost: TIER1_COST,
          canAfford: flow >= TIER1_COST,
          canActivate: flow >= TIER1_COST && t1Pre,
        },
        {
          tier: 2,
          name: 'Spicy Defense',
          cost: TIER2_COST,
          canAfford: flow >= TIER2_COST,
          canActivate: flow >= TIER2_COST && t2Pre,
        },
        {
          tier: 3,
          name: 'East Wind Onslaught',
          cost: TIER3_COST,
          canAfford: flow >= TIER3_COST,
          canActivate: flow >= TIER3_COST && t3Pre,
        },
        {
          tier: 4,
          name: 'Ultimate Fiesta',
          cost: TIER4_COST,
          canAfford: flow >= TIER4_COST,
          canActivate: flow >= TIER4_COST && t4Pre,
        },
      ];
    },

    activateTier(state, tier, extraArg) {
      switch (tier) {
        case 1:
          return this.tryActivateTier1(state, extraArg);
        case 2:
          return this.tryActivateTier2(state);
        case 3:
          return this.tryActivateTier3(state, extraArg);
        case 4:
          return this.tryActivateTier4(state, extraArg);
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

    // Lifecycle: decrement durations.
    onTurnEnd(_state) {
      if (tier1TurnsLeft > 0) tier1TurnsLeft--;
      if (tier4TurnsLeft > 0) tier4TurnsLeft--;
    },

    // Settlement: South round deal-in drain + damage multiplier.
    onSettlement(result, state) {
      if (isSouthRound(state) && result && result.type === 'ron' && result.from === seat) {
        if (state.flow) state.flow.drainFlow(seat, SOUTH_DRAIN);
        return { scoreMultiplier: SOUTH_DAMAGE_MULTIPLIER };
      }
      if (result && result.winner === seat && isEastRound(state) && result.isDealer) {
        return { flowDelta: DEALER_WIN_FLOW };
      }
      return {};
    },

    _state: () => ({ tier1TurnsLeft, tier2Active, tier3Active, tier4TurnsLeft, sugarCrashCleansed }),
    _resetTiers: () => {
      tier1TurnsLeft = 0;
      tier2Active = false;
      tier3Active = false;
      tier4TurnsLeft = 0;
      sugarCrashCleansed = false;
    },
  };
}

module.exports = {
  createYuukiHooks,
  isSpeedTile,
  isEastRound,
  isSouthRound,
  YUUKI: {
    TIER1_COST,
    TIER2_COST,
    TIER3_COST,
    TIER4_COST,
    EAST_FLOW_PER_DISCARD,
    SOUTH_FLOW_PER_DISCARD,
    OPEN_MELD_FLOW,
    DEALER_WIN_FLOW,
    SOUTH_DAMAGE_MULTIPLIER,
    SOUTH_DRAIN,
    SPEED_AFFINITY,
  },
};
