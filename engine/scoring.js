// scoring.js — wrapper around riichi / agari libraries (Spec §7, Phase 3).
// Pure rules: yaku/han/fu validation. No supernatural logic here.
const Riichi = require('riichi');
const { toHandStr, norm } = require('./tiles');

function meldStr(m) {
  return toHandStr(m.tiles);
}

// ctx: {dora[], bakaze, jikaze, riichi, doubleRiichi, ippatsu, kanFlag(k), lastFlag(h), tenhou(t)}
function scoreHand(closed, melds, winTile, isTsumo, ctx) {
  let str = toHandStr(closed);
  for (const m of melds) str += '+' + meldStr(m);
  if (!isTsumo) str += '+' + norm(winTile);
  if (ctx.dora && ctx.dora.length) str += '+d' + ctx.dora.map(norm).join('');
  let ex = '';
  if (ctx.tenhou) ex += 't';
  ex += ctx.doubleRiichi ? 'w' : ctx.riichi ? 'r' : '';
  if (ctx.ippatsu) ex += 'i';
  if (ctx.kanFlag) ex += 'k';
  if (ctx.lastFlag) ex += 'h';
  ex += `${ctx.bakaze}${ctx.jikaze}`;
  str += '+' + ex;
  const inst = new Riichi(str);
  inst.disableHairi();
  return inst.calc();
}

module.exports = { scoreHand, meldStr };
