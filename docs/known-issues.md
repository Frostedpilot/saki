# Known issues — structural fragility & documentation rot

Two registers. **Part A** is about the code: things that will break silently, cost time,
or lose work. **Part B** is about the docs: statements that are wrong *right now*.

Everything here was verified against the tree. Severity is my judgement, not a metric.

**Severity key** — 🔴 will lose data or produce a wrong game · 🟠 breaks a workflow ·
🟡 will mislead you · ⚪ housekeeping.

---

# Part A — Structural fragility

## <a id="ki-01"></a>KI-01 ✅ FIXED — `npm test` was broken in `engine/` and `server/`

Both package scripts passed a **bare directory** to `node --test`:

```json
"test": "node --test tests/ && node game.js --selftest=1"   // engine
"test": "node --test test/"                                    // server
```

On Node 22 this was rejected as a module path:

```
Error: Cannot find module 'N:\Fun\saki\engine\tests'
```

Both suites reported `0 pass / 1 fail` — **the failure was the runner, not the tests**.
The tests themselves were green all along, verified with glob forms on Node 22.18.0:

| Command | Result |
| --- | --- |
| `node --test tests/*.test.js` (engine) | **310 pass / 0 fail** (~80 s) |
| `node --test test/*.test.js` (server) | **3 pass / 0 fail** (~8–17 s) |
| `node game.js --selftest=1` | `SELFTEST PASS (43 checks)` |

**Fixed** — the scripts now use the glob form:

```json
"test": "node --test tests/*.test.js && node game.js --selftest=1"   // engine
"test": "node --test test/*.test.js"                                   // server
```

Verified through `npm test` (i.e. via `cmd.exe`, which passes the pattern through
literally for Node to expand — so this also works under bash and zsh):

| Command | Tests | Exit code |
| --- | --- | --- |
| `cd engine && npm test` | 310 pass + 43 selftest checks | **0** |
| `cd server && npm test` | 3 pass | **0** |

The remaining problem is that **nothing runs these tests automatically** — see KI-06.

---

## <a id="ki-02"></a>KI-02 ✅ FIXED — Three installs, no workspace, duplicated dependencies

**Was:** no root `package.json` and no npm workspaces — three packages, three lockfiles,
three `node_modules` trees. A developer who ran `npm ci` in the root got an error; one
who forgot `server/` got `Cannot find module 'ws'`.

Worse, `server/` declares `riichi` and `syanten` as **its own dependencies** even though
it consumes engine code by relative path (`require('../engine/core')`,
`require('../engine/tiles')`), so both libraries were installed **twice as separate
physical copies** with nothing enforcing they stayed in sync.

**Fixed** — the repo is now a single npm workspace:

- Root `package.json` with `"workspaces": ["engine", "server", "web-client"]`.
- One `package-lock.json` at the root; the three sub-lockfiles are deleted.
- `npm ci` once at the root installs everything into one hoisted `node_modules`.
- Verified: exactly **one** `riichi@1.2.0` and **one** `syanten@1.6.0` on disk.
- Root scripts for the common tasks: `npm test`, `test:engine`, `test:server`,
  `test:client`, `links`, `smoke`, `check`.

Per-package runs still work (`npm test --workspace engine`).

**Residual:** `server/` still declares `riichi`/`syanten` redundantly. That is
deliberate and harmless under hoisting, but if the pins ever diverge npm will install
two copies and the server will score against a different library than the engine tests
assert against. Bump both together.

---

## <a id="ki-03"></a>KI-03 ✅ FIXED — Engine tests depended on the server package

**Was:** three files in `engine/tests/` reached across into `server/` for the shared
rule helpers (`require('../../server/helpers')`). The dependency ran **both ways**, so
the engine test suite could not run without `server/` present.

**Fixed** — `server/helpers.js` was moved to `engine/helpers.js`, putting the shared
rules on the engine side where they belong. Four call sites updated:

| File | Change |
|---|---|
| `server/room.js` | `require('./helpers')` → `require('../engine/helpers')` |
| `engine/tests/edge.test.js` | `require('../../server/helpers')` → `require('../helpers')` |
| `engine/tests/furiten-riichi.test.js` | same |
| `engine/tests/rules.test.js` | same |

The dependency graph is now one-directional: `server/` → `engine/`, never the reverse.

**Also fixed while in there:** `engine/game.js` had been keeping **19 verbatim copies**
of the functions in `helpers.js`, annotated "canonical copy … keep in sync". They were
byte-identical (`isNagashi`) or strictly better (`botDiscard` gained a `rand`
injection parameter). `game.js` now imports all of them, deleting **131 lines**
(1029 → 898) with **zero behaviour change** — verified by byte-identical output hashes
on two seeded 4-hand matches before and after, plus the 43-check selftest.

