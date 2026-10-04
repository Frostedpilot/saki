// tile-utils.test.ts — the client's pure tile logic.
//
// This is the highest-value target on the client: these functions translate
// between the wire's numeric `index` and the face strings the renderer uses, sort
// hands, compute kuikae bans, and wrap the `syanten` package. Every one of them
// had zero tests, so an off-by-one in `tileToFace` would render the whole board
// wrong and nothing would fail.
//
// No DOM needed here — see svg-tiles.test.ts for the rendering layer.

import { describe, test, expect } from 'vitest';
import {
  tileToFace, faceToTile, sortTiles, areTilesEqual, isSameSuit, tileNumber,
  getKuikaeBannedIndices, normFace, getDoraFromIndicator, DORA_NEXT,
  tilesToCounts, shantenOfTiles, hairiOfTiles,
} from './tile-utils';

// The engine's KINDS order, which the protocol index encodes:
//   0-8   1m..9m
//   9-17  1p..9p
//   18-26 1s..9s
//   27-33 1z..7z
const ALL_FACES = [
  '1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m',
  '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p',
  '1s', '2s', '3s', '4s', '5s', '6s', '7s', '8s', '9s',
  '1z', '2z', '3z', '4z', '5z', '6z', '7z',
];

describe('tileToFace', () => {
  test('maps every wire index to its face', () => {
    for (let i = 0; i < 34; i++) {
      expect(tileToFace({ index: i })).toBe(ALL_FACES[i]);
    }
  });

  test('a red_dora flag on the 5 of any suit becomes the aka face', () => {
    expect(tileToFace({ index: 4, red_dora: true })).toBe('0m');
    expect(tileToFace({ index: 13, red_dora: true })).toBe('0p');
    expect(tileToFace({ index: 22, red_dora: true })).toBe('0s');
  });

  test('red_dora on any other tile is ignored', () => {
    // The engine only ever marks a 5 red; anything else must not shift the face.
    for (const i of [0, 3, 8, 9, 12, 18, 26, 27, 33]) {
      expect(tileToFace({ index: i, red_dora: true })).toBe(ALL_FACES[i]);
    }
  });

  test('honours are never red', () => {
    expect(tileToFace({ index: 31, red_dora: true })).toBe('5z');
  });
});

describe('faceToTile', () => {
  test('round-trips every plain face back to its wire index', () => {
    for (let i = 0; i < 34; i++) {
      expect(faceToTile(ALL_FACES[i])).toEqual({ index: i, red_dora: false });
    }
  });

  test('the aka faces share an index with the plain 5 but carry the flag', () => {
    expect(faceToTile('0m')).toEqual({ index: 4, red_dora: true });
    expect(faceToTile('0p')).toEqual({ index: 13, red_dora: true });
    expect(faceToTile('0s')).toEqual({ index: 22, red_dora: true });
  });

  test('round-trips red faces back through tileToFace', () => {
    for (const face of ['0m', '0p', '0s']) {
      expect(tileToFace(faceToTile(face))).toBe(face);
    }
  });
});

describe('sortTiles', () => {
  test('orders by wire index, which is suit then number', () => {
    const shuffled = [
      { index: 33 }, { index: 0 }, { index: 18 }, { index: 9 }, { index: 4 },
    ];
    expect(sortTiles(shuffled).map((t) => t.index)).toEqual([0, 4, 9, 18, 33]);
  });

  test('sorts the plain 5 before the red 5 at the same index', () => {
    const pair = [{ index: 4, red_dora: true }, { index: 4 }];
    expect(sortTiles(pair).map((t) => Boolean(t.red_dora))).toEqual([false, true]);
  });

  test('does not mutate its input', () => {
    const input = [{ index: 9 }, { index: 0 }];
    sortTiles(input);
    expect(input.map((t) => t.index)).toEqual([9, 0]);
  });
});

describe('areTilesEqual', () => {
  test('distinguishes a red 5 from a plain 5', () => {
    expect(areTilesEqual({ index: 4 }, { index: 4, red_dora: true })).toBe(false);
    expect(areTilesEqual({ index: 4, red_dora: true }, { index: 4, red_dora: true })).toBe(true);
  });

  test('treats an absent flag as false', () => {
    expect(areTilesEqual({ index: 0 }, { index: 0, red_dora: false })).toBe(true);
  });
});

describe('isSameSuit', () => {
  test('is true within a suit and false across suits', () => {
    expect(isSameSuit({ index: 0 }, { index: 8 })).toBe(true);   // 1m, 9m
    expect(isSameSuit({ index: 8 }, { index: 9 })).toBe(false);  // 9m, 1p
    expect(isSameSuit({ index: 20 }, { index: 22 })).toBe(true); // 3s, 5s
  });

  test('honours are never the same suit as anything', () => {
    expect(isSameSuit({ index: 27 }, { index: 28 })).toBe(false);
    expect(isSameSuit({ index: 26 }, { index: 27 })).toBe(false);
    expect(isSameSuit({ index: 27 }, { index: 27 })).toBe(false);
  });
});

