# Engine Implementation — How a Real Game Runs

Scope: pure riichi core only. Character rosters (`engine/powers/rosters/*`) are
intentionally omitted here; see `docs/abilities.md` for those.

There are two implementations of the same rules. They share helpers and
libraries, but have different wall models:

| Layer | Files | Wall model | Used by |
|---|---|---|---|
| Offline reference game | `engine/game.js`, `engine/cli.js` | Pre-shuffled 136-array, `wall.pop()` | CLI demo, `--selftest`, rule truth |
| Modular match core | `engine/core.js`, `engine/tiles.js`, `engine/scoring.js`, `engine/rng.js`, `engine/powers/dynamicPool.js`, `engine/powers/index.js`, `engine/powers/flowManager.js`, `engine/powers/trajectoryPlanner.js` | `DynamicPool` inventory + weighted sample | `server/room.js` `Table` (network game) |
| Netplay glue | `server/room.js`, `server/helpers.js`, `server/protocol.js` | Delegates draws to `core.executeDrawStep` | Real client matches |
| Reused rule math | `riichi` (yaku/score), `syanten` (shanten/hairi) npm packages | — | Both layers |

`server/helpers.js:1-6` is an explicit extract of `engine/game.js` logic so the
server reuses identical waits/furiten/bot/kuikae code.

---

## 1. Tiles, RNG, scoring primitives

### 1.1 Tile codes — `engine/tiles.js`

- 34 normalized kinds: `1m–9m, 1p–9p, 1s–9s, 1z–7z` (`engine/tiles.js:4-6`).
- Physical pool is 136 tiles: 4 copies per kind, except one `5m/5p/5s` is
  replaced by aka `0m/0p/0s` (`engine/tiles.js:8-10`, `engine/tiles.js:16-23`).
- `norm` / `akaToFive`: `0x -> 5x`. All comparisons that should ignore red
  fives use `norm`/`same` (`engine/tiles.js:12-14`).
- `fullCounts()` returns the conservation baseline the audit checks against.
- `toCounts(hand)` converts to `[[m x9],[p x9],[s x9],[z x7]]` for `syanten`.
- `toHandStr(hand)` serializes to `riichi`-lib form (`111m22p...`).
- `DORA_NEXT`: indicator -> actual dora (wraps `9->1`, `7z->1z`)
  (`engine/tiles.js:43-48`).
- `isSimple` / `isTerminalOrHonor` are small classifiers.

`engine/game.js:48-86` and `engine/cli.js:14-67` duplicate these helpers
locally instead of importing `tiles.js`; behavior is the same.

### 1.2 RNG — `engine/rng.js`

- `mulberry32(seed)` deterministic PRNG (`engine/rng.js:3-11`).
- `RNG` wrapper with `next()/int(n)/fork(salt)` and a call counter
  (`engine/rng.js:13-22`).
- `createRNG(seed)`: seeded `RNG`, or a `Math.random` shim when seed is null
  (`engine/rng.js:24-28`).
- `core.createMatchState({seed})` threads one `RNG` through the whole hand, so
  same seed + same inputs = same deal and draws. `engine/game.js:42-45` has an
  older equivalent: `--seed N` monkey-patches `Math.random`.

### 1.3 Scoring wrapper — `engine/scoring.js`

`scoreHand(closed, melds, winTile, isTsumo, ctx)` (`engine/scoring.js:9-25`):

1. Build string: `toHandStr(closed)` + `+meld` per meld + `+winTile` if ron +
   `+d<dora...>` if any dora.
2. Build extra flags: `t` (tenhou) + `w` (double riichi) / `r` (riichi) +
   `i` (ippatsu) + `k` (kan/rinshan/chankan) + `h` (haitei/houtei) +
   `{bakaze}{jikaze}`.
3. `new Riichi(str)`, `disableHairi()` (lib hairi is ~7000x slower; engine uses
   `syanten` directly), `calc()`.

