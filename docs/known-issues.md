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

## <a id="ki-02"></a>KI-02 🟠 Three installs, no workspace, duplicated dependencies

There is no root `package.json` and no npm workspaces. Three packages, three lockfiles,
three `node_modules` trees. A developer who runs `npm ci` in the root gets an error; a
developer who forgets `server/` gets `Cannot find module 'ws'`.

Worse, `server/` declares `riichi` and `syanten` as **its own dependencies** even though
it consumes engine code across the package boundary by relative path:

```js
// server/room.js
const core = require('../engine/core');
const { KINDS, norm, same, DORA_NEXT } = require('../engine/tiles');
```

So `riichi@1.2.0` and `syanten@1.6.0` are installed **twice, as two separate physical
copies**. Nothing enforces they stay in sync — bump one and the server silently scores
against a different library than the engine's tests assert against.

**Fix direction:** make `server/` a workspace member of `engine/`, or drop the
duplicate declarations and rely on Node's resolution walking up to `engine/node_modules`.

---

## <a id="ki-03"></a>KI-03 🟠 Engine tests depend on the server package

Three files in `engine/tests/` import from `server/`:

```
engine/tests/edge.test.js:5            require('../../server/helpers')
engine/tests/furiten-riichi.test.js:8  require('../../server/helpers')
engine/tests/rules.test.js:9           require('../../server/helpers')
```

The dependency runs **both ways**: `server/` → `engine/` for the engine, and
`engine/tests/` → `server/` for the shared rule helpers. So the engine test suite
cannot run in isolation, the two packages are not separable, and the "engine has no
dependency on the server" assumption in `architecture-comparison.md` is false.

`server/helpers.js` exists precisely to break this (it was extracted out of
`engine/game.js`), but it landed on the wrong side of the boundary. Moving it to
`engine/helpers.js` would make the dependency one-directional.

---

## <a id="ki-04"></a>KI-04 🔴 Two rule implementations that diverge

The same rules are implemented twice, and the two copies disagree:

| | Offline — `engine/game.js` | Network — `engine/core.js` + `server/room.js` |
| --- | --- | --- |
| Wall | pre-shuffled array, `wall.pop()` | `DynamicPool` weighted sampling |
| Length | tonpuusen or hanchan (`--kyoku`) | tonpuusen only |
| Abortive draws | **all five on** | **all five off** |
| Nagashi mangan, oka/uma | yes | no |
| Character powers | **inline `powerDraw()`, not the roster framework** | full `PowerDispatcher` + `rosters/` |

A rule fixed in `game.js` is not automatically fixed in `room.js`. This has already
happened: the permanent-riichi-furiten bug existed on both sides and needed two fixes
plus a regression suite. The divergence is at least *declared* in
`engine/rules-config.js` (`RULES.aborts` vs `RULES.serverAborts`) — but the comment
there, "Flip a flag only together with its handler", is a warning that this is a trap.

There is also residual duplication *within* the engine: `engine/cli.js` still
re-declares `KINDS` and re-implements `buildWall` instead of importing `engine/tiles.js`,
even though `game.js` was already deduped.

**Fix direction:** make `server/room.js` the single rule implementation and have
`game.js` drive it, or extract every divergent rule behind a shared function.

---

## <a id="ki-05"></a>KI-05 🟠 `--powers` silently ignores characters it accepts

`engine/game.js` accepts eight power keys:

```js
const POWERS = ['none','saki','kuro','koromo','toki','yuuki','hisa','teru'];
```

but its inline `powerDraw()` only branches on `saki`/`yuuki`, `kuro`, `koromo`, and
`hisa`. **`toki` and `teru` fall through and behave exactly like `none`** — no warning,
no error. `mako` is not in the list at all despite having a roster file.

Combined with KI-04, `game.js --powers X` is *not* a way to exercise a roster: the
Flow gauge, tiers, `PowerDispatcher`, `dynamicPool` reservations and `awakening.js`
are all unreachable from that entry point. **The roster framework is only reachable
via `server/room.js` and the engine unit tests.** Anyone using `game.js` to sanity-check
a character is testing a different implementation than the one that ships.

---

## <a id="ki-06"></a>KI-06 🔴 No CI, no linter, no pinned runtime

