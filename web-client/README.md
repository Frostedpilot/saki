# Saki Mahjong Web Client

A modern, fast, hot-reloading web client for Saki Superpower Riichi Mahjong, built with **TypeScript**, **Vite**, **lit-html**, and **SCSS**.

## Features

- **FluffyStuff Vector SVG Tiles**: Crisp vector tiles at any zoom level, complete with red fives and classic tile backs.
- **Saki Character Cards**: 63 official high-resolution character cards from the anime/manga (`sakicardsv13.png`).
- **Hover Zoom Preview**: Hover over any card on the table or in the lobby to inspect full character artwork, ability descriptions, and trigger conditions.
- **Superpower Indicators & Gauges**: Live power status tracking (active state, meter fill, and glowing aura per character).
- **Responsive Mahjong Table**: CSS Grid 4-player board with 3-row discard ponds, sideways riichi discards, open melds (Chi/Pon/Kan), and center compass.
- **Interactive Action Bar**: Click hand tiles to discard; contextual buttons for Chi, Pon, Kan, Riichi, Tsumo, Ron, and Pass.

## Running the Web Client

### 1. Start the Bridge Server
In a terminal:
```bash
node server/index.js
```
The bridge server starts on port `24141` by default.

### 2. Start the Web Client Dev Server
In another terminal:
```bash
cd web-client
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser. Vite automatically proxies `/ws` requests to the bridge server on port `24141`.

### 3. Production Build
```bash
cd web-client
npm run build
npm run preview
```
The built client is located in `web-client/dist/` (bundle size is ~250 kB total).