---

## <a id="ki-04"></a>KI-04 🟡 Two rule front-ends that diverge (shared rules now deduplicated)

The same rules are implemented twice, and the two copies disagree:

| | Offline — `engine/game.js` | Network — `engine/core.js` + `server/room.js` |
| --- | --- | --- |
| Wall | pre-shuffled array, `wall.pop()` | `DynamicPool` weighted sampling |
| Length | tonpuusen or hanchan (`--kyoku`) | tonpuusen only |
| Abortive draws | **all five on** | **all five off** |
| Nagashi mangan, oka/uma | yes | no |
| Character powers | **inline `powerDraw()`, not the roster framework** | full `PowerDispatcher` + `rosters/` |

**Still open.** A rule fixed in `game.js` is not automatically fixed in `room.js`. This
has already happened: the permanent-riichi-furiten bug existed on both sides and needed
two fixes plus a regression suite. The divergence is at least *declared* in
`engine/rules-config.js` (`RULES.aborts` vs `RULES.serverAborts`) — but the comment
there, "Flip a flag only together with its handler", is a warning that this is a trap.

**Reduced, not closed.** The *shared rule functions* are no longer duplicated —
`engine/helpers.js` is now the single definition for waits, furiten, bot decisions,
abort conditions and oka/uma, and `game.js` imports all of them (see KI-03). What still
differs is the **rule front-ends**: `game.js`'s `main()` and `server/room.js`'s
`Table` each orchestrate a hand independently, and that orchestration is not shared.

`engine/cli.js` also re-declared `KINDS` and re-implemented `buildWall`; that copy is
now gone (see KI-05).

**Why this is deferred.** The orchestration in `game.js`'s `main()` — `declareRiichi`,
`collectRon`, call-window arbitration, nagashi payout distribution, chombo settlement —
has **no unit tests**; the only net is the 43-check selftest, which covers it thinly.
Consolidating it means either writing that coverage first, or rewriting both front-ends
at once with a weak safety net. Both are worse than the status quo, so this stays open
until `main()`'s closure logic is characterised. The 19 duplicated helpers *were* worth
removing immediately because the selftest covered them well.

---

## <a id="ki-05"></a>KI-05 ✅ FIXED — `--powers` silently ignored characters it accepted

**Was:** `engine/game.js` accepted eight keys

```js
const POWERS = ['none','saki','kuro','koromo','toki','yuuki','hisa','teru'];
```

but its inline `powerDraw()` only branches on `saki`/`yuuki`, `kuro`, `koromo`, and
`hisa`. **`toki` and `teru` fell through and behaved exactly like `none`** — no warning,
no error. `mako` was not in the list at all despite having a roster file.

Root cause: `toki` and `teru` were never forgotten implementations. They were
display-layer gimmicks in the old `cli.js` ("precog", a streak message) and `game.js`
had copied the key list without the display layer.

**Fixed:**

- `toki` and `teru` removed from `POWERS`; an unknown key is now a **hard error**
  listing the valid keys, instead of a silent fallback to `none`.
- `engine/cli.js` cut from 204 lines to 47: only `eval` survives, which needs nothing
  but the `riichi` package. That removed the third copy of the tile helpers *and* the
  fourth copy of `powerDraw`.
- `engine/tests/offline-rules.test.js` asserts `toki`/`teru` are absent from `POWERS`,
  so they cannot quietly return.
- `game.js`'s header now says plainly that `--powers` drives the inline rig and **not**
  the roster framework, with a pointer to the server for that.

**Still true (part of KI-04):** `game.js --powers X` does not exercise a roster. The
Flow gauge, tiers, `PowerDispatcher`, `dynamicPool` reservations and `awakening.js` are
reachable only via `server/room.js` and the engine unit tests.

---

## <a id="ki-06"></a>KI-06 🟡 CI added; no linter, no release process

- **CI: ✅ fixed.** `.github/workflows/ci.yml` runs on push and PR: `npm ci`, engine
  tests, server E2E, client type-check + build, a CLI smoke check, and the markdown link
  checker. The 344 tests plus the 43-check selftest now run automatically.
- **Markdown link checking: ✅ added.** `scripts/check-links.mjs` (`npm run links`)
  verifies every relative link in every `.md` resolves. It caught real breakage during
  this work and is cheap to run locally.
- **No linter or formatter.** Still no ESLint, Prettier, or `.editorconfig`.
- **Node version: ✅ pinned.** `"engines": { "node": ">=22" }` in all three
  `package.json`s plus the root, and CI runs Node 22 explicitly. No `.nvmrc` yet.