- **No CI.** No `.github/`, no workflow file, no `*.yml` anywhere in the repo. The 313
  tests plus the 43-check selftest run only when a human remembers to run them.
  (`npm test` now works in both packages as of the KI-01 fix — there is simply nothing
  to invoke it automatically.)
- **No linter or formatter.** No ESLint, Prettier, `.editorconfig`, or `tsconfig`
  sharing between packages.
- **No pinned Node version.** No `.nvmrc`, no `engines` field in any `package.json`.
  The code uses `node:test`, ES2022, and `??` — Node 22+ is required but never declared.
- **Three unrelated versions**: `engine@1.0.0`, `server@0.1.0`, `web-client@1.0.0`,
  with no release process, no changelog, and commit messages like `update` and
  `whatever this is`.

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

## <a id="ki-09"></a>KI-09 🔴 Several silent failure modes

The code prefers to swallow errors. Each of these produces a confusing symptom rather
than a diagnostic:

| Where | Behaviour | Symptom instead of an error |
| --- | --- | --- |
| `server/room.js` roster registry | `try { ROSTERS.x = require(...) } catch { /* roster missing */ }` | A character silently unavailable, no log line |
| `engine/powers/index.js` hooks | Every hook call wrapped in `try/catch`, falling back to the default | A broken power silently becomes a no-op |
| `server/room.js` `SAKI_POWER_SEATS` | `.filter(n => Number.isFinite(n) && n >= 0 && n < 4)` | `SAKI_POWER_SEATS=0,9,x` silently drops `9` and `x` |
| `server/index.js` `Hello` | Answers `Welcome` **without validating `protocol_version`** | A version-mismatched client is accepted, then misbehaves |
| `server/public/` HTTP handler | Any read error → `404 not found` | A permissions/corruption problem looks like a missing route |

The hook-level `try/catch` is defensible — a cosmetic aura must not break a game — but
it means **a power can be fully broken and still pass every test**, because the tests
assert the fallback path too. At minimum, log to `console.warn` when a hook throws.

---

## <a id="ki-10"></a>KI-10 🟠 Reconnect silently loses your session

`web-client/src/net/socket.ts` reconnects every 2 s on close — but the server has
**no session resume**. `Hello` mints a brand-new `session_token` (`tok_<time>_<n>_<rand>`)
and the client is a fresh anonymous player with no room, no seat, and no game.

The `GameStore` still holds the pre-disconnect game state. So after a bridge restart the
client looks connected, renders a stale table, and every action returns
`{ Error: { code: 'InvalidAction', message: 'no game in progress' } }`. The user must
manually reload and create a new room.

`server/README.md` lists reconnection under "Excluded features", but the client
actively attempts it, which turns a documented exclusion into an undocumented
half-feature.

---

## <a id="ki-11"></a>KI-11 🟡 Very large files carrying whole subsystems

| File | Lines | Concern |
| --- | --- | --- |
| `server/room.js` | **1800** | `Room` (lobby, seats, power assignment) **and** `Table` (the entire hand driver) in one file |
| `web-client/src/state/store.ts` | **1141** | All game state *and* all outbound protocol calls in one class |
| `engine/game.js` | 1006 | Game loop, bot AI, power hooks, and the 43-check selftest |
| `engine/powers/rosters/kiyosumi.js` | 571 | One character's full skill tree |
| `engine/tests/crossCharacter.test.js` | 578 | — |

`room.js` is the direct cause of several items above: the roster registry, the env-var
parsing, the bot pacing, and the rule divergence all live together with no seam.
Splitting `Table` out of `Room` would make KI-04 and KI-09 tractable.

---

## <a id="ki-12"></a>KI-12 ⚪ No LICENSE

No `LICENSE` file, despite `engine/` and `server/` depending on the third-party
`riichi` and `syanten` packages and vendoring a FluffyStuff SVG sheet and official
Saki card art. Redistribution terms for the vendored assets are undefined.

---

# Part B — Documentation rot

The docs contradict each other and the code in specific, fixable ways.

## <a id="dr-01"></a>DR-01 🟡 ~40 stale `file:line` citations

`engine-implementation.md` cites line numbers throughout. They are **30–100 lines
stale** — it cites `game.js:1030` in a 1006-line file. Spot checks:

