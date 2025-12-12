import { defineConfig } from 'vite';

export default defineConfig({
  // Base path for GitHub Pages deployment
  base: process.env.GITHUB_ACTIONS ? '/realtime-geops-api/' : '/',
  build: {
    target: 'esnext',
  },
});
