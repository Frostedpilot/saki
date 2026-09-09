// rosters/hisa.js — Hisa Takei (full skill tree).
// Archetype: Trajectory Shaper + Field Enforcer.
// Primary Window: Row 2–3 (Turns 9–16) — Hell-Waits.
const { norm } = require('../../tiles');
const { shantenOf, hairiOf, ukeire } = require('../trajectoryPlanner');
const { scalePassiveWeight } = require('../awakening');

const TIER1_COST = 25;
const TIER2_COST = 50;
const TIER3_COST = 100;
const TIER4_COST = 150;
const RYANMEN_PENALTY = 0.70;  // -30% for multi-sided waits
const HELL_WAIT_BOOST = 3.0;   // 3.0x for 1-tile ugly waits
const RIICHI_FLOW_DRAIN = 10;   // drain 10% from each opponent on Riichi
const UGLY_WAIT_FLOW = 15;      // +15% for shifting to ugly wait
const HELL_WAIT_FLOW = 30;      // +30% for Riichi on 1-tile wait
const CHAOS_SLAP_WEIGHT = 12.0; // T3: ~70% win on 1-tile wait
const HELL_DOMINANCE_WEIGHT = 17.0; // T4: 85% win on final draw
const DAMAGE_MITIGATION = 0.50; // T4: 50% damage reduction

function getHand(state, seat) {
  return (state.players[seat] && state.players[seat].hand) || [];
}

function getScore(state, seat) {
  if (state.scores && state.scores[seat] !== undefined) return state.scores[seat];
  return 25000;
}

// Classify a wait: 'ryanmen' (same-suit pair diff 3, 5+ live), 'hell'
// (single-tile wait, <=2 live), 'ugly' (tanki/kanchan/penchan/shanpon).
// Only meaningful at tenpai; non-tenpai hands return 'none'.
function classifyWait(hand, pool) {
  if (shantenOf(hand) !== 0) return { type: 'none', waits: [], liveCount: 0 };
  const h = hairiOf(hand);
  if (!h || !h.wait) return { type: 'none', waits: [], liveCount: 0 };
  const waits = Object.keys(h.wait).sort();
  let liveCount = 0;
  for (const w of waits) {
    const c = pool ? (pool.get(w) || 0) + (pool.get(w.replace(/^5/, '0')) || 0) : 4;
    liveCount += c;
  }
  const isRyanmen = waits.length === 2 &&
    waits[0][1] === waits[1][1] && waits[0][1] !== 'z' &&
    Math.abs(parseInt(waits[0][0], 10) - parseInt(waits[1][0], 10)) === 3;
  if (isRyanmen && liveCount >= 5) return { type: 'ryanmen', waits, liveCount };
  if (waits.length === 1 && liveCount <= 2) return { type: 'hell', waits, liveCount };
  return { type: 'ugly', waits, liveCount };
}

