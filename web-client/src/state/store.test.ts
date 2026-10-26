// store.test.ts — the client's reactive state machine.
//
// `store.ts` is the largest file in the client (1199 lines) and had no tests at
// all: every protocol message the server can send flows through
// `handleServerMessage` / `handleGameEvent`, and every visible piece of state is
// derived there. A mis-handled event means a wrong board with no error anywhere.
//
// The socket is stubbed rather than mocked: the store only ever calls
// `onMessage` / `onStatus` and the outbound methods, so a fake that records the
// handlers is enough and keeps these tests about the store, not the transport.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeStore } from './test-harness';

// A 14-tile GameStarted payload.
const gameStarted = (over: Record<string, any> = {}) => ({
  Event: {
    GameStarted: {
      seat_wind: 'East',
      hand: [
        { index: 0 },
        { index: 1 },
        { index: 2 },
        { index: 3 },
        { index: 4 },
        { index: 5 },
        { index: 6 },
        { index: 7 },
        { index: 8 },
        { index: 9 },
        { index: 10 },
        { index: 11 },
        { index: 31 },
      ],
      scores: [25000, 25000, 25000, 25000],
      round_wind: 'East',
      dora_indicators: [{ index: 8 }],
      round_number: 1,
      total_rounds: 4,
      honba: 0,
      riichi_sticks: 0,
      three_player: false,
      nuki_dora: false,
      ...over,
    },
  },
});

beforeEach(() => {
  vi.restoreAllMocks();
});

// ------------------------------------------------------------- initial state

describe('GameStore initial state', () => {
  test('starts in the lobby, disconnected, with a 25 000 start', () => {
    const { store } = makeStore();
    expect(store.screen).toBe('lobby');
    expect(store.connectionStatus).toBe('disconnected');
    expect(store.scores).toEqual([25000, 25000, 25000, 25000]);
    expect(store.hand).toEqual([]);
    expect(store.currentTurn).toBe(-1);
    expect(store.isGameOver).toBe(false);
  });

  test('subscribes to both socket channels', () => {
    const { socket } = makeStore();
    expect(socket.onMessageHandler).not.toBeNull();
    expect(socket.onStatusHandler).not.toBeNull();
  });

  test('opponents are shown as holding 13 tiles each', () => {
    const { store } = makeStore();
    expect(store.opponentTileCounts).toEqual([13, 13, 13, 13]);
  });
});

// ------------------------------------------------------------- RoomState

describe('RoomState', () => {
  test('populates seats, defaulting empty ones to CPU', () => {
    const { store, socket } = makeStore();
    socket.emit({
      RoomState: {
        code: 'ABCD',
        host_seat: 1,
        your_seat: 2,
        seats: [{ Human: { name: 'Aki' } }, 'Empty', { Cpu: { level: 'Hard', personality: 'Aggressive' } }, 'Empty'],
        power_seats: ['saki', 'none', 'koromo', 'yuuki'],
      },
    });
    expect(store.roomCode).toBe('ABCD');
    expect(store.hostSeat).toBe(1);
    expect(store.yourSeat).toBe(2);
    expect(store.seats[0]).toMatchObject({ kind: 'human', name: 'Aki' });
    expect(store.seats[1]).toMatchObject({ kind: 'cpu' });
    expect(store.seats[2]).toMatchObject({ kind: 'cpu', level: 'Hard', personality: 'Aggressive' });
    expect(store.seats[3]).toMatchObject({ kind: 'cpu' });
  });

  test('power_seats is recorded on both the flat list and per-seat state', () => {
    const { store, socket } = makeStore();
    socket.emit({
      RoomState: {
        code: 'WXYZ',
        host_seat: 0,
        your_seat: 0,
        seats: ['Empty', 'Empty', 'Empty', 'Empty'],
        power_seats: ['nodoka', 'none', 'none', 'none'],
      },
    });
    expect(store.powerSeats[0]).toBe('nodoka');
    expect(store.powers[0].power).toBe('nodoka');
  });

  test('a human seat with no name gets a positional fallback', () => {
    const { store, socket } = makeStore();
    socket.emit({
      RoomState: {
        code: 'AAAA',
        host_seat: 0,
        your_seat: 0,
        seats: [{ Human: {} }, 'Empty', 'Empty', 'Empty'],
      },
    });
    expect(store.seats[0].name).toBe('Player 1');
  });
});

// ------------------------------------------------------------- GameStarted

