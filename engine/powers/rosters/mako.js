// rosters/mako.js — Mako Someya (full skill tree).
// Archetype: Perception Warper + Trajectory Shaper.
// Primary Window: Row 2 (Turns 7+).
const { norm } = require('../../tiles');
const { shantenOf, hairiOf, ukeire, getOptimalBridges } = require('../trajectoryPlanner');

const TIER1_COST = 25;
const TIER2_COST = 50;
const TIER3_COST = 100;
const TIER4_COST = 150;
const BASE_RAMP_START = 2.5;  // flow per turn starting turn 7
const RAMP_STEP = 0.5;        // +0.5 each subsequent turn
const SAFE_DISCARD_FLOW = 15; // +15% for safe discard vs multi-meld opponent

function getHand(state, seat) {
  return (state.players[seat] && state.players[seat].hand) || [];
}

function getDiscards(state, seat) {
  return (state.players[seat] && state.players[seat].discards) || [];
}

function getMeldCount(state, seat) {
  return (state.players[seat] && state.players[seat].melds) ? state.players[seat].melds.length : 0;
}

// Check if a discard is safe against a specific opponent (simplified:
// the tile appears in that opponent's discard river — genbutsu).
function isSafeAgainst(discard, targetDiscards) {
  return targetDiscards.some(d => norm(d) === norm(discard));
}

// Phase 1: flow generation modifier — delayed ignition.
// Turns 1–6: 0% flow. Turn 7+: ramp starting at 2.5%/turn.
function computeFlowPerTurn(turn) {
  if (turn < 7) return 0;
  return BASE_RAMP_START + (turn - 7) * RAMP_STEP;
}