- **Three unrelated versions**: `engine@1.0.0`, `server@0.1.0`, `web-client@1.0.0`,
  with no release process, no changelog, and commit messages like `update`.

---

## <a id="ki-07"></a>KI-07 🟠 The web client has no tests

`web-client/` has no test runner, no `*.test.*`, no test script. Its only automated
gate is `tsc` inside `npm run build` — a pure type-check.

The highest-risk surface in the repo is therefore the least protected: a 1141-line
reactive store, 11 render modules, a Vite proxy, and hand-rolled SVG tile rendering,
all verified by nothing but "does it compile". A UI regression ships silently.

---

## <a id="ki-08"></a>KI-08 🟠 A 12 MB vendored binary with no recorded provenance

`server/public/` contains a **prebuilt WASM client from upstream `riichi_mahjong_rs`**,
committed to git:

```
mahjong-client.aa938046.wasm   ~12.4 MB
mq_js_bundle.382096af.js      minified glue
ws.596d430a.js  storage.c489e133.js  loading.32d3b0bf.js  index.html  favicon.png
```

Nothing in this repo builds it, and **no document records which upstream commit it came
from or how to regenerate it**. The content-hashed filenames are the only provenance
signal. If upstream ships a protocol change, there is no documented way to update this
build, and `web-client/README.md` does not even mention that it exists.

The repo also ships two hand-curated third-party assets with the same problem:
`web-client/src/assets/fluffy-stuff.svg` (218 KB tile sheet) and
`web-client/public/images/sakicardsv13.png` (23 MB card sheet).

---

## <a id="ki-09"></a>KI-09 ✅ FIXED — Silent failure modes

The code prefers to swallow errors. Each of these produced a confusing symptom
rather than a diagnostic. All are now either logged or rejected outright:

| Where | Was | Now |
| --- | --- | --- |
| `server/room.js` roster registry | `try { ROSTERS.x = require(...) } catch {}` | `loadRoster(key, load)` logs `console.warn` naming the key and error, and rejects a module that doesn't export a factory |
| `engine/powers/index.js` hook calls | every hook wrapped in `try/catch` with no log | warns **once per hook name** (rate-limited: `drawWeight` fires on every draw) |
| `server/room.js` `SAKI_POWER_SEATS` | `.filter(...)` silently dropped bad values | names each rejected entry and why: `ignoring 9 (seat must be 0-3), x (not a number)` |
| `server/index.js` `Hello` | answered `Welcome` **without validating `protocol_version`** | rejects an explicit mismatch with `Error{code:'VersionMismatch'}`; omitting the field is still accepted, since it's optional |
| `server/public/` HTTP handler | any read error → `404 not found` | ⚠️ still open — a permissions problem looks like a missing route |

The hook-level `try/catch` is defensible — a cosmetic aura must not break a game — and
is retained. What was wrong was the *silence*: a power could be fully broken and the
suite still passed, because the tests assert the fallback path too. `onPowerDraw` now
prints

```
[power] hook 'onPowerDraw' (seat 0) threw and was ignored: <error>
[power] this power is now inert for the rest of the session
```

once per hook, and `resetHookWarnings()` is exported for tests.

---

## <a id="ki-15"></a>KI-15 ✅ FIXED — Kakan was legal while in riichi, in both rule implementations

Found by the same sweep as KI-13/KI-14 — this time by reading `classifyHumanKan` and
asking what standard riichi says about each branch.

**The rule:** an *ankan* (closed quad) while in riichi is legal **only if it leaves your
waits unchanged**; otherwise it is chombo. A *kakan* (adding the fourth tile to an
existing **pon**) while in riichi is **never legal** — it moves a tile out of the
concealed hand into the meld, which can change the wait, and standard rules forbid it
outright rather than making it conditional.

**The bug:** the kakan branch had no riichi check at all, in *either* rule
implementation — and, on the server, in **two further places**:

| Site | Reached by | Was |
| --- | --- | --- |
| `engine/game.js` human kan offer | offline human | `else if (a.startsWith('kakan') && ponUp) kanChoice = …` — no riichi test |
| `engine/game.js` bot kan offer | offline bots | `else if (ponUp && Math.random() < 0.35) kanChoice = …` — bots would do it too |
| `room.js` `classifyHumanKan`, explicit-tile branch | networked human | returned `{kind:'kakan'}` with no riichi test |
| `room.js` `classifyHumanKan`, auto-detect branch | networked human | returned `{kind:'kakan'}` with no riichi test |
| **`room.js` CPU kan offer (`playTurn`)** | **networked bots** | `kanChoice = { kind: 'kakan' }` — no riichi test |

