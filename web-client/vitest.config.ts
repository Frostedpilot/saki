// vitest.config.ts — the client had no behavioural tests at all (KI-07), so a UI
// regression could not be caught by anything short of opening the app by hand.
//
// Two settings matter here:
//   - `jsdom`, because the tile renderer emits lit-html templates that only resolve
//     against a real DOM.
//   - the `@` alias, which `svg-tiles.ts` relies on for its `?raw` SVG imports.
//     Vitest resolves through Vite, but does NOT inherit vite.config.ts by default,
//     so the alias has to be repeated.
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    // The store and the sprite injector both keep module-level singletons (the
    // injected SVG container, the socket handler list), so files must not share an
    // environment.
    isolate: true,
  },
});
