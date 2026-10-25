// Phase names for Table's async state machine. Shared with table-calls.js so a
// call-window file does not have to import the whole Table class (KI-11).
const PHASE = {
  LOBBY: 'LOBBY',
  DEAL: 'DEAL',
  TURN_ACT: 'TURN_ACT',
  CALL_WINDOW: 'CALL_WINDOW',
  CALL_DISCARD: 'CALL_DISCARD',
  ROUND_END: 'ROUND_END',
};

module.exports = { PHASE };