Important: the lib returns `isAgari=true` for any complete shape even with no
yaku. Both game layers therefore require `r.yakuman > 0 || r.han >= 1`
(`server/room.js:463-468`, `engine/game.js:300`, `engine/game.js:655`).
Overtime adds `minHan=2` (see §7).

`shantenOf` / `hairiOf` are thin `syanten(toCounts(hand))` wrappers that return
`99` / `{}` on throw (`server/helpers.js:12-17`).

---

## 2. Wall, dead wall, deal

### 2.1 Offline wall — `engine/game.js:54-60`

```js
buildWall() // 4x each of 34 kinds, swap one 5m/5p/5s -> 0m/0p/0s, Fisher-Yates
```

- `wallFull.splice(0, 14)` becomes `dead` (the wanpai)
  (`engine/game.js:438`).
- Layout comment at `engine/game.js:437`:
  `dead[0..3]` = rinshan replacement tiles, dora indicators at
  `dead[4,6,8,10,12]`, ura indicators at `dead[5,7,9,11,13]`.
- `doraInd=[dead[4]]`, `uraInd=[dead[5]]`; `revealKanDora()` pushes
  `dead[4+kanCount*2]` / `dead[5+kanCount*2]` (`engine/game.js:445-449`).
- `baseDora() = doraInd.map(DORA_NEXT)`.
- Deal: 13 tiles each in dealer order
  (`engine/game.js:457`): `for k<13, for i<4: P[(dealer+i)%4].hand.push(wall.pop())`.

### 2.2 Modular wall — `engine/core.js` + `powers/dynamicPool.js`

- `createMatchState({seed, nSeats})` (`engine/core.js:14-25`): creates `rng`,
  `pool=DynamicPool.full(rng)`, `flow`, empty `players`, `deadWall=[]`.
- `setupDeadWall(state)` (`engine/core.js:28-36`): 14 uniform `pool.sample()`s.
- `dealHands(state)` (`engine/core.js:39-47`): 13 rounds over seats.
- After setup + deal: `pool.total()==70` (`136-14-52`), asserted in tests.
- `DynamicPool.sample(weights)` (`engine/powers/dynamicPool.js:57-80`):
  `P(t) = count[t]*W(t) / sum(count[k]*W(k))`. Tiles with count 0 can never be
  drawn; `W==0` excludes a tile. `weights` is a map or `(tile)=>multiplier`.
- `reveal`/`decrement` remove a copy; throws on drawing an exhausted tile
  (conservation violation).
- `reserveSlot` / `takeSlot` bind a tile to a named slot (rinshan/haitei
  mechanism); `core.exchangeDeadWallSlot` / `core.sampleRinshan`
  (`engine/core.js:61-87`) do the physical wanpai swap while keeping the dead
  wall exactly 14 tiles.
- `audit(partitions)` (`engine/powers/dynamicPool.js:83-98`) checks
  hands + discards + melds + dead + live == `fullCounts()`; used in long-horizon
  tests.

The server uses this path: `core.createMatchState`, `core.setupDeadWall`,
`core.dealHands`, then `core.executeDrawStep(seat, state)` every turn
(`server/room.js:525-536`, `server/room.js:681`).

---

## 3. Match loop and turn calculation

### 3.1 Outer loop — `engine/game.js:433-434,491-552`

State: `scores=[25000 x4]`, `dealer=0`, `honba=0`, `riichiCarry=0`
(riichi sticks in points), `overtime=false`, per-kyoku `ctx`.

- `KYOKU_N`: `--kyoku` flag, `4` = tonpuusen, `8` = full hanchan
  (`engine/game.js:34`).
- `bakazeOf(kyoku)`: `kyoku<4 ? East : South` (`engine/game.js:232`);
  `jikazeOf(p) = ((p-dealer+4)%4)+1`.
- `for kyoku in 0..KYOKU_N-1`: build wall, dead wall, deal, kyuushu check
  (§6), then inner `while (wallFull.length>0)` turn loop.
