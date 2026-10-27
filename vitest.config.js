import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Repository site tests exercise this checkout, without requiring a second
  // dependency install. Packed-consumer smoke tests prove published resolution.
  resolve: {
    alias: [
      { find: /^@inventure71\/paddockjs$/, replacement: fileURLToPath(new URL('./src/index.js', import.meta.url)) },
      { find: /^@inventure71\/paddockjs\/environment$/, replacement: fileURLToPath(new URL('./src/environment/index.js', import.meta.url)) },
      { find: /^@inventure71\/paddockjs\/data$/, replacement: fileURLToPath(new URL('./src/data/index.js', import.meta.url)) },
    ],
  },
  test: {
    setupFiles: ['./src/__tests__/setupBrowserGlobals.js'],
  },
});
