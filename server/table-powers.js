'use strict';
// Power activation, tier arming, HUD broadcasting and the settlement hook for
// `Table`. Extracted from table.js (KI-11): this is the whole client-facing
// power subsystem, and it needs only a narrow slice of the Table — ctx,
// armedTiers, powerOf, isCpuSeat and broadcast.
const P = require('./protocol');
const core = require('../engine/core');
const { RULES } = require('../engine/rules-config');
const { warnOnce, callHook } = require('./hook-utils');

function setArmedTier(table, seat, tier) {
  if (seat >= 0 && seat < 4) {
    // Normal-type powers are fully automatic — nothing to arm, no cost.
    if (
      table.ctx &&
      table.ctx.state &&
      table.ctx.state.powers &&
      table.ctx.state.powers.powerTypeOf(seat) === 'normal'
    ) {
      console.log(`[bridge] seat ${seat} power is normal-type — tier selection ignored`);
      return;
    }
    table.armedTiers[seat] = typeof tier === 'number' ? Math.max(0, Math.min(4, Math.floor(tier))) : 0;
    console.log(`[bridge] seat ${seat} armed power tier ${table.armedTiers[seat]}`);
    table.broadcastPowerStatus();
  }
}

function broadcastPowerStatus(table) {
  if (!table.ctx || !table.ctx.state) return;
  const { state } = table.ctx;
  for (let s = 0; s < 4; s++) {
    const power = table.powerOf(s);
    if (power === 'none') continue;
    const hooks = state.powers ? state.powers.hooksFor(s) : null;
    const type = state.powers ? state.powers.powerTypeOf(s) : 'flow';

    // Normal-type powers: passive pill, no meter, no tiers, no arming.
    if (type === 'normal') {
      let isActive = false;
      if (hooks && typeof hooks.isPowerActive === 'function') {
        try {
          isActive = !!hooks.isPowerActive(state);
        } catch (e) {
          warnOnce('isPowerActive', e);
        }
      }
      let desc = '';
      if (hooks && hooks.meta && hooks.meta.passiveName) desc = hooks.meta.passiveName;
      if (hooks && typeof hooks.getHudAdvice === 'function') {
        try {
          desc = hooks.getHudAdvice(state) || desc;
        } catch (e) {
          warnOnce('getHudAdvice', e);
        }
      }
      table.broadcast(
        P.evSuperpowerIndicator({
          seat: s,
          active: isActive,
          type: 'normal',
          gauge: null,
          power,
          description: desc,
          armedTier: 0,
          availableTiers: [],
        })
      );
      continue;
    }

    const flowVal = state.flow ? Math.round(state.flow.get(s)) : 50;
    const gauge = Math.min(100, Math.max(0, Math.round((flowVal / 150) * 100)));
    let isActive = false;
    let desc = `Flow: ${flowVal} / 150`;
    const hs = callHook(hooks, '_state');
    if (hs && typeof hs === 'object') {
      for (const val of Object.values(hs)) {
        if (typeof val === 'number' && val > 0) isActive = true;
        if (typeof val === 'boolean' && val) isActive = true;
      }
    }
    if (power === 'nodoka') {
      if (hooks && typeof hooks.getHudAdvice === 'function') {
        desc = callHook(hooks, 'getHudAdvice', state) || desc;
      } else if (flowVal >= 50) {
        desc = `Nodocchi Mode (${flowVal}/150)`;
      }
      if (flowVal >= 50) isActive = true;
    } else if (power === 'yuuki' && (!table.ctx.bakaze || table.ctx.bakaze === 1)) {
      isActive = true;
      desc = `East Round Burst (${flowVal}/150)`;
    } else if (power === 'koromo' && flowVal >= 50) {
      isActive = true;
      desc = `Full Moon Aura (${flowVal}/150)`;
    } else if (isActive) {
      desc = `Active Power (${flowVal}/150)`;
    }
    const armedTier = table.armedTiers ? table.armedTiers[s] || 0 : 0;
    let availableTiers = [];
    if (hooks && typeof hooks.getTierInfo === 'function') {
      const tiers = callHook(hooks, 'getTierInfo', state);
      availableTiers = Array.isArray(tiers) ? tiers : [];
    }
    table.broadcast(
      P.evSuperpowerIndicator({
        seat: s,
        active: isActive,
        gauge,
        power,
        description: desc,
        armedTier,
        availableTiers,
      })
    );
  }
}

