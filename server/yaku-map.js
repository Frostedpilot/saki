'use strict';
// yaku-map.js — maps the `riichi` library's Japanese yaku names (as produced
// by engine/scoring.js but WITHOUT dora entries) to the Kind / DoraLabel
// serde values the riichi_mahjong_rs client renders, and builds the
// `yaku_list` + rank fields for RoundWon.

// Non-dora yaku: Japanese name -> Kind variant name.
const JP_TO_KIND = {
  // 1 han
  立直: 'Riichi',
  ダブル立直: 'DoubleRiichi',
  一発: 'Unbroken',
  門前清自摸和: 'FullyConcealedHand',
  平和: 'Pinfu',
  一盃口: 'TwinSequences',
  断么九: 'AllInside',
  役牌白: 'ValueHonourWhiteDragon',
  役牌発: 'ValueHonourGreenDragon',
  役牌中: 'ValueHonourRedDragon',
  海底摸月: 'LastTileDraw',
  河底撈魚: 'LastTileClaim',
  嶺上開花: 'AfterAQuad',
  搶槓: 'RobbingAQuad',
  // 2 han
  両立直: 'DoubleRiichi',
  七対子: 'SevenPairs',
  三色同順: 'MixedSequences',
  一気通貫: 'FullStraight',
  混全帯么九: 'CommonEnds',
  対々和: 'AllTriplets',
  三暗刻: 'ThreeConcealedTriplets',
  小三元: 'LittleDragons',
  三色同刻: 'MixedTriplets',
  三槓子: 'ThreeQuads',
  混一色: 'CommonFlush',
  // 3 han
  二盃口: 'DoubleTwinSequences',
  純全帯么九: 'PerfectEnds',
  混老頭: 'CommonTerminals',
  清一色: 'PerfectFlush',
  // 6 han
  '清一色（喰い下がり）': 'PerfectFlush',
  // yakuman
  国士無双: 'ThirteenOrphans',
  国士無双十三面待ち: 'ThirteenOrphansThirteenWait',
  四暗刻: 'FourConcealedTriplets',
  四暗刻単騎待ち: 'FourConcealedTripletsPairWait',
  大三元: 'BigDragons',
  小四喜: 'LittleWinds',
  大四喜: 'BigWinds',
  字一色: 'AllHonours',
  緑一色: 'AllGreen',
  清老頭: 'PerfectTerminals',
  四槓子: 'FourQuads',
  九蓮宝燈: 'NineGates',
  純正九蓮宝燈: 'PureNineGates',
  天和: 'BlessingOfHeaven',
  地和: 'BlessingOfEarth',
};

// Wind-based yakuhai: the lib emits per-wind names.
const ROUND_WIND_KIND = {
  場風東: 'ValueHonourRoundWind', 場風南: 'ValueHonourRoundWind',
  場風西: 'ValueHonourRoundWind', 場風北: 'ValueHonourRoundWind',
};
const SEAT_WIND_KIND = {
  自風東: 'ValueHonourSeatWind', 自風南: 'ValueHonourSeatWind',
  自風西: 'ValueHonourSeatWind', 自風北: 'ValueHonourSeatWind',
};

// Dora entries have their own ScoreItem::Dora(DoraLabel) shape.
const DORA_LABELS = {
  ドラ: 'Dora',
  赤ドラ: 'RedDora',
  裏ドラ: 'UraDora',
  北抜き: 'PeiDora',
};

// Mapped names that the pinned riichi@1.2.0 does not actually emit, kept as
// insurance in case a future version renames/emits them. Verified dead by
// yaku-map.test.js, which fails if this list itself goes stale.
//   両立直            — an alternative spelling of ダブル立直, which is mapped above.
//   清一色（喰い下がり） — the open-hand flush the lib reports as plain 清一色.
const LEGACY_ALIASES = new Set(['両立直', '清一色（喰い下がり）']);

// Builds the client's yaku_list: [[ScoreItem, han], ...].
// Yakuman entries carry han=0 (the rank carries the magnitude).
//
// Yaku the lib can emit but that have NO corresponding protocol `Kind` variant
// are dropped rather than sent as an unknown enum value. Keep this list
// exhaustive: yaku-map.test.js fails if the lib grows a yaku that is neither
// mapped nor listed here.
const UNSUPPORTED_BY_PROTOCOL = new Set([
  '人和',   // renhou — no Kind variant in riichi_mahjong_rs
  '大七星', // Big Seven Stars — no Kind variant
]);

function buildYakuList(result) {
  const items = [];
  for (const [name, value] of Object.entries(result.yaku || {})) {
    const han = value.endsWith('飜') ? parseInt(value, 10) : 0;
    const dora = DORA_LABELS[name];
    const kind = JP_TO_KIND[name] || ROUND_WIND_KIND[name] || SEAT_WIND_KIND[name];
    if (dora) items.push([{ Dora: dora }, han]);
    else if (kind) items.push([{ Yaku: kind }, han]);
    // Unmapped yaku are dropped; the RoundWon `han` field stays authoritative
    // for the total, so the client's han display remains correct.
  }
  return items;
}

// Converts the lib's `name` field (満貫/跳満/.../ダブル役満) to ScoreRank.
// Anything containing 役満 is a yakuman naming; the yakuman flag is normally
// already set, but match on the name too so a double yakuman is never reported
// as Normal.
function rankFromResult(result) {
  if (result.yakuman > 0) return 'Yakuman';
  if (result.name && result.name.includes('役満')) return 'Yakuman';
  switch (result.name) {
    case '満貫': return 'Mangan';
    case '跳満': return 'Haneman';
    case '倍満': return 'Baiman';
    case '三倍満': return 'Sanbaiman';
    default:
      if (result.name && result.name.endsWith('倍役満')) return 'Yakuman';
      return 'Normal';
  }
}

module.exports = {
  buildYakuList,
  rankFromResult,
  UNSUPPORTED_BY_PROTOCOL,
  LEGACY_ALIASES,
  JP_TO_KIND,
  ROUND_WIND_KIND,
  SEAT_WIND_KIND,
  DORA_LABELS,
};