- `turn` starts at `dealer`. Normal advance is `turn=(turn+1)%4`
  (`engine/game.js:883`). A successful pon/daiminkan/chi sets
  `turn=(caller+1)%4` and `continue`s, skipping the normal advance
  (`engine/game.js:824,844,879`).
- Bookkeeping per kyoku: `rinshanIdx`, `kanCount`, `kansBy[4]`, `callsMade`,
  `drawsThisKyoku`, `firstLapDiscards`, `fourRiichiPending`
  (`engine/game.js:439-444`).
- `drawsThisKyoku` + `callsMade` + `me.discards/melds` lengths jointly define
  "first turn" for double riichi / tenhou / chihou
  (`engine/game.js:509,561`).

### 3.2 Server equivalent — `server/room.js:506-636`

`Table.run()` loops `playOneHand()` until `kyoku==totalRounds` (East-only 4).
`playOneHand()` builds seeded `state`, registers powers, deals, then loops
`playTurn(turn)` until `poolTotal()==0` or a win object returns.
`keepDealer` / `honba` / `kyoku--` replay logic mirrors game.js (§7), minus
abortive draws (explicitly unimplemented: `server/room.js:9-12`).
`resolveCallWindow` returns `{end:false,next}` or `{end:true,winner,winBy}`.

---

## 4. Draw → tsumo → discard

Per turn (`engine/game.js:552-560`, `server/room.js:666-704`):

1. `me.tempFuriten=false` — temp furiten clears on your own draw (note: currently clears even in riichi; see `docs/architecture-comparison.md` §3 for the permanent riichi furiten fix).
2. `ctx.jikaze=jikazeOf(turn)`.
3. `isLastDraw = wall.length==1`.
4. `t = wall.pop()` (offline) or `core.executeDrawStep(seat, state)` (server:
   trajectory → `computeDrawWeights` → `pool.sample` → push to hand →
   `onPostDraw`). Returns `null` when empty → hand ends.
5. `me.hand.push(t)`; compute `firstDrawOfKyoku` (no discards/melds, no calls,
   `drawsThisKyoku<=4`).

### 4.1 Kan declaration on the drawn turn (§5 covers resolution)

- Detect `ankanTile` (any normalized kind with count 4 in hand) and `ponUp`
  (existing pon meld + 4th copy in hand) (`engine/game.js:564-566`).
- Gate: `kanCount<4 && rinshanIdx<4`.
- Bots: ankan with p=0.5 (skipped if it would change riichi waits), kakan with
  p=0.35 (`engine/game.js:584-589`). Server bots use `decide.next()` with the
  same probabilities (`server/room.js:713-720`).
- Humans are prompted; illegal riichi-changing ankan warns and can become
  chombo (`engine/game.js:574-579`).

### 4.2 Tsumo check — `engine/game.js:664-683`

Build `tsumoFlags` with `riichi/doubleRiichi/ippatsu`, `kanFlag=afterKan`,
`lastFlag=isLastDraw && !afterKan`, `tenhou=firstDraw && !afterKan`.
`scoreHand(hand, melds, t, true, flags)`; win requires
`isAgari && (yakuman>0 || han>=minHan)` where `minHan=2` in overtime
(ryanhan-shibari), else 1. Humans confirm; bots always declare (offline) or
via `wantTsumo` (server). Win path calls `tsumoWin()` which **rescores** with
`finalDoraFor()` (ura added only for riichi winners) and corrects
`tenhou` to `discards==0 && melds<=1 && callsMade<=1 && draws<=4`
(`engine/game.js:899-907`).

### 4.3 Discard + riichi

- Discard index: human input or `botDiscard(hand, riichiLocked, banned)`
  (`server/helpers.js:51-66`): if riichi-locked, tsumogiri (`hand.length-1`);
  else 15% random, else argmin shanten over unique discards.