function maybeActivateTurnPower(table, seat) {
  const power = table.powerOf(seat);
  if (power === 'none') return;
  const hooks = table.ctx.state.powers ? table.ctx.state.powers.hooksFor(seat) : null;
  if (!hooks) return;
  const ctx = table.ctx;
  const state = ctx.state;
  const type = state.powers ? state.powers.powerTypeOf(seat) : 'flow';

  // Normal-type powers are fully automatic: no armed tier, no cost, always
  // at full strength. Fire the onTurnStart condition if it exists.
  if (type === 'normal') {
    const activation = callHook(hooks, 'onTurnStart', state, { type: 'normal', armedTier: 0 });
    if (activation && activation.activated) {
      const eventType =
        (activation.event && activation.event.type) ||
        (activation.result && activation.result.event && activation.result.event.type) ||
        'NORMAL_TRIGGER';
      console.log(`[bridge] normal power ${power} triggered ${eventType} for seat ${seat}`);
      table.broadcast(
        P.evPowerActivated({
          player: P.seatWind(seat, ctx.dealer),
          power,
          tier: 0,
          eventType,
        })
      );
      table.broadcastPowerStatus();
    }
    return;
  }

  if (power === 'saki') return; // flow Saki is kan-only

  // Human player uses explicitly armed tier (0 = conserve/off); CPU defaults to 'auto'
  const armedTier = table.isCpuSeat(seat) ? 'auto' : table.armedTiers[seat] || 0;
  if (armedTier === 0) return;

  let activation = null;
  if (typeof hooks.onTurnStart === 'function') {
    activation = callHook(hooks, 'onTurnStart', state, { armedTier });
  } else {
    const order = armedTier === 'auto' ? [4, 3, 2, 1] : [armedTier];
    for (const t of order) {
      const fnName = `tryActivateTier${t}`;
      if (typeof hooks[fnName] === 'function') {
        try {
          const r = hooks[fnName].call(hooks, state);
          if (r && r.ok) {
            activation = { activated: true, tier: t, result: r };
            break;
          }
        } catch (e) {
          warnOnce(`tryActivateTier${t}`, e);
        }
      }
    }
  }

  if (activation && activation.activated) {
    const tier = activation.tier;
    const eventType = (activation.result && activation.result.event && activation.result.event.type) || `TIER_${tier}`;
    console.log(`[bridge] ${power} activated ${eventType} (Tier ${tier}) for seat ${seat}`);
    table.broadcast(
      P.evPowerActivated({
        player: P.seatWind(seat, ctx.dealer),
        power,
        tier,
        eventType,
      })
    );
    if (!table.isCpuSeat(seat)) {
      table.armedTiers[seat] = 0; // Reset after one-shot activation
    }
    table.broadcastPowerStatus();
  }
}

