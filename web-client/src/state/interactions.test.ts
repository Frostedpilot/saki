// interactions.test.ts — replaying the server's call/kan event sequences through
// the client reducer.
//
// The kan bug was not a missing rule on either side: the server removed the four
// tiles correctly, but the client was never told, so its hand still contained
// them when the rinshan draw arrived. The next discard/riichi then referenced
// tiles the server no longer had. These tests pin the sequences rather than
// individual events, because that is where the state drifted.
//
// Tile indices follow the protocol: 0-8 = 1m-9m, 9-17 = 1p-9p, 18-26 = 1s-9s,
// 27-33 = East, South, West, North, Haku, Hatsu, Chun.

import { describe, test, expect } from 'vitest';
import { makeStore } from './test-harness';

const t = (index: number) => ({ index });
const indices = (tiles: Array<{ index: number }>) => tiles.map((x) => x.index).sort((a, b) => a - b);

const event = (name: string, payload: any) => ({ Event: { [name]: payload } });

const gameStarted = (hand: number[], over: Record<string, any> = {}) =>
  event('GameStarted', {
    seat_wind: 'East',
    hand: hand.map(t),
    scores: [25000, 25000, 25000, 25000],
    round_wind: 'East',
    dora_indicators: [t(8)],
    round_number: 1,
    total_rounds: 4,
    honba: 0,
    riichi_sticks: 0,
    three_player: false,
    nuki_dora: false,
    ...over,
  });

const tileDrawn = (index: number, over: Record<string, any> = {}) =>
  event('TileDrawn', {
    tile: t(index),
    remaining_tiles: 60,
    can_tsumo: false,
    can_riichi: false,
    is_furiten: false,
    ...over,
  });

const discarded = (player: string, index: number, over: Record<string, any> = {}) =>
  event('TileDiscarded', {
    player,
    tile: t(index),
    hand: [],
    is_riichi: false,
    ...over,
  });

const called = (
  player: string,
  callType: string,
  tiles: number[],
  calledTile: number | undefined,
  fromPlayer?: string
) =>
  event('PlayerCalled', {
    player,
    call_type: callType,
    called_tile: calledTile === undefined ? undefined : t(calledTile),
    tiles: tiles.map(t),
    from_player: fromPlayer,
  });

const handUpdated = (tiles: number[]) => event('HandUpdated', { hand: tiles.map(t) });

// A 13-tile hand with four 1m and no other repeats.
const ANKAN_HAND = [0, 0, 0, 0, 9, 10, 11, 12, 13, 14, 15, 16, 17];
const AFTER_ANKAN = [9, 10, 11, 12, 13, 14, 15, 16, 17];

// 13 tiles with a pair of 3m (index 2) and no other 2.
const PON_HAND = [2, 2, 9, 10, 11, 12, 13, 14, 15, 16, 17, 27, 28];