describe('GameStarted', () => {
  test('switches to the game screen and installs the dealt state', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted());
    expect(store.screen).toBe('game');
    expect(store.hand).toHaveLength(13);
    expect(store.yourSeatWind).toBe('East');
    expect(store.roundWind).toBe('East');
    expect(store.roundNumber).toBe(1);
    expect(store.totalRounds).toBe(4);
    expect(store.doraIndicators).toEqual([{ index: 8 }]);
  });

  test('carries scores and riichi sticks through', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted({ scores: [31000, 24000, 21000, 24000], riichi_sticks: 2, honba: 3 }));
    expect(store.scores).toEqual([31000, 24000, 21000, 24000]);
    expect(store.riichiSticks).toBe(2);
    expect(store.honba).toBe(3);
  });

  test('clears state left over from a previous hand', () => {
    const { store, socket } = makeStore();
    // Deal once, discard, then deal again.
    socket.emit(gameStarted());
    socket.emit({ Event: { TileDiscarded: { seat: 0, tile: { index: 0 }, hand: [{ index: 1 }], is_riichi: false } } });
    expect(store.discards[0]).toHaveLength(1);
    socket.emit(gameStarted());
    expect(store.discards[0]).toEqual([]);
    expect(store.riichiDeclared).toEqual([false, false, false, false]);
  });
});

// ------------------------------------------------------- errors and feedback

describe('server errors', () => {
  test('an Error message raises a toast and a rule log line', () => {
    const { store, socket } = makeStore();
    const notify = vi.spyOn(store, 'notify');
    // Exactly what table.js sends: code 'NotInTurn', message 'not your turn to act'.
    socket.emit({ Error: { code: 'NotInTurn', message: 'not your turn to act' } });
    expect(store.toast?.text).toMatch(/Wait for your turn/i);
    expect(store.logs.some((e) => /Action Rejected/i.test(e.message))).toBe(true);
    expect(notify).toHaveBeenCalled();
  });

  test('the error code is included in the log line', () => {
    const { store, socket } = makeStore();
    socket.emit({ Error: { code: 'InvalidAction', message: 'tile not in hand' } });
    expect(store.logs.some((e) => /\[InvalidAction\]/.test(e.message))).toBe(true);
  });

  // These three are the only translations the store attempts, and two of them were
  // dead: the old code tested `errMsg` for the concatenated code, but the server
  // sends prose messages. The payloads below are copied from table.js.
  test.each([
    ['kuikae', { code: 'InvalidAction', message: 'kuikae: 1p is illegal after this call' }, /Kuikae rule/],
    ['not your turn', { code: 'NotInTurn', message: 'not your turn to act' }, /Wait for your turn/i],
    [
      'call window closed',
      { code: 'CallWindowClosed', message: 'call window closed or no call available' },
      /Call window is already closed/i,
    ],
  ])('translates the %s rejection', (_label, payload, expected) => {
    const { store, socket } = makeStore();
    socket.emit({ Error: payload });
    expect(store.toast?.text).toMatch(expected);
    // The raw server prose must not leak through as the headline.
    expect(store.toast?.text).not.toMatch(/^kuikae:/);
  });

  test('an unrecognised rejection shows the server message unchanged', () => {
    const { store, socket } = makeStore();
    socket.emit({ Error: { code: 'InvalidAction', message: 'kan not possible' } });
    expect(store.toast?.text).toBe('kan not possible');
  });

  test('a kuikae rejection carries an explanatory detail line', () => {
    const { store, socket } = makeStore();
    socket.emit({ Error: { code: 'InvalidAction', message: 'kuikae: 1p is illegal after this call' } });
    expect(store.logs.some((e) => typeof e.details === 'string' && /Kuikae prohibits/.test(e.details))).toBe(true);
  });

  test('a kuikae rejection gets the explanatory message', () => {
    const { store, socket } = makeStore();
    socket.emit({ Error: { code: 'InvalidAction', message: 'Kuikae violation' } });
    expect(store.toast?.text).toMatch(/Kuikae/i);
  });

  test('a bare string Error is still handled', () => {
    const { store, socket } = makeStore();
    socket.emit({ Error: 'something went wrong' });
    expect(store.toast?.text).toMatch(/something went wrong/);
  });

  test('an unknown message shape does not throw', () => {
    const { store, socket } = makeStore();
    expect(() => socket.emit({ Totally: 'unknown' })).not.toThrow();
    expect(() => socket.emit({})).not.toThrow();
  });
});

