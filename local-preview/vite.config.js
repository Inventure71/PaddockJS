import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        templates: resolve(__dirname, 'templates.html'),
        components: resolve(__dirname, 'components.html'),
        api: resolve(__dirname, 'api.html'),
        behavior: resolve(__dirname, 'behavior.html'),
        expertEnvironment: resolve(__dirname, 'expert-environment.html'),
        policyRunner: resolve(__dirname, 'policy-runner.html'),
      },
    },
  },
});
