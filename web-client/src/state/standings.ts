// standings.ts — oka/uma placement, ported from engine/helpers.js applyOkaUma.
//
// The wire carries raw scores (GameOver.final_scores); oka/uma is display-only
// and computed locally so the client never needs a protocol change. Zero-sum,
// ties share averaged uma; the oka (+20) goes to sole first (split on ties).
// Totals are in units of 1000 relative to the 30000 start score.

export interface OkaUmaRow {
  seat: number;
  score: number;
  uma: number;
  oka: number;
  total: number;
  place: number;
}

const UMA = [20, 10, -10, -20];
const OKA = 20;
const START_SCORE = 30000;

export function applyOkaUma(scores: number[]): OkaUmaRow[] {
  const order = [0, 1, 2, 3].sort((a, b) => scores[b] - scores[a]);
  const rows: OkaUmaRow[] = [0, 1, 2, 3].map((seat) => ({
    seat,
    score: scores[seat],
    uma: 0,
    oka: 0,
    total: 0,
    place: 0,
  }));
  const bySeat = new Map(rows.map((r) => [r.seat, r]));
  let rank = 0;
  let i = 0;
  while (i < 4) {
    let j = i;
    while (j + 1 < 4 && scores[order[j + 1]] === scores[order[i]]) j++;
    const group = order.slice(i, j + 1);
    const avgUma = group.reduce((s, _seat, k) => s + UMA[rank + k], 0) / group.length;
    for (const seat of group) {
      const row = bySeat.get(seat)!;
      row.uma = avgUma;
      row.place = rank + 1;
      if (rank === 0) row.oka = OKA / group.length;
      row.total = (scores[seat] - START_SCORE) / 1000 + row.uma + row.oka;
    }
    rank += group.length;
    i = j + 1;
  }
  return rows.sort((a, b) => b.total - a.total || a.seat - b.seat);
}
