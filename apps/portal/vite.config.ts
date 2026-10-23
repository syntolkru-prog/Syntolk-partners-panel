import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { localBrowserLogin } from '../../scripts/local-launcher/browser-login.mjs';

export default defineConfig({
  plugins: [tailwindcss(), react(), localBrowserLogin(fileURLToPath(new URL('../..', import.meta.url)))],
  server: {
    // 5673: stays out of the brightyard-platform 5173/5175 range.
    port: Number(process.env.PORTAL_PORT ?? 5673),
    strictPort: true,
    headers: { 'Cache-Control': 'no-store' },
    proxy: {
      // The local portal and share links must work on the same origin.
      // Forward referral requests to the dedicated click-counting router.
      '^/r(?:/|$)': {
        target: process.env.ROUTER_URL ?? 'http://localhost:4701',
        changeOrigin: true,
      },
      '/api': {
        target: process.env.API_URL ?? 'http://localhost:4601',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  preview: {
    headers: { 'Cache-Control': 'no-store' },
  },
});
