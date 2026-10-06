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
| Abortive draws | **All five enabled** | **All five disabled** |
| Nagashi mangan, oka/uma | Yes | No |
| Wall model | Pre-shuffled array, `wall.pop()` | `DynamicPool` weighted sampling |

Both read `engine/rules-config.js` (`RULES.aborts` vs `RULES.serverAborts`) so the
divergence is explicit data rather than a hidden branch. Per-rule detail:
[`docs/engine-implementation.md`](docs/engine-implementation.md).

---

## Repository layout

```
saki/
├── engine/                  core rules + power framework (no I/O, no network)
│   ├── game.js              offline reference game + CLI + --selftest rule checker
│   ├── cli.js               single-hand scorer (node cli.js eval <hand>)
│   ├── core.js              modular match core used by the server
│   ├── helpers.js           shared rule helpers (waits/furiten/bots/aborts/oka-uma)
│   ├── tiles.js             34 kinds -> 37 physical tile kinds (aka) -> 136 tiles
│   ├── scoring.js           thin wrapper over the `riichi` npm package
│   ├── rng.js               deterministic seeded RNG (mulberry32)
│   ├── rules-config.js      rules as data (shared by game.js and table.js)
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
│   └── tests/               25 *.test.js, node:test
│
├── scripts/
│   └── check-links.mjs      markdown link checker (npm run links)
│
├── .github/workflows/ci.yml  engine + server + client build + link check
│
├── server/                  WebSocket bridge (node:http + ws)
│   ├── index.js             static host for public/ + WebSocketServer at /ws
│   ├── room.js              Room: lobby, seats, power assignment
│   ├── table.js             Table: the hand driver  <- largest file
│   ├── rosters.js           power roster registry, loaded defensively
│   ├── protocol.js          protocol v6 JSON codec
│   ├── yaku-map.js          riichi lib yaku names -> protocol Kind/DoraLabel
│   ├── public/              vendored prebuilt WASM client (upstream build, ~12 MB)
│   └── test/                bridge (E2E), settlement, validation, call-window, yaku-map
│
├── web-client/              Vite + lit-html + strict TypeScript client
│   └── src/
│       ├── main.ts          entry: GameSocket -> GameStore -> screens
│       ├── state/store.ts   the single reactive store (largest client file)
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
npm test              # everything CI runs (~2 min)
npm run test:engine   # 365 tests + 43 rule checks
npm run test:server   # 97 server tests
npm run test:client   # 80 client tests + tsc type-check
npm run links         # markdown link check
npm run smoke         # one short deterministic hand
```

> `node --test` needs a **glob**, not a bare directory: `node --test tests/*.test.js`
> works, `node --test tests/` throws `Cannot find module` on Node 22. The `npm test`
> scripts are set up correctly. History in
> [`docs/known-issues.md`](docs/known-issues.md#ki-01).

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

An active personal project. **CI is green on every push**, tests run locally via one
command, and the engine is a single npm workspace — but there is still **no linter, no
LICENSE, and no release process**.

Character coverage is the main remaining gap: **8 powers implemented out of ~28
documented**. The structural risks that are still open, and the documentation-rot
register, live in [`docs/known-issues.md`](docs/known-issues.md).
