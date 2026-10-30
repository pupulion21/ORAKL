/** Vite build configuration for the ORAKL frontend.
 *
 *  Two entry points share one build:
 *   - index.html  -> the frozen legacy QIE Testnet app (src/main.ts);
 *   - local.html  -> the local selected-protocol app (src/local/main.ts).
 *
 *  This file is an ADDITION: no legacy source, stylesheet or frozen module is
 *  modified. The legacy entry keeps its original behaviour, output path and
 *  hash-based routing; the local entry reuses the same styles and frozen
 *  helpers by import.
 */

import {defineConfig} from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: 'index.html',
        local: 'local.html',
      },
    },
  },
});
