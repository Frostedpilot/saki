# Protocol v6 — server ↔ client wire contract

The bridge speaks a **JSON, serde-shaped** protocol over a single WebSocket. It
mirrors the `riichi_mahjong_rs` Rust server so the vendored WASM client in
`server/public/` works unchanged.

| | |
| --- | --- |
| Transport | WebSocket, path `/ws`, default `ws://127.0.0.1:24141/ws` (`PORT` env) |
| Encoding | UTF-8 JSON, one message per frame |
| Version | `PROTOCOL_VERSION = 6` (`server/protocol.js`) |
| Reference impl | `server/protocol.js` (encode/decode) |
| Type mirror | `web-client/src/net/protocol-types.ts` (authoritative TS types) |
| Round-trip test | `server/test/bridge.test.js` (mock client, full match to `GameOver`) |

> This contract was previously undocumented — `server/README.md` said only
> "protocol v6 serde". If you change a payload, update **both**
> `server/protocol.js` and `protocol-types.ts`.

---

## 1. Envelope convention

Rust serde's externally-tagged enum representation, three shapes:

| Shape | Encoding | Example |
| --- | --- | --- |
| Unit variant | bare string | `"Pass"` |
| Newtype variant | `{ Variant: value }` | `{"Dora":"RedDora"}` |
| Struct variant | `{ Variant: { …fields } }` | `{"TileDrawn":{"tile":{…}}}` |

Every message is exactly one of these objects at the top level. Game events are
nested one level deeper inside `{ "Event": { … } }`.

Field naming is **snake_case**, matching serde. Tile representation is described in §2.

---

## 2. Tile codec

```jsonc
{ "index": 0..33, "red_dora": false }
```

`index` is the **kind**, not the physical tile. Layout:

| Range | Suit |
| --- | --- |
| `0..8` | man (`1m`..`9m`) |
| `9..17` | pin (`1p`..`9p`) |
| `18..26` | sou (`1s`..`9s`) |
| `27..33` | honours (`1z` East .. `7z` Red) |

Red (aka) dora are **not separate indices**. They are `{ index: <index of 5>, red_dora: true }`,
so `0m` == `{index:4, red_dora:true}`, `0p` == `{index:13, …}`, `0s` == `{index:22, …}`.
Honours have no red variant.

Internally the engine uses string codes (`"5m"`, `"0p"`, `"1z"`). Conversion:

```
sakiToTile("0p")   -> { index: 13, red_dora: true }
tileToSaki({13,true}) -> "0p"
```

Client-side equivalents live in `web-client/src/tiles/tile-utils.ts`
(`tileToFace`, `faceToTile`). Note the engine's own 37-kind normalisation
(`engine/tiles.js`) is a *different, internal* model — do not leak it onto the wire.

---

## 3. Handshake

```
client -> {"Hello":{"display_name":"tungv","protocol_version":6}}
server -> {"Welcome":{"session_token":"tok_…","protocol_version":6}}
```

`Hello` is answered unconditionally. **The server does not validate
`protocol_version`** — a mismatched client is accepted and then misbehaves rather than
being rejected with an `Error`. `session_token` is generated per-connection and is not
used for reconnection (there is no reconnection support).

---

## 4. Client → server

```ts
type ClientMessage =
  | { Hello: { display_name: string; protocol_version?: number } }
  | { CreateRoom: { length: string; rules: Record<string, unknown> } }
  | { JoinRoom: { code: string } }
  | 'LeaveRoom'
  | { SetCpuConfigs: { cpu_configs: Array<{ level: string; personality: string }> } }
  | { SetPowers: { power_seats: string[] } }
  | { SelectPowerTier: { tier: number } }
  | { StartGame: Record<string, unknown> }
  | { Action: ClientAction }
  | 'ReadyNextRound'
  | 'ReturnToLobby';
```

### Actions (always wrapped in `{ "Action": … }`)

```ts
type ClientAction =
  | { Discard: { tile: ProtocolTile } }
  | { Riichi: { tile: ProtocolTile } }
  | { Tsumo } | { Ron } | 'Pass'
  | { Chi: { tiles: ProtocolTile[] } }
  | { Pon: { tiles: ProtocolTile[] } }
  | { Kan: { tile_index: number } }
  | { NineTerminals: { declare: boolean } }
  | { SelectPowerTier: { tier: number } };
```

`SelectPowerTier` is special-cased at the top level in `server/index.js`: it is
routed to the room even inside an `Action`, before `submitAction`.

### Room rules and seat constraints

Enforced in `server/index.js`; violations return `{ Error: { code, message } }`:

| Condition | `code` |
| --- | --- |
| `CreateRoom`/`JoinRoom` while already in a room | `RoomFull` |
| `JoinRoom` for an unknown code, or a finished room | `RoomNotFound` |
| `JoinRoom` into a room with a game in progress, or no free seat | `RoomFull` |
| Any message requiring a room when not in one | `NotInRoom` |
| `Action` with no game running | `InvalidAction` |
| Unrecognised top-level message | `InvalidMessage` |

`SetPowers` must arrive **before** `StartGame` — the roster is assigned at game
creation. `power_seats` is a 4-element array of roster keys
(`saki`, `saki-normal`, `hisa`, `koromo`, `yuuki`, `mako`, `nodoka`, `yuu`, `none`),
positionally mapped to seats 0–3. The room pre-fills it with
`['saki','nodoka','koromo','yuuki']` unless `SAKI_POWER_SEATS` overrides it.

---

## 5. Server → client