- Riichi gate, checked **before** the cut using the same `di` (avoids
  epsilon-random disagreement): closed hand, some discard leaves 0-shanten,
  `canRiichi(score, wallLeft)` = `score>=1000 && wallLeft>=4`
  (`server/helpers.js:108`), probability 0.45 (or 1.0 with `--riichi-always`).
  Humans confirm; `declareRiichi()` sets `riichi/doubleRiichi(first-turn)/ippatsu`,
  subtracts 1000 pts to `riichiPool`, snapshots `riichiWaits` via `getWaits`,
  and arms `fourRiichiPending` when all four are riichi
  (`engine/game.js:497-508`).
- After the cut: `me.ippatsu=false` for the discarder (one lap over).
- `isHoutei = wall.length==0` is captured for the following ron check.
- Server validates the same rules in `validateAct` (`server/room.js:914-964`):
  open hand cannot riichi, tenpai discard required, riichi player may only
  tsumogiri, tile must be in hand.

---

## 5. Kan, rinshan, dora, chankan

All three kan types share: `revealKanDora()`, `callsMade++`,
`clearAllIppatsu(P)` (any call kills everyone's ippatsu), `kansBy[seat]++`,
suukaikan check, rinshan draw `dead[rinshanIdx++]`, rinshan tsumo check with
`kanFlag=true`.

| Kind | Trigger | Tiles moved | Notes |
|---|---|---|---|
| Ankan (closed) | 4 copies in hand after draw | 4 hand tiles → `{open:false,type:'kan'}` meld | Kokushi-only chankan exception checked first (`engine/game.js:614-627`): closed 13 + no melds + `国士無双` yaku only |
| Kakan (added) | pon meld + 4th copy drawn | 1 hand tile appended to pon, `type='kan'` | Full `collectRon(chankan)` **before** upgrading; 3 hits = abort, else wins immediately (`engine/game.js:596-607`) |
| Daiminkan (open) | Opponent discard + 3 copies in hand | 3 hand tiles + discard → `{open:true,type:'kan'}` | Offered in the pon branch when `nSame>=3`, bot p=0.25; consumes the discard (`me.discards.pop()`) |

- `isSuukaikanAbort(kansBy)`: total>=4 and not all by one player → abortive
  draw (`engine/game.js:225-230`). Solo quad continues with a log line.
- Rinshan win calls `tsumoWin(..., rinshan=true)`; else fall through to the
  normal discard path (`discardAfterCall`).
- Kan dora: `revealKanDora` exposes the next indicator pair and rebroadcasts
  (`server/room.js:566-574`); `ctx.dora=baseDora()` refreshes.
- Ankan after riichi: legal only if waits are unchanged
  (`ankanKeepsWaits`, `server/helpers.js:121-131` comparing `riichiWaits` before
  vs after). Offline humans can force it and eat a chombo mangan penalty +
  replay (`engine/game.js:940-947`); bots skip it; the server rejects it in
  `classifyHumanKan`/`validateAct` (`server/room.js:883-932`).

---

## 6. Ron, furiten, calls, kuikae

### 6.1 Waits and furiten — `server/helpers.js:19-47`

- `getWaits(player, players, dead, ctxBase)`: try all 34 `KINDS` as ron tiles
  with neutral flags; collect those with `isAgari`. Shape-only so open tenpai
  works. Karaten (all copies visible) still counts as tenpai for ryukyoku.
- `isDiscardFuriten`: any wait present (normalized) in own discards.
- `tryRon`: score the discard → require yaku (`han>=minHan` or yakuman) →
  recompute waits → `tempFuriten` blocks → discard furiten blocks → else win.
- Temp furiten: set when a human passes an available ron
  (`engine/game.js:528`), or any player with a valid ron claim responds Pass in
  the server window (`server/room.js:1345-1372`); cleared on own next draw (known
  bug: standard riichi rules require furiten to persist permanently for the round).

### 6.2 Ron collection

- Offline `collectRon(tile, fromTurn, {houtei,chankan,minHan})`
  (`engine/game.js:513-534`): iterate `k=1..3` (turn order), build per-seat
  shoot ctx (`riichi/double/ippatsu/kanFlag/lastFlag`), call `tryRon`, prompt
  humans. Returns `hits` in turn order.
- `ronWinResultMulti` rescores each hitter with final (ura-inclusive) dora and
  tags `CHANKAN/HOUTEI/IPPATSU/DOUBLE RON` (`engine/game.js:535-550`).
- 3 hits = triple ron → abortive draw, not a win (`engine/game.js:727-731`).
  1–2 hits = ron / double ron; discarder pays each winner `ten+300*honba`,
  sticks go to the nearest winner (`engine/game.js:962-971`).
- Server `resolveCallWindow` (`server/room.js:1219-1393`) generalizes this to a
  simultaneous window: gather ron/pon/daiminkan/chi candidates, poll humans and
  bots concurrently (bots: ron always, daiminkan 0.25, pon via
  `botWantsCall(shantenGain)`, chi 0.35), then arbitrate
  **Ron > Pon/Daiminkan > Chi**. Passing a ron sets `tempFuriten`.

### 6.3 Pon / chi priority and kuikae

- Pon loop runs `k=1..3` and stops at the first claim; chi is only offered to
  `nx=(turn+1)%4` (kamicha) **if no pon claimed** (`engine/game.js:760-882`).
  Riichi seats are skipped for both.
- `chiOptions(hand, tile)` (`server/helpers.js:76-86`): honors and aka `0x`
  excluded; returns rank pairs for ryanmen/kanchan/penchan shapes.
- Pon meld: 2 hand copies + discard; chi meld: 2 hand tiles + discard; in both
  cases the discard is popped from the discarder's river and `callsMade++`,
  ippatsu cleared.
- Kuikae: after chi with hand tiles `a,b`, `kuikaeBannedChi(a,b)`
  (`server/helpers.js:91-101`) computes the forbidden discards (e.g. chi 2-3
  bans 1,4). `discardAfterCall(pl, seat, ..., banned)`
  (`engine/game.js:915-936`) enforces it: humans re-prompt, bots filter via
  `botDiscard(..., banned)`. After pon the 4th copy is banned
  (`engine/game.js:832`).

---

## 7. End-of-hand rules and match settlement

### 7.1 Riichi extras

- Double riichi: `isFirstTurn() = callsMade==0 && drawsThisKyoku<=4`
  (`engine/game.js:509`); server `isFirstDraw` also requires no
  discards/melds (`server/room.js:638-641`).
- Ippatsu: set on riichi (`engine/game.js:499`), cleared for everyone on any
  call (`clearAllIppatsu`), and for the declarer on their next discard
  (`engine/game.js:718`). Ura dora revealed only for riichi winners at rescore
  (`engine/game.js:886-898`).
- Tenhou/chihou: `firstDraw` flag flows into `tenhou` ctx; tsumo rescore
  re-derives it strictly (`engine/game.js:903`).

### 7.2 Abortive draws (offline engine; server omits most)

Checked only when the discard produces no ron (wins take precedence):

- Kyuushu-kyuuhai: 9+ terminals/honors in the deal; declarer chooses abort
  (honba+1, same dealer replay) or play on; bots keep kokushi-shaped 9-distinct
  hands (`engine/game.js:461-490`).
- Suufon-renda: first discard of each seat with no calls, all same wind
  `1z–4z` (`engine/game.js:220-224,722-723,750-757`).
- Suukaikan: split 4+ kans (`engine/game.js:637-640,790-795`).
- Suucha-riichi: 4th riichi declared; abort after its discard if unclaimed
  (`engine/game.js:504-507,738-743`).
- Triple ron incl. chankan variant (`engine/game.js:598-602,727-731`).
- All aborts: `honba++`, sticks stay (`riichiCarry=ctx.riichiPool`), `kyoku--`
  replay, same dealer (`engine/game.js:948-953`).

### 7.3 Exhaustive draw, nagashi, noten

- Tenpai test: `getWaits(...)>0` per seat (`engine/game.js:996`).
- Nagashi mangan (`engine/game.js:287-291`): closed hand (ankan ok) + every
  discard terminal/honor + non-empty river. Replaces noten exchange; each
  qualifier gets a mangan tsumo payment (+100*honba), sticks to the first
  (`engine/game.js:1003-1012`).
- Else noten: 1 tenpai `+3000/-1000`, 2 `+1500/-1500`, 3 `+1000/-3000`
  (`engine/game.js:1013-1018`).
- Dealer repeats on tenpai (`keepDealer=tenpai[dealer]`, `kyoku--`).

### 7.4 Points, honba, sticks, match end

- Tsumo: dealer win → each pays `oya+100*honba`; non-dealer → dealer pays
  `ko[0]`, others `ko[1]`, each `+100*honba`; winner takes `riichiPool`
  (`engine/game.js:956-961`).
- Chombo (illegal ankan after riichi, offline only): mangan penalty,
  honba unchanged, replay (`engine/game.js:940-947`).
- Dealer win → renchan (`honba++`, `kyoku--`).
- All-last extras: agari-yame (leading dealer may end), enchousen/overtime
  (dealer win or dealer tenpai at all-last continues; `minHan=2`
  ryanhan-shibari), tobi bust-out (`score<0` ends match)
  (`engine/game.js:974-1030`).
- Match result: `applyOkaUma` (`server/helpers.js:135-155`): 25k start vs 30k
  target, oka +20 split among tied 1sts, uma `+20/+10/-10/-20` averaged over
  ties, zero-sum totals.

---

## 8. Bots, human I/O, selftest

- `botDiscard` (above) + `botWantsCall(gain)`: 0.05 if call worsens shanten,
  else 0.55 unless `--closed-only` (`engine/game.js:199-203`).
- Flags: `--powers`, `--human -1|0..3`, `--seed`, `--kyoku`,
  `--closed-only=1`, `--riichi-always=1`, `--demo-abort=NAME`
  (`engine/game.js:24-41`).
- `node game.js --selftest=1` (`engine/game.js:308-419`) asserts ippatsu,
  chankan, rinshan, haitei/houtei, double riichi, ura/kan dora, waits/furiten,
  double/triple ron eligibility, kyuushu counts, all abort helpers, riichi
  gate, nagashi, kuikae bans, ankan wait preservation, oka/uma.
- `node cli.js eval/play/demo` (`engine/cli.js`) is a smaller single-player
  sandbox with the same tile/shanten/scoring hacks.
- `npm test` runs `tests/` (conservation, determinism, slots, flow) plus the
  selftest (`engine/package.json:7-9`).

---

## 9. How it glues together (read order)

1. `engine/tiles.js` + `engine/rng.js` + `engine/scoring.js`: stateless facts.
2. `engine/game.js:main()`: match loop → kyoku setup → turn loop → per-turn
   kan/tsumo/discard/ron/calls → settlement → rotation. Start here for the
   full rules picture.
3. `server/helpers.js`: same pure rules, importable by the server.
4. `engine/core.js` + `engine/powers/dynamicPool.js`: stateful pool version of
   deal/draw/slots with audit.
5. `server/room.js:Table`: event-driven mirror of (2) — `playTurn` (= draw +
   kan + tsumo + discard), `resolveCallWindow` (= ron/pon/chi arbitration),
   `doOwnKan`/`doOpenCall`/`doOpenChi`, `finishHand` (= settlement +
   rotation). Draws go through `core.executeDrawStep`; all other rulings reuse
   (3).
6. `engine/powers/index.js` (dispatcher), `flowManager.js` (0–150 gauge,
   +1.5/discard), `trajectoryPlanner.js` (shanten/hairi/ukeire/bridges): the
   supernatural hook layer. Per-turn weights flow
   `getActiveTrajectory → computeDrawWeights → pool.sample → onPostDraw`
   (`engine/core.js:50-59`). Roster files plug into this dispatcher and are out
   of scope for this document.
