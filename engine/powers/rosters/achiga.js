// rosters/achiga.js — Achiga Girls Academy.
// Yuu Matsumi (normal-type): pure passive Trajectory Shaper.
// Fires "Hot Dams" — a quiet traction on Manzu and Red Dragons. She is always
// at full power and lives entirely outside the Flow economy (type: 'normal'),
// so she has no tiers, no gauge, and nothing for the player to conserve.
const { norm } = require('../../tiles');

const MANZU_CHUN_BIAS = 1.35;

function getHand(state, seat) {
  return (state.players[seat] && state.players[seat].hand) || [];
}

// Hot tiles: any Manzu (1m-9m, aka 0m folds to 5m) and the Red Dragon (7z).
function isWarmTile(tile) {
  const n = norm(tile);
  return /^[1-9]m$/.test(n) || n === '7z';
}

function createYuuHooks(seat) {
  return {
    seat,
    meta: {
      type: 'normal',
      name: 'Yuu Matsumi',
      school: 'Achiga',
      passiveName: 'Hot Dams (Manzu + Chun)',
      tiers: {},
    },
    getTierInfo() {
      return [];
    },

    // Phase 2: Trajectory Shaper — pure weight, no mutation, always live.
    onPowerDraw(tile, state) {
      const hand = getHand(state, seat);
      void hand;
      return isWarmTile(tile) ? MANZU_CHUN_BIAS : 1.0;
    },

    isPowerActive() {
      return true;
    },

    getHudAdvice() {
      return 'Hot Dams active — Manzu and Red Dragon draws are boosted (x1.35).';
    },
  };
}

module.exports = { createYuuHooks, isWarmTile, MANZU_CHUN_BIAS };