// ------------------------------------------------------------- reconnection

describe('reconnection', () => {
  test('losing the connection mid-game returns the player to the lobby', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted());
    expect(store.screen).toBe('game');
    socket.status('disconnected');
    expect(store.screen).toBe('lobby');
    expect(store.toast?.text).toMatch(/Connection lost/);
  });

  test('losing the connection while in the lobby does not invent a message', () => {
    const { store, socket } = makeStore();
    socket.status('disconnected');
    expect(store.screen).toBe('lobby');
    expect(store.toast?.text ?? '').not.toMatch(/Connection lost/);
  });

  test('a dropped game is fully cleared, not left stale', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted());
    socket.status('disconnected');
    expect(store.hand).toEqual([]);
    expect(store.scores).toEqual([25000, 25000, 25000, 25000]);
    expect(store.doraIndicators).toEqual([]);
    expect(store.roomCode).toBe('');
    expect(store.riichiSticks).toBe(0);
  });

  test('reconnecting normally is recorded without abandoning the session', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted());
    socket.status('disconnected');
    socket.status('connecting');
    socket.status('connected');
    expect(store.connectionStatus).toBe('connected');
  });
});

// ------------------------------------------- riichi auto-tsumogiri

const tileDrawn = (over: Record<string, any> = {}) => ({
  Event: {
    TileDrawn: {
      tile: { index: 20 },
      remaining_tiles: 60,
      can_tsumo: false,
      can_riichi: false,
      is_furiten: false,
      ...over,
    },
  },
});

describe('riichi auto-tsumogiri', () => {
  test('a dead draw in riichi is discarded without a click', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted());
    store.riichiDeclared[store.yourSeat] = true;
    socket.emit(tileDrawn());
    expect(socket.sentRaw).toEqual([{ Action: { Discard: { tile: { index: 20 } } } }]);
    expect(store.actions.can_discard).toBe(false);
    expect(store.logs.some((e) => /auto-discarded/i.test(e.message))).toBe(true);
  });

  test('a tsumo-available draw in riichi still waits for the player', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted());
    store.riichiDeclared[store.yourSeat] = true;
    socket.emit(tileDrawn({ can_tsumo: true }));
    expect(socket.sentRaw).toEqual([]);
    expect(store.actions.can_tsumo).toBe(true);
  });

  test('an ankan quartet in riichi still waits for the player', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted());
    store.riichiDeclared[store.yourSeat] = true;
    // Three 5s in hand plus a drawn 5: a possible ankan, so no fast path.
    store.hand = [{ index: 5 }, { index: 5 }, { index: 5 }, { index: 1 }, { index: 2 }] as any;
    socket.emit(tileDrawn({ tile: { index: 5 } }));
    expect(socket.sentRaw).toEqual([]);
    expect(store.actions.can_discard).toBe(true);
    expect(store.actions.can_kan).toBe(true);
  });

  test('a kakan match in riichi offers no kan and still auto-discards', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted());
    store.riichiDeclared[store.yourSeat] = true;
    // Pon of 5s plus the fourth 5 drawn: kakan, never legal in riichi.
    store.melds[store.yourSeat] = [{ callType: 'Pon', tiles: [{ index: 5 }, { index: 5 }, { index: 5 }] }] as any;
    store.hand = [{ index: 1 }, { index: 2 }] as any;
    socket.emit(tileDrawn({ tile: { index: 5 } }));
    expect(store.actions.can_kan).toBe(false);
    expect(socket.sentRaw).toEqual([{ Action: { Discard: { tile: { index: 5 } } } }]);
  });

  test('a dead draw outside riichi still waits for the player', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted());
    socket.emit(tileDrawn());
    expect(socket.sentRaw).toEqual([]);
    expect(store.actions.can_discard).toBe(true);
  });
});

// ---------------------------------------------------------------- turn clock
//
// The server sends `TurnTimer` (from the getTurnClock hook) when a human's turn
// opens. The client counts down and tsumogiris at zero — but only on its own
// turn: a call window is left alone, because auto-passing could decline a win.