| Doc | Actual |
| --- | --- |
| `game.js:308-419` selftest | `game.js:269-380` |
| `game.js:513-534` collectRon | `game.js:474` |
| `room.js:666-704` playTurn | `room.js:746` |
| `room.js:914-964` validateAct | `room.js:996` |
| `room.js:1219-1393` resolveCallWindow | `room.js:1367` |

The prose is still useful; the coordinates are not. **Cite symbols, not lines** — see
[`conventions.md`](conventions.md#8-things-not-to-do).

## <a id="dr-02"></a>DR-02 ✅ FIXED — 7 absolute `file:///` links

`docs/characters/README.md` linked to absolute paths from a collaborator's machine:

```
file:///home/laffey/Projects/personal/saki/docs/engine-design.md
file:///home/laffey/Projects/personal/saki/docs/characters/01_saki_miyanaga.md
   ... (6 more, lines 17-24)
```

None resolved on any other checkout. **Fixed** — all 7 are now relative
(`../engine-design.md`, `./01_saki_miyanaga.md`, …), so they resolve from any clone on
any platform. Verified: 0 dead relative links across all 21 markdown files.

## <a id="dr-03"></a>DR-03 🔴 `abilities.md` has ~18 sentences with missing numbers

Numeric values have been stripped, leaving sentences that trail off into punctuation:

- `net score delta is within of her starting score ()`
- `draw weight for her winning tile is multiplied by .`
- `If Touka leads by , gauge gain drops by -20%.`
- `Locks the wall when remain.`

The values are recoverable from `docs/characters/*.md` and the roster constants, so this
is mechanical — but as written **the document is unusable as a rules reference for at
least 18 mechanics.**

## <a id="dr-04"></a>DR-04 🔴 `abilities.md` contradicts the specs on ~16 mechanics

A redesign pass updated `docs/characters/*.md` and the rosters but not `abilities.md`.
The specs win in every case. The full clash table is in
[`docs/README.md`](README.md#where-abilitiesmd-contradicts-the-character-specs).
Highest-impact examples:

- **Yuuki T4** — `abilities.md` still describes a "75% chance to deal directly into her
  wait". The spec explicitly titles the replacement *"Redesigned — No Mind Control"*.
- **Hisa T1** — `abilities.md` describes a "Bluff Riichi" that waives the no-ten
  penalty. The spec is *"Why this replaces the old 1-Shanten Bluff Riichi"*: no Riichi
  is declared.
- **Koromo T1** — `abilities.md` says a 2-second decision window; the spec says
  *"Redesigned — No Unplayable 2s Timer"* (5 s threshold, −5% Flow/sec).
- **Yuuki's turn clock** — `abilities.md` says 4 s; spec, `engine-design.md`, and code
  all say 6 s.

`abilities.md` also documents ~28 characters while only 8 roster modules exist.

## <a id="dr-05"></a>DR-05 🟡 `engine-design.md` names files and APIs that don't exist

- The §7 roster tree lists `rosters/ryuumonbuchi.js` and `rosters/shiraitodai.js` —
  **neither exists**. Actual: `achiga`, `hisa`, `kiyosumi`, `koromo`, `mako`, `nodoka`,
  `saki-normal`, `yuuki`.
- The tree describes `kiyosumi.js` as containing "Saki, Nodoka, Yuuki, Mako, Hisa".
  It contains only Saki; the others are separate files.
- §7 pseudo-code shows `DynamicPool.sample(state.pool, weights, state.rng)`. The real
  signature is `sample(weights)` on a bound pool.
- §1 promises "PCG32/xoshiro256"; `engine/rng.js` uses **mulberry32**.
- §6 self-contradicts: "all players start at 0% Flow" vs §6's "the FlowManager
  pre-charges flow seats (server convention: 50 base)". The client hardcodes
  `'Flow: 50 / 150'`, so 50 base is correct.

## <a id="dr-06"></a>DR-06 🟡 `engine-implementation.md` documents fixed bugs as live

Two claims were fixed and the doc was never updated:

1. *"game.js and cli.js duplicate these helpers locally instead of importing tiles.js"*
   — **false**. `game.js:22` imports from `./tiles`; only `cli.js` still duplicates.
2. *"temp furiten currently clears even in riichi"* and *"known bug: standard riichi
   rules require furiten to persist permanently"* — **fixed** at `game.js:518` and
   `room.js:754`, with regression tests in `engine/tests/furiten-riichi.test.js` and
   recorded as done in `architecture-comparison.md` §5.

## <a id="dr-07"></a>DR-07 ⚪ Stale counts in `architecture-comparison.md` §5

- *"node --test tests/ — 254 pass"* → actual **310** (and that command no longer works,
  see KI-01).
- *"server npm test — 2 pass"* → actual **3**.
- §3 lists the furiten bug as a live risk while §5 lists it as fixed.
- §4's Phase 3 plan names a fixture directory `engine/tests/rules/`; what shipped is
  the file `engine/tests/rules.test.js`. Plan and status disagree.

## <a id="dr-08"></a>DR-08 ⚪ ~60 unresolvable citations to `reference/`

`reference-riichi-advanced.md` cites ~60 paths under `reference/riichi_advanced/`
(`saki.json`, `*.majs`, `documentation/riichi.md`, `lib/...ex`, …) and
`architecture-comparison.md` cites ~10 more. `.gitignore:2` excludes `reference/`, so
**none of these resolve in a fresh clone** and the reader has no way to know what is
being compared. Either vendor the specific files cited, or inline the findings.

## <a id="dr-09"></a>DR-09 ⚪ Smaller inaccuracies

| Claim | Location | Reality |
| --- | --- | --- |
| "any of the **six** Saki-character rosters" | `server/README.md:45` | **eight** are registered in `room.js:24-31` (`saki-normal` and `yuu`/`achiga` are missing from the README) |
| "bundle size is ~250 kB total" | `web-client/README.md:37` | 282 kB JS + 46 kB CSS + a **23 MB** PNG |
| "**production-ready** technical implementation specifications" | `docs/characters/README.md:3` | Design specs with pseudo-code; 2 of 8 shipped characters have no spec at all |
| "50+ Saki cast" fully combinable from 6 primitives | `engine-design.md:268` | Aspirational. No roadmap maps the 28 documented characters to the 8 built. |

Also undocumented anywhere until [`development.md`](development.md#4-environment-variables):
`PORT`, `SAKI_POWER_SEATS`, `BOT_DELAY_MS`, `NODE_ENV`, `SAKI_RIICHI_FORCE`. And
`run_server.sh` / `run_server.bat` were referenced by **no** document at all.

---

# Suggested order of work

| # | Action | Cost | Fixes |
| --- | --- | --- | --- |
| 1 | ~~Change `tests/` → `tests/*.test.js` in both `package.json`s~~ | ✅ done | KI-01 |
| 2 | ~~Relative-ise the 7 `file:///` links~~ | ✅ done | DR-02 |
| 3 | Add a GitHub Actions workflow running the 4 test commands | 30 min | KI-06 |
| 4 | Add `"engines": { "node": ">=22" }` to all three `package.json`s | 5 min | KI-06 |
| 5 | Restore the ~18 missing numbers in `abilities.md` from the specs | 2 h | DR-03 |
| 6 | Add a "superseded by §N of the character spec" note to `abilities.md` | 1 h | DR-04 |
| 7 | Strip `file:line` from `engine-implementation.md`, cite symbols | 2 h | DR-01, DR-06 |
| 8 | Fix the roster tree, `sample()` signature, and RNG name in `engine-design.md` | 30 min | DR-05 |
| 9 | Log `console.warn` when a roster hook throws or a roster fails to load | 30 min | KI-09 |
| 10 | Reject `Hello` on `protocol_version` mismatch | 20 min | KI-09 |
| 11 | Make `server/helpers.js` → `engine/helpers.js`, update the 3 test imports | 30 min | KI-03 |
| 12 | Add npm workspaces; drop duplicate `riichi`/`syanten` from `server/` | 1 h | KI-02 |
| 13 | Split `Table` out of `server/room.js` | 3 h | KI-11, unblocks 10 |
| 14 | Make `game.js` drive `core.js` (or delete its inline power hooks) | 1 d | KI-04, KI-05 |
| 15 | Document `server/public/` provenance; add a LICENSE | 1 h | KI-08, KI-12 |
| 16 | Add client tests (Vitest + jsdom) for `store.ts` and tile rendering | 1 d | KI-07 |
