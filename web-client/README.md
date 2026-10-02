# Saki Mahjong Web Client

A modern, fast, hot-reloading web client for Saki Superpower Riichi Mahjong, built with **TypeScript**, **Vite**, **lit-html**, and **SCSS**.

## Features

- **FluffyStuff Vector SVG Tiles**: Crisp vector tiles at any zoom level, complete with red fives and classic tile backs.
- **Saki Character Cards**: 63 official high-resolution character cards from the anime/manga (`public/images/sakicardsv13.png`, a **23 MB** sprite sheet).
- **Hover Zoom Preview**: Hover over any card on the table or in the lobby to inspect full character artwork, ability descriptions, and trigger conditions.
- **Superpower Indicators & Gauges**: Live power status tracking (active state, meter fill, and glowing aura per character). Normal-type passives render a dashed `PASSIVE` pill instead of a meter.
- **Responsive Mahjong Table**: CSS Grid 4-player board with 3-row discard ponds, sideways riichi discards, open melds (Chi/Pon/Kan), and center compass.
- **Interactive Action Bar**: Click hand tiles to discard; contextual buttons for Chi, Pon, Kan, Riichi, Tsumo, Ron, and Pass.

## Requirements

Node.js **22+**. This package is one of three independent npm packages — there is no
root `package.json` and no workspaces, so install here **and** in `server/`:

```bash
cd engine       && npm ci   # the client needs the engine only at runtime, via the server
cd ../server    && npm ci
cd ../web-client && npm ci
```

## Running the Web Client

### 1. Start the Bridge Server
In a terminal, from the **repository root**:
```bash
node server/index.js
```
The bridge server starts on port `24141` by default (override with `PORT`). If you
change the port you must also update the `/ws` proxy target in `vite.config.ts`.

### 2. Start the Web Client Dev Server
In another terminal:
```bash
cd web-client
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser. Vite automatically proxies `/ws` requests to the bridge server on port `24141`.

> `run_server.sh` / `run_server.bat` at the repo root start both processes for you.

### 3. Production Build
```bash
cd web-client
npm run build     # tsc --noEmit, then vite build -> dist/
npm run preview   # serve the built dist/
```

The built client lands in `web-client/dist/` (gitignored). Realistic sizes:

| Asset | Size |
|---|---|
| `assets/index-*.js` | ~280 kB minified |
| `assets/index-*.css` | ~46 kB minified |
| `images/sakicardsv13.png` | **~23 MB** |

The character-card sheet dominates. Budget for it, or serve it from a CDN / cache it
aggressively — the JS bundle alone is the "small" figure, not the total.

## Testing

**There are none.** This package has no test runner and no `*.test.*` files. The only
automated gate is the `tsc` type-check inside `npm run build`, so a UI regression
will not be caught. See `docs/known-issues.md` (KI-07).
