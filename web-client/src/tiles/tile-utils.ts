export interface ProtocolTile {
  index: number;
  red_dora?: boolean;
}

export type TileFace =
  | '1m'
  | '2m'
  | '3m'
  | '4m'
  | '5m'
  | '0m'
  | '6m'
  | '7m'
  | '8m'
  | '9m'
  | '1p'
  | '2p'
  | '3p'
  | '4p'
  | '5p'
  | '0p'
  | '6p'
  | '7p'
  | '8p'
  | '9p'
  | '1s'
  | '2s'
  | '3s'
  | '4s'
  | '5s'
  | '0s'
  | '6s'
  | '7s'
  | '8s'
  | '9s'
  | '1z'
  | '2z'
  | '3z'
  | '4z'
  | '5z'
  | '6z'
  | '7z';

export function tileToFace(tile: ProtocolTile): TileFace {
  const { index, red_dora } = tile;
  if (index >= 27) {
    return `${index - 27 + 1}z` as TileFace;
  }
  if (index < 9) {
    if (red_dora && index === 4) return '0m';
    return `${index + 1}m` as TileFace;
  }
  if (index < 18) {
    const n = index - 9 + 1;
    if (red_dora && n === 5) return '0p';
    return `${n}p` as TileFace;
  }
  const n = index - 18 + 1;
  if (red_dora && n === 5) return '0s';
  return `${n}s` as TileFace;
}

export function faceToTile(face: TileFace | string): ProtocolTile {
  const red = face[0] === '0';
  const num = parseInt(face[0], 10);
  const suit = face[1];
  if (suit === 'z') {
    return { index: 27 + (num - 1), red_dora: false };
  }
  const suitOffset = suit === 'm' ? 0 : suit === 'p' ? 9 : 18;
  const n = red ? 5 : num;
  return {
    index: suitOffset + (n - 1),
    red_dora: red,
  };
}

export function sortTiles(tiles: ProtocolTile[]): ProtocolTile[] {
  return [...tiles].sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index;
    return (a.red_dora ? 1 : 0) - (b.red_dora ? 1 : 0);
  });
}

export function areTilesEqual(a: ProtocolTile, b: ProtocolTile): boolean {
  return a.index === b.index && Boolean(a.red_dora) === Boolean(b.red_dora);
}

export function isSameSuit(a: ProtocolTile, b: ProtocolTile): boolean {
  if (a.index >= 27 || b.index >= 27) return false;
  return Math.floor(a.index / 9) === Math.floor(b.index / 9);
}

export function tileNumber(tile: ProtocolTile): number {
  if (tile.index >= 27) return tile.index - 27 + 1;
  return (tile.index % 9) + 1;
}

export function getKuikaeBannedIndices(calledTile: ProtocolTile, handTiles: ProtocolTile[]): number[] {
  const banned: number[] = [calledTile.index];
  if (handTiles.length === 2 && isSameSuit(handTiles[0], handTiles[1])) {
    const suitBase = Math.floor(handTiles[0].index / 9) * 9;
    const n1 = tileNumber(handTiles[0]);
    const n2 = tileNumber(handTiles[1]);
    const nums = [n1, n2].sort((x, y) => x - y);
    const d = nums[1] - nums[0];
    if (d === 1) {
      if (nums[0] > 1) banned.push(suitBase + (nums[0] - 2));
      if (nums[1] < 9) banned.push(suitBase + nums[1]);
    } else if (d === 2) {
      banned.push(suitBase + nums[0]);
    }
  }
  return banned;
}

export function normFace(face: TileFace | string): string {
  return face.replace(/^0/, '5');
}

export const DORA_NEXT: Record<string, string> = {
  '1m': '2m',
  '2m': '3m',
  '3m': '4m',
  '4m': '5m',
  '5m': '6m',
  '6m': '7m',
  '7m': '8m',
  '8m': '9m',
  '9m': '1m',
  '1p': '2p',
  '2p': '3p',
  '3p': '4p',
  '4p': '5p',
  '5p': '6p',
  '6p': '7p',
  '7p': '8p',
  '8p': '9p',
  '9p': '1p',
  '1s': '2s',
  '2s': '3s',
  '3s': '4s',
  '4s': '5s',
  '5s': '6s',
  '6s': '7s',
  '7s': '8s',
  '8s': '9s',
  '9s': '1s',
  '1z': '2z',
  '2z': '3z',
  '3z': '4z',
  '4z': '1z',
  '5z': '6z',
  '6z': '7z',
  '7z': '5z',
};

export function getDoraFromIndicator(indicator: ProtocolTile | TileFace): string {
  const face = typeof indicator === 'string' ? indicator : tileToFace(indicator);
  const normalized = normFace(face);
  return DORA_NEXT[normalized] || normalized;
}

// Convert ProtocolTiles into syanten 4-row matrix
import syanten from 'syanten';

export function tilesToCounts(tiles: ProtocolTile[]): syanten.HaiArr {
  const counts: any = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0],
  ];
  for (const t of tiles) {
    if (t.index >= 27) {
      const zIdx = t.index - 27;
      if (zIdx >= 0 && zIdx < 7) counts[3][zIdx]++;
    } else {
      const suit = Math.floor(t.index / 9);
      const num = t.index % 9;
      if (suit >= 0 && suit < 3 && num >= 0 && num < 9) {
        counts[suit][num]++;
      }
    }
  }
  return counts as syanten.HaiArr;
}

export function shantenOfTiles(tiles: ProtocolTile[]): number {
  try {
    return syanten(tilesToCounts(tiles));
  } catch {
    return 99;
  }
}

export function hairiOfTiles(tiles: ProtocolTile[]): { now: number; wait?: Record<string, number> } {
  try {
    return syanten.hairi(tilesToCounts(tiles)) || { now: 99 };
  } catch {
    return { now: 99 };
  }
}
