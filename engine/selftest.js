// Deterministic rule checks (`node game.js --selftest=1`).
// Extracted from game.js so the CLI entry point stays about the match loop. This
// file is a fixture body: it deliberately contains literal scores and payments,
// because asserting the numbers is the point of it.
const { scoreHand } = require('./scoring');
const {
  getWaits,
  isDiscardFuriten,
  tryRon,
  countYaochuu,
  distinctYaochuu,
  isSuufonRenda,
  isSuukaikanAbort,
  bakazeOf,
  roundLabel,
  canRiichi,
  isNagashi,
  kuikaeBannedChi,
  ankanKeepsWaits,
  applyOkaUma,
} = require('./helpers');

// ---------- selftest (deterministic rule checks) ----------
async function selftest() {
  let n = 0;
  const ok = (cond, msg) => {
    n++;
    if (!cond) {
      console.error(`FAIL: ${msg}`);
      process.exit(1);
    }
    console.log(`ok ${n} - ${msg}`);
  };
  const C = (o) => ({
    dora: [],
    bakaze: 1,
    jikaze: 2,
    riichi: false,
    doubleRiichi: false,
    ippatsu: false,
    kanFlag: false,
    lastFlag: false,
    tenhou: false,
    ...o,
  });
  const P0 = {
    hand: ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '2p', '2p', '2p', '3p'],
    melds: [],
    discards: [],
    tempFuriten: false,
  };
  const P0win = [...P0.hand, '3p']; // 14 tiles: tanki pair completed (tsumo cases)
  // ippatsu: closed tanki wait 3p, riichi+ippatsu tsumo
  let r = scoreHand(P0win, [], null, true, C({ riichi: true, ippatsu: true }));
  ok(r.isAgari && r.yaku['一発'] !== undefined, `ippatsu yaku present (${JSON.stringify(r.yaku)})`);
  // chankan: ron on 3p with kanFlag
  r = scoreHand(P0.hand, [], '3p', false, C({ kanFlag: true }));
  ok(
    r.isAgari && (r.yaku['槍槓'] !== undefined || r.yaku['搶槓'] !== undefined),
    `chankan yaku present (${JSON.stringify(r.yaku)})`
  );
  // rinshan: tsumo with kanFlag (needs a kan meld, as in real rinshan)
  // 11 closed (lib counts kan meld as 3: 11+3=14) + ankan = complete
  const rinClosed = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m', '3p', '3p'];
  r = scoreHand(
    rinClosed,
    [{ tiles: ['7s', '7s', '7s', '7s'], open: false, type: 'kan' }],
    null,
    true,
    C({ kanFlag: true })
  );
  ok(r.isAgari && r.yaku['嶺上開花'] !== undefined, `rinshan yaku present (${JSON.stringify(r.yaku)})`);
  // haitei / houtei
  r = scoreHand(P0win, [], null, true, C({ lastFlag: true }));
  ok(r.isAgari && r.yaku['海底摸月'] !== undefined, `haitei yaku present (${JSON.stringify(r.yaku)})`);
  r = scoreHand(P0.hand, [], '3p', false, C({ lastFlag: true }));
  ok(r.isAgari && r.yaku['河底撈魚'] !== undefined, `houtei yaku present (${JSON.stringify(r.yaku)})`);
  // double riichi
  r = scoreHand(P0win, [], null, true, C({ doubleRiichi: true }));
  ok(r.isAgari && r.yaku['ダブル立直'] !== undefined, `double riichi yaku present (${JSON.stringify(r.yaku)})`);
  // ura dora adds han: same hand with/without ura tile 3p as dora
  const noUra = scoreHand(P0win, [], null, true, C({}));
  const withUra = scoreHand(P0win, [], null, true, C({ dora: ['2p'] })); // 3p dora x1
  ok(
    withUra.han > noUra.han && withUra.yaku['ドラ'] !== undefined,
    `ura/kan dora adds han (${noUra.han}->${withUra.han})`
  );
  // waits + furiten
  const players = [
    P0,
    { hand: [], melds: [], discards: [] },
    { hand: [], melds: [], discards: [] },
    { hand: [], melds: [], discards: [] },
  ];
  const waits = getWaits(P0, players, [], C({}));
  ok(waits.includes('3p'), `waits include 3p (${waits})`);
  ok(!isDiscardFuriten(P0, waits), 'no furiten on empty discards');
  P0.discards.push('3p');
  ok(isDiscardFuriten(P0, waits), 'discard furiten detected after dropping wait');
  // behavioral: tryRon blocks/permits end-to-end
  const mkQ = (discards, temp) => ({
    hand: [...P0.hand],
    melds: [],
    discards: [...discards],
    tempFuriten: !!temp,
    riichi: false,
    doubleRiichi: false,
    ippatsu: false,
  });
  const shoot = (kan) => C({ kanFlag: !!kan });
  const plist = [
    mkQ([], false),
    { hand: [], melds: [], discards: [] },
    { hand: [], melds: [], discards: [] },
    { hand: [], melds: [], discards: [] },
  ];
  plist[0] = mkQ([], false);
  let att = tryRon(plist[0], '3p', shoot(false), plist, []);
  ok(att.win === true, 'ron wins with no furiten');
  att = tryRon(mkQ(['3p'], false), '3p', shoot(false), plist, []);
  ok(att.win === false && att.blocked && att.reason === 'discard', 'discard furiten blocks ron');
  att = tryRon(mkQ([], true), '3p', shoot(false), plist, []);
  ok(att.win === false && att.blocked && att.reason === 'temp', 'temp furiten blocks ron');
  att = tryRon(mkQ([], false), '3p', shoot(true), plist, [], { chankan: true });
  ok(
    att.win === true && (att.r.yaku['槍槓'] !== undefined || att.r.yaku['搶槓'] !== undefined),
    'chankan ron wins via tryRon'
  );
  att = tryRon(mkQ(['3p'], false), '3p', shoot(true), plist, [], { chankan: true });
  ok(att.win === false && att.blocked, 'furiten blocks chankan too');
  // combined attack flags as tsumoWin/rescore build them (riichi+ippatsu+ura)
  r = scoreHand(P0win, [], null, true, C({ riichi: true, ippatsu: true, dora: ['2p'] }));
  ok(
    r.isAgari && r.yaku['立直'] !== undefined && r.yaku['一発'] !== undefined && r.yaku['ドラ'] !== undefined,
    `combined riichi+ippatsu+ura scores (${JSON.stringify(r.yaku)})`
  );
  // double ron eligibility: TWO tenpai players both win the same tile
  const qa = mkQ([], false),
    qb = mkQ([], false);
  const pl2 = [qa, qb, { hand: [], melds: [], discards: [] }, { hand: [], melds: [], discards: [] }];
  const ra = tryRon(qa, '3p', shoot(false), pl2, []);
  const rb = tryRon(qb, '3p', shoot(false), pl2, []);
  ok(ra.win === true && rb.win === true, 'double ron: two players win same tile');
  // triple ron condition: three eligible winners
  const qc = mkQ([], false);
  const pl3 = [qa, qb, qc, { hand: [], melds: [], discards: [] }];
  const rc = tryRon(qc, '3p', shoot(false), pl3, []);
  ok(rc.win === true, 'triple ron: third player also wins (abortive in game)');
  // kyuushu counting: 9+ terminals/honors
  const yao = ['1m', '9m', '1p', '9p', '1s', '9s', '1z', '2z', '3z', '4z', '5z', '6z', '7z'];
  ok(countYaochuu(yao) === 13, `kyuushu counts 13 yaochuu tiles (${countYaochuu(yao)})`);
  ok(countYaochuu(P0.hand) === 2, `2 yaochuu (1m,9m) in test hand (${countYaochuu(P0.hand)})`);
  // 九種九牌 counts DISTINCT kinds. Nine tiles is not nine kinds — this gate used to
  // use the tile count and let illegal declarations through (KI-22).
  ok(distinctYaochuu(yao) === 13, `kyuushu counts 13 distinct yaochuu kinds (${distinctYaochuu(yao)})`);
  ok(
    distinctYaochuu(['1m', '1m', '1m', '1m', '1p', '1p', '1p', '9s', '9s']) === 3,
    'nine yaochuu tiles of three kinds is NOT a legal kyuushu'
  );
  ok(
    distinctYaochuu(['1m', '1m', '1m', '1m', '1p', '1p', '1p', '1p', '9s']) === 3,
    'duplicates never turn three kinds into nine'
  );
  ok(
    distinctYaochuu(['1m', '9m', '1p', '9p', '1s', '9s', '1z', '2z', '3z']) === 9,
    'nine distinct kinds is exactly legal'
  );
  ok(
    distinctYaochuu(['1m', '9m', '1p', '9p', '1s', '9s', '1z', '2z', '3z', '2m']) === 9,
    'simples do not dilute the count'
  );
  // abortive-draw conditions (pure helpers)
  ok(isSuufonRenda(['1z', '1z', '1z', '1z']) === true, 'suufon: four 1z');
  ok(isSuufonRenda(['1z', '1z', '1z', '2z']) === false, 'suufon: mixed winds rejected');
  ok(isSuufonRenda(['5m', '5m', '5m', '5m']) === false, 'suufon: non-wind rejected');
  ok(isSuufonRenda(['1z', '1z', '1z']) === false, 'suufon: needs exactly four');
  ok(isSuukaikanAbort([2, 1, 1, 0]) === true, 'suukaikan: split 2/1/1 aborts');
  ok(isSuukaikanAbort([4, 0, 0, 0]) === false, 'suukaikan: solo quad continues');
  ok(isSuukaikanAbort([1, 1, 0, 0]) === false, 'suukaikan: under four continues');
  // rounds / riichi-gate / nagashi helpers
  ok(bakazeOf(0) === 1 && bakazeOf(3) === 1 && bakazeOf(4) === 2 && bakazeOf(7) === 2, 'bakaze East 0-3, South 4-7');
  ok(roundLabel(0) === 'EAST 1' && roundLabel(5) === 'SOUTH 2', `round labels (${roundLabel(0)}/${roundLabel(5)})`);
  ok(
    canRiichi(1000, 4) === true && canRiichi(900, 10) === false && canRiichi(2000, 3) === false,
    'riichi needs 1000pts + 4 wall tiles'
  );
  const ng0 = { melds: [], discards: ['1m', '9p', '1z', '9s', '2z'] };
  const ng1 = { melds: [{ tiles: ['1m', '1m', '1m'], open: true, type: 'pon' }], discards: ['1m', '9p'] };
  const ng2 = { melds: [], discards: ['1m', '5p'] };
  ok(isNagashi(ng0) === true, 'nagashi: closed all-yaochuu discards');
  ok(isNagashi(ng1) === false, 'nagashi: open meld disqualifies');
  ok(isNagashi(ng2) === false, 'nagashi: simple discard disqualifies');
  ok(isNagashi({ melds: [], discards: [] }) === false, 'nagashi: empty discards rejected');
  // kuikae bans after chi (two HAND tiles used)
  ok(JSON.stringify(kuikaeBannedChi('2p', '3p')) === JSON.stringify(['1p', '4p']), 'kuikae: chi 2-3 bans 1,4');
  ok(JSON.stringify(kuikaeBannedChi('1s', '3s')) === JSON.stringify(['2s']), 'kuikae: kanchan chi bans called tile');
  ok(JSON.stringify(kuikaeBannedChi('8m', '9m')) === JSON.stringify(['7m']), 'kuikae: penchan chi bans called tile');
  // ankan-after-riichi wait check (tanki quad keeps, shanpon quad breaks)
  const seqs = ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m'];
  const wctx = { dora: [], bakaze: 1, jikaze: 1 };
  const lkKeep = [...seqs, '7p', '7p', '7p', '4p']; // tanki 4p only
  const plKeep = {
    hand: [...lkKeep, '7p'],
    melds: [],
    riichiWaits: getWaits({ hand: lkKeep, melds: [] }, [], [], wctx),
  };
  ok(JSON.stringify(plKeep.riichiWaits) === JSON.stringify(['4p']), `riichi waits tanki (${plKeep.riichiWaits})`);
  ok(ankanKeepsWaits(plKeep, '7p') === true, 'ankan keeps tanki waits: legal');
  const lkBreak = [...seqs, '3p', '3p', '4p', '4p']; // shanpon 3p/4p
  const plBreak = {
    hand: [...lkBreak, '3p'],
    melds: [],
    riichiWaits: getWaits({ hand: lkBreak, melds: [] }, [], [], wctx),
  };
  ok(ankanKeepsWaits(plBreak, '3p') === false, `ankan breaks shanpon waits (${plBreak.riichiWaits}): chombo`);
  // oka/uma placement
  const t1 = applyOkaUma([31000, 26000, 24000, 19000]);
  ok(t1.map((r) => r.total).join(',') === '41,6,-16,-31', `oka/uma basics (${t1.map((r) => r.total)})`);
  const t2 = applyOkaUma([25000, 25000, 25000, 25000]);
  ok(
    t2.every((r) => r.total === 0),
    'oka/uma all-tie zeros out'
  );
  const t3 = applyOkaUma([30000, 30000, 20000, 20000]);
  ok(
    t3[0].total === 25 && t3[1].total === 25 && t3[2].total === -25 && t3[3].total === -25,
    `oka/uma tied groups (${t3.map((r) => r.total)})`
  );
  console.log(`\nSELFTEST PASS (${n} checks)`);
}

module.exports = { selftest };
