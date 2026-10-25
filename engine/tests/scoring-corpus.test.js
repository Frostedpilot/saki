// scoring-corpus.test.js — table-driven yaku/fu corpus (Fix plan Phase 3).
//
// rules.test.js has the narrative cases (one bug/edge per test). This file is the
// exhaustive half: one fixture per standard yaku plus the fu boundaries that the
// narrative cases do not reach, all scored through the pinned `riichi` 1.2.0.
// Expected han/ten come from standard riichi scoring, not from the library, so a
// change in the wrapper or a version bump shows up as a failure here.
//
// Round/seat winds are South by default so a stray East triplet cannot add an
// incidental yakuhai; cases that need a wind pass it explicitly.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { scoreHand } = require('../scoring');

const ctx = (over = {}) => ({
  dora: [],
  bakaze: 2,
  jikaze: 2,
  riichi: false,
  doubleRiichi: false,
  ippatsu: false,
  kanFlag: false,
  lastFlag: false,
  tenhou: false,
  ...over,
});

// Ron hands hold 13 tiles (scoreHand appends the winning tile); tsumo hands hold
// 14, including the winning tile. `melds` are physical melds (a kan is 4 tiles).
const CASES = [
  {
    name: 'iipeikou: two identical sequences, closed',
    hand: ['1m', '1m', '2m', '2m', '3m', '3m', '5p', '6p', '7s', '8s', '9s', '5z', '5z'],
    win: '4p',
    yaku: ['一盃口'],
    han: 1,
    fu: 40,
    ten: 1300,
  },
  {
    name: 'ryanpeikou: two pairs of identical sequences',
    hand: ['1m', '1m', '2m', '2m', '3m', '3m', '4p', '4p', '5p', '5p', '6p', '6p', '5s'],
    win: '5s',
    yaku: ['二盃口'],
    han: 3,
    fu: 40,
    ten: 5200,
  },
  {
    name: 'sanshoku doujun: same sequence in all three suits, plus pinfu',
    hand: ['1m', '2m', '3m', '4m', '5m', '1p', '2p', '3p', '1s', '2s', '3s', '9p', '9p'],
    win: '6m',
    yaku: ['三色同順', '平和'],
    han: 3,
    fu: 30,
    ten: 3900,
  },
  {
    name: 'sanshoku doukou: same triplet in all three suits, plus sanankou',
    hand: ['1m', '1m', '1m', '2m', '3m', '1p', '1p', '1p', '1s', '1s', '1s', '9p', '9p'],
    win: '4m',
    yaku: ['三色同刻', '三暗刻'],
    han: 4,
    fu: 60,
    ten: 8000,
  },
  {
    name: 'ittsu: 1-9 in one suit, closed',
    hand: ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '1p', '2p', '9s', '9s'],
    win: '3p',
    yaku: ['一気通貫'],
    han: 2,
    fu: 30,
    ten: 2000,
  },
  {
    name: 'chanta: every set and the pair contains a terminal or honour',
    hand: ['1m', '2m', '3m', '7p', '8p', '9p', '1s', '2s', '1z', '1z', '1z', '9m', '9m'],
    win: '3s',
    yaku: ['混全帯么九'],
    han: 2,
    fu: 40,
    ten: 2600,
  },
  {
    name: 'junchan: every set and the pair contains a terminal',
    hand: ['1m', '2m', '3m', '7m', '8m', '9m', '1p', '2p', '7s', '8s', '9s', '9s', '9s'],
    win: '3p',
    yaku: ['純全帯么九'],
    han: 3,
    fu: 30,
    ten: 3900,
  },
  {
    name: 'honroutou + toitoi: all terminals/honours, open triplets',
    hand: ['9p', '9p', '9p', '1z'],
    melds: [
      { tiles: ['1m', '1m', '1m'], open: true, type: 'pon' },
      { tiles: ['9m', '9m', '9m'], open: true, type: 'pon' },
      { tiles: ['1p', '1p', '1p'], open: true, type: 'pon' },
    ],
    win: '1z',
    yaku: ['混老頭', '対々和'],
    han: 4,
    fu: 50,
    ten: 8000,
  },
  {
    name: 'sanankou: three concealed triplets',
    hand: ['1m', '1m', '1m', '2p', '2p', '2p', '3s', '3s', '3s', '4m', '5m', '9s', '9s'],
    win: '6m',
    yaku: ['三暗刻'],
    han: 2,
    fu: 50,
    ten: 3200,
  },
  {
    name: 'sankantsu: three kans in one hand',
    hand: ['4m', '5m', '9m', '9m'],
    melds: [
      { tiles: ['1m', '1m', '1m', '1m'], open: true, type: 'kan' },
      { tiles: ['2p', '2p', '2p', '2p'], open: true, type: 'kan' },
      { tiles: ['3s', '3s', '3s', '3s'], open: true, type: 'kan' },
    ],
    win: '6m',
    yaku: ['三槓子'],
    han: 2,
    fu: 60,
    ten: 3900,
  },
  {
    name: 'shousangen: two dragon triplets plus the dragon pair',
    hand: ['5z', '5z', '5z', '6z', '6z', '6z', '7z', '1m', '2m', '3m', '4p', '5p', '6p'],
    win: '7z',
    yaku: ['小三元', '役牌白', '役牌発'],
    han: 4,
    fu: 50,
    ten: 8000,
  },
  {
    name: 'honitsu: one suit plus honours, closed',
    hand: ['1m', '2m', '3m', '5m', '6m', '9m', '9m', '9m', '1z', '1z', '1z', '9m', '9m'],
    win: '4m',
    yaku: ['混一色'],
    han: 3,
    fu: 50,
    ten: 6400,
  },
  {
    name: 'chinitsu: one suit only',
    hand: ['1m', '1m', '1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '8m', '8m', '9m'],
    win: '9m',
    yaku: ['清一色'],
    han: 6,
    fu: 50,
    ten: 12000,
  },
  {
    name: 'daisangen: three dragon triplets',
    hand: ['5z', '5z', '5z', '6z', '6z', '6z', '7z', '7z', '1m', '2m', '3m', '9p', '9p'],
    win: '7z',
    yaku: ['大三元'],
    yakuman: 1,
    ten: 32000,
  },
  {
    name: 'shousuushii: three wind triplets plus the fourth wind pair',
    hand: ['1z', '1z', '1z', '2z', '2z', '2z', '3z', '3z', '3z', '4z', '4z', '1m', '2m'],
    win: '3m',
    yaku: ['小四喜'],
    yakuman: 1,
    ten: 32000,
  },
  {
    name: 'daisuushii: four wind triplets (stacks with the other yakuman)',
    hand: ['1z', '1z', '1z', '2z', '2z', '2z', '3z', '3z', '3z', '4z', '4z', '4z', '5z', '5z'],
    win: '5z',
    tsumo: true,
    yaku: ['大四喜'],
    yakuman: 5,
    ten: 160000,
  },
  {
    name: 'tsuuiisou: all honours, open triplet',
    hand: ['2z', '2z', '3z', '3z', '3z', '5z', '5z', '5z', '6z', '6z'],
    melds: [{ tiles: ['1z', '1z', '1z'], open: true, type: 'pon' }],
    win: '2z',
    yaku: ['字一色'],
    yakuman: 1,
    ten: 32000,
  },
  {
    name: 'chinroutou: all terminals, open triplets',
    hand: ['9p', '9p', '1s', '1s'],
    melds: [
      { tiles: ['1m', '1m', '1m'], open: true, type: 'pon' },
      { tiles: ['9m', '9m', '9m'], open: true, type: 'pon' },
      { tiles: ['1p', '1p', '1p'], open: true, type: 'pon' },
    ],
    win: '9p',
    yaku: ['清老頭'],
    yakuman: 1,
    ten: 32000,
  },
  {
    name: 'ryuuiisou: only green tiles, open dragon triplet',
    hand: ['2s', '2s', '2s', '3s', '3s', '3s', '4s', '4s', '4s', '8s'],
    melds: [{ tiles: ['6z', '6z', '6z'], open: true, type: 'pon' }],
    win: '8s',
    yaku: ['緑一色'],
    yakuman: 1,
    ten: 32000,
  },
  {
    name: 'chuuren poutou: 1-9 with 1/9 triplets plus any one tile',
    hand: ['1m', '1m', '1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '9m', '9m', '5m'],
    win: '5m',
    tsumo: true,
    yaku: ['九蓮宝燈'],
    yakuman: 1,
    ten: 32000,
  },
  {
    name: 'suukantsu: four kans',
    hand: ['5z', '5z'],
    melds: [
      { tiles: ['1m', '1m', '1m', '1m'], open: true, type: 'kan' },
      { tiles: ['2p', '2p', '2p', '2p'], open: true, type: 'kan' },
      { tiles: ['3s', '3s', '3s', '3s'], open: true, type: 'kan' },
      { tiles: ['4z', '4z', '4z', '4z'], open: true, type: 'kan' },
    ],
    win: '5z',
    tsumo: true,
    yaku: ['四槓子'],
    yakuman: 1,
    ten: 32000,
  },
  // ---- fu boundaries not reached by the narrative cases ---------------------
  {
    name: 'fu 20: pinfu + tanyao + menzen tsumo',
    hand: ['2m', '3m', '4m', '3p', '4p', '5p', '4s', '5s', '6s', '6s', '7s', '8s', '5p', '5p'],
    win: '4s',
    tsumo: true,
    yaku: ['平和', '断么九', '門前清自摸和'],
    han: 3,
    fu: 20,
    ten: 2700,
  },
  {
    name: 'fu 30: open pinfu-shaped ron',
    hand: ['3p', '4p', '5p', '4s', '5s', '6s', '7s', '8s', '5p', '5p'],
    melds: [{ tiles: ['2m', '3m', '4m'], open: true, type: 'chi' }],
    win: '6s',
    yaku: ['断么九'],
    han: 1,
    fu: 30,
    ten: 1000,
  },
  {
    name: 'fu 40: closed ron with a honour triplet and a dragon pair',
    hand: ['1m', '2m', '3m', '4p', '5p', '6p', '7s', '8s', '9s', '5z', '5z', '5z', '9s'],
    win: '9s',
    yaku: ['役牌白'],
    han: 1,
    fu: 40,
    ten: 1300,
  },
];

for (const c of CASES) {
  test(c.name, () => {
    const r = scoreHand(c.hand, c.melds || [], c.win, !!c.tsumo, ctx(c.ctx));
    assert.equal(r.isAgari, true, 'hand should be a winning shape');
    for (const key of c.yaku) assert.ok(r.yaku[key] !== undefined, `missing yaku ${key}`);
    if (c.yakuman) {
      assert.equal(r.yakuman, c.yakuman, 'yakuman count');
      assert.equal(r.ten, c.ten, 'yakuman payment');
    } else {
      assert.equal(r.han, c.han, 'han');
      assert.equal(r.fu, c.fu, 'fu');
      assert.equal(r.ten, c.ten, 'payment');
    }
  });
}
