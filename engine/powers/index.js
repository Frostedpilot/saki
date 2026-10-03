// powers/index.js — Power registry & lifecycle dispatcher (Spec §5, §7).
// Six primitives: Trajectory Shaper, Slot Reserver, Field Enforcer,
// Perception Warper, Tempo Economist, Settlement Modifier.
// Character rosters register hooks here; engine-only build ships empty
// (all weights 1.0 = pure uniform sampling, identical to physical deck).
const TrajectoryPlanner = require('./trajectoryPlanner');

// A throwing hook must never break a game, but silence hid real breakage: a
// power could fail completely and the suite still passed, because the tests
// assert the fallback path too. Warn once per hook name — drawWeight fires on
// every single draw, so an unguarded warn would flood the console.
const warnedHooks = new Set();
function warnHook(hookName, seat, e) {
  if (warnedHooks.has(hookName)) return;
  warnedHooks.add(hookName);
  const msg = e && e.message ? e.message : String(e);
  console.warn(`[power] hook '${hookName}' (seat ${seat}) threw and was ignored: ${msg}`);
  console.warn('[power] this power is now inert for the rest of the session');
}
function resetHookWarnings() { warnedHooks.clear(); }

class PowerDispatcher {
  constructor() {
    this.registry = new Map(); // seat -> hooks object
  }
  register(seat, hooks) { this.registry.set(seat, hooks); }
  clear(seat) { this.registry.delete(seat); }
  hooksFor(seat) { return this.registry.get(seat) || {}; }

  // Power type of a seat: 'flow' (gauge/tier economy) by default, or 'normal'
  // for self-described passive powers that live entirely outside the Flow
  // economy (Spec §6.1). Roster meta decides: { type: 'normal' } opts in.
  powerTypeOf(seat) {
    const h = this.hooksFor(seat);
    return h && h.meta && h.meta.type === 'normal' ? 'normal' : 'flow';
  }

  // Field-wide notification that some seat declared a kan. Feeds the
  // `onPlayerKan(kanSeat, state)` hook so normal-type powers (e.g. a Saki that
  // is disrupted by an opponent's kan) can observe every kan on the table.
  broadcastPlayerKan(kanSeat, state) {
    if (typeof kanSeat !== 'number') return;
    for (const [seat, h] of this.registry) {
      if (typeof h.onPlayerKan === 'function') {
        try { h.onPlayerKan(kanSeat, state); } catch (e) { warnHook('onPlayerKan', seat, e); }
      }
    }
  }

  // Phase 0
  onPreDeal(seat, ctx) {
    const h = this.hooksFor(seat);
    if (h.onPreDeal) return h.onPreDeal(ctx);
    return null;
  }
  // Phase 1
  onWallSetup(seat, ctx) {
    const h = this.hooksFor(seat);
    if (h.onWallSetup) return h.onWallSetup(ctx);
    return null;
  }

  getTierInfo(seat, state) {
    const h = this.hooksFor(seat);
    if (typeof h.getTierInfo === 'function') return h.getTierInfo(state);
    return [];
  }

  onTurnStart(seat, state, opts) {
    const h = this.hooksFor(seat);
    if (typeof h.onTurnStart === 'function') return h.onTurnStart(state, opts);
    return { activated: false, reason: 'no-hook' };
  }

  onKanDeclared(seat, state, opts) {
    const h = this.hooksFor(seat);
    if (typeof h.onKanDeclared === 'function') return h.onKanDeclared(state, opts);
    return { activated: false, reason: 'no-hook' };
  }
  // Phase 2: per-tile weight. Must return >= 0. Default 1.0.
  drawWeight(seat, tile, state, trajectory) {
    const h = this.hooksFor(seat);
    if (h.onPowerDraw) {
      try {
        const w = h.onPowerDraw(tile, state, trajectory);
        if (typeof w === 'number' && w >= 0) return w;
      } catch (e) { warnHook('onPowerDraw', seat, e); }
    }
    return 1.0;
  }
  computeDrawWeights(seat, state, trajectory) {
    const weights = {};
    const pool = state.pool;
    const kinds = pool ? Object.keys(pool.counts) : [];
    for (const k of kinds) weights[k] = this.drawWeight(seat, k, state, trajectory);
    return this.applyAllFieldAuras(seat, weights, state);
  }
  // Field Enforcer aggregation (Spec §5.3): every registered hook may dampen
  // or boost the DRAWING seat's weight map. Weights is a fresh per-draw object,
  // so plugin mutation is the sanctioned engine-owned channel. Multipliers from
  // multiple enforcers compose multiplicatively (order-independent).
  applyAllFieldAuras(drawSeat, weights, state) {
    let w = weights;
    for (const [, h] of this.registry) {
      if (typeof h.applyFieldAura === 'function') {
        const next = h.applyFieldAura(drawSeat, w, state);
        if (next) w = next;
      }
    }
    return w;
  }
  onPostDraw(seat, tile, state) {
    const h = this.hooksFor(seat);
    if (h.onPostDraw) h.onPostDraw(tile, state);
  }
  // Phase 2b: field aura dampening of opponent weights (default: identity)
  applyFieldAura(seat, weights, state) {
    const h = this.hooksFor(seat);
    if (h.applyFieldAura) return h.applyFieldAura(weights, state) || weights;
    return weights;
  }
  // Phase 2c: turn clock (default 10s)
  getTurnClock(seat, state) {
    const h = this.hooksFor(seat);
    if (h.getTurnClock) return h.getTurnClock(state);
    return 10;
  }
  // Phase 3
  onSettlement(result, state) {
    for (const [seat, h] of this.registry) {
      if (h.onSettlement) {
        try { h.onSettlement(result, state); } catch (e) { warnHook('onSettlement', seat, e); }
      }
    }
  }
}

const dispatcher = new PowerDispatcher();

module.exports = { PowerDispatcher, dispatcher, resetHookWarnings };
