// rules-config.js — shared rules configuration.
//
// This is LIVE configuration, not documentation: both rule front-ends read it.
// `engine/game.js` (offline) and `server/table.js` (networked) used to hardcode the
// same numbers independently, which is exactly how KI-04 happened — a rule fixed in
// one was not fixed in the other. Every value below is consumed by at least one
// front-end, and `engine/tests/rules-config-parity.test.js` fails if either file
// reintroduces a literal copy of one of them.
//
// Not here: the *turn loops*. The two front-ends still drive a hand differently
// (a CLI turn loop versus an async phase machine), because they have to. The
// shared *transition table* (dealer repeat, honba, kyoku, noten schedule, han
// floor) lives in engine/match-flow.js, which both front-ends call. See KI-04
// for what is and is not shared.
const RULES = {
  startScore: 25000,
  riichiValue: 1000,
  minWallForRiichi: 4,
  honbaTsumo: 100, // per payer on tsumo
  honbaRon: 300, // per win on ron
  minHan: 1,
  overtimeMinHan: 2, // ryanhan-shibari during enchousen
  notenTotal: 3000, // points moved at an exhaustive draw (1 tenpai: +3000/-1000)
  maxKan: 4,
  rinshanSlots: 4,
  deadWallLength: 14,
  // Abortive draws. game.js enables all five; the server implements all five
  // too (kyuushu has a documented human limitation: no deal-time prompt, so
  // human 9-kind hands auto play on — see table.js checkKyuushu).
  // Flip a flag only together with its handler.
  aborts: {
    kyuushuKyuuhai: true,
    suufonRenda: true,
    suukaikan: true,
    suuchaRiichi: true,
    tripleRon: true,
  },
  serverAborts: {
    kyuushuKyuuhai: true,
    suufonRenda: true,
    suukaikan: true,
    suuchaRiichi: true,
    tripleRon: true,
  },
};

module.exports = { RULES };
