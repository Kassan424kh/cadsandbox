import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Cross-origin isolation enables SharedArrayBuffer + multithreaded WASM. Everything (fonts, wasm,
// workers, blobs via /api) is served same-origin, so require-corp costs nothing — and it also
// guarantees no third-party requests leak user data (GDPR).
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
}

const API = process.env.CADSANDBOX_API ?? 'http://localhost:8787'

/** Heavy, optional importer runtimes (STEP/IGES, 3DM, IFC): cached on first use instead of precached. */
const LAZY_RUNTIMES = ['**/occt-import-js*', '**/rhino3dm*', '**/web-ifc*']

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'generateSW',
      registerType: 'prompt',
      injectRegister: false, // registered in src/app/pwa.ts (update prompt + offline-ready toast)
      includeAssets: ['favicon.svg', 'icon.svg', 'icon-maskable.svg', 'icon-mono.svg'],
      manifest: {
        id: '/',
        name: 'CadSandbox',
        short_name: 'CadSandbox',
        description: 'Design, draft and build together — right in your browser.',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'any',
        theme_color: '#0b0b0d',
        background_color: '#0b0b0d',
        categories: ['design', 'productivity', 'utilities'],
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
          { src: '/icon-mono.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'monochrome' },
        ],
      },
      workbox: {
        // App shell + fonts + core wasm are precached; large optional runtimes are cached on demand.
        globPatterns: ['**/*.{js,css,html,svg,woff2,wasm,webmanifest}'],
        globIgnores: ['**/*.map', ...LAZY_RUNTIMES],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/collab/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Content-addressed project blobs are immutable: serve from cache, never revalidate.
            // The cache is deleted on sign-out (see src/data/cloud-cache.ts).
            urlPattern: ({ url, request }) => request.method === 'GET' && /^\/api\/projects\/[^/]+\/blobs\/[a-f0-9]{64}$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'cadsandbox-blobs',
              expiration: { maxEntries: 1000, maxAgeSeconds: 60 * 60 * 24 * 90, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Hashed build assets are immutable: lazily used runtimes (IFC/STEP/3DM) work offline after first use.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/assets/'),
            handler: 'CacheFirst',
            options: { cacheName: 'cadsandbox-assets', expiration: { maxEntries: 60, purgeOnQuotaError: true }, cacheableResponse: { statuses: [200] } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    headers: isolation,
    proxy: {
      '/api': { target: API, changeOrigin: false },
      '/collab': { target: API.replace(/^http/, 'ws'), ws: true },
    },
  },
  preview: { port: 4173, headers: isolation },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 4000,
    rolldownOptions: {
      output: {
        // Stable vendor/feature chunks (the successor of Rollup's manualChunks in Vite 8/Rolldown).
        codeSplitting: {
          groups: [
            { name: 'three', test: /[\\/]node_modules[\\/](three|three-mesh-bvh|three-stdlib)[\\/]/, priority: 40 },
            { name: 'radix', test: /[\\/]node_modules[\\/](@radix-ui|radix-ui)[\\/]/, priority: 30 },
            { name: 'collab', test: /[\\/]node_modules[\\/](yjs|y-indexeddb|y-protocols|lib0|@hocuspocus)[\\/]/, priority: 25 },
            { name: 'editor', test: /[\\/](packages[\\/](render|geometry|io)|src[\\/]editor)[\\/]/, priority: 20 },
            { name: 'admin', test: /[\\/]src[\\/]app[\\/]admin[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
})