The server has **two** independent implementations of "may this seat declare a kan":
`classifyHumanKan` for humans and an inline block in `playTurn` for CPU seats. The
first was fixed; the second was missed until a follow-up review — and CPU seats
**bypass `validateAct` entirely** (only the human branch calls it), so the boundary
re-check added to `validateAct` did not cover them either.

So a player in riichi could add a kan to a pon and alter their wait structure with no
chombo penalty, on either rule path, as human or as CPU.

**Fixed at all five sites**, plus defence in depth:

- Each kakan branch now refuses explicitly with
  `'cannot add a kan to a pon while in riichi (chombo)'`.
- `validateAct` re-asserts the rule (covers humans).
- **`doOwnKan` — the single choke point every kan passes through, whatever its
  origin — refuses a kakan from a riichi hand** before touching the hand or melds.
  This is the guard that actually covers bots and any future caller.

### Second finding from the same review: `ankanKeepsWaits` did not fail closed

`engine/helpers.js` documents "fail closed: unknown waits ⇒ treat as wait-changing",
but the guard was `if (!pl.riichiWaits) return false;` — and **`[]` is truthy in JS**. An
empty wait set therefore fell through, and `waitsSetEq(computed, [])` returns `true`
when the computed side is also empty, so an unknown wait set could read as
"unchanged" and permit a chombo. Now `[]` is treated as unknown, and a `kanTile` not
present in the hand is refused rather than silently mishandled.

**Tests:** `server/test/validation.test.js` (37 deterministic tests) pins
`classifyHumanKan`, `validateAct`, `botDecision` and `doOwnKan` — ankan/kakan detection,
both riichi-kan rules, explicit tile-index selection (including index 0, which a `> 0`
guard used to skip), every `validateAct` rejection path, bot discard sanity over 500
draws (the RNG can never index past the candidate list), riichi-locked tsumogiri,
`SAKI_RIICHI_FORCE`, and the `doOwnKan` choke point from both sides.
`engine/tests/rules.test.js` gains a case for the fail-closed behaviour.

Neither seeded offline match contained a kakan-while-riichi situation, so their output
hashes are byte-identical — the fix is surgical and changed no unrelated play.

**Lesson worth recording:** two independent implementations of the same rule decision
existed on the server (human vs CPU), and only one of them was fixed the first time.
When a rule is enforced, enforce it at the **choke point** where the effect happens, not
only at each decision site — hence the `doOwnKan` guard.

---

## <a id="ki-14"></a>KI-14 ✅ FIXED — Riichi sticks vanished at an exhaustive draw

Found by the same method as KI-13: add a missing invariant assertion, then read what
breaks. The bridge E2E test only asserted that final scores were *finite*, never that
they *conserve* — so a money bug sailed straight through.

**The bug:** at an exhaustive draw, `finishHand` ran the noten payments and then only
*reported* the riichi sticks sitting on the table:

```js
riichiSticks: ctx.riichiPool / 1000,   // reported…
                                       // …and never awarded
```

Neither awarded to the tenpai players nor carried forward. The win path awards the pool
to the nearest winner, so **every riichi declared in a hand that ended in an exhaustive
draw destroyed 1000 points.** The new assertion failed with
`final scores must total 100000, got 99000` — exactly one stick, intermittently,
depending on whether that match happened to contain a drawn riichi hand.

**The fix** — implement the actual rule, which also makes it self-balancing:

- **Exhaustive draw:** sticks go to the tenpai players, split as evenly as a whole
  number of points allows (1000 across 3 players is 334/333/333, not 1000/0/0). If
  nobody is tenpai they carry to the next hand, as `engine/game.js` does.
- **Match end:** `run()` settles anything still carried before emitting `GameOver`.
  A quarter of the pot is always exact because the pot is a whole multiple of 1000.

**Tests:** new `server/test/settlement.test.js` (11 deterministic tests) drives
`finishHand` directly with a headless `Table`, covering exhaustive draw (0/2/3/4
tenpai), dealer and non-dealer tsumo, single and double ron, carry accumulation, and
match teardown. The E2E test additionally asserts that every `RoundWon` score
snapshot and the final total are exactly 100 000.

Worth noting how the work went: three of the eleven failures were **my own test
expectations** being wrong (an incomplete hand, a missing `dead` array, forgetting
that declaring riichi adds a han) and one exposed a **flaw in my first fix** — a
`units % 4` remainder scheme that handed one seat the entire 1000 instead of splitting
it. The code was right in every case; the tests were not. That is the argument for
writing the deterministic tests rather than trusting a random match to catch it.

---