describe('an ankan sequence', () => {
  test('drops the four kan tiles and installs the rinshan draw', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted(ANKAN_HAND));
    socket.emit(tileDrawn(31, { can_riichi: true }));
    expect(store.actions.can_riichi).toBe(true);

    socket.emit(called('East', 'Ankan', [0, 0, 0, 0], 0));
    expect(store.melds[0]).toHaveLength(1);
    expect(store.melds[0][0].callType).toBe('Ankan');
    expect(store.melds[0][0].tiles).toHaveLength(4);

    // The server's authoritative hand: the pre-kan draw (5z) stays in hand.
    socket.emit(handUpdated([...AFTER_ANKAN, 31]));
    expect(store.hand).toHaveLength(10);
    expect(indices(store.hand)).toEqual(indices([...AFTER_ANKAN, 31].map(t)));
    expect(store.hand.some((x) => x.index === 0)).toBe(false);
    expect(store.drawnTile).toBeNull();
    expect(store.actions.can_discard).toBe(true);

    socket.emit(tileDrawn(32));
    expect(store.drawnTile).toEqual(t(32));
    expect(store.hand).toHaveLength(10);
    // 10 concealed + a four-tile meld is 14 physical tiles, as it must be.
    expect(store.hand.length + store.melds[0][0].tiles.length).toBe(14);
  });

  test('in riichi the rinshan tile is the only discard, never a kan tile', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted(ANKAN_HAND));
    socket.emit(event('PlayerRiichi', { player: 'East', scores: [24000, 25000, 25000, 26000], riichi_sticks: 1 }));
    expect(store.riichiDeclared[0]).toBe(true);

    socket.emit(called('East', 'Ankan', [0, 0, 0, 0], 0));
    socket.emit(handUpdated([...AFTER_ANKAN, 31]));
    socket.emit(tileDrawn(32));

    // The reducer auto-tsumogiris in riichi once the kan is no longer pending.
    expect(socket.sentRaw).toEqual([{ Action: { Discard: { tile: t(32) } } }]);

    // Finish the discard the way the server would echo it.
    socket.emit(discarded('East', 32));
    expect(store.hand).toHaveLength(10);
    expect(store.hand.some((x) => x.index === 0)).toBe(false);
    expect(store.drawnTile).toBeNull();
    expect(store.discards[0]).toHaveLength(1);
    expect(store.discards[0][0].tile).toEqual(t(32));
    expect(store.riichiDeclared[0]).toBe(true);
  });

  test('riichi is not offered again on a later draw', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted(ANKAN_HAND));
    socket.emit(event('PlayerRiichi', { player: 'East', scores: [24000, 25000, 25000, 26000], riichi_sticks: 1 }));
    socket.emit(tileDrawn(31, { can_riichi: true }));
    expect(store.actions.can_riichi).toBe(false);
  });
});

describe('a kakan sequence', () => {
  test('upgrades the pon in place and removes exactly one hand tile', () => {
    const { store, socket } = makeStore();
    // After the pon, the meld holds three 3m and the hand holds the fourth copy.
    socket.emit(gameStarted([2, ...PON_HAND.slice(2)]));
    store.melds[0] = [{ callType: 'Pon', calledTile: t(2), tiles: [t(2), t(2), t(2)], calledIndex: 0 }];

    socket.emit(tileDrawn(2));
    expect(store.actions.can_kan).toBe(true);
    expect(store.pendingKanIndex).toBe(2);

    socket.emit(called('East', 'Kakan', [2, 2, 2, 2], 2));
    expect(store.melds[0]).toHaveLength(1);
    expect(store.melds[0][0].callType).toBe('Kakan');
    expect(store.melds[0][0].tiles).toHaveLength(4);

    const remaining = PON_HAND.slice(2);
    socket.emit(handUpdated(remaining));
    expect(indices(store.hand)).toEqual(indices(remaining.map(t)));
    expect(store.hand.some((x) => x.index === 2)).toBe(false);
    expect(store.melds[0][0].tiles).toHaveLength(4);
  });

  test('callKan sends the fourth-tile index, not a hard-coded zero', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted(PON_HAND.slice(2)));
    store.melds[0] = [{ callType: 'Pon', calledTile: t(2), tiles: [t(2), t(2), t(2)], calledIndex: 0 }];
    socket.emit(tileDrawn(2));

    store.callKan();
    expect(socket.sentRaw).toEqual([{ Action: { Kan: { tile_index: 2 } } }]);
  });
});

