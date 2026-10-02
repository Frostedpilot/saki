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

There is **no root `package.json` and no npm workspaces**. Three packages, three
lockfiles, three `node_modules`. You must install each one:

```bash
cd engine       && npm ci
cd ../server    && npm ci
cd ../web-client && npm ci
```

Use `npm ci` (not `npm install`) for reproducibility — the lockfiles pin
`riichi@1.2.0` and `syanten@1.6.0`, and `engine/tests/rules.test.js` asserts scoring
behaviour against those exact versions. `npm install` can silently float them and break
scoring tests.

If you only want the offline engine, `cd engine && npm ci` is enough.

### Why three installs?

`server/` declares `riichi` and `syanten` as its own dependencies even though it
`require()`s engine files across the package boundary via relative paths
(`require('../engine/tiles')`). So `riichi` and `syanten` exist **twice on disk**,
once in each tree, and nothing enforces that the copies stay the same version. Today
both are `1.2.0` / `1.6.0`. If you bump one, bump both. See
[`known-issues.md`](known-issues.md#ki-03).

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

```bash
cd engine
node game.js        # 4 CPU bots, full hanchan (8 rounds), no powers
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

Accepted `--powers` keys: `none`, `saki`, `kuro`, `koromo`, `toki`, `yuuki`, `hisa`,
`teru`.

> **Caveat — `--powers` in `game.js` is NOT the roster framework.** `game.js` has its
> own inline `powerDraw()` with simplified per-key behaviour and a pre-shuffled wall.
> Only `saki`/`yuuki`, `kuro`, `koromo`, and `hisa` have a branch; **`toki` and `teru`
> are accepted but silently behave as `none`.** The full `engine/powers/rosters/*`
> framework (Flow gauge, tiers, `PowerDispatcher`) is exercised only via
> `engine/core.js` — i.e. the **server path** and the engine unit tests, not `game.js`.
> See [`known-issues.md`](known-issues.md#ki-04).

```bash
# faster demo loops
node game.js --kyoku 4 --seed 42 --riichi-always=1

# the leaner harness
node cli.js eval "123456789m1234p"   # score one hand
node cli.js play --power saki        # interactive draw/discard
node cli.js demo                     # scripted power demos
```

### 3.4 Building the client

```bash
cd web-client
npm run build     # tsc --noEmit, then vite build -> dist/  (~280 kB JS + 46 kB CSS)
npm run preview   # serve the built dist/
```

`dist/` is gitignored. Note the build also copies a **23 MB** character-card sprite
(`public/images/sakicardsv13.png`) into `dist/images/`, so a production deploy is not
~250 kB as `web-client/README.md` implies.

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

No CI, no test framework dependency — everything uses Node's built-in runner
(`node:test` + `node:assert/strict`).

```bash
cd engine     && npm test                        # 310 tests + 43 selftest checks (~80 s)
cd server     && npm test                        # 3 tests   (~8-17 s)
cd web-client && npm run build                   # tsc type-check; NO unit tests
```

Equivalently, without npm: `node --test tests/*.test.js` (engine),
`node --test test/*.test.js` (server), `node game.js --selftest=1` (rule checks).

> Use the **glob form**. `node --test tests/` (bare directory) is rejected by Node 22
> with `Cannot find module '.../tests'`; the `npm test` scripts were fixed to use
> `tests/*.test.js`. Note `cmd.exe` passes the pattern through literally for Node to
> expand, so the glob works identically on Windows, macOS, and Linux.

### What each layer covers

| Layer | Command | Scope |
| --- | --- | --- |
| Engine unit tests | `node --test tests/*.test.js` | 24 files. Per-character rosters, `dynamicPool`, `trajectoryPlanner`, `flowManager`, `nodokaEval`, `core` phases, scoring/tiles/rng, plus `crossCharacter` (517 lines, multi-seat power interaction) and `edge` (bug-hunting). |
| Engine rule selftest | `node game.js --selftest=1` | 43 checks inside `game.js` covering yaku, fu, dora, aborts, kuikae, oka/uma, invariants. |
| Server E2E | `node --test test/*.test.js` | `server/test/bridge.test.js` spawns the real server, connects a mock protocol-v6 client over `ws`, and plays a full match to `GameOver`. Also unit-tests the red-dora tile codec and the Yuu Matsumi passive. |
| Client types | `npm run build` | `tsc` with `strict: true`. **The client has no behavioural tests at all** — a UI regression will not be caught by CI-equivalent commands. |

### Test helpers

- `engine/tests/helpers/sim.js` is **not** a test — it's a mini table simulator
  (`createTable`, `scriptHand`, `runTurn`, `runRounds`, `sumTiles`) that isolates a
  `PowerDispatcher` per table. Use it to script hands without a full match.
- `engine/game.js --seed N` is the fastest way to reproduce a specific wall.

### Three tests reach across a package boundary

`engine/tests/edge.test.js`, `furiten-riichi.test.js`, and `rules.test.js` all
`require('../../server/helpers')`. The engine test suite therefore cannot run if
`server/` is absent, and engine and server share no install. See
[`known-issues.md`](known-issues.md#ki-03).

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Cannot find module '.../tests'` from `npm test` | Bare directory arg to `node --test` on Node 22 | **Fixed** — the scripts now use `tests/*.test.js`. If you hit this, you're on a stale checkout; run `node --test tests/*.test.js` directly |
| `Cannot find module 'riichi'` or `'syanten'` | `npm ci` not run in the package you're executing from | Run it in `engine/`, `server/`, **and** `web-client/` |
| WebSocket never connects in the browser | Bridge not running, or `PORT` changed without updating the Vite proxy | Confirm `node server/index.js`; the proxy target `24141` is hardcoded in `web-client/vite.config.ts` |
| `EADDRINUSE` on 24141 | Another process holds the port | `PORT=3001 node server/index.js` **and** update the proxy in `vite.config.ts` |
| Client loads but shows an empty table | Stale `GameStore` after a bridge restart — there is **no reconnection logic** | Reload the page; create a new room |
| Game feels sluggish, bots hesitate ~1 s each turn | Default `BOT_DELAY_MS=1000` | `BOT_DELAY_MS=0` |
| Scoring tests fail after a dependency change | `riichi`/`syanten` floated past the pinned versions | Re-run `npm ci` in both `engine/` and `server/` |
| `--powers tok i` / `teru` does nothing | Accepted by `game.js` but has no implementation branch | Use the server path, or one of `saki`/`kuro`/`koromo`/`yuuki`/`hisa` |
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
