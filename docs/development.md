# Development guide

Everything needed to set up, run, test, and debug Saki locally.

---

## 1. Prerequisites

| Requirement | Version | Why |
| --- | --- | --- |
| Node.js | **22+** (developed on 22.18.0) | Native test runner (`node --test`), `node:http`, ES2022 |
| npm | 10+ | ships with Node 22 |
| A browser | any modern | the web client |

There is no Python, Rust, Go, Make, or Docker toolchain involved — the WASM client in
`server/public/` is a **prebuilt vendored artifact**, nothing in this repo compiles it.

Check your version:

```bash
node --version   # must be >= 22
```

---

## 2. Install

The repo is a single **npm workspace** rooted at `package.json`. One install covers all
three packages and produces one hoisted `node_modules` at the root:

```bash
npm ci
```

Use `npm ci` (not `npm install`) for reproducibility — the root lockfile pins
`riichi@1.2.0` and `syanten@1.6.0`, and `engine/tests/rules.test.js` asserts scoring
behaviour against those exact versions. `npm install` can silently float them and break
scoring tests.

If you only want the offline engine: `npm ci && npm run test:engine`.

### Running things

| Command | What it does |
|---|---|
| `npm test` | everything CI runs: engine + server + client build |
| `npm run test:engine` | 341 engine unit tests + the 43-check rule selftest |
| `npm run test:server` | 3 headless end-to-end tests over a real WebSocket |
| `npm run test:client` | `tsc` type-check + production build (no client tests exist) |
| `npm run links` | verify every relative markdown link resolves |
| `npm run smoke` | one short deterministic hand; proves the CLI arg parser works |
| `npm run check` | `test` + `links` |

You can still run a single package directly:

```bash
npm test --workspace engine
npm test --workspace server
npm run build --workspace web-client
```

`server/` declares `riichi` and `syanten` as its own dependencies even though it
`require()`s engine files by relative path (`require('../engine/tiles')`). Under
workspaces that is harmless — identical pins hoist to a single copy at the root, so
there is exactly one `riichi@1.2.0` and one `syanten@1.6.0` on disk. If you bump one,
bump both, or npm will install two copies and the server will score against a different
library than the engine tests assert against.

---

## 3. Running

### 3.1 Full stack (recommended)

```bash
./run_server.sh     # macOS / Linux / WSL — starts both, Ctrl+C stops both
run_server.bat      # Windows — opens two cmd windows
```

Then open **<http://localhost:3000>**.

Neither script is documented anywhere else, and both assume dependencies are already
installed.

### 3.2 By hand

```bash
# terminal 1 — bridge server
node server/index.js

# terminal 2 — client dev server
cd web-client && npm run dev
```

| Surface | URL |
| --- | --- |
| Web client (Vite dev) | <http://localhost:3000> |
| Bridge HTTP | <http://127.0.0.1:24141> |
| Bridge WebSocket | `ws://127.0.0.1:24141/ws` |
| Vendored WASM client | <http://127.0.0.1:24141/> (see caveat below) |

`web-client/vite.config.ts` proxies `/ws` to `ws://127.0.0.1:24141`, so from the
browser you only ever talk to port 3000.

> **Two clients, one server.** `server/public/` holds a prebuilt upstream WASM client
> that the bridge serves at `/`. It is a different UI from `web-client/` and is not
> built by anything here. `web-client/README.md` documents only the Vite client; if
> you're developing, use that one.

### 3.3 Running the engine

Run from the **repo root**:

```bash
node engine/game.js        # 4 CPU bots, full hanchan (8 rounds), no powers
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--powers a,b,c,d` | `none,none,none,none` | Per-seat power keys (see caveat) |
| `--human -1\|0..3` | `-1` | `-1` = all bots; `0..3` = human at that seat |
| `--seed N` | random | Seeded mulberry32 RNG; also makes `Math.random` deterministic |
| `--kyoku N` | `8` | `4` = tonpuusen, `8` = full hanchan |
| `--selftest=1` | off | Run 43 deterministic rule checks and exit |
| `--closed-only=1` | off | Demo: bots never pon/chi |
| `--riichi-always=1` | off | Demo: bots riichi whenever able (surfaces ippatsu/ura/furiten fast) |
| `--demo-abort=NAME` | off | Demo: fire one abortive-draw settlement on demand |

Both `--flag value` and `--flag=value` work, including negative values
(`--human -1`). **This was broken until recently**: the parser accepted only the `=`
form, so `--kyoku 4` set the flag to boolean `true`, `parseInt(true)` was `NaN`, and
`for (kyoku = 0; kyoku < NaN; …)` never ran — the game printed a normal-looking
match result having played **zero hands**. `npm run smoke` in CI now guards this, and
`engine/tests/offline-rules.test.js` pins both forms.

