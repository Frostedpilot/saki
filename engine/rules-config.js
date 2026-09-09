// rules-config.js — shared rules configuration (Fix plan Phase 4).
// Documents current behavior as data instead of hardcoded branches.
// Values below match engine/game.js behavior; the server keeps abortive
// draws disabled by default (ABORTS all false) to preserve its behavior
// until the handlers are unified.
const RULES = {
  startScore: 25000,
  riichiValue: 1000,
  minWallForRiichi: 4,
  honbaTsumo: 100, // per payer on tsumo
  honbaRon: 300,   // per win on ron
  minHan: 1,
  overtimeMinHan: 2, // ryanhan-shibari during enchousen
  maxKan: 4,
  rinshanSlots: 4,
  deadWallLength: 14,
  // Abortive draws. game.js enables all five; server/room.js enables none
  // (see room.js header). Flip a flag only together with its handler.
  aborts: {
    kyuushuKyuuhai: true,
    suufonRenda: true,
    suukaikan: true,
    suuchaRiichi: true,
    tripleRon: true,
  },
  serverAborts: {
    kyuushuKyuuhai: false,
    suufonRenda: false,
    suukaikan: false,
    suuchaRiichi: false,
    tripleRon: false,
  },
};

module.exports = { RULES };