describe('turn clock', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('a timer arms a countdown and auto-discards at zero', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted());
    socket.emit(tileDrawn()); // your turn: can_discard, drawn { index: 20 }
    socket.emit({ TurnTimer: { seconds: 3 } });
    expect(store.turnClockSeconds).toBe(3);
    expect(store.turnClockRemaining).toBe(3);

    vi.advanceTimersByTime(2000);
    expect(store.turnClockRemaining).toBe(1);
    expect(socket.sentRaw).toEqual([]);

    vi.advanceTimersByTime(1000);
    expect(store.turnClockRemaining).toBe(0);
    expect(socket.sentRaw).toEqual([{ Action: { Discard: { tile: { index: 20 } } } }]);
    expect(store.logs.some((e) => /turn clock expired/i.test(e.message))).toBe(true);
  });

  test('a timer during an opponent turn does not auto-discard', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted());
    socket.emit({ TurnTimer: { seconds: 2 } });
    vi.advanceTimersByTime(5000);
    expect(socket.sentRaw).toEqual([]);
  });

  test('discarding before zero cancels the countdown', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted());
    socket.emit(tileDrawn());
    socket.emit({ TurnTimer: { seconds: 5 } });
    store.discard({ index: 5 });
    expect(store.turnClockRemaining).toBe(0);
    vi.advanceTimersByTime(10000);
    expect(socket.sentRaw).toEqual([{ Action: { Discard: { tile: { index: 5 } } } }]);
  });

  test('nonsense seconds arm nothing', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted());
    socket.emit(tileDrawn());
    socket.emit({ TurnTimer: { seconds: 0 } });
    expect(store.turnClockRemaining).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(socket.sentRaw).toEqual([]);
  });
});

// ------------------------------------------------------- calls & the river
//
// `TileDiscarded` records `lastDiscarderSeat`; `PlayerCalled` unconditionally
// popped that seat's river. An ankan or kakan takes its tile from the caller's
// own hand, so the stale `lastDiscarderSeat` meant those calls deleted an
// unrelated player's most recent discard.

describe('calls and the discard river', () => {
  const discard = (player: number, index: number) => ({
    Event: { TileDiscarded: { player, tile: { index }, hand: [], is_riichi: false } },
  });

  test('a pon removes the called tile from the discarder river', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted());
    socket.emit(discard(1, 3));
    expect(store.discards[1]).toHaveLength(1);
    socket.emit({
      Event: {
        PlayerCalled: {
          player: 0,
          from_player: 1,
          call_type: 'Pon',
          called_tile: { index: 3 },
          tiles: [{ index: 3 }, { index: 3 }, { index: 3 }],
        },
      },
    });
    expect(store.discards[1]).toHaveLength(0);
  });

  test('an ankan leaves the previous discarder river intact', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted());
    socket.emit(discard(1, 3));
    expect(store.discards[1]).toHaveLength(1);
    socket.emit({
      Event: {
        PlayerCalled: {
          player: 0,
          call_type: 'Ankan',
          tiles: [{ index: 5 }, { index: 5 }, { index: 5 }, { index: 5 }],
        },
      },
    });
    expect(store.discards[1]).toHaveLength(1);
  });

  test('a kakan leaves the previous discarder river intact', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted());
    socket.emit(discard(1, 3));
    socket.emit({
      Event: {
        PlayerCalled: {
          player: 0,
          call_type: 'Kakan',
          called_tile: { index: 5 },
          tiles: [{ index: 5 }, { index: 5 }, { index: 5 }, { index: 5 }],
        },
      },
    });
    expect(store.discards[1]).toHaveLength(1);
  });
});

// --------------------------------------------------------------- GameOver

describe('GameOver', () => {
  test('records the final scores and flips the game-over flag', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted());
    socket.emit({ GameOver: { final_scores: [41000, 19000, 21000, 19000] } });
    expect(store.scores).toEqual([41000, 19000, 21000, 19000]);
    expect(store.isGameOver).toBe(true);
  });

  test('the final scores need not total 100 000', () => {
    // Leftover riichi sticks are forfeited at match end (see known-issues KI-18),
    // so the client must accept a total that is short by whole 1000s.
    const { store, socket } = makeStore();
    expect(() => socket.emit({ GameOver: { final_scores: [51000, 19000, 20000, 8000] } })).not.toThrow();
    expect(store.scores.reduce((a, b) => a + b, 0)).toBe(98000);
  });

  test('the final scores are written through unchanged', () => {
    // No redistribution, no clamping: the server is the authority.
    const { store, socket } = makeStore();
    const finals = [51000, 19000, 20000, 8000];
    socket.emit({ GameOver: { final_scores: finals } });
    expect(store.scores).toEqual(finals);
  });
});