An unrecognised `--powers` key is now a **hard error** naming the valid keys, rather
than silently degrading to `none`.

Accepted `--powers` keys: `none`, `saki`, `kuro`, `koromo`, `yuuki`, `hisa`.

> **Caveat — `--powers` in `game.js` is NOT the roster framework.** `game.js` has its
> own inline `powerDraw()` with simplified per-key behaviour against a pre-shuffled
> wall. The full `engine/powers/rosters/*` framework (Flow gauge, tiers,
> `PowerDispatcher`, `DynamicPool`) is exercised only via `engine/core.js` — i.e. the
> **server path** and the engine unit tests, not `game.js`. To try the real powers, run
> the bridge server and play through the web client. See
> [`known-issues.md`](known-issues.md#ki-05).
>
> `toki` and `teru` used to be accepted here but had no `powerDraw` branch, so they
> silently behaved like `none`. They were display-layer gimmicks in the old `cli.js`
> and are now removed from the valid-key list entirely.

```bash
# faster demo loops
npm run smoke --silent                       # or: node engine/game.js --seed 42 --kyoku 1
node engine/game.js --kyoku 4 --seed 42 --riichi-always=1

# score a single hand
node engine/cli.js eval "112233456789m11s"
```

### 3.4 Building the client

```bash
npm run build --workspace web-client   # tsc --noEmit, then vite build -> dist/
npm run preview --workspace web-client # serve the built dist/
```

`dist/` is gitignored. The build also copies a **23 MB** character-card sprite
(`web-client/public/images/sakicardsv13.png`) into `dist/images/`, so a production
deploy is ~280 kB of JS + 46 kB of CSS **plus 23 MB of art**.

---

## 4. Environment variables

Read by the server (`server/index.js`, `server/room.js`). **None are documented
elsewhere in the repo.**

| Variable | Default | Effect |
| --- | --- | --- |
| `PORT` | `24141` | Bridge HTTP + WebSocket port |
| `SAKI_POWER_SEATS` | `saki,nodoka,koromo,yuuki` | Comma-separated seat indices (`0..3`) that receive the `saki` power; all others become `none`. Out-of-range and unparseable values are silently dropped. |
| `BOT_DELAY_MS` | `1000`, or `0` when `NODE_ENV=test` | Minimum CPU think-time. Set `0` to make games instant. |
| `NODE_ENV` | unset | `test` only affects the default bot delay |
| `SAKI_RIICHI_FORCE` | unset | `1` forces bots to riichi at a `0.45` probability gate instead of normal evaluation |

Example — instant CPU games with no powers:

```bash
BOT_DELAY_MS=0 SAKI_POWER_SEATS="" node server/index.js
```

---

## 5. Testing

CI runs on every push and PR (`.github/workflows/ci.yml`). Everything uses Node's
built-in runner (`node:test` + `node:assert/strict`) — no Jest/Mocha/Vitest dependency.

```bash
npm test              # everything CI runs (~2 min)
npm run test:engine   # 341 unit tests + 43 selftest checks
npm run test:server   # 3 end-to-end tests
npm run test:client   # tsc + production build
npm run links         # markdown link check
npm run smoke         # one short deterministic hand
npm run check         # test + links
```

Per package: `npm test --workspace engine`, `npm test --workspace server`,
`npm run build --workspace web-client`.

Raw invocations, if you need them: `node --test tests/*.test.js` (engine),
`node --test test/*.test.js` (server), `node game.js --selftest=1` (rule checks).

> Use the **glob form**. `node --test tests/` (bare directory) is rejected by Node 22
> with `Cannot find module '.../tests'`; the `npm test` scripts use `tests/*.test.js`.
> `cmd.exe` passes the pattern through literally for Node to expand, so the glob works
> identically on Windows, macOS, and Linux.

### What each layer covers

| Layer | Command | Scope |
| --- | --- | --- |
| Engine unit tests | `npm run test:engine` | 25 files, 341 tests. Per-character rosters, `dynamicPool`, `trajectoryPlanner`, `flowManager`, `nodokaEval`, `core` phases, scoring/tiles/rng, plus `crossCharacter` (multi-seat power interaction), `edge` (bug-hunting), and **`offline-rules`** (the `game.js`-only layer: CLI arg parsing, `buildWall`, `countVisible`, `powerDraw`, bot decision injection). |
| Engine rule selftest | `node engine/game.js --selftest=1` | 43 in-engine checks covering yaku, fu, dora, aborts, kuikae, oka/uma, invariants. |
| Server E2E | `npm run test:server` | `server/test/bridge.test.js` spawns the real server, connects a mock protocol-v6 client over `ws`, and plays a full match to `GameOver`. Also unit-tests the red-dora tile codec and the Yuu Matsumi passive. |
| Client types | `npm run test:client` | `tsc` with `strict: true`. **The client has no behavioural tests at all** — a UI regression will not be caught. See [`known-issues.md`](known-issues.md#ki-07). |
| Markdown links | `npm run links` | `scripts/check-links.mjs`: every relative link in every `.md` resolves. |
| CLI smoke | `npm run smoke` | Plays one hand and greps for a discard, catching the arg-parser class of bug where the engine silently completes zero hands. |

### Test helpers

- `engine/tests/helpers/sim.js` is **not** a test — it's a mini table simulator
  (`createTable`, `scriptHand`, `runTurn`, `runRounds`, `sumTiles`) that isolates a
  `PowerDispatcher` per table. Use it to script hands without a full match.
- `node engine/game.js --seed N` is the fastest way to reproduce a specific wall; it is
  deterministic and byte-stable.

### Coverage boundary

`engine/helpers.js` holds the rule functions shared by `game.js` and the bridge
(`getWaits`, `tryRon`, `botDiscard`, `isNagashi`, `applyOkaUma`, abort conditions, …)
and is covered by `rules.test.js`. `game.js` imports all of them rather than keeping
copies, so the only remaining gap is logic that lives *inside* `game.js`'s `main()` as
closures — `declareRiichi`, `collectRon`, call-window arbitration, nagashi payout
distribution and chombo settlement — which the 43-check selftest is the only net for.
Closing that would mean extracting a rule layer shared with `server/room.js`; see
[`known-issues.md`](known-issues.md#ki-04).

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Cannot find module '.../tests'` from `npm test` | Bare directory arg to `node --test` on Node 22 | **Fixed** — the scripts use `tests/*.test.js`. If you hit this you're on a stale checkout |
| Engine "finishes" instantly with all scores tied | Arg-parser regression: `--kyoku 4` parsed as `NaN`, so the match loop ran zero hands | **Fixed** — both `--flag value` and `--flag=value` parse. Run `npm run smoke` to check |
| `Cannot find module 'riichi'` or `'syanten'` | Dependencies not installed | Run `npm ci` **once at the repo root** (it's a workspace) |
| WebSocket never connects in the browser | Bridge not running, or `PORT` changed without updating the Vite proxy | Confirm `node server/index.js`; the proxy target `24141` is hardcoded in `web-client/vite.config.ts` |
| `EADDRINUSE` on 24141 | Another process holds the port | `PORT=3001 node server/index.js` **and** update the proxy in `vite.config.ts` |
| Client loads but shows an empty table | Stale `GameStore` after a bridge restart — there is **no reconnection logic** | Reload the page; create a new room |
| Game feels sluggish, bots hesitate ~1 s each turn | Default `BOT_DELAY_MS=1000` | `BOT_DELAY_MS=0` |
| Scoring tests fail after a dependency change | `riichi`/`syanten` floated past the pinned versions | Re-run `npm ci` in both `engine/` and `server/` |
| `--powers tok i` / `teru` errors out | Those placeholder keys were removed; they had no `powerDraw` branch and silently behaved like `none` | Use one of `saki` / `kuro` / `koromo` / `yuuki` / `hisa`, or play through the server for the real roster framework |
| Vite reports `Failed to resolve import` for an SVG asset | Assets use Vite's `?raw` suffix | Import as `import x from './a.svg?raw'`; types live in `web-client/src/vite-env.d.ts` |
| Engine tests pass but a server game misbehaves | Two rule implementations: `game.js` vs `core.js`/`room.js` (different aborts, different wall model) | Test against the path you'll actually ship — see the rules table in the root README |

---

## 7. Where to look in the code

| Question | File |
| --- | --- |
| How does a hand actually play out? | `engine/core.js` (header documents the canonical 4-phase draw step) |
| How does a networked hand play out? | `server/room.js` — `Room` (lobby/seats) + `Table` (driver) |
| How do character powers hook in? | `engine/powers/index.js` — `PowerDispatcher`, and each `engine/powers/rosters/*.js` |
| How is the wall sampled? | `engine/powers/dynamicPool.js` |
| What is the wire format? | `server/protocol.js` (encode/decode) + `web-client/src/net/protocol-types.ts` (types) |
| What does the client hold in memory? | `web-client/src/state/store.ts` |
| How do I add a character? | [`conventions.md`](conventions.md#adding-a-character) |