function maybeActivateTier(table, seat, kanCount) {
  const power = table.powerOf(seat);
  const hooks = table.ctx.state.powers ? table.ctx.state.powers.hooksFor(seat) : null;
  if (!hooks) return;
  const ctx = table.ctx;
  const state = ctx.state;
  const type = state.powers ? state.powers.powerTypeOf(seat) : 'flow';
  // Power hooks score with state.bakaze/state.doraIndicators/p.wind, but the
  // bridge keeps those on ctx (ctx.bakaze/ctx.doraInd/dealer). Sync them so
  // winningWaits sees the real round wind, seat wind and dora (matters for
  // the overtime ryanhan floor, and avoids wind-yakuhai skew).
  try {
    state.bakaze = ctx.bakaze;
    state.doraIndicators = [...ctx.doraInd];
    if (state.players && state.players[seat]) state.players[seat].wind = P.jikazeOf(seat, ctx.dealer);
  } catch (e) {
    warnOnce('kan-ctx-sync', e);
  }

  // Normal-type powers need no arming and spend nothing: the hook evaluates
  // its own condition and pins the on-deck replacement slot when it fires.
  if (type === 'normal') {
    const activation = callHook(hooks, 'onKanDeclared', state, {
      kanCount,
      rinshanIdx: ctx.rinshanIdx,
      armedTier: 0,
    });
    if (activation && activation.activated) {
      const eventType =
        (activation.event && activation.event.type) ||
        (activation.result && activation.result.event && activation.result.event.type) ||
        'NORMAL_KAN';
      console.log(`[bridge] normal power ${power} triggered ${eventType} (kan ${kanCount})`);
      table.broadcast(
        P.evPowerActivated({
          player: P.seatWind(seat, ctx.dealer),
          power,
          tier: 0,
          eventType,
        })
      );
      table.broadcastPowerStatus();
    }
    return;
  }

  // Human player uses explicitly armed tier (or 'auto' if CPU)
  const armedTier = table.isCpuSeat(seat) ? 'auto' : table.armedTiers[seat] || 0;
  if (armedTier === 0) return; // Conserve meter on Kan!

  let activation = null;
  if (typeof hooks.onKanDeclared === 'function') {
    activation = callHook(hooks, 'onKanDeclared', table.ctx.state, {
      armedTier,
      kanCount,
      rinshanIdx: table.ctx.rinshanIdx,
    });
  } else {
    const order = armedTier === 'auto' ? [4, 3, 2, 1] : [armedTier];
    for (const t of order) {
      const name = `tryActivateTier${t}`;
      if (typeof hooks[name] === 'function') {
        try {
          const r = hooks[name].call(hooks, table.ctx.state, kanCount, table.ctx.rinshanIdx);
          if (r && r.ok) {
            activation = { activated: true, tier: t, result: r };
            break;
          }
        } catch (e) {
          warnOnce(`${power}:onKanDeclared`, e);
        }
      }
    }
  }

  if (activation && activation.activated) {
    const r = activation.result;
    const tier = activation.tier;
    // Saki tiers now deterministically pin the on-deck slot (win if live,
    // else best ukeire). Only fall back to weighted sampling when the hook
    // did NOT pin — never overwrite a guaranteed slot.
    if (
      r &&
      !r.pinned &&
      r.weightOf &&
      typeof core.sampleRinshan === 'function' &&
      table.ctx.rinshanIdx < RULES.rinshanSlots
    ) {
      core.sampleRinshan(table.ctx.state, table.ctx.rinshanIdx, r.weightOf);
    }
    console.log(`[bridge] ${power} tier ${tier} activated (kan ${kanCount})`);
    const eventType = (r && r.event && r.event.type) || `TIER_${tier}`;
    table.broadcast(
      P.evPowerActivated({
        player: P.seatWind(seat, table.ctx.dealer),
        power,
        tier,
        eventType,
      })
    );
    if (!table.isCpuSeat(seat)) {
      table.armedTiers[seat] = 0;
    }
    table.broadcastPowerStatus();
  }
}

function settlePowerHook(table, result) {
  try {
    if (typeof table.ctx.state.powers.onSettlement === 'function') {
      table.ctx.state.powers.onSettlement(result, table.ctx.state);
    }
  } catch (e) {
    warnOnce('onSettlement', e);
  }
}

module.exports = {
  setArmedTier,
  broadcastPowerStatus,
  maybeActivateTurnPower,
  maybeActivateTier,
  settlePowerHook,
};
