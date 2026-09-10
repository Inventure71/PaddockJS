import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const previewRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  cacheDir: '../.vite/local-preview',
  build: {
    rollupOptions: {
      input: {
        index: resolve(previewRoot, 'index.html'),
        templates: resolve(previewRoot, 'templates.html'),
        components: resolve(previewRoot, 'components.html'),
        customization: resolve(previewRoot, 'customization.html'),
        api: resolve(previewRoot, 'api.html'),
        playable: resolve(previewRoot, 'playable.html'),
        behavior: resolve(previewRoot, 'behavior.html'),
        rules: resolve(previewRoot, 'rules.html'),
        stewarding: resolve(previewRoot, 'stewarding.html'),
        collisionLab: resolve(previewRoot, 'collision-lab.html'),
        policyRunner: resolve(previewRoot, 'policy-runner.html'),
      },
    },
  },
});