function createHisaHooks(seat) {
  let tier1Active = false;
  let tier1TurnsLeft = 0;
  let tier2Active = false;
  let tier3TurnsLeft = 0;
  let tier4Active = false;
  let tier4TurnsLeft = 0;

  return {
    seat,
    meta: {
      name: 'Hisa Takei',
      school: 'Kiyosumi',
      tiers: {
        passive: 0,
        phantomIntimidation: TIER1_COST,
        jigokuTrapForge: TIER2_COST,
        chaosSlap: TIER3_COST,
        hellDominance: TIER4_COST,
      },
    },

    // Phase 2: draw weight hook.
    onPowerDraw(tile, state) {
      const n = norm(tile);
      const hand = getHand(state, seat);
      const pool = state.pool;
      const waitInfo = classifyWait(hand, pool);

      // T4: Hell Dominance — 85% on hell wait
      if (tier4TurnsLeft > 0 && waitInfo.type === 'hell') {
        if (waitInfo.waits.includes(n)) return HELL_DOMINANCE_WEIGHT;
      }

      // T3: Chaos Slap — 70% on ugly/hell wait
      if (tier3TurnsLeft > 0 && (waitInfo.type === 'hell' || waitInfo.type === 'ugly')) {
        if (waitInfo.waits.includes(n)) return CHAOS_SLAP_WEIGHT;
      }

      // Passive: wait-based multiplier
      let base = 1.0;
      if (waitInfo.type === 'ryanmen' && waitInfo.waits.includes(n)) {
        base = RYANMEN_PENALTY;
      } else if ((waitInfo.type === 'hell' || waitInfo.type === 'ugly') && waitInfo.waits.includes(n)) {
        base = HELL_WAIT_BOOST;
      }

      if (base !== 1.0) {
        if (state && state.enableAwakening) {
          const flow = state.flow ? state.flow.get(seat) : 0;
          return scalePassiveWeight(base, flow, state, seat);
        }
        return base;
      }

      return 1.0;
    },

    // Riichi declaration hook — Showmanship Slam: drain 10% from all opponents.
    onDeclareRiichi(state) {
      const flow = state.flow;
      if (!flow) return;
      for (let i = 0; i < 4; i++) {
        if (i !== seat) flow.drainFlow(i, RIICHI_FLOW_DRAIN);
      }
      // Check if it's a hell wait for bonus flow
      const hand = getHand(state, seat);
      const waitInfo = classifyWait(hand, state.pool);
      if (waitInfo.type === 'hell') {
        flow.addFlow(seat, HELL_WAIT_FLOW);
      }
      return { event: { type: 'SHOWMANSHIP_SLAM' } };
    },

    // Discard hook: +15% flow when shifting to ugly wait.
    onDiscard(discard, state) {
      const hand = getHand(state, seat);
      const newHand = hand.filter((_, i) => i !== hand.findIndex(t => norm(t) === norm(discard)));
      const beforeWait = classifyWait(hand, state.pool);
      const afterWait = classifyWait(newHand, state.pool);
      if (afterWait.type === 'ugly' || afterWait.type === 'hell') {
        if (beforeWait.type === 'ryanmen' || beforeWait.type === 'none') {
          return { flowDelta: UGLY_WAIT_FLOW };
        }
      }
      return { flowDelta: 0 };
    },

    // T1: Phantom Intimidation — fake Riichi threat for 3 turns.
    tryActivateTier1(state, turn) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER1_COST)) return { ok: false, reason: 'insufficient-flow' };
      const curTurn = turn !== undefined ? turn : ((state.players && state.players[seat] && state.players[seat].discards) ? state.players[seat].discards.length + 1 : 1);
      if (curTurn < 7 || curTurn > 12) return { ok: false, reason: 'turn-gate' };
      const hand = getHand(state, seat);
      if (shantenOf(hand) !== 1) return { ok: false, reason: 'precondition' };
      flow.consume(seat, TIER1_COST);
      tier1Active = true;
      tier1TurnsLeft = 3;
      return { ok: true, event: { type: 'PHANTOM_INTIMIDATION', tier: 1 } };
    },

    // T2: Jigoku Trap Forge — inject winning tile into opponent's draw.
    tryActivateTier2(state) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER2_COST)) return { ok: false, reason: 'insufficient-flow' };
      const hand = getHand(state, seat);
      const waitInfo = classifyWait(hand, state.pool);
      if (waitInfo.type !== 'hell') return { ok: false, reason: 'precondition' };
      flow.consume(seat, TIER2_COST);
      tier2Active = true;
      // Return the trap tile info — engine handles injection
      return { ok: true, trapTile: waitInfo.waits[0], event: { type: 'JIGOKU_TRAP_FORGE', tier: 2 } };
    },

    // T3: Chaos Slap Tsumo — 70% win on ugly/hell wait for 3 turns.
    tryActivateTier3(state) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER3_COST)) return { ok: false, reason: 'insufficient-flow' };
      const hand = getHand(state, seat);
      const waitInfo = classifyWait(hand, state.pool);
      if (waitInfo.type !== 'hell' && waitInfo.type !== 'ugly') return { ok: false, reason: 'precondition' };
      flow.consume(seat, TIER3_COST);
      tier3TurnsLeft = 3;
      return { ok: true, event: { type: 'CHAOS_SLAP', tier: 3 } };
    },

    // T4: Absolute Hell Dominance — 85% on hell wait, damage mitigation.
    tryActivateTier4(state, wallLeft) {
      const flow = state.flow;
      if (!flow || !flow.canAfford(seat, TIER4_COST)) return { ok: false, reason: 'insufficient-flow' };
      const hand = getHand(state, seat);
      const waitInfo = classifyWait(hand, state.pool);
      if (waitInfo.type !== 'hell') return { ok: false, reason: 'precondition' };
      const curWall = wallLeft !== undefined ? wallLeft : (state.pool ? state.pool.total() : 0);
      if (curWall > 25) return { ok: false, reason: 'wall-gate' };
      flow.consume(seat, TIER4_COST);
      tier4Active = true;
      tier4TurnsLeft = 3;
      return { ok: true, event: { type: 'HELL_DOMINANCE', tier: 4 } };
    },

    getTierInfo(state) {
      const flow = state.flow ? state.flow.get(seat) : 0;
      const turn = (state.players && state.players[seat] && state.players[seat].discards) ? state.players[seat].discards.length + 1 : 1;
      const wallLeft = state.pool ? state.pool.total() : 0;
      const hand = getHand(state, seat);
      const waitInfo = classifyWait(hand, state.pool);

      const t1Pre = turn >= 7 && turn <= 12 && shantenOf(hand) === 1;
      const t2Pre = waitInfo.type === 'hell';
      const t3Pre = waitInfo.type === 'hell' || waitInfo.type === 'ugly';
      const t4Pre = waitInfo.type === 'hell' && wallLeft <= 25;

      return [
        { tier: 1, name: 'Phantom Intimidation', cost: TIER1_COST, canAfford: flow >= TIER1_COST, canActivate: flow >= TIER1_COST && t1Pre },
        { tier: 2, name: 'Jigoku Trap Forge', cost: TIER2_COST, canAfford: flow >= TIER2_COST, canActivate: flow >= TIER2_COST && t2Pre },
        { tier: 3, name: 'Chaos Slap', cost: TIER3_COST, canAfford: flow >= TIER3_COST, canActivate: flow >= TIER3_COST && t3Pre },
        { tier: 4, name: 'Hell Dominance', cost: TIER4_COST, canAfford: flow >= TIER4_COST, canActivate: flow >= TIER4_COST && t4Pre },
      ];
    },

    activateTier(state, tier, extraArg) {
      switch (tier) {
        case 1: return this.tryActivateTier1(state, extraArg);
        case 2: return this.tryActivateTier2(state);
        case 3: return this.tryActivateTier3(state);
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

    // Lifecycle: decrement durations.
    onTurnEnd(state) {
      if (tier1TurnsLeft > 0) tier1TurnsLeft--;
      if (tier3TurnsLeft > 0) tier3TurnsLeft--;
      if (tier4TurnsLeft > 0) tier4TurnsLeft--;
    },

    // Settlement: damage mitigation on deal-in during T4.
    onSettlement(result, state) {
      if (tier4Active && result && result.type === 'ron' && result.from === seat) {
        return { scoreMultiplier: DAMAGE_MITIGATION };
      }
      return {};
    },

    _state: () => ({ tier1Active, tier1TurnsLeft, tier2Active, tier3TurnsLeft, tier4Active, tier4TurnsLeft }),
    _resetTiers: () => { tier1Active = false; tier1TurnsLeft = 0; tier2Active = false; tier3TurnsLeft = 0; tier4Active = false; tier4TurnsLeft = 0; },
  };
}

module.exports = {
  createHisaHooks,
  classifyWait,
  HISA: {
    TIER1_COST, TIER2_COST, TIER3_COST, TIER4_COST,
    RYANMEN_PENALTY, HELL_WAIT_BOOST, RIICHI_FLOW_DRAIN,
    UGLY_WAIT_FLOW, HELL_WAIT_FLOW, CHAOS_SLAP_WEIGHT,
    HELL_DOMINANCE_WEIGHT, DAMAGE_MITIGATION,
  },
};