## <a id="ki-13"></a>KI-13 ✅ FIXED — Unmapped yaku silently dropped from the wire

Found by probing `server/yaku-map.js`, which had **zero test coverage** — nothing
asserted that a yaku the `riichi` library can actually emit survives translation.

**The bug:** `対々和` (Toitoi, 2 han) and `三暗刻` (Sanankou, 2 han) were in no lookup
table, so `buildYakuList` dropped them. A toitoi or sanankou win reached the client
with a `yaku_list` missing its main yaku while `RoundWon.han` stayed correct — so the
hand's total looked right and its yaku list was quietly wrong. The comment in the file
claimed 人和 and 大七星 were the only unmapped yaku; two more common ones had simply
never been noticed.

**The fix:** mapped them to the correct protocol variants, recovered from the vendored
WASM client binary (serde serialises unit variants as their Rust names, so the enums
are recoverable as contiguous ASCII runs):

| Japanese | Protocol `Kind` |
| --- | --- |
| 対々和 | `AllTriplets` |
| 三暗刻 | `ThreeConcealedTriplets` |

人和 and 大七星 stay dropped — the protocol's `Kind` enum genuinely has no variant for
either — and that is now declared in an exported `UNSUPPORTED_BY_PROTOCOL` set rather
than buried in a comment.

**Also fixed while in there:**
- `rankFromResult` matched `endsWith('倍役満')`, which misses `ダブル役満`; it now
  matches any name containing `役満`.
- `yaku-map.js` exported its tables so tests needn't parse its source.
- Two provably dead map entries (`両立直`, `清一色（喰い下がり）`) are now declared in
  `LEGACY_ALIASES` — kept as insurance against a future lib rename, but asserted to be
  unemitted by the pinned version.

**New test:** `server/test/yaku-map.test.js` (18 tests). Two of them are drift guards
that would have caught this and will catch its recurrence:
1. every yaku the lib can emit is either mapped or explicitly listed as unsupported
2. every `Kind`, `DoraLabel` and `ScoreRank` the map targets is a real enum variant,
   re-verified against the WASM binary

That turns an unaudited translation table into a self-checking one. If a future
`riichi` release adds a yaku, the suite fails and names it.

---

## <a id="ki-10"></a>KI-10 ✅ FIXED — Reconnect silently lost your session

**Was:** `web-client/src/net/socket.ts` reconnects every 2 s on close, but the server has
**no session resume** — `Hello` mints a fresh anonymous token, so the client came back
with no room, no seat, and no game. `GameStore` kept the pre-disconnect state, so the
client *looked* connected while rendering a stale table, and every action returned
`{ Error: { code: 'InvalidAction' } }`. The user had to reload manually.

**Fixed** — `GameStore` now detects the situation and acts on it. On a `disconnected`
status while `screen === 'game'` it calls a new `abandonSession()`, which clears every
piece of game state (hand, discards, melds, scores, dora, actions, call state via the
existing `resetTurnActions`/`resetCalls` helpers, round modal, riichi mode, logs) and
returns to the lobby, then shows an explanatory toast:

> Connection lost. The bridge cannot resume a game, so you have been returned to the
> lobby.

The next `RoomState` / `GameStarted` repopulates everything, so nothing stale survives.
The server side is unchanged — resume is still genuinely unsupported, now honestly so.

---

## <a id="ki-11"></a>KI-11 🟡 Very large files carrying whole subsystems

| File | Lines | Concern |
| --- | --- | --- |
| `server/room.js` | **1800** | `Room` (lobby, seats, power assignment) **and** `Table` (the entire hand driver) in one file |
| `web-client/src/state/store.ts` | **1198** | All game state *and* all outbound protocol calls in one class |
| `engine/game.js` | **898** | Game loop, bot AI, power rig, and the 43-check selftest (was 1006; 131 lines of duplicated helpers removed) |
| `engine/powers/rosters/kiyosumi.js` | 571 | One character's full skill tree |
| `engine/tests/crossCharacter.test.js` | 578 | — |

`room.js` is the direct cause of several items above: the roster registry, the env-var
parsing, the bot pacing, and the rule divergence all live together with no seam.
Splitting `Table` out of `Room` would make KI-04 tractable. Purely mechanical and
low-risk, but it changes no behaviour, so it is not urgent.

---

## <a id="ki-12"></a>KI-12 ⚪ No LICENSE

No `LICENSE` file, despite `engine/` and `server/` depending on the third-party
`riichi` and `syanten` packages and vendoring a FluffyStuff SVG sheet and official
Saki card art. Redistribution terms for the vendored assets are undefined.

Deliberately deferred — this needs a decision from the repo owner, not a code change.

