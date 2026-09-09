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
- **Saki power framework**: each seat can be assigned any of the six
  Saki-character rosters (Saki, Hisa, Koromo, Yuuki, Mako, Nodoka) from a
  dedicated character screen. It appears as part of room creation — after
  picking a game mode (Create Room → モード選択 → 東風), the host assigns one
  character per seat before the room is created — and can be reopened later
  from the host-only **Characters** button in the lobby.
  Tier activation fires on a sealed kan/rinshan draw; passive/field effects
  react to settlement. Activations are broadcast as `PowerActivated` events
  and rendered as a transient banner plus per-seat board badges.

## Character powers

The character screen (host only) assigns one character per seat; `None`
disables powers for that seat. Rosters live in
`engine/powers/rosters/{kiyosumi,hisa,koromo,yuuki,mako,nodoka}.js`. The
server broadcasts `RoomState.power_seats` so everyone's lobby shows the
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

Abortive draws (kyuushu, suufon-renda, suucha-riichi, suukaikan), nagashi
mangan, chankan only on kakan, pao/sekinin, 3-player, reconnection/resync,
turn timers, oka/uma (raw scores in GameOver).

## Human disconnect

If the human WebSocket drops mid-game, the seat is auto-substituted with a CPU
that finishes the remaining hands.

## Testing

```bash
node --test test/bridge.test.js
```

Spins up a headless server, connects a mock protocol v6 client, plays an
entire 4-hand match to completion, and asserts the full event flow through
GameOver.