```ts
type ServerMessage =
  | { Welcome: { session_token: string; protocol_version: number } }
  | { RoomState: RoomStatePayload }
  | { Event: ServerEvent }
  | { GameOver: { final_scores: number[] } }
  | { Error: { code: string; message: string } }
  | { TurnTimer: { seconds: number } };
```

### Events (always wrapped in `{ "Event": { … } }`)

| Event | Payload highlights |
| --- | --- |
| `GameStarted` | `seat_wind`, `hand` (your 13), `scores`, `round_wind`, `dora_indicators`, `round_number`, `total_rounds`, `honba`, `riichi_sticks`, `three_player`, `nuki_dora` |
| `TileDrawn` | `tile`, `remaining_tiles`, `can_tsumo`, `can_riichi`, `is_furiten` |
| `OtherPlayerDrew` | `player`, `remaining_tiles` |
| `TileDiscarded` | `player`, `tile`, `is_tsumogiri?`, `hand_index?` |
| `CallAvailable` | `tile`, `discarder`, `calls: string[]` (e.g. `['Chi','Pon','Daiminkan','Ron']`) |
| `PlayerCalled` | `player`, `call_type`, `called_tile`, `tiles`, `from_player?` |
| `DoraIndicatorsUpdated` | `dora_indicators` (after a kan) |
| `PlayerRiichi` | `player`, `scores`, `riichi_sticks` |
| `HandUpdated` | `hand` |
| `RoundWon` | `winner`, `loser?`, `winning_tile`, `scores`, `yaku_list`, `han`, `fu`, `score_points`, `rank?`, `uradora_indicators?`, `riichi_sticks?`, `honba?`, `honba_points?`, `player_hands?` |
| `RoundDraw` | `scores`, `reason`, `tenpai?`, `riichi_sticks?`, `declarer?` |
| `SuperpowerIndicator` | **Saki extension** — see below |
| `PowerActivated` | **Saki extension** — `player`, `power`, `tier?`, `event_type?` |

`SuperpowerIndicator` and `PowerActivated` are **not part of upstream protocol v6** —
they are Saki additions that let the stock WASM client ignore them gracefully.

### Saki's power extensions

```ts
interface SuperpowerIndicatorEvent {
  seat: number;
  power: string;
  active: boolean;
  type?: 'flow' | 'normal';        // power economy class
  gauge?: number | null;           // 0..100 Flow, or null for normal-type
  description?: string;
  armed_tier?: number;             // 0 = unarmed
  available_tiers?: Array<{
    tier: number; name: string; cost: number;
    canAfford: boolean; canActivate: boolean;
  }>;
}
```

Two power types, distinguished by `type` (`docs/abilities.md` has the full rules):

- **`flow`** — Gauge economy. Tiers cost `25 / 50 / 100 / 150` Flow. `gauge` is a number.
- **`normal`** — always-on passive. No gauge, no tiers. **`gauge` is `null`** and the
  client renders a dashed `PASSIVE` pill instead of a meter
  (`web-client/src/components/power-badge.ts`).

Getting this wrong is the easiest client bug to make: `gauge: null` vs `gauge: 0` are
different states, and `armed_tier: 0` means *no tier armed*, not *tier zero*.

### Yaku encoding

`RoundWon.yaku_list` is a `yaku`/`han` pair array, and the two elements use
different shapes depending on whether the entry is a yaku or a dora:

```ts
yaku_list: Array<
  { name: string; han: number }                  // yaku
  | [{ Yaku?: string; Dora?: string }, number]   // dora
>;
```

`server/yaku-map.js` translates Japanese yaku names from the `riichi` npm package into
the protocol's `Kind` enum and `DoraLabel`. Round and wind names are strings
(`'East' | 'South' | 'West' | 'North'`), see `seatWind()` in `server/protocol.js`.

---

## 6. Round lifecycle (happy path)

```
Hello          -> Welcome
CreateRoom     -> RoomState
SetCpuConfigs  -> RoomState
SetPowers      -> RoomState
StartGame      -> Event(GameStarted)
                  Event(TileDrawn)            x N, per turn
                  Event(SuperpowerIndicator)  when power state changes
                  Event(PowerActivated)       on activation
                  Event(TileDiscarded)
                  Event(CallAvailable)        when a call window opens
   <- Action(Discard|Riichi|Chi|Pon|Kan|Tsumo|Ron|Pass|NineTerminals|SelectPowerTier)
                  Event(PlayerCalled) / Event(PlayerRiichi)
                  Event(DoraIndicatorsUpdated) after a kan
                  Event(RoundWon) | Event(RoundDraw)
ReadyNextRound -> Event(GameStarted) ... or GameOver
ReturnToLobby  -> RoomState
```

CPU seats are driven internally with a `BOT_DELAY_MS` pacing timer; the human seat
blocks on `Action`.

---

## 7. Server capabilities

The server plays **East-only tonpuusen, 1 human + 3 CPU** and deliberately omits
abortive draws, nagashi mangan, pao, sanma, reconnection, and oka/uma. See
`server/README.md` §"Excluded features" and the rules table in the root README.

`TurnTimer` is emitted by the server type surface but there is **no turn timer
implemented** — the field exists for upstream compatibility.

---

## 8. Changing the protocol

1. Edit the encoder/decoder in `server/protocol.js`.
2. Mirror the change in `web-client/src/net/protocol-types.ts`.
3. Extend `server/test/bridge.test.js` — it drives a real match and will catch
   payload drift.
4. If you change a Saki extension (`SuperpowerIndicator`, `PowerActivated`), note that
   the vendored WASM client in `server/public/` must keep tolerating its absence.