describe('tileNumber', () => {
  test('is 1-based within the suit for all 34 tiles', () => {
    expect(ALL_FACES.map((_, i) => tileNumber({ index: i })))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('normFace', () => {
  test('rewrites an aka face to its plain 5 for dora purposes', () => {
    expect(normFace('0m')).toBe('5m');
    expect(normFace('5m')).toBe('5m');
    expect(normFace('0z' as never)).toBe('5z');
  });
});

describe('getDoraFromIndicator', () => {
  test('follows the indicator round the suit, wrapping 9 to 1', () => {
    expect(getDoraFromIndicator({ index: 0 })).toBe('2m');   // 1m -> 2m
    expect(getDoraFromIndicator({ index: 7 })).toBe('9m');   // 8m -> 9m
    expect(getDoraFromIndicator({ index: 8 })).toBe('1m');   // 9m -> 1m
    expect(getDoraFromIndicator({ index: 17 })).toBe('1p');  // 9p -> 1p
    expect(getDoraFromIndicator({ index: 26 })).toBe('1s');  // 9s -> 1s
  });

  test('cycles the four winds separately from the three dragons', () => {
    // Matches engine/tiles.js `DORA_NEXT`, which is the authority: winds cycle
    // 1z->2z->3z->4z->1z and dragons cycle 5z->6z->7z->5z. Note that 4z therefore
    // points at 1z, not at 5z — the winds are their own cycle.
    expect(getDoraFromIndicator({ index: 27 })).toBe('2z');  // 1z East -> South
    expect(getDoraFromIndicator({ index: 29 })).toBe('4z');  // 3z West -> North
    expect(getDoraFromIndicator({ index: 30 })).toBe('1z');  // 4z North -> East (wraps)
    expect(getDoraFromIndicator({ index: 31 })).toBe('6z');  // 5z White -> Green
    expect(getDoraFromIndicator({ index: 32 })).toBe('7z');  // 6z Green -> Red
    expect(getDoraFromIndicator({ index: 33 })).toBe('5z');  // 7z Red -> White (wraps)
  });

  test('a red 5 indicator still counts as a 5', () => {
    expect(getDoraFromIndicator({ index: 4, red_dora: true })).toBe('6m');
  });

  test('accepts a face string as well as a tile', () => {
    expect(getDoraFromIndicator('1m')).toBe('2m');
    expect(getDoraFromIndicator('0p')).toBe('6p');
  });

  test('every indicator maps to a dora, and it is never itself', () => {
    for (let i = 0; i < 34; i++) {
      const dora = getDoraFromIndicator({ index: i });
      expect(ALL_FACES).toContain(dora);
      expect(dora).not.toBe(normFace(ALL_FACES[i]));
    }
    expect(Object.keys(DORA_NEXT).sort()).toEqual([...ALL_FACES].sort());
  });
});

describe('getKuikaeBannedIndices', () => {
  // On a chi, `handTiles` is the pre-call hand, so the two tiles that formed the
  // run are still present. Only the *other* end of the run becomes forbidden — the
  // melded tiles themselves are already out of hand.
  const called = { index: 9 }; // 1p

  test('always bans discarding the tile just called', () => {
    expect(getKuikaeBannedIndices(called, [{ index: 0 }, { index: 8 }])).toContain(9);
  });

  test('bans the same tile even with no other context', () => {
    expect(getKuikaeBannedIndices(called, [])).toEqual([9]);
  });

  test('after pon, bans the called tile only — a triplet has no sequence ends', () => {
    expect(getKuikaeBannedIndices(called, [{ index: 9 }, { index: 9 }, { index: 9 }]))
      .toEqual([9]);
  });

  test('after chi on 4p5p, bans 3p and 6p', () => {
    expect(getKuikaeBannedIndices({ index: 13 }, [{ index: 12 }, { index: 13 }]).sort((a, b) => a - b))
      .toEqual([11, 13, 14]);   // 3p, the called 5p, 6p
  });

  test('after chi on 1p2p, only the 3p end is banned (no 0p exists)', () => {
    expect(getKuikaeBannedIndices({ index: 9 }, [{ index: 9 }, { index: 10 }]).sort((a, b) => a - b))
      .toEqual([9, 11]);
  });

  test('after chi on 8p9p, only the 7p end is banned (no 10p exists)', () => {
    expect(getKuikaeBannedIndices({ index: 17 }, [{ index: 16 }, { index: 17 }]).sort((a, b) => a - b))
      .toEqual([15, 17]);
  });

  test('after chi on 3p4p, both ends are banned', () => {
    expect(getKuikaeBannedIndices({ index: 11 }, [{ index: 11 }, { index: 12 }]).sort((a, b) => a - b))
      .toEqual([10, 11, 13]);   // 2p, the called 3p, 5p
  });

  test('a non-adjacent hand is only itself', () => {
    expect(getKuikaeBannedIndices(called, [{ index: 0 }, { index: 8 }])).toEqual([9]);
  });

  test('never returns an out-of-range index', () => {
    // Duplicates ARE possible — calling chi on 1m with 2m3m in hand makes the called
    // tile its own ban — and that is harmless, because the only consumer is
    // `kuikaeBannedIndices.includes(...)` in store.ts. Noted so a refactor does not
    // come to rely on the list being unique.
    for (let c = 0; c < 34; c++) {
      for (const hand of [[{ index: 0 }, { index: 1 }], [{ index: 27 }, { index: 30 }]]) {
        for (const b of getKuikaeBannedIndices({ index: c }, hand)) {
          expect(b).toBeGreaterThanOrEqual(0);
          expect(b).toBeLessThanOrEqual(33);
        }
      }
    }
  });
});

describe('tilesToCounts', () => {
  test('builds a 4-row matrix of 9/9/9/7', () => {
    const counts = tilesToCounts([]);
    expect(counts.map((r) => r.length)).toEqual([9, 9, 9, 7]);
    expect(counts.flat().every((n) => n === 0)).toBe(true);
  });

  test('places each tile in the right row and column', () => {
    const counts = tilesToCounts([{ index: 0 }, { index: 4 }, { index: 9 }, { index: 22 }, { index: 27 }]);
    expect(counts[0][0]).toBe(1);  // 1m
    expect(counts[0][4]).toBe(1);  // 5m
    expect(counts[1][0]).toBe(1);  // 1p
    expect(counts[2][4]).toBe(1);  // 5s
    expect(counts[3][0]).toBe(1);  // 1z
  });

  test('counts duplicates', () => {
    const counts = tilesToCounts([{ index: 4 }, { index: 4 }, { index: 4 }]);
    expect(counts[0][4]).toBe(3);
  });

  test('a red 5 lands on the same column as a plain 5', () => {
    const counts = tilesToCounts([{ index: 4 }, { index: 4, red_dora: true }]);
    expect(counts[0][4]).toBe(2);
  });
});

describe('shantenOfTiles / hairiOfTiles', () => {
  // Expected values verified against engine/helpers.js `shantenOf` on the same
  // hands — the client and the engine agreed on all of them, which is the point:
  // a divergence here would show the board drawing shanten the server disagrees
  // with.
  const complete14 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 31, 31]; // 123m456m789m123p 55z
  const tenpai13 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 31];    // same, waiting 3p
  const chiitoi13 = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
  const junk13 = [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 30, 5, 9];
  const T = (idx: number[]) => idx.map((index) => ({ index }));

  test('a complete 14-tile hand is at shanten -1', () => {
    expect(shantenOfTiles(T(complete14))).toBe(-1);
    expect(hairiOfTiles(T(complete14)).now).toBe(-1);
  });

  test('a tenpai 13-tile hand is at shanten 0', () => {
    expect(shantenOfTiles(T(tenpai13))).toBe(0);
    expect(hairiOfTiles(T(tenpai13)).now).toBe(0);
  });

  test('thirteen distinct pairs is tenpai, not a complete hand', () => {
    expect(shantenOfTiles(T(chiitoi13))).toBe(0);
  });

  test('a junk hand reports a high shanten rather than throwing', () => {
    expect(shantenOfTiles(T(junk13))).toBe(6);
  });

  test('an empty hand reports -2, matching the engine', () => {
    // The `syanten` package returns -2 for an all-zero matrix, which reads like a
    // complete hand but is meaningless here. Verified that engine/helpers.js
    // `shantenOf([])` returns -2 as well, so this is shared behaviour rather than a
    // client bug — "fixing" it here would *create* a KI-04 divergence. Pinned so that
    // is a deliberate decision.
    //
    // Not reachable in practice: the only caller is the riichi-candidate check in
    // store.ts, which always passes a real hand.
    expect(shantenOfTiles([])).toBe(-2);
    expect(hairiOfTiles([]).now).toBe(-2);
  });

  test('shanten never improves when a tile is removed from a complete hand', () => {
    // Guards against a transposed count matrix: dropping the winning tile should
    // always leave the hand tenpai.
    for (let i = 0; i < complete14.length; i++) {
      const without = complete14.filter((_, k) => k !== i);
      expect(shantenOfTiles(T(without))).toBe(0);
    }
  });
});