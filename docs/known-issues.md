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
| `server/table.js` | `require('./helpers')` → `require('../engine/helpers')` |
| `engine/tests/edge.test.js` | `require('../../server/helpers')` → `require('../helpers')` |
| `engine/tests/furiten-riichi.test.js` | same |
| `engine/tests/rules.test.js` | same |

The dependency graph is now one-directional: `server/` → `engine/`, never the reverse.

**Also fixed while in there:** `engine/game.js` had been keeping **19 verbatim copies**
of the functions in `helpers.js`, annotated "canonical copy … keep in sync". They were
byte-identical (`isNagashi`) or strictly better (`botDiscard` gained a `rand`
injection parameter). `game.js` now imports all of them, deleting **131 lines**
(1029 → 898) with **zero behaviour change** — verified by byte-identical output hashes
on two seeded 4-hand matches before and after, plus the 48-check selftest.

---

## <a id="ki-04"></a>KI-04 🟡 Two rule front-ends that diverge (shared rules now deduplicated)

The same rules are implemented twice, and the two copies disagree:

| | Offline — `engine/game.js` | Network — `engine/core.js` + `server/table.js` |
| --- | --- | --- |
| Wall | pre-shuffled array, `wall.pop()` | `DynamicPool` weighted sampling |
| Length | tonpuusen or hanchan (`--kyoku`) | tonpuusen only |
| Abortive draws | **all five on** | **all five off** |
| Nagashi mangan, oka/uma | yes | no |
| Character powers | **inline `powerDraw()`, not the roster framework** | full `PowerDispatcher` + `rosters/` |

**Still open.** A rule fixed in `game.js` is not automatically fixed in `table.js`. This
has already happened: the permanent-riichi-furiten bug existed on both sides and needed
two fixes plus a regression suite. The divergence is at least *declared* in
`engine/rules-config.js` (`RULES.aborts` vs `RULES.serverAborts`) — but nothing reads
those two objects, because the server has no abort handlers to switch on. They document
intent; they do not enforce it.

**Reduced, not closed.** The *shared rule functions* are no longer duplicated —
`engine/helpers.js` is now the single definition for waits, furiten, bot decisions,
abort conditions and oka/uma, and `game.js` imports all of them (see KI-03). What still
differs is the **rule front-ends**: `game.js`'s `main()` and `server/table.js`'s
`Table` each orchestrate a hand independently, and that orchestration is not shared.

### `rules-config.js` was dead, and is now live

Worth recording because it is the whole mechanism of this issue in miniature. The file
claimed to be "shared rules configuration" and `rules.test.js` asserted its values were
correct — but **no production code imported it**. Both front-ends hardcoded their own
copies of every number, which is precisely how they drifted.

Both now read it (`engine/game.js`, `server/table.js`), so these cannot diverge:

| Constant | Was | Now |
| --- | --- | --- |
| start score | `25000` in both | `RULES.startScore` |
| riichi stake | `-= 1000` in both | `RULES.riichiValue` |
| honba per payer (tsumo) | `+ 100 * honba` in both | `RULES.honbaTsumo` |
| honba per win (ron) | `+ 300 * honba` in both | `RULES.honbaRon` |
| noten schedule | `[0, 3000, 1500, 1000][n]` inline | `RULES.notenTotal` |

`engine/tests/rules-config-parity.test.js` (7 tests) keeps it that way. It asserts the
config is *imported and referenced* — not merely correct, which is the check that let
the file stay dead — and fails if either front-end reintroduces a literal copy of one of
the expressions above. Verified to bite: reinstating `+ 300 * honba` in `game.js` fails
it.

### What is genuinely still not shared

Being precise about the remaining scope, because "consolidate the front-ends" reads
like one task and is not:

- **The turn loop itself.** `game.js main()` is a `while` loop with decisions inline;
  `Table` is an async phase machine that awaits a WebSocket reply per decision. They
  have different control architectures because one is a CLI and the other is a server.
  Merging them means rewriting both, not extracting a shared function — which is why
  item 23 was scoped at 2–3 days.
- **Abortive draws.** `game.js` implements all five; `Table` implements none. The
  handlers do not exist server-side, so no amount of sharing fixes this — it needs
  writing, and `RULES.aborts` / `RULES.serverAborts` already flag the intent.
- **Nagashi mangan, oka/uma, agari-yame, enchousen.** Offline only. Oka/uma is a
  scoring concern with no network equivalent (the client computes its own standings).
- **Character powers.** `game.js --powers` drives a small inline `powerDraw()` and is
  explicitly *not* the roster framework; only the server path exercises
  `PowerDispatcher` + `rosters/`.

None of these is accidental any more; they are declared. The residual risk is that a
*new* rule gets added to one side only — which is what the parity test now catches for
the numbers, and what still needs discipline for the orchestration.

`engine/cli.js` also re-declared `KINDS` and re-implemented `buildWall`; that copy is
now gone (see KI-05).

**Why this was deferred, and what has since changed.** The orchestration in `game.js`'s
`main()` — `declareRiichi`, `collectRon`, call-window arbitration, nagashi payout
distribution, chombo settlement — had **no unit tests**; the only net was the selftest,
which covered it thinly. Consolidating it would have meant writing that coverage first,
or rewriting both front-ends at once with a weak safety net.

**Item 21 supplied that net** — 12 characterisation tests in
`engine/tests/main-orchestration.test.js`, plus a golden match fingerprint — which is
what made starting this safe. It is still *characterisation*, not a suite written against
intended rules: it pins current behaviour, so a consolidation has something to fail
against, but it will not tell you the current behaviour is right. Both are worse than the status quo, so this stays open
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
reachable only via `server/table.js` and the engine unit tests.

---

## <a id="ki-06"></a>KI-06 🟡 CI added; no linter, no release process

- **CI: ✅ fixed.** `.github/workflows/ci.yml` runs on push and PR: `npm ci`, engine
  tests, server E2E, client type-check + build, a CLI smoke check, and the markdown link
  checker. The 369 tests plus the 48-check selftest now run automatically.
- **Markdown link checking: ✅ added.** `scripts/check-links.mjs` (`npm run links`)
  verifies every relative link in every `.md` resolves. It caught real breakage during
  this work and is cheap to run locally.
- **No linter or formatter.** Still no ESLint, Prettier, or `.editorconfig`.
- **Node version: ✅ pinned.** `"engines": { "node": ">=22" }` in all three
  `package.json`s plus the root, CI runs Node 22 explicitly, and a root `.nvmrc`
  pins `22` for version managers.
- **Three unrelated versions**: `engine@1.0.0`, `server@0.1.0`, `web-client@1.0.0`,
  with no release process, no changelog, and commit messages like `update`.

---

## <a id="ki-07"></a>KI-07 ✅ FIXED — the web client had no tests

`web-client/` had no test runner, no `*.test.*`, no test script. Its only automated
gate was `tsc` inside `npm run build` — a pure type-check.

The highest-risk surface in the repo was therefore the least protected: a 1199-line
reactive store, 11 render modules, a Vite proxy, and hand-rolled SVG tile rendering,
all verified by nothing but "does it compile". A UI regression shipped silently.

**Fixed** — Vitest 5 + jsdom, three files, **80 tests**, wired into `npm test`,
`npm run check` and CI (which had been carrying a comment saying no suite existed).

| File | Tests | Covers |
| --- | ---: | --- |
| `src/tiles/tile-utils.test.ts` | 40 | wire index ↔ face for all 34 tiles, red-5 handling, hand sorting, kuikae bans, the dora-indicator cycle, shanten/hairi |
| `src/tiles/svg-tiles.test.ts` | 14 | `renderTile` markup, every state class, the dora title, click/hover wiring, sprite injection |
| `src/state/store.test.ts` | 26 | `RoomState`, `GameStarted`, errors, reconnect, `GameOver` |

**It found a real bug on the first run.** `store.ts` translated three server errors
into friendlier text by testing `errMsg.toLowerCase().includes('notinturn')` — but
`errMsg` is the server's *prose* message (`'not your turn to act'`), while the stable
token lives in the separate `code` field (`'NotInTurn'`). Two of the three translations
could therefore never fire, and the player saw the raw lowercase server string. The
`kuikae` case only worked by luck, because that word genuinely appears in its message.
Now matches on code **and** message, with all three payloads copied from `table.js`.

Three things the suite deliberately does **not** claim:

- **Shanten parity with the engine is asserted, not assumed.** The client wraps the
  `syanten` package; the values were cross-checked against `engine/helpers.js`
  `shantenOf` on seven hands (0 mismatches) and those are the values pinned. An empty
  hand returns `-2` from the upstream package on **both** sides — recorded rather than
  "fixed", because changing only the client would create a KI-04 divergence.
- **The dora cycle is the engine's, not the textbook one.** Winds cycle
  `1z→2z→3z→4z→1z` and dragons `5z→6z→7z→5z`, so a North indicator points at East,
  not at White. The client's table already matched `engine/tiles.js`; the first version
  of the test asserted the textbook rule and failed.
- **`injectTileSprite` is guarded by a module-level flag**, so it cannot be re-run once
  the DOM node is gone. Harmless in the app (the body persists) but it makes the
  function untestable in place, so its tests reset the module registry instead.

---

## <a id="ki-08"></a>KI-08 🟡 A 12 MB vendored binary with no recorded provenance — now recorded, upstream commit still unknown

`server/public/` contains a **prebuilt WASM client from upstream `riichi_mahjong_rs`**,
committed to git:

```
mahjong-client.aa938046.wasm   ~12.4 MB
mq_js_bundle.382096af.js      minified glue
ws.596d430a.js  storage.c489e133.js  loading.32d3b0bf.js  index.html  favicon.png
```

Nothing in this repo builds it, and **no document recorded which upstream commit it came
from or how to regenerate it**. The content-hashed filenames were the only provenance
signal. If upstream ships a protocol change, there was no documented way to update this
build, and `web-client/README.md` did not even mention that it exists.

**Fixed by [`provenance.md`](provenance.md)**, which records the full inventory with
SHA-256s, a re-verification command, and the manual update procedure. Two things worth
recording about how that was done:

- **The upstream commit is still unknown, and the new doc says so rather than guessing.**
  The filename suffixes are bundler content hashes; nothing in the artefacts maps them to
  a commit. The bundles were searched for version/commit literals (`aa938046`,
  `382096af`, `protocol_version`, `version`) and **contain none**. So "which commit?" is
  only answerable by rebuilding upstream and re-recording — the doc is honest about that
  instead of inferring an answer from a filename.
- **The doc also records a confusion worth naming: there are two clients.** `server/public/`
  is the prebuilt upstream one; `web-client/` is the separate Vite + lit client under
  development. They are independent, and conflating them is easy.

What remains genuinely open is that `server/protocol.js` speaks `PROTOCOL_VERSION = 6`
and **nothing in the repo proves this build is v6-compatible** — it is the build the
server was developed against, which is belief, not evidence.

Still unrecorded, and now listed as such in `provenance.md`: the upstream revision behind
`web-client/src/assets/fluffy-stuff.svg` (218 KB tile sheet) and the source plus
redistribution terms for `web-client/public/images/sakicardsv13.png` (23 MB card sheet).

---

## <a id="ki-09"></a>KI-09 ✅ FIXED — Silent failure modes

The code prefers to swallow errors. Each of these produced a confusing symptom
rather than a diagnostic. All are now either logged or rejected outright:

| Where | Was | Now |
| --- | --- | --- |
| `server/rosters.js` roster registry | `try { ROSTERS.x = require(...) } catch {}` | `loadRoster(key, load)` logs `console.warn` naming the key and error, and rejects a module that doesn't export a factory |
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

## <a id="ki-24"></a>KI-24 ✅ FIXED — `docs/development.md` was overwritten with the whole known-issues register

Not found by inspection: found by noticing that a documentation edit reported success
against text that should not have been in that file. `docs/development.md` had been
replaced, wholesale, with a copy of `docs/known-issues.md` — same title, same 22 sections,
1 113 lines instead of 290.

**How it hid.** Every link into `development.md` still resolved, `npm run links` was
green, `npm test` was green, and both files had drifted only slightly (23 vs 22 anchors).
The link checker validates link *targets*, never the content at them, so a document
replaced by a wrong document is invisible to it. It was also invisible to me for four
commits, because the edits I was making were mostly to the register text — which the
clobbered file also contained, identically.

**Cause:** one of my scripted `Get-Content … -Raw` / `Set-Content` doc edits wrote the
register's content into `development.md`. Which script exactly is not worth reconstructing;
the lesson is that editing docs with a throwaway shell loop and no read-back is how you
delete a file without noticing.

**Recovered** from `0ca46d3`, the last commit where it was still the Development guide
(290 lines, 7 sections). The four legitimate edits made since — test counts, the
`table.js` split, `main-orchestration` and `rules-config-parity`, the corrected KI-04
wording, the expanded client test layer — were re-applied and verified. Both anchors
pointing into it (`#33-running-the-engine`, `#5-testing`) were checked to resolve against
the restored headings.

**Guard added.** `scripts/check-links.mjs` now fails on **duplicate document titles**,
because two files claiming the same H1 is almost always one having been overwritten with
the other, and that is precisely what a link check cannot see. Verified to catch this
exact case: with `development.md` re-clobbered it exits 1 naming both files. The message
points at `git log --follow`.

Worth stating plainly: this was my error, caught late, and the reason it survived four
commits is that nobody — including the tooling — was checking document *identity*, only
document *links*.

---

## <a id="ki-23"></a>KI-23 ✅ FIXED — the client UI layer had no tests, and testing it found two bugs

Extending item 22 from the store and tile layer to the 14 lit-html components. An audit
of which source files no test imports put all the remaining risk in one place: the
engine, the bridge and the store were covered, and every unreferenced production file
was a component or `socket.ts`.

The first audit said 44 of 52 files were untested, which was **the audit being wrong**:
this repo imports modules without the `.js` extension (`require('../yaku-map')`), so both
spellings had to be tried or `yaku-map.js` — which has a whole test file — looked dead.

**Two bugs, both in the "silent, no crash, board lies" class:**

1. **`GameSocket` reported subscriber exceptions as parse failures.** `onmessage` wrapped
   both `JSON.parse` *and* the handler dispatch in one `try`. A throw inside
   `GameStore.handleServerMessage` was logged as `[ws] Failed to parse message`, which
   points an investigator at the wire format when the fault is in the code reacting to
   it. Worse, `forEach` inside the same `try` meant the first throwing subscriber meant
   later subscribers never saw the message at all. Parse and dispatch are now guarded
   separately, and each subscriber is isolated.

2. **The action log was a keyboard trap.** `game-log.ts` marked its header
   `role="button" tabindex="0"` — and it was the *only* element in the entire client
   carrying those attributes, with no key handler anywhere in the codebase. So it was
   focusable and announced as a button to assistive tech while Enter and Space did
   nothing: a WCAG 2.1.1 Keyboard failure. Now handles both keys, as a native `<button>`
   would.

**Also fixed in the tests themselves:** `toBe`/`toEqual` were being called with a second
argument for a message, which `tsc` rejects — and `npm test` was failing on it while the
test counts still printed green. Worth noting: the counts looking green is not the same
as the suite passing, and the exit code is the thing to read.

**Two behaviours recorded rather than changed**, because both readings are defensible
and picking a side is a design call:

- A **kuikae-banned tile still gets the `--clickable` class** while also being grayed.
  The class gives `cursor: pointer` and a hover lift, so the tile reads "unavailable" and
  "come click me" at once. Clicking is routed correctly (to the explanatory handler,
  never to discard), so nothing is lost — but the styling contradicts itself.
- **`renderSakiCard` has `onClick` and `disabled` props that no caller uses.** All four
  call sites pass neither, so the `disabled`-does-not-suppress-`onClick` gap is currently
  unreachable.

**Tests:** 145 new client tests across four files — `components` (melds, discards,
saki-card), `interactive-components` (hand, action bar), `display-components` (center
info, game log, power badge) and `socket`. Client suite 80 → **225**.

Untested still: `board.ts` (219 lines, mostly composition), `round-modal.ts` and
`lobby-view.ts`. Recorded rather than glossed.

---

## <a id="ki-22"></a>KI-22 ✅ FIXED — kyuushu-kyuuhai counted tiles instead of kinds, and bots declared it illegally

Found by the last part of the item-23 sweep: checking that `main()`'s abort *detection*
is reachable, not just that the abort *settlement* works. `--demo-abort` forces an
abort, so it had never exercised the condition that triggers one.

**The rule:** 九種九牌 literally means "nine **kinds**" of honours and terminals.
riichi.wiki's *Tochuu ryuukyoku* page: "a player's 14-tile hand after the initial draw
has **9 different types** of honor/terminal tile, the player may announce this."

**Two bugs in one block:**

```js
const terms = countYaochuu(P[q].hand);   // counts TILES
if (terms >= 9) {                        // so the gate used the wrong metric
  ...
  declare = distinct < 9 && Math.random() < 0.8;   // ...and this is inverted
```

1. The gate counted tiles, so `1111m 1111p 99s` — **nine tiles, three kinds** — passed
   it. That is not a legal declaration.
2. The bot branch then declared when `distinct < 9`, i.e. **precisely when the abort was
   illegal**. The author had clearly worked out the distinct-kind rule (that line computes
   it) but wired it to the wrong side of the comparison.

Together: a bot holding a legal 9-kind hand could refuse to abort, while a bot holding
three kinds of yaochuu could declare an abort nobody is allowed to call. The human path
was also wrong — the player was prompted with a tile count and could accept an illegal
abort.

**Fixed** — `engine/helpers.js` gains `distinctYaochuu(hand)` alongside the existing
`countYaochuu`, which still counts tiles and is now used only for reporting. The gate,
the printed number and the bot decision all use distinct kinds. The bot keeps its
original 0.8 declaration rate: bot *policy* is a judgement call and the bug here was
legality, not taste.

**Tests:** five new selftest checks (duplicates never turn three kinds into nine; nine
kinds is the inclusive boundary; Simples do not dilute the count) and a
`rules.test.js` case that pins the two metrics against each other, including that an
aka 5 counts as a 5 and never as a terminal. The offline hash for seed 42 is
**unchanged** — that particular match contains no kyuushu declaration, which is itself
confirmation the fix only alters hands where the rule was being violated.

### Follow-up: four of the five abortive draws are unreachable in bot play — now CLOSED

While pinning the fix, `main()` was run over **40 seeded matches** and every
abortive-draw path counted:

| Abortive draw | Occurrences in 40 matches |
| --- | ---: |
| kyuushu-kyuuhai | 1 (seed 2) |
| suufon-renda | 0 |
| suukaikan | 0 |
| suucha-riichi | 0 |
| triple ron | 0 |
| *(for comparison)* enchousen | 26 |
| *(for comparison)* agari-yame | 4 |
| *(for comparison)* nagashi mangan | 0 |

So the detection *wiring* for four of the five aborts had never been exercised by
anything, including this work. `--demo-abort` covers their **settlement** — and the
settlement is genuinely shared now — but it bypasses detection entirely by injecting the
abort directly. The pure predicates (`isSuufonRenda`, `isSuukaikanAbort`) are unit
tested; what was untested is that `main()` ever *reaches* them under the right
circumstances.

That was a real coverage gap, not a bug: the bot policies simply never produce the
situations. Four identical opening wind discards, four kans split between players, all
four players riichi, and three players tenpai on the same tile are all rare between
bots. A wider sweep — **600 seeds with `--riichi-always`** — still produced zero of the
four, so the gap was the rules rather than a narrow search. (Both sweeps are seeded, so
neither was flaky; `--seed` replaces `Math.random` wholesale at `game.js:113`, which is
what makes a sweep meaningful at all.)

**Now closed by `--force-abort=NAME`.** It forces the *detection* to report true while
leaving every guard before it real, so the accumulator feeding the site, the flag it
sets and the shared settlement all run for real. This is deliberately a different seam
from `--demo-abort`:

| | `--demo-abort` | `--force-abort` |
| --- | --- | --- |
| Injects at | the settlement | the detection |
| Guards before it | skipped | still executed |
| Covers | settlement only | accumulator, flag, detection, settlement |

For suufon-renda specifically the guard is `firstLapDiscards.length === 4`, so the forced
run still has to collect a genuine uninterrupted first go-around — only the content test
("were all four the same wind") is overridden. The predicates stay covered by the
`selftest` cases in `game.js`, so nothing is traded away to make the forced tests pass.

Two of the detections appear at several call sites (suukaikan twice, triple ron five
times), so each is routed through a single `suukaikanAbort()` / `tripleRonAbort()`
helper. Otherwise `--force-abort` could be wired into one site and forgotten at another —
the same "one site of N was tested" trap as the
[KI-21](#ki-21) regression, caught here by construction instead of by review.

`main-orchestration.test.js` gained six tests: one per rare abort asserting detection,
point conservation, the pot being carried intact, exactly one honba and the same-dealer
redeal; one asserting a forced abort never reports a winner or a payee; and one asserting
none of the four occur naturally over the `SEEDS` set — kept as a test so the rarity claim
cannot quietly become false, and so that if one ever *does* start happening on its own,
someone is told to pin it by seed instead of forcing it. Engine 369 → 375.

Verified to bite: making the abort settlement award the pot instead of carrying it fails
the suucha-riichi test; dropping `--force-abort` from the suufon site fails the suufon
test.

The generalisation, which now runs in both directions: **if the reason a path is hard to
test is that it is rare, then reach it by forcing the *earliest* real condition, not by
injecting the outcome.** Forcing the outcome tests the settlement you already had covered;
forcing the detection tests the wiring you did not.

The one abort bots *do* reach — kyuushu on seed 2 — remains pinned end to end by a test in
`main-orchestration.test.js`, covering detection, the no-points-moved settlement, the extra
honba and the same-dealer redeal. It is verified to fail if the KI-22 tile-count gate is
put back.

---

## <a id="ki-21"></a>KI-21 ✅ FIXED — a drawn hand silently destroyed its riichi sticks, intermittently

Found by running the bridge E2E repeatedly (40+ times) rather than once, after the
[KI-20](#ki-20) triple-ron work. Roughly **one run in six** failed with:

```
RoundWon #0 scores must total 100000, got 99000
```

— exactly one 1000-point riichi stick. The failure was in `playOneHand`, *after*
settlement:

```js
} else {                        // exhaustive draw
  this.honba++;
  this.riichiCarry = this.ctx.riichiPool;   // <-- the bug
```

`finishHand` had **already** moved `ctx.riichiPool` onto `this.riichiCarry` and zeroed
the hand's pool. So this line read a drained pool and overwrote a real carry with `0`,
destroying every stick left on the table.

**Why it survived so long.** It was written as part of the [KI-14](#ki-14) fix, at a
moment when `finishHand` only carried the pot in the nobody-is-tenpai case, so the two
assignments did not yet collide. Nothing caught it because:

- The `finishHand` unit tests **cannot** see it. They call `finishHand` directly, which
  never runs the code after settlement. My own header comment in that file admitted the
  E2E "only catches that by luck" — this was that luck, failing 15% of the time.
- It is order-dependent: it only fires when a hand ends drawn *with* a stick on the
  table, which a seeded match hits rarely.

**Fixed** by removing the duplicate assignment. The post-settlement decision was then
**extracted into `Table.applyPostSettlementFlow`**, so the seam where the bug lived is
directly callable — though as the follow-up below records, callable turned out not to
mean covered, and the extraction itself broke the call site.
`finishHand` now returns a consistent `{ aborted }` descriptor rather than sometimes
returning nothing.

**Tests:** six new cases in `server/test/settlement.test.js` call the extracted method,
including a sweep of every branch shape with the hand pool already drained, and an
assertion that the carry survives. Verified to bite: reintroducing the one line fails
two of them. Bridge E2E: 0 failures in 60 consecutive runs after the fix, against
roughly 1 in 6 before.

### Follow-up: the E2E match is now seedable

The deeper problem was that `Room.startGame` seeded from `Math.random()`, so every
assertion in the bridge E2E test was a probability rather than a guarantee — which is why
this bug presented as "fails sometimes" instead of "fails". `SAKI_SEED` now pins it, and
`resolveMatchSeed()` is exported so the behaviour is testable without connecting a client
(deriving it inline meant it could only be checked by playing a match, and an env var that
is accepted then ignored still *looks* deterministic when one seed in a row happens to
repeat). A non-numeric value warns and falls back to random, matching the treatment of
`SAKI_POWER_SEATS`.

Verified: three consecutive E2E runs produce an identical game — same final scores
`19400/20400/30800/29400` — and a different `SAKI_SEED` yields a different seed.

**What this does and does not buy, stated honestly.** It turns every other E2E assertion
from probabilistic into a guarantee, and makes any *observed* failure exactly reproducible
via `BRIDGE_TEST_SEED`. It does **not** increase coverage of this particular path: the
mock client is bot-legal (it accepts every tsumo and ron, passes every pon and chi,
discards tsumogiri), so hands usually end in wins and a drawn hand carrying a riichi stick
is uncommon — roughly one match in six. Sweeping 12 fixed seeds with the leak deliberately
reintroduced did not reproduce it, which is a coverage limit, not a determinism one.

The regression for this bug therefore lives in the unit tests above, which construct the
scenario exactly and fail deterministically. Making the E2E cover it would mean giving the
mock client a policy that sometimes declines a winning tile — recorded here rather than
done, because a client that declines wins also makes the rest of the E2E harder to assert
on.

A class of bug this is worth naming: **two places both "handling" the same value**, with
no single owner. The fix was to give `finishHand` sole ownership of the carry and delete
the second writer, not to adjust both.

### Follow-up: the extraction introduced a worse bug in the call site

The paragraph above claims the extraction made the seam "directly callable and
testable — the thing that made it invisible in the first place." **That claim was false,
and the fix it shipped was worse than the bug it was fixing.**

`playOneHand` called the new method with three arguments into a four-parameter
signature:

```js
const keepDealer = this.applyPostSettlementFlow(outcome, winBy, dealer);
...
applyPostSettlementFlow(outcome, winBy, winner, dealer) {   // dealer === undefined
```

So `dealer` arrived as `undefined`, and both `winner === dealer` (tsumo) and
`winBy.hits.some(h => h.seat === dealer)` (ron) were false for every hand. `tenpaiSeats()
.includes(undefined)` was false too. The result: **the dealer never kept the deal except
on an abortive triple ron**, and `kyoku` never decremented on a tenpai exhaustive draw.
The pre-extraction code, using closure variables, was correct.

Every one of the 97 server tests passed throughout, because all of them called
`applyPostSettlementFlow` *directly* with correct arguments. The extraction moved the
logic somewhere testable and left the only untested part — the call — broken. Nothing in
the suite ever ran `playOneHand` far enough to notice.

Two mistakes, worth separating:

1. **Positional arguments.** Four parameters, two of them bare seat numbers, is exactly
   the signature that fails by an off-by-one with no error. The method now takes a single
   object, so a dropped argument is a named `undefined` rather than a silent shift of
   every argument after it.
2. **The tests tested the extracted unit, not the seam.** "Directly callable" is not the
   same as "covered". The defect class here is *wiring*, and wiring is only observable
   through the caller.

**Fixed, and this time the caller is under test.** `server/test/settlement.test.js` gained
a `playOneHand -> dealer rotation` block that drives `playOneHand` end to end — real
deal, `playTurn` ending the hand immediately, `finishHand` stubbed — and asserts on
`this.dealer`, `this.honba` and `this.kyoku` afterwards: dealer tsumo, dealer ron, dealer
in a double ron, non-dealer ron, tenpai dealer at a draw, noten dealer at a draw, plus a
sweep of all four dealer seats × those three shapes. Server suite 97 → 104.

Verified to bite: reintroducing the dropped argument fails
`playOneHand keeps the dealer when the dealer wins by tsumo` and
`the dealer rotation holds for every dealer seat`.

The generalisation: **extracting a function does not test it.** If the reason for the
extraction was that the bug lived in a seam, then the test has to cross the seam, or the
extraction has only relocated the untested part.

---

## <a id="ki-20"></a>KI-20 ✅ FIXED — the server paid three winners when three players claimed the same tile

Found by continuing the item-23 sweep of decisions the two front-ends still disagree
about. Driving `resolveCallWindow` with three simultaneous ron claims produced:

```json
{"type":"ron","from":0,"hits":[{"seat":1},{"seat":2},{"seat":3}]}
```

and `finishHand` then paid **all three in full** from the discarder.

**The rule:** three players claiming the same discard — sanchahou / triple ron — is an
**abortive draw**. The hand is void, nobody is paid, the dealer repeats and a honba is
added. Two claimants is a perfectly legal double ron and is paid in full.

`engine/game.js` has always aborted here. The server had no such handling, which is a
consequence of the server having no abort machinery at all (KI-04) — so the divergence
was structural, not an oversight.

**Fixed** — `finishHand` detects `wins.length >= 3` on a ron, moves the riichi pot to
the carry, broadcasts `RoundDraw` with `reason: 'TripleRon'`, and returns
`{ aborted: true }`. `playOneHand` branches on that: honba++, dealer repeats. It
deliberately does **not** fall through to the exhaustive-draw branch, which asks whether
the dealer is tenpai — a question an abortive draw does not have.

**Tests:** four new cases, including that a double ron still pays both winners (the
`>= 3` boundary), that a triple ron broadcasts no `RoundWon` at all, and that the
outcome does not depend on the order the three claims arrived in.

---

## <a id="ki-19"></a>KI-19 ✅ FIXED — riichi sticks were paid to tenpai players at an exhaustive draw

Found by continuing the item-23 sweep: having wired the shared constants together, the
obvious next question is what the two front-ends still disagree about. They disagreed
about who collects the riichi pot on a drawn hand.

`engine/game.js` carried the pot to the next hand. `server/table.js` split it between the
tenpai seats. **The server was wrong, and it was my own mistake** — introduced by the
[KI-14](known-issues.md#ki-14) fix, which correctly spotted that the pot was being
destroyed but then implemented the wrong destination for it. Three of the eleven tests
added there asserted the wrong rule, which is how it survived.

### The rule

At an exhaustive draw the sticks **stay on the table** and are claimed by the next
player to win a hand. They are *not* awarded to the tenpai players:

- riichi.wiki, *Ryuukyoku*: "Any riichi bets left on the table are saved for later
  rounds. The next player that wins claims all leftover riichi bets."
- EMA Japanese Mahjong Rules: "In case of an exhaustive draw, the riichi bets remain on
  the table until a player wins a hand."
- The standard riichi rules sheet, under *Handling riichi bets after drawn games*: "In
  case of a drawn game, any riichi bets stay on the table to be claimed by the next
  player who declares a win."

Note this is the **opposite** of the tenpai payments, which do happen: a noten player
still pays 1000 to each tenpai player. It is only the riichi *sticks* that stay put.
Conflating the two is what made the KI-14 fix look reasonable.

**Fixed** — `finishHand` now carries the pot unconditionally at an exhaustive draw, and
the log line no longer reports an `awarded` figure. The three tests that encoded the
wrong rule were rewritten, including one that sweeps every tenpai count from 0 to 4 to
prove the destination does not depend on it, and one that confirms the carried pot is
still collectable by a later win — otherwise "carry" would quietly become a stalling bug.

The tenpai payments themselves were untouched; they now read `RULES.notenTotal` from the
shared config instead of a local copy of `[0, 3000, 1500, 1000]`, which was the last
duplicated settlement schedule between the two front-ends.

---

## <a id="ki-18"></a>KI-18 ✅ FIXED — the two front-ends disagreed about leftover riichi sticks at match end

Found by item 21's characterisation tests, which is the point of writing them: the
offline match total does not always come to 100 000, and the reason was a rule decision
nobody had written down.

`game.js` `main()` settles the riichi pot after every hand but **not at match
teardown**. Whatever is on the table when the loop ends is dropped, so `FINAL(raw)` is
short by that amount:

```
=== EAST 4 dealer=P3(none) honba=3 dora=8p(9p) scores=21000/28000/28000/21000 ===
...
FINAL(raw): 21000/28000/28000/21000     <- 98 000; the 2000 carry is gone
```

`table.js` did the opposite — `run()` returned the leftover pot evenly across the four
seats before emitting `GameOver`, specifically so the bridge would always total
100 000. So the front-ends disagreed, which is a KI-04 instance.

**Which side was right:** losing the pot is the standard rule. The World Riichi
Championship rules state it outright — *"riichi deposits remaining on the table at the
end of the hanchan are lost"* — and the official riichi rules sheet agrees. Returning
them evenly was **not** a rule; it was a rule bent to satisfy a test, which is the tail
wagging the dog. It was introduced during KI-14, where the conservation assertion was
written first and the settlement adjusted to fit it.

**Decided by the repo owner: forfeit the pot, per the standard rules.** `table.js`
`run()` no longer redistributes; it logs the forfeited sticks and leaves the pot
readable on the Table rather than silently zeroing it.

Consequences handled:

- `server/test/bridge.test.js` no longer asserts `final_scores` totals exactly 100 000.
  It asserts the shortfall is `>= 0` **and a whole multiple of 1000** — which still
  catches fractional-score corruption while permitting a forfeited pot. Per-hand
  `RoundWon` snapshots must still total exactly 100 000, since those are mid-match.
- `server/test/settlement.test.js` gained four deterministic teardown tests.
- The web client needed no change: it renders `final_scores` and never asserts a total.
- The offline regression hash is **unchanged** — `main()` already behaved this way.

**Also fixed: two tests that could not fail.** The previous "match teardown" tests in
`settlement.test.js` computed the expected redistribution *in the test body* and then
asserted on their own arithmetic, so they passed regardless of what `table.js` did. They
now drive `run()` and read what it actually broadcasts. Written before this decision,
they would have quietly locked in the wrong rule.

---

## <a id="ki-17"></a>KI-17 ✅ FIXED — bare `--powers` crashed; `--seed`/`--human` silently ran on `NaN`

Found while re-verifying the offline regression hashes after the `Table` split: the
powers run produced a hash that matched nothing recorded, so the invocation was run by
hand — and it threw.

```js
const SEAT_POWERS = ((args.powers || 'none,none,none,none').split(',')...)
//                                        ^^^^^^^ true.split is not a function
```

`parseArgs` deliberately maps a bare flag to boolean `true` (`--selftest` depends on
it), but the flags that take a value never handled that. Three flags, three different
failures:

| Invocation | Old behaviour |
| --- | --- |
| `game.js --powers` | **Raw `TypeError`** — crashed before the "unknown --powers value" check below it could run |
| `game.js --seed` | `parseInt(true)` → `NaN`, so `createRNG(NaN)` seeded mulberry32 from `NaN` and every subsequent draw was garbage |
| `game.js --human` | `HUMAN = NaN`, so `seat === HUMAN` was never true and the match silently played **all bots**, exactly as if you had asked for seat `-1` |

Only `--kyoku` was safe, because it already validated its own result.

**Fixed** with one shared guard, `valueOf(key, example)`, which refuses a bare
value-taking flag with a usage hint, plus range checks that were missing on the two
flags that had none: `--human` must be `-1` or a seat `0-3`, and `--seed` must be an
integer.

**Tests:** four new cases in `engine/tests/offline-rules.test.js` drive the real
process, because this parsing happens at require time rather than in a testable
function. They assert no raw `TypeError`, that the offending flag is named, and that a
valid invocation still exits `0`. Reverting the guard makes them fail.

**Behaviour-preserving:** all four `--powers` configurations produce byte-identical
output against `HEAD`, so this adds validation without changing any valid run.

---

## <a id="ki-16"></a>KI-16 ✅ FIXED — Call-window priority decided by response arrival, not turn order

Found by the sweep added after KI-15 (item 17a): reading `resolveCallWindow` looking
for the duplicated-rule pattern. It wasn't duplication — it was an ordering bug.

**The bug:** arbitration used `responses.find(...)` and `responses.filter(...)`, but
`responses` is built by `results.push(res)` as each candidate resolves. CPU candidates
resolve synchronously, so they land in turn order *by accident*; human candidates are
awaited over the WebSocket and land in whatever order the network delivers. Two
consequences:

1. **Pon / daiminkan priority** went to whichever claimant's response arrived first.
   Standard riichi gives it to the claimant **nearest the discarder in turn order**.
2. **Riichi sticks on a double ron** went to `wins[0]`, which was likewise in response
   order — even though `finishHand` documents that seat as "the nearest winner in turn
   order". The pot could be paid to the wrong player.

**Why it survived:** the E2E test has exactly one human seat, and CPU-only play is
correct by accident, so no existing test could see it.

**Fixed** by ranking explicitly instead of relying on arrival order:

```js
const turnRank = (seat) => (seat - from + 4) % 4;
const ordered = [...responses].sort((a, b) => turnRank(a.seat) - turnRank(b.seat));
```

`ron` claims, the furiten-on-pass sweep, pon/daiminkan selection, chi selection and
`winBy.hits` all now read from `ordered`, so `hits[0]` is genuinely the nearest winner
and stick collection is correct.

**Tests:** `server/test/call-window.test.js` (9 tests) scripts **out-of-order** human
responses with an artificial delay, covering pon priority from two discarder seats, ron
beating a pon, double-ron hit ordering, furiten on passing a ron, riichi seats being
offered no calls, chi being kamicha-only, an uncontested discard, and chankan opening
ron only.

Two things worth recording about how these tests were written:

- The first harness set `isCpu: true` on every seat, so the CPU branch **ignored the
  scripted responses entirely** and the tests passed while asserting almost nothing —
  including the two that were meant to prove the ordering fix. Real behaviour, not the
  code, was wrong; a test that cannot fail is worse than no test.
- Verified the tests actually bite: reverting the fix to arrival order makes **3 of the
  9 fail**; restoring it returns 9/9.

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
| `table.js` `classifyHumanKan`, explicit-tile branch | networked human | returned `{kind:'kakan'}` with no riichi test |
| `table.js` `classifyHumanKan`, auto-detect branch | networked human | returned `{kind:'kakan'}` with no riichi test |
| **`table.js` CPU kan offer (`playTurn`)** | **networked bots** | `kanChoice = { kind: 'kakan' }` — no riichi test |

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

**The fix** — stop destroying the pot. Both halves of this were subsequently found to
be wrong or corrected; see [KI-19](known-issues.md#ki-19) for the current rules:

- **Exhaustive draw:** ~~sticks go to the tenpai players~~ — **this part was wrong.**
  The sticks stay on the table and are claimed by the next player to win. They are now
  carried, matching `engine/game.js`, which had it right all along. Nobody is tenpai was
  already correct.
- **Match end:** ~~`run()` settles anything still carried~~ — also wrong; leftover
  sticks are **forfeited**, per the World Riichi Championship rules. Corrected by
  [KI-18](known-issues.md#ki-18).

Conservation held throughout and still does: the pot is never destroyed, only moved
between `ctx.riichiPool` and `Table.riichiCarry`.

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
| `server/table.js` | **1695** | `Table` — the entire hand driver. Split out of `room.js`, which was **1800** with `Room` in it |
| `web-client/src/state/store.ts` | **1198** | All game state *and* all outbound protocol calls in one class |
| `engine/game.js` | **898** | Game loop, bot AI, power rig, and the 48-check selftest (was 1006; 131 lines of duplicated helpers removed) |
| `engine/powers/rosters/kiyosumi.js` | 571 | One character's full skill tree |
| `engine/tests/crossCharacter.test.js` | 578 | — |

`room.js` was the direct cause of several items above: the roster registry, the env-var
parsing, the bot pacing and the rule divergence all lived together with no seam. It is
now split into three modules — `room.js` (`Room`: lobby, seats, power assignment),
`table.js` (`Table`: the hand driver) and `rosters.js` (the registry both share, so
neither has to require the other) — which makes KI-04 tractable. **Partly resolved:**
`table.js` is still large, but it is now one coherent subsystem rather than two, and
the split was purely mechanical: both class bodies were moved by line range and
verified byte-identical, with all 1740 original substantive lines accounted for.

Remaining size is deliberate — `table.js` is still only safe to shrink by extracting the
rule layer (item 23), which is behaviour-changing and not yet characterised (item 21).

---

## <a id="ki-12"></a>KI-12 ✅ CLOSED — No LICENSE (decision: repo is private)

**Decided by the repo owner: not adding a LICENSE.** The repository is private, so there
is no redistribution to license. Recorded here so this stops being re-raised as an open
item — it is a decision, not an oversight.

The original concern was that `engine/` and `server/` depend on third-party `riichi` and
`syanten` and vendor a FluffyStuff SVG sheet plus official Saki card art, leaving
redistribution terms undefined. That remains factually true and is documented in
[`provenance.md`](provenance.md); it simply does not need resolving while the repo is
private.

**If this repo is ever made public, revisit this** — vendored third-party art would then
need actual redistribution rights.

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
- *"server npm test — 2 pass"* → **94**.
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
| Undocumented env vars | — | `PORT`, `SAKI_POWER_SEATS`, `BOT_DELAY_MS`, `NODE_ENV`, `SAKI_RIICHI_FORCE`, `SAKI_SEED` now in both `docs/development.md` and `server/README.md` |
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
| 17 | ~~Record `server/public/` provenance~~ (LICENSE skipped: private repo) | ✅ done | KI-08, KI-12 |
| 17a | ~~Sweep `resolveCallWindow` and the scoring path~~ | ✅ done | KI-16 |
| 17b | ~~Guard bare value-taking CLI flags (`--powers` crashed on `true.split`)~~ | ✅ done | KI-17 |
| 18 | ~~Add an `.nvmrc`~~ | ✅ done | KI-06 |
| 19 | ~~Pin the kan/riichi rules across every decision site + `doOwnKan`~~ | ✅ done | KI-15 |
| 20 | ~~Cover `botDecision` and the `doOwnKan` choke point~~ | ✅ done | KI-15 |
| 21 | ~~Characterise `game.js` `main()` orchestration (12 tests)~~ | ✅ done | KI-18 |
| 22 | ~~Client tests: Vitest + jsdom (225 tests)~~ | ✅ done | KI-07, KI-23, KI-24 |
| 23 | ~~Share rule constants via rules-config + parity guard; sweep found KI-19/20/21~~ (orchestration merge still open, see KI-04) | partly done | KI-04, KI-19, KI-20, KI-21 |
| 24 | ~~Split `Table` out of `server/room.js`~~ | ✅ done | KI-11 |

Item **23** is now *partly* done — the shared constants live in one place with a parity
test — but merging the two orchestration loops is still open. **21** was its prerequisite
and is done: `main()` now has 12 characterisation tests, so that rewrite would have a net
under it which it did not have before. It is still the largest remaining piece of work
here.

**The method that found KI-13 and KI-14 is cheaper than any refactor here.** Neither
bug was on this register. Both came from two questions: *which source file has no test
touching it?* and *what invariant is asserted nowhere?* `server/yaku-map.js` answered
the first, score conservation answered the second.

That sweep has since paid out twice more, with no design decisions at all: **19** read
the hand driver (then the un-split `room.js`) for the same duplicated-rule pattern and
found KI-15, and **17a** found KI-16 — call arbitration ordered by response arrival
rather than turn order. Neither was on this register either.