# Part B — Documentation rot

**All nine items below have been fixed.** They are kept as a record of what was wrong
and what the current state is, so the same rot is not reintroduced. Verified after the
fact: 313 tests still pass, and 0 dead relative links across all 21 markdown files.

> **Convention adopted:** cite **symbols, not line numbers**. A `file.js:123`
> citation rots the next time anyone edits above it, which is how every item in this
> section happened. See [`conventions.md`](conventions.md#8-things-not-to-do).

## <a id="dr-01"></a>DR-01 ✅ FIXED — ~40 stale `file:line` citations

`engine-implementation.md` cited line numbers throughout, **30–100 lines** stale — it
cited `game.js:1030` in a 1006-line file. Spot checks at the time:

| Doc said | Actual |
| --- | --- |
| `game.js:308-419` selftest | `game.js:269-380` |
| `game.js:513-534` collectRon | `game.js:474` |
| `room.js:666-704` playTurn | `room.js:746` |
| `room.js:914-964` validateAct | `room.js:996` |
| `room.js:1219-1393` resolveCallWindow | `room.js:1367` |

**Fixed** — every `file:line` citation in `engine-implementation.md` and
`architecture-comparison.md` was replaced with file + symbol (`Table.resolveCallWindow`,
`core.executeDrawStep`, `game.js` `main`, `H.clearTempFuritenOnDraw`, …). Line numbers
now appear only in this register, where they are quoting the old text on purpose.

## <a id="dr-02"></a>DR-02 ✅ FIXED — 7 absolute `file:///` links

`docs/characters/README.md` linked to absolute paths from a collaborator's machine
(`file:///home/laffey/Projects/personal/saki/...`), which resolved nowhere else.

**Fixed** — all 7 are relative (`../engine-design.md`, `./01_saki_miyanaga.md`, …).

## <a id="dr-03"></a>DR-03 ✅ FIXED — ~18 sentences with missing numbers

Numeric values had been stripped, leaving sentences that trailed off
(`"multiplied by ."`, `"within of her starting score ()"`).

**Fixed in two categories:**

- **Implemented characters (8)** — every value was recoverable from
  `docs/characters/*.md` and the roster constants, and has been restored: Saki's
  `±1500` band and `×1.35` affinity, Nodoka's `+3.5%` and `×4.0`, Yuuki's `+3.0%`/
  `+0.75%` and 6 s clock, Mako's `+2.5% +0.5%/turn`, Hisa's `×3.0`/`70%`/`85%`,
  Koromo's `×2.5`, and the wall gates `<= 20` / `<= 14`.
- **Unimplemented characters (~20)** — nothing exists to recover them from, so they are
  now marked **`[unspecified]`** rather than left as broken sentences or silently
  invented. They are also flagged as design intent in a status banner at the top of
  the mechanics section.

## <a id="dr-04"></a>DR-04 ✅ FIXED — `abilities.md` contradicted the specs on ~16 mechanics

A redesign pass updated `docs/characters/*.md` and the rosters but not `abilities.md`.

**Fixed** — all 8 implemented characters were reconciled against their spec, and each
now carries a **Canonical source** line naming the spec file and the roster constants.
The redesigned tiers are documented with a note about what they replaced:

- **Yuuki T4** — was "75% chance to deal directly into her wait"; now **Turn-4 Tenpai
  guarantee + 75% Tsumo boost**, annotated as replacing the removed mind control.
- **Hisa T1** — was "Bluff Riichi" waiving the no-ten penalty; now **Phantom
  Intimidation** (aura only, no Riichi declared, 3 turns not 4).
- **Koromo T1** — was a 2 s decision window; now **5 s threshold, −5% Flow/sec**.
- **Nodoka T2** — was "90% accuracy + Ron immunity"; now the **intersection of 100%
  safe tiles**, with an explicit note that Ron immunity was removed as engine-breaking.
- **Yuuki's turn clock** — 4 s → **6 s**.
- **Mako** — `+15%/turn` → **`+2.5%` at T7 then `+0.5%/turn`**; `-15%/+30%` →
  **`-10%/+35%`**.
- **Hisa T4** — wall `<20` → **`<25`**; 1,000-pt cap → **50% mitigation**;
  2 rotations of furiten → **4 s decision window**; Haitei 90% → **85%**.
- **Yuu Matsumi** — renamed from "Thermal Affinity" to the code's actual
  **"Hot Dams"**, `MANZU_CHUN_BIAS = 1.35`.

The 8-implemented / ~20-design-intent split is now stated in a banner at the top of
`abilities.md`.

## <a id="dr-05"></a>DR-05 ✅ FIXED — `engine-design.md` named files and APIs that don't exist

- The §7 roster tree listed `rosters/ryuumonbuchi.js` and `rosters/shiraitodai.js` —
  **neither exists**. **Fixed** — the tree is now the real 8 files, each labelled with
  its character, plus the previously-unlisted `core.js`, `tiles.js`, `rng.js`,
  `rules-config.js`, `invariants.js`, `replay.js`, `input.js`, `awakening.js`,
  `nodokaEval.js`, and `mjaiAdapter.js`.
- The tree claimed `kiyosumi.js` held five characters. **Fixed** — one file per
  character.
- §7 pseudo-code showed `DynamicPool.sample(state.pool, weights, state.rng)`. The real
  signature is `sample(weights)` on a bound pool. **Fixed** — and while correcting it,
  a latent **double-decrement bug** was removed: `sample()` already calls
  `this.decrement(k)` internally (`dynamicPool.js`), so the documented explicit
  `state.pool.decrement(drawnTile)` would have corrupted tile counts.
- §1 promised "PCG32/xoshiro256"; `engine/rng.js` uses **mulberry32**. **Fixed**.
- §6 self-contradicted on the Flow starting value. **Fixed** — now states that seats
  start at 0 but the `FlowManager` **pre-charges flow seats to 50 each hand**, which
  matches the `gauge: 33` / `Flow: 50 / 150` indicator the client renders.
- §6 thematic accelerators repeated three stale numbers (Nodoka, Yuuki, Mako).
  **Fixed** with the spec values and an inline note that the spec wins.
- §8's "any new character from the 50+ cast" is now marked aspirational, with the
  real 8-of-28 coverage.

## <a id="dr-06"></a>DR-06 ✅ FIXED — `engine-implementation.md` documented fixed bugs as live

1. *"game.js and cli.js duplicate these helpers locally instead of importing
   tiles.js"* — was false for `game.js`. **Fixed**: the doc now says `game.js` imports
   from `./tiles` (that dedup completed) and flags `cli.js` as the one remaining
   duplicate, which is true.
2. *"temp furiten currently clears even in riichi"* / *"known bug: standard riichi
   rules require furiten to persist permanently"* — **fixed** at `game.js:518` and
   `room.js:754` (`H.clearTempFuritenOnDraw`), pinned by
   `engine/tests/furiten-riichi.test.js`. The doc now quotes the actual guard
   (`if (!me.riichi && !me.doubleRiichi)`) and cites the regression suite.

## <a id="dr-07"></a>DR-07 ✅ FIXED — stale counts in `architecture-comparison.md`

- *"node --test tests/ — 254 pass"* → **342**, and the command is now the working glob
  form.
- *"server npm test — 2 pass"* → **71**.
- §3 listed the furiten bug as a live risk while §5 listed it fixed. **Fixed** — §3
  items now carry **[FIXED]** / **[OPEN]** / *partly* tags, and §4's phases are marked
  ✅ / ⚠️ with the residual work named (e.g. `cli.js` still duplicates `KINDS`;
  nothing persists replay journals to disk).
- §4 Phase 3 named a fixture directory `engine/tests/rules/`; what shipped is the file
  `engine/tests/rules.test.js`. **Fixed** — the status now notes the substitution.
- The `rules.test.js` (27) and `furiten-riichi.test.js` (5) counts were already correct
  and are unchanged.

## <a id="dr-08"></a>DR-08 ✅ ANNOTATED — ~60 unresolvable citations to `reference/`

`reference/` is gitignored, so none of these paths resolve in a fresh clone.

**Fixed by disclosure rather than deletion** — deleting them would destroy the research
value. `reference-riichi-advanced.md` and `architecture-comparison.md` now open with a
banner stating that `reference/` is not committed, that every `path:line` citation there
is **unverified** without a manual clone, and that the document is background reading
rather than a spec. The one path that had drifted from our own tree
(`sakicardsv12/v13.png`) now points at our actual vendored copy.

Still open if you want it closed properly: vendoring the handful of upstream files that
are actually cited.

## <a id="dr-09"></a>DR-09 ✅ FIXED — smaller inaccuracies

| Claim | Was | Now |
| --- | --- | --- |
| "any of the **six** Saki-character rosters" | `server/README.md` | A **table of all eight** registry keys → roster files → characters, flagging the two normal-type ones and the silent-`catch` failure mode |
| "bundle size is ~250 kB total" | `web-client/README.md` | Per-asset table: ~280 kB JS, ~46 kB CSS, **~23 MB** PNG, with a note to budget for the sprite sheet |
| "**production-ready** technical implementation specifications" | `docs/characters/README.md` | Reframed as **design specifications** with illustrative pseudo-code, plus an explicit note that `saki-normal` and `yuu` have no spec |
| "50+ Saki cast" fully combinable | `engine-design.md` | Marked aspirational with real 8-of-28 coverage |
| Undocumented env vars | — | `PORT`, `SAKI_POWER_SEATS`, `BOT_DELAY_MS`, `NODE_ENV`, `SAKI_RIICHI_FORCE` now in both `docs/development.md` and `server/README.md` |
| `run_server.sh` / `run_server.bat` referenced by nothing | — | Documented in the root README, `docs/development.md` §3, and `web-client/README.md` |
| "two clients, one server" | — | Both READMEs now explain `web-client/` vs the vendored WASM client in `server/public/` |
| Reconnect listed as "excluded" but attempted by the client | — | `server/README.md` now carries the reconnect caveat and the stale-store symptom |

---

# Suggested order of work

Docs are consistent and CI is green. These are the remaining **code** items:

| # | Action | Cost | Fixes |
| --- | --- | --- | --- |
| 1 | ~~Fix `npm test` in both packages~~ | ✅ done | KI-01 |
| 2 | ~~Fix all doc rot (DR-01 – DR-09)~~ | ✅ done | Part B |
| 3 | ~~Fix the CLI arg parser (`--flag value` produced NaN, 0 hands played)~~ | ✅ done | new |
| 4 | ~~GitHub Actions workflow + `scripts/check-links.mjs`~~ | ✅ done | KI-06 |
| 5 | ~~`"engines": { "node": ">=22" }` in all `package.json`s~~ | ✅ done | KI-06 |
| 6 | ~~Warn on roster-load and hook failures~~ | ✅ done | KI-09 |
| 7 | ~~Reset the session on reconnect instead of showing a zombie table~~ | ✅ done | KI-10 |
| 8 | ~~Move `server/helpers.js` → `engine/helpers.js`; delete `game.js`'s 19 duplicate fns~~ | ✅ done | KI-03 |
| 9 | ~~`cli.js` → `eval` only; drop `toki`/`teru`; error on unknown `--powers`~~ | ✅ done | KI-05 |
| 10 | ~~npm workspaces: one `npm ci`, one lockfile, single `riichi`/`syanten`~~ | ✅ done | KI-02 |
| 11 | ~~`game.js` export guard + `engine/tests/offline-rules.test.js` (31 tests)~~ | ✅ done | KI-04 (partial) |
| 12 | ~~Reject `Hello` on `protocol_version` mismatch~~ | ✅ done | KI-09 |
| 13 | ~~Warn on dropped `SAKI_POWER_SEATS` values~~ | ✅ done | KI-09 |
| 14 | ~~Cover `yaku-map.js`; fix the dropped Toitoi/Sanankou~~ | ✅ done | KI-13 |
| 15 | ~~Assert score conservation; fix riichi sticks lost at an exhaustive draw~~ | ✅ done | KI-14 |
| 16 | ~~Log 500s distinctly from 404s in the static handler~~ | ✅ done | KI-09 |
| 17 | Add a LICENSE; record `server/public/` provenance | 1 h | KI-08, KI-12 |
| 17a | Sweep `resolveCallWindow` and the scoring path for the same duplicated-rule pattern as KI-15 | 3 h | KI-04 |
| 18 | Add an `.nvmrc` | 2 min | KI-06 |
| 19 | ~~Pin the kan/riichi rules across every decision site + `doOwnKan`~~ | ✅ done | KI-15 |
| 20 | ~~Cover `botDecision` and the `doOwnKan` choke point~~ | ✅ done | KI-15 |
| 21 | Characterise `game.js` `main()` closures with unit tests | 4 h | prerequisite for 23 |
| 22 | Add client tests (Vitest + jsdom) for `store.ts` and tile rendering | 1 d | KI-07 |
| 23 | Consolidate the two rule front-ends behind one shared layer | 2–3 d | KI-04 |
| 24 | Split `Table` out of `server/room.js` | 3 h | KI-11, unblocks 21–23 |

The one genuinely large remaining item is **23**, and it should not be started before
**21**: `main()`'s orchestration is the only significant block of logic in the repo with
thin coverage, so consolidating it before characterising it would mean rewriting the
weakest-tested code in the project.

**The method that found KI-13 and KI-14 is cheaper than any refactor here.** Neither
bug was on this register. Both came from two questions: *which source file has no test
touching it?* and *what invariant is asserted nowhere?* `server/yaku-map.js` answered
the first, score conservation answered the second. `server/room.js` is the same shape
and bigger — **19** continues that sweep, and needs no design decisions at all.
