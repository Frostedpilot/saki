export interface ProtocolTile {
  index: number;
  red_dora?: boolean;
}

export type TileFace =
  | '1m' | '2m' | '3m' | '4m' | '5m' | '0m' | '6m' | '7m' | '8m' | '9m'
  | '1p' | '2p' | '3p' | '4p' | '5p' | '0p' | '6p' | '7p' | '8p' | '9p'
  | '1s' | '2s' | '3s' | '4s' | '5s' | '0s' | '6s' | '7s' | '8s' | '9s'
  | '1z' | '2z' | '3z' | '4z' | '5z' | '6z' | '7z';

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
      banned.push(suitBase + (nums[0]));
    }
  }
  return banned;
}
