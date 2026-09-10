import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  cacheDir: '../.vite/demo',
  server: {
    strictPort: true,
  },
  preview: {
    strictPort: true,
  },
});
