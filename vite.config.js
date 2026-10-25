// The browser build of the Token eligibility demo. The same evaluator as the command
// line (src/evaluate.js) runs in the page against the public Portaldot V3 testnet nodes;
// the installed `revivecheck` package is bundled from node_modules like any dependency.
// WEB_BASE sets the public base path (GitHub Pages serves the site under the repository
// name); the default './' works from any directory and from file://.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  base: process.env.WEB_BASE || './',
  plugins: [react()],
  server: { host: '127.0.0.1', port: 4190 },
  preview: { host: '127.0.0.1', port: 4191 },
  build: { outDir: '../dist-web', emptyOutDir: true, sourcemap: false },
});
