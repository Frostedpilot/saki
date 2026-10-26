# Saki — supernatural riichi mahjong

A 4-player Japanese riichi mahjong engine where each player is a character from the
*Saki* franchise and their superpower rewrites the rules of the wall. Implemented as
three independent Node packages:

| Package | What it is | Language |
| --- | --- | --- |
| `engine/` | Rules, tile model, scoring, RNG, and the six-primitive power framework | CommonJS JavaScript |
| `server/` | WebSocket bridge that runs games over `riichi_mahjong_rs` **protocol v6** | CommonJS JavaScript |
| `web-client/` | Modern browser client (lit-html + Vite + strict TypeScript) | TypeScript + SCSS |

The defining mechanic is **Schrödinger's Wall** (`engine/powers/dynamicPool.js`):
the live wall is never shuffled up front. It is a finite counted inventory sampled on
demand, and character powers bias the sampling weights, reserve specific wall slots,
or re-shape the whole distribution. See [`docs/engine-design.md`](docs/engine-design.md).

---

## Quick start

Requires **Node.js 22+** (developed on 22.18.0). The repo is a single **npm
workspace** — one install covers all three packages:

```bash
npm ci
```

Then start the full stack:

```bash
./run_server.sh          # macOS / Linux / WSL
run_server.bat           # Windows
```

Open **<http://localhost:3000>**. The bridge listens on <http://127.0.0.1:24141>
(WebSocket at `/ws`); the Vite dev server proxies `/ws` to it.

Prefer to run the two processes by hand:

```bash
node server/index.js                # terminal 1 — bridge, :24141
cd web-client && npm run dev        # terminal 2 — client, :3000
```

### Just want to watch the engine play itself?

```bash
node engine/game.js                       # full hanchan, 4 CPU bots
node engine/game.js --powers none --human 0   # you at seat 0, no powers
node engine/game.js --seed 12345 --kyoku 4    # deterministic, 4 rounds
node engine/cli.js eval "112233456789m11s"    # score one hand
```

Full flag list and more: [`docs/development.md`](docs/development.md#33-running-the-engine).

---

## Which rules do we play?

The engine implements two deliberately different rule sets. This trips people up, so
it is stated here once and cross-linked everywhere else:

| | Offline (`engine/game.js`) | Network (`server/table.js`) |
| --- | --- | --- |
| Length | Tonpuusen (4) or hanchan (8), `--kyoku` | **Tonpuusen only**, 4 rounds |
| Abortive draws | **All five enabled** | **All five enabled** (KI-25) |
| Nagashi mangan | Yes | Yes (KI-25) |
| Agari-yame / enchousen | Yes | Yes (KI-25) |
| Oka/uma (final standings) | Yes | Offline only — the client computes its own |
| Wall model | Pre-shuffled array, `wall.pop()` | `DynamicPool` weighted sampling |

Both read `engine/rules-config.js` (`RULES.aborts` vs `RULES.serverAborts`) so the
divergence is explicit data rather than a hidden branch; `RULES.serverAborts` is now
all-true. Per-rule detail:
[`docs/engine-implementation.md`](docs/engine-implementation.md).

---

## Repository layout

```
saki/
├── engine/                  core rules + power framework (no I/O, no network)
│   ├── game.js              offline reference game + CLI match loop
│   ├── selftest.js          the 48 deterministic rule checks behind --selftest
│   ├── cli.js               single-hand scorer (node cli.js eval <hand>)
│   ├── core.js              modular match core used by the server
│   ├── helpers.js           shared rule helpers (waits/furiten/bots/aborts/oka-uma)
│   ├── tiles.js             34 kinds -> 37 physical tile kinds (aka) -> 136 tiles
│   ├── scoring.js           thin wrapper over the `riichi` npm package
│   ├── rng.js               deterministic seeded RNG (mulberry32)
│   ├── rules-config.js      rules as data (shared by game.js and table.js)
│   ├── match-flow.js        shared hand-transition table (dealer/honba/kyoku/noten/han floor)
│   ├── hand-driver.js       shared hand/turn driver (`playHand` / `playTurn`)
│   ├── turn-core.js         shared single-turn decisions (turn start, discard, kan, calls)
│   ├── invariants.js        per-turn tile-conservation checks
│   ├── replay.js            deterministic action journal + verifier
│   ├── input.js             human discard-index parsing
│   ├── powers/              the six-primitive framework
│   │   ├── index.js         PowerDispatcher registry + lifecycle routing
│   │   ├── dynamicPool.js   Schrodinger's Wall
│   │   ├── trajectoryPlanner.js  hand Trajectory DAG / uke-ire
│   │   ├── flowManager.js   Flow Gauge economy (0-150%)
│   │   ├── awakening.js     Awakening Curve + Riichi Table Pressure
│   │   ├── nodokaEval.js    "Nodocchi" EV / tenpai evaluator
│   │   ├── mjaiAdapter.js   pluggable evaluator interface (MJAI bots)
│   │   └── rosters/         one file per character power (8 shipped)
│   └── tests/               31 *.test.js, node:test
│
├── scripts/
│   ├── check-links.mjs      markdown link checker (npm run links)
│   └── release-check.mjs    version + changelog gate (npm run release:check)
│
├── .github/workflows/       ci.yml (every push) + release.yml (v* tags)
│
├── CHANGELOG.md             Keep a Changelog, one entry per release
│
├── server/                  WebSocket bridge (node:http + ws)
│   ├── index.js             static host for public/ + WebSocketServer at /ws
│   ├── room.js              Room: lobby, seats, power assignment
│   ├── table.js             Table: the hand driver and server adapter
│   ├── table-calls.js       call window: ron/pon/kan/chi, open calls
│   ├── table-powers.js      power activation, tier arming, HUD broadcast
│   ├── hook-utils.js        defensive character-hook calls (warnOnce/callHook)
│   ├── phases.js            Table's async phase names
│   ├── rosters.js           power roster registry, loaded defensively
│   ├── protocol.js          protocol v6 JSON codec
│   ├── yaku-map.js          riichi lib yaku names -> protocol Kind/DoraLabel
│   ├── public/              vendored prebuilt WASM client (upstream build, ~12 MB)
│   └── test/                bridge (E2E), aborts, settlement, validation, call-window, yaku-map
│
├── web-client/              Vite + lit-html + strict TypeScript client
│   └── src/
│       ├── main.ts          entry: GameSocket -> GameStore -> screens
│       ├── state/store.ts   the reactive store (state + outbound commands)
│       ├── state/events.ts  wire-event reducer (server event -> store state)
│       ├── net/             socket.ts (reconnect) + protocol-types.ts (wire types)
│       ├── tiles/           tile model helpers + FluffyStuff SVG rendering
│       ├── components/      11 lit-html render modules
│       ├── styles/          SCSS, board grid + design tokens
│       └── assets/          vendored tile sprite sheets
│
├── docs/                    design specs, per-character specs, reference notes
├── package.json             npm workspace root (one install for all three)
├── run_server.sh / .bat     start bridge + client dev server together
└── .gitignore               reference/ (upstream clones), node_modules/, dist/
```

---

## Tests

CI runs on every push and PR (`.github/workflows/ci.yml`). Everything runs locally
via Node's built-in test runner.

```bash
npm test              # everything CI runs
npm run test:engine   # 475 tests + 48 rule checks
npm run test:server   # 148 server tests
npm run test:scripts  # 13 dev-script tests
npm run test:client   # 244 client tests + tsc type-check
npm run release:check # version + changelog consistency
npm run links         # markdown link check
npm run smoke         # one short deterministic hand
```

> `node --test` needs a **glob**, not a bare directory: `node --test tests/*.test.js`
> works, `node --test tests/` throws `Cannot find module` on Node 22. The `npm test`
> scripts are set up correctly. History in
> [`docs/known-issues.md`](docs/known-issues.md#ki-01).

---

## Releases

One version across the workspace. A release is a `vX.Y.Z` tag with a matching
[`CHANGELOG.md`](CHANGELOG.md) section; `npm run release:check` fails if the manifests
disagree or the section is missing. Pushing the tag runs the full check and publishes a
GitHub Release (`.github/workflows/release.yml`). The step-by-step flow is in
[`docs/development.md` §8](docs/development.md#8-releasing).

---

## Documentation map

| Document | Read it when |
| --- | --- |
| [`docs/README.md`](docs/README.md) | **Start here** — index + which doc wins when they disagree |
| [`docs/development.md`](docs/development.md) | Setting up, running, testing, troubleshooting |
| [`docs/engine-design.md`](docs/engine-design.md) | How supernatural powers work (the 6 primitives) |
| [`docs/engine-implementation.md`](docs/engine-implementation.md) | How a real game runs, tile by tile |
| [`docs/protocol.md`](docs/protocol.md) | The server/client wire contract (protocol v6) |
| [`docs/conventions.md`](docs/conventions.md) | Code style, module boundaries, adding a character |
| [`docs/known-issues.md`](docs/known-issues.md) | Structural fragility register + doc rot |
| [`docs/architecture-comparison.md`](docs/architecture-comparison.md) | Why this design over the upstream Elixir/Rust/Z3 engine |
| [`docs/abilities.md`](docs/abilities.md) | All character powers — 8 implemented, ~20 design intent |
| [`docs/characters/`](docs/characters/) | Per-character specs — **canonical for implemented characters** |
| [`docs/saki-characters.md`](docs/saki-characters.md) | Franchise lore / full cast reference |
| [`docs/reference-riichi-advanced.md`](docs/reference-riichi-advanced.md) | Notes on the upstream reference engine (needs `reference/`) |

---

## Known state

An active personal project. CI runs on every push (`npm ci`, format check, lint, the full
test suite, a CLI smoke check and the link check), and all of it is reproducible locally
with one command (`npm run check`). The engine is a single npm workspace. Still missing: a
release process. There is deliberately **no LICENSE** — see
[`docs/known-issues.md` KI-12](docs/known-issues.md#ki-12), which explains why the
vendored art makes that a decision rather than an oversight.

Character coverage is the main remaining gap: **8 powers implemented out of ~28
documented**. The structural risks that are still open, and the documentation-rot
register, live in [`docs/known-issues.md`](docs/known-issues.md).