describe('a daiminkan sequence', () => {
  test('consumes the discard, opens four tiles, then draws from the dead wall', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted([9, 10, 11, 12, 13, 14, 15, 16, 17, 27, 28, 29, 30]));
    socket.emit(discarded('North', 2));
    expect(store.discards[3]).toHaveLength(1);

    socket.emit(called('East', 'Daiminkan', [2, 2, 2, 2], 2, 'North'));
    expect(store.discards[3]).toHaveLength(0);
    expect(store.melds[0]).toHaveLength(1);
    expect(store.melds[0][0].callType).toBe('Daiminkan');
    expect(store.melds[0][0].tiles).toHaveLength(4);

    socket.emit(handUpdated([9, 10, 11, 12, 13, 14, 15, 16, 17, 27]));
    expect(store.hand).toHaveLength(10);
    expect(store.hand.some((x) => x.index === 2)).toBe(false);
    expect(store.drawnTile).toBeNull();

    socket.emit(tileDrawn(31));
    expect(store.drawnTile).toEqual(t(31));
    expect(store.hand.length + 1 + store.melds[0][0].tiles.length).toBe(15);
  });

  test('never appears as a second meld beside the consumed pon tiles', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted([9, 10, 11, 12, 13, 14, 15, 16, 17, 27, 28, 29, 30]));
    socket.emit(called('East', 'Daiminkan', [2, 2, 2, 2], 2, 'North'));
    expect(store.melds[0].filter((m) => m.tiles.length === 4)).toHaveLength(1);
    expect(store.melds[0]).toHaveLength(1);
  });
});

describe('pon and chi update the river and the hand count', () => {
  test('a pon removes the called discard and decrements the caller count', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted([0, 1, 3, 9, 10, 11, 12, 13, 14, 15, 16, 17, 27]));
    socket.emit(discarded('North', 2));
    expect(store.opponentTileCounts[3]).toBe(12);

    socket.emit(called('South', 'Pon', [2, 2, 2], 2, 'North'));
    expect(store.discards[3]).toHaveLength(0);
    expect(store.melds[1]).toHaveLength(1);
    expect(store.melds[1][0].callType).toBe('Pon');
    expect(store.melds[1][0].tiles).toHaveLength(3);
    expect(store.melds[1][0].fromSeat).toBe(3);
    expect(store.opponentTileCounts[1]).toBe(11);
  });

  test('a chi by the local player bans kuikae on the called tile', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted([9, 10, 11, 12, 13, 14, 15, 16, 17, 27, 28, 29, 30]));
    socket.emit(discarded('North', 3));
    socket.emit(called('East', 'Chi', [2, 3, 4], 3, 'North'));

    expect(store.discards[3]).toHaveLength(0);
    expect(store.melds[0]).toHaveLength(1);
    expect(store.melds[0][0].callType).toBe('Chi');
    expect(store.melds[0][0].tiles).toHaveLength(3);
    expect(store.kuikaeBannedIndices).toContain(3);

    socket.emit(handUpdated([9, 10, 11, 12, 13, 14, 15, 16, 17, 27, 28]));
    expect(store.hand).toHaveLength(11);
    expect(store.hand.some((x) => x.index === 3)).toBe(false);
  });
});

describe('HandUpdated is authoritative', () => {
  test('replaces rather than appends, even with a different hand size', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted(ANKAN_HAND));
    socket.emit(tileDrawn(31));
    expect(store.drawnTile).toEqual(t(31));

    socket.emit(handUpdated([9, 10, 11, 12, 13]));
    expect(indices(store.hand)).toEqual([9, 10, 11, 12, 13]);
    expect(store.drawnTile).toBeNull();
    expect(store.actions.can_discard).toBe(true);
  });

  test('no physical tile appears twice across hand and melds after a call', () => {
    const { store, socket } = makeStore();
    socket.emit(gameStarted(ANKAN_HAND));
    socket.emit(called('East', 'Ankan', [0, 0, 0, 0], 0));
    socket.emit(handUpdated([...AFTER_ANKAN, 31]));

    const seen = new Map<number, number>();
    for (const tile of store.hand) seen.set(tile.index, (seen.get(tile.index) || 0) + 1);
    for (const meld of store.melds.flat()) {
      for (const tile of meld.tiles) seen.set(tile.index, (seen.get(tile.index) || 0) + 1);
    }
    for (const [index, count] of seen) {
      expect(count, `tile ${index} appears at most four times`).toBeLessThanOrEqual(4);
    }
    // The four 1m are all accounted for by the ankan meld, none in hand.
    expect(seen.get(0)).toBe(4);
    expect(store.hand.some((x) => x.index === 0)).toBe(false);
  });
});