function createMakoHooks(seat) {
  let tier1TurnsLeft = 0;
  let tier2TurnsLeft = 0;
  let tier3TurnsLeft = 0;
  let tier4Active = false;
  let tier3Target = -1; // target opponent seat for river mirroring

  return {
    seat,
    meta: {
      name: 'Mako Someya',
      school: 'Kiyosumi',
      tiers: {
        passive: 0,
        matchRecognition: TIER1_COST,
        flowReroute: TIER2_COST,
        riverMirroring: TIER3_COST,
        omnipresentRecall: TIER4_COST,
      },
    },

    // Phase 2: draw weight hook (self-effects only).
    onPowerDraw(tile, state) {
      const n = norm(tile);
      const hand = getHand(state, seat);

      // T3: River Mirroring — steal opponent's bridge tiles
      if (tier3TurnsLeft > 0 && tier3Target >= 0) {
        const targetHand = (state.players[tier3Target] && state.players[tier3Target].hand) || [];
        const enemyBridges = getOptimalBridges(targetHand, state.pool, 4);
        if (enemyBridges.includes(n)) return 5.0;
      }

      // T2: Flow Reroute — +40% uke-ire boost
      if (tier2TurnsLeft > 0) {
        const gain = ukeire([...hand, tile].slice(-14), state.pool) - ukeire(hand, state.pool);
        return 1.0 + Math.max(0, gain) * 0.40;
      }

      // T4: Omnipresent Recall — winning wait magnet (tenpai only)
      if (tier4Active) {
        const h = hairiOf(hand);
        const waits = h && h.wait ? Object.keys(h.wait) : [];
        if (waits.includes(n)) return 4.0;
      }

      return 1.0;
    },

    // Phase 1: flow generation override.
    onFlowGeneration(state, turn) {
      const gen = computeFlowPerTurn(turn);
      return gen > 0 ? gen : 0;
    },

    // Discard hook: safe discard bonus against multi-meld opponents.
    onDiscard(discard, state) {
      if (tier1TurnsLeft > 0) {
        // Check if discard is safe against any opponent with 2+ melds
        for (let i = 0; i < 4; i++) {
          if (i === seat) continue;
          if (getMeldCount(state, i) >= 2) {
            const oppDiscards = getDiscards(state, i);
            if (isSafeAgainst(discard, oppDiscards)) {
              return { flowDelta: SAFE_DISCARD_FLOW };
            }
          }
        }
      }
      return { flowDelta: 0 };
    },

    // T1: Match Recognition — safe tile highlighting for 3 turns.
    tryActivateTier1(state, turn) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER1_COST)) return { ok: false, reason: 'insufficient-flow' };
      if (turn < 7) return { ok: false, reason: 'turn-gate' };
      flow.consume(seat, TIER1_COST);
      tier1TurnsLeft = 3;
      // Return safe tiles info for HUD
      const hand = getHand(state, seat);
      const safeTiles = [];
      for (let i = 0; i < 4; i++) {
        if (i === seat) continue;
        if (getMeldCount(state, i) >= 2) {
          const oppDiscards = getDiscards(state, i);
          for (const t of hand) {
            if (isSafeAgainst(t, oppDiscards)) safeTiles.push(norm(t));
          }
        }
      }
      return { ok: true, safeTiles: [...new Set(safeTiles)], event: { type: 'MATCH_RECOGNITION', tier: 1 } };
    },

    // T2: Flow Reroute — +40% uke-ire for 3 draws.
    tryActivateTier2(state, turn) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER2_COST)) return { ok: false, reason: 'insufficient-flow' };
      if (turn < 7 || turn > 12) return { ok: false, reason: 'turn-gate' };
      flow.consume(seat, TIER2_COST);
      tier2TurnsLeft = 3;
      return { ok: true, event: { type: 'FLOW_REROUTE', tier: 2 } };
    },

    // T3: River Mirroring — steal opponent's bridge tiles for 4 turns.
    tryActivateTier3(state, targetSeat) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER3_COST)) return { ok: false, reason: 'insufficient-flow' };
      if (targetSeat === undefined || targetSeat === seat || targetSeat < 0 || targetSeat > 3) {
        return { ok: false, reason: 'invalid-target' };
      }
      flow.consume(seat, TIER3_COST);
      tier3TurnsLeft = 4;
      tier3Target = targetSeat;
      return { ok: true, target: targetSeat, event: { type: 'RIVER_MIRRORING', tier: 3, target: targetSeat } };
    },

    // T4: Omnipresent Recall — tenpai wait knowledge + win alignment.
    tryActivateTier4(state, turn) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER4_COST)) return { ok: false, reason: 'insufficient-flow' };
      const hand = getHand(state, seat);
      if (shantenOf(hand) !== 0) return { ok: false, reason: 'precondition' };
      if (turn < 8 || turn > 16) return { ok: false, reason: 'turn-gate' };
      flow.consume(seat, TIER4_COST);
      tier4Active = true;
      // Compute opponent wait info
      const waitsBySeat = {};
      for (let i = 0; i < 4; i++) {
        if (i === seat) continue;
        const h = hairiOf((state.players[i] && state.players[i].hand) || []);
        waitsBySeat[i] = h && h.wait ? Object.keys(h.wait) : [];
      }
      return { ok: true, waitsBySeat, event: { type: 'OMNIPRESENT_RECALL', tier: 4, waitsBySeat } };
    },

    // Lifecycle: decrement durations.
    onTurnEnd(state) {
      if (tier1TurnsLeft > 0) tier1TurnsLeft--;
      if (tier2TurnsLeft > 0) tier2TurnsLeft--;
      if (tier3TurnsLeft > 0) tier3TurnsLeft--;
    },

    // Settlement: reset tier4 on win.
    onSettlement(result, state) {
      if (result && result.winner === seat) tier4Active = false;
      return {};
    },

    _state: () => ({ tier1TurnsLeft, tier2TurnsLeft, tier3TurnsLeft, tier4Active, tier3Target }),
    _resetTiers: () => { tier1TurnsLeft = 0; tier2TurnsLeft = 0; tier3TurnsLeft = 0; tier4Active = false; tier3Target = -1; },
  };
}

module.exports = {
  createMakoHooks,
  computeFlowPerTurn,
  isSafeAgainst,
  MAKO: {
    TIER1_COST, TIER2_COST, TIER3_COST, TIER4_COST,
    BASE_RAMP_START, RAMP_STEP, SAFE_DISCARD_FLOW,
  },
};
