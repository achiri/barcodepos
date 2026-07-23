import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: {
    // `npm run host` exposes the dev server via a localtunnel .loca.lt
    // subdomain — Vite's dev server rejects unrecognized Host headers by
    // default, so allow that domain (subdomain varies per run).
    allowedHosts: ['.loca.lt']
  },
  plugins: [
    VitePWA({
      // We keep our own public/manifest.json — don't let the plugin generate one.
      manifest: false,
      // We call navigator.serviceWorker.register('sw.js') ourselves in app.js.
      injectRegister: false,
      registerType: 'autoUpdate',
      workbox: {
        // Precache every hashed build asset so the SW cache is invalidated
        // automatically whenever any file's content changes.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            // Barcode lookup — try the network first, fall back to cache offline.
            urlPattern: ({ url }) => url.hostname.includes('openfoodfacts.org'),
            handler: 'NetworkFirst',
            options: { cacheName: 'off-lookup' }
          },
          {
            // Google Apps Script / Sheets API calls must always hit the network.
            urlPattern: ({ url }) =>
              url.hostname.includes('google') || url.hostname.includes('sheets.googleapis.com'),
            handler: 'NetworkOnly'
          }
        ]
      }
    })
  ]
});
