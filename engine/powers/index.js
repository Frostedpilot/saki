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
    if (h.onPreDeal) {
      try { return h.onPreDeal(ctx); } catch (e) { warnHook('onPreDeal', seat, e); }
    }
    return null;
  }
  // Phase 1
  onWallSetup(seat, ctx) {
    const h = this.hooksFor(seat);
    if (h.onWallSetup) {
      try { return h.onWallSetup(ctx); } catch (e) { warnHook('onWallSetup', seat, e); }
    }
    return null;
  }

  getTierInfo(seat, state) {
    const h = this.hooksFor(seat);
    if (typeof h.getTierInfo === 'function') {
      try { return h.getTierInfo(state); } catch (e) { warnHook('getTierInfo', seat, e); }
    }
    return [];
  }

  onTurnStart(seat, state, opts) {
    const h = this.hooksFor(seat);
    if (typeof h.onTurnStart === 'function') {
      try { return h.onTurnStart(state, opts); } catch (e) { warnHook('onTurnStart', seat, e); }
    }
    return { activated: false, reason: 'no-hook' };
  }

  onKanDeclared(seat, state, opts) {
    const h = this.hooksFor(seat);
    if (typeof h.onKanDeclared === 'function') {
      try { return h.onKanDeclared(state, opts); } catch (e) { warnHook('onKanDeclared', seat, e); }
    }
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
    for (const [seat, h] of this.registry) {
      if (typeof h.applyFieldAura === 'function') {
        try {
          const next = h.applyFieldAura(drawSeat, w, state);
          if (next) w = next;
        } catch (e) { warnHook('applyFieldAura', seat, e); }
      }
    }
    return w;
  }
  onPostDraw(seat, tile, state) {
    const h = this.hooksFor(seat);
    if (h.onPostDraw) {
      try { h.onPostDraw(tile, state); } catch (e) { warnHook('onPostDraw', seat, e); }
    }
  }
  // Phase 2b: field aura dampening of opponent weights (default: identity)
  // NOTE: single-seat wrapper kept for compatibility; the canonical path is
  // applyAllFieldAuras(drawSeat, weights, state) with the draw-seat first.
  applyFieldAura(seat, weights, state) {
    const h = this.hooksFor(seat);
    if (h.applyFieldAura) {
      try { return h.applyFieldAura(seat, weights, state) || weights; }
      catch (e) { warnHook('applyFieldAura', seat, e); }
    }
    return weights;
  }
  // Phase 2c: turn clock (default 10s)
  getTurnClock(seat, state) {
    const h = this.hooksFor(seat);
    if (h.getTurnClock) {
      try { return h.getTurnClock(state); } catch (e) { warnHook('getTurnClock', seat, e); }
    }
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
