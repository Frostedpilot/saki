# saki bridge server

WebSocket bridge that speaks **riichi_mahjong_rs protocol v6**, driving the
**saki** engine + supernatural power framework to serve a 1-human + 3-CPU
East-only mahjong match rendered by the existing WASM web client.

## Quick start

```bash
npm install        # install ws, riichi, syanten
node index.js      # http://127.0.0.1:24141  (ws://127.0.0.1:24141/ws)
```

Open `http://127.0.0.1:24141` in a browser → you're seated East (host).
The three CPU seats auto-fill when you press **Start**.

## Architecture

```
Browser (WASM client)  ←→  WebSocket (JSON, protocol v6)  ←→  index.js (hub)
                                                     ↓
                                              room.js (Table driver)
                                              ├─ helpers.js   (rules, scoring helpers)
                                              ├─ protocol.js  (serde codec)
                                              ├─ yaku-map.js  (JP→Kind yaku names)
                                              └─ engine/      (saki engine core)
```

### Files

| File | Purpose |
|------|---------|
| `index.js` | HTTP static server + WebSocket `/ws` hub, Hello/Welcome, room map |
| `room.js` | `Room` (lobby/seats) + `Table` (full hand driver, kan/tsumo/ron/call pipelines, scoring, power hooks) |
| `protocol.js` | Protocol v6 serde: `ServerEvent`/`ClientAction` builders, `parseClientMessage`/`parseAction` |
| `helpers.js` | Extracted rules: shanten, hairi, wait tiles, furiten, bot decision, riichi/kan guards, scoring proxy |
| `yaku-map.js` | Japanese yaku names → protocol `Kind` enum, dora label mapping, `buildYakuList` |
| `package.json` | Dependencies: `ws`, `riichi` (score lib), `syanten` |
| `public/` | Pre-built `riichi_mahjong_rs` WASM client (copied from build) |

## Game configuration

- **East only** (tonpuusen): 4 rounds (East 1–4)
- **1 human** (host seat 0) + **3 CPU** seats
- **Saki power framework**: each seat can be assigned any of the **eight**
  registered Saki-character rosters from a dedicated character screen. It appears
  as part of room creation — after picking a game mode (Create Room →
  モード選択 → 東風), the host assigns one character per seat before the room is
  created — and can be reopened later from the host-only **Characters** button
  in the lobby.
  Tier activation fires on a sealed kan/rinshan draw; passive/field effects
  react to settlement. Activations are broadcast as `PowerActivated` events
  and rendered as a transient banner plus per-seat board badges.

## Character powers

The character screen (host only) assigns one character per seat; `None`
disables powers for that seat. All eight rosters live in
`engine/powers/rosters/`:

| Registry key | Roster file | Character | Power type |
|---|---|---|---|
| `saki` | `kiyosumi.js` | Saki Miyanaga | flow |
| `saki-normal` | `saki-normal.js` | Saki Miyanaga ("Ridge Bias / Ridge Resonance") | **normal** |
| `nodoka` | `nodoka.js` | Nodoka Haramura | flow |
| `yuuki` | `yuuki.js` | Yuuki Kataoka | flow |
| `mako` | `mako.js` | Mako Someya | flow |
| `hisa` | `hisa.js` | Hisa Takei | flow |
| `koromo` | `koromo.js` | Koromo Amae | flow |
| `yuu` | `achiga.js` | Yuu Matsumi (Achiga) | **normal** |

Two are **normal-type** passives: they sit outside the Flow economy (gauge pinned
at 0, no tiers) and the client renders a `PASSIVE` pill instead of a meter. See
`docs/abilities.md` and `docs/protocol.md`.

Rosters are loaded through `try { … } catch { /* roster missing */ }` blocks, so a
broken or absent roster **fails silently** — the seat just gets no power. If a
character is missing from the screen, check the `ROSTERS` block in `room.js` first.

The server broadcasts `RoomState.power_seats` so everyone's lobby shows the
selections, and `SetPowers` is how the host updates them. When characters are
chosen before the room exists (via the pre-game screen), the client holds the
assignment until the room is created and sends `SetPowers` right after, so
the wire order stays CreateRoom → SetPowers. Empty seats and CPU-substituted
seats keep the powers assigned to their seat index. The host seat defaults to
Saki to match the server's default room assignment.

Power activations surface to the client as a `PowerActivated` server event
with the owner's wind, power id, tier (1–4, or 0 for passives) and an
event-type tag (e.g. `RINSHAN_RESONANCE_TRIGGER`, `CHILLING_GAZE`,
`QUICK_BITE`). The client localizes the tags and shows a banner.

## Excluded features

Abortive draws (all five: kyuushu-kyuuhai, suufon-renda, suucha-riichi,
suukaikan, triple ron — gated off via `RULES.serverAborts`), nagashi mangan,
chankan only on kakan, pao/sekinin, 3-player, reconnection/resync, turn timers,
oka/uma (raw scores in GameOver).

> **Reconnection caveat.** The client *attempts* to reconnect every 2 s
> (`web-client/src/net/socket.ts`), but the server has no session resume — a new
> `Hello` mints a fresh anonymous session, so the reconnected client holds a
> stale `GameStore` and every action returns `InvalidAction`. Reload the page.
> The offline engine (`engine/game.js`) implements all five aborts and oka/uma.

## Environment variables

Read by `index.js` and `room.js`; see `docs/development.md` §4 for full detail.

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `24141` | HTTP + WebSocket port |
| `SAKI_POWER_SEATS` | `saki,nodoka,koromo,yuuki` | Comma-separated seat indices `0..3` that get `saki`; all others become `none`. Bad values are reported by name, not silently dropped. |
| `BOT_DELAY_MS` | `1000` (`0` if `NODE_ENV=test`) | Minimum CPU think-time |
| `NODE_ENV` | unset | `test` only affects the default bot delay |
| `SAKI_RIICHI_FORCE` | unset | `1` forces bot riichi at a fixed 0.45 probability gate |
| `SAKI_SEED` | unset | Pins the match seed (any integer) so a match is reproducible. Used by the E2E test, which runs a fixed seed by default; override with `BRIDGE_TEST_SEED`. A non-numeric value warns and falls back to a random seed. |

## Human disconnect

If the human WebSocket drops mid-game, the seat is auto-substituted with a CPU
that finishes the remaining hands.

## Clients

Two clients can talk to this server:

- **`web-client/`** — the active TypeScript/Vite/lit-html client. Use this one for
  development (`npm run dev` on :3000, proxying `/ws` here).
- **`server/public/`** — a **vendored, prebuilt WASM client** from upstream
  `riichi_mahjong_rs`, served at `/`. Nothing in this repo builds it or records
  which upstream commit it came from; its content-hashed filenames are the only
  provenance signal. Treat it as an opaque artifact.

## Testing

```bash
npm test                        # node --test test/*.test.js
# or:
node --test test/*.test.js
```

3 tests. Spins up a headless server, connects a mock protocol v6 client, plays
an entire 4-hand match to completion, and asserts the full event flow through
GameOver. Also unit-tests the red-dora tile codec and the Yuu Matsumi passive.
