import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { brotliCompress, constants as zlib, gzip } from 'node:zlib'
import { defineConfig, type Plugin } from 'vite'
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

/**
 * Large, rarely needed build outputs that are not precached either (~5 MB). They are hashed
 * /assets/* files, so the runtime CacheFirst route below keeps them available offline once used.
 * Deliberately still precached because the editor cannot open a drawing without them: the geometry
 * worker and manifold (CSG, loaded by that worker).
 */
const LAZY_ASSETS = [
  '**/draco_*', // Draco decoders (compressed glTF import only)
  '**/serif-*', '**/sans-*', '**/mono-*', '**/display-*', // font-outline JSON chunks, loaded per text family on first use
  '**/troika-three-text*', // 3D text; its font (cs-sans-*.ttf) is runtime-cached on first use anyway
  '**/pdf-*', '**/pdf.worker.min-*', // pdf.js (PDF import)
  '**/jspdf*', '**/html2canvas-*', '**/index.es-*', '**/purify.es-*', // PDF export: jsPDF, html2canvas, canvg, DOMPurify
  '**/generateMeshBVH.worker-*', '**/parallelMeshBVH.worker-*', // three-mesh-bvh workers (path tracer, mesh BVH)
]

/**
 * Writes `.br` (quality 11) and `.gz` (level 9) siblings next to every compressible build output;
 * apps/server serves them with `precompressed: true` (nothing compresses at runtime, Traefik adds
 * nothing). Runs after vite-plugin-pwa's closeBundle so sw.js and workbox-*.js get siblings too.
 * Skipped: files under 1 KB, already-compressed formats (woff2, images) and source maps (devtools-only,
 * and they would double the compression time).
 */
function precompress(): Plugin {
  const COMPRESSIBLE = /\.(?:js|mjs|css|html|svg|json|wasm|webmanifest|txt)$/
  const MIN_BYTES = 1024
  const brotli = promisify(brotliCompress)
  const gz = promisify(gzip)
  let outDir = ''
  let log = (msg: string): void => console.log(msg)
  return {
    name: 'cadsandbox:precompress',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
      log = (msg) => config.logger.info(msg)
    },
    closeBundle: {
      sequential: true,
      order: 'post',
      async handler() {
        const started = Date.now()
        const entries = await readdir(outDir, { recursive: true, withFileTypes: true })
        const files = entries.filter((e) => e.isFile() && COMPRESSIBLE.test(e.name)).map((e) => join(e.parentPath, e.name))
        let written = 0
        // zlib's async API runs on libuv's threadpool, which bounds the parallelism.
        await Promise.all(
          files.map(async (file) => {
            const src = await readFile(file)
            if (src.length < MIN_BYTES) return
            const [br, gzipped] = await Promise.all([
              brotli(src, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11, [zlib.BROTLI_PARAM_SIZE_HINT]: src.length } }),
              gz(src, { level: 9 }),
            ])
            await Promise.all([writeFile(`${file}.br`, br), writeFile(`${file}.gz`, gzipped)])
            written++
          }),
        )
        log(`precompress: wrote .br/.gz siblings for ${written} files in ${((Date.now() - started) / 1000).toFixed(1)}s`)
      },
    },
  }
}

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
        globIgnores: ['**/*.map', ...LAZY_RUNTIMES, ...LAZY_ASSETS],
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
            // Hashed build assets are immutable: everything not precached (LAZY_RUNTIMES, LAZY_ASSETS, the
            // lazily imported route/feature chunks) works offline after first use.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/assets/'),
            handler: 'CacheFirst',
            options: { cacheName: 'cadsandbox-assets', expiration: { maxEntries: 150, purgeOnQuotaError: true }, cacheableResponse: { statuses: [200] } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
    precompress(),
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
        // Module bodies run lazily in source order even when a chunk boundary reorders them, so the
        // cross-chunk cycles that non-recursive groups create (editor ↔ EditorRoute, radix ↔ ui …)
        // cannot hit a TDZ ("Cannot access X before initialization"). Costs ~3 % of JS size.
        strictExecutionOrder: true,
        // Stable vendor/feature chunks (the successor of Rollup's manualChunks in Vite 8/Rolldown).
        codeSplitting: {
          // A group captures only the modules its `test` matches — never their dependencies. With the
          // default (true) the `editor` group swallowed everything it imported (react-router, lucide,
          // tanstack, the UI kit, the data layer …), so index.html preloaded the whole editor on the
          // sign-in page. Shared code is placed by Rolldown's automatic, entry-aware splitting instead.
          // Vite already sets the companion `preserveEntrySignatures: false` for app builds.
          includeDependenciesRecursively: false,
          groups: [
            { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 50 },
            // three/examples/jsm (loaders, exporters, Draco) is excluded so the lazily imported ones stay lazy.
            { name: 'three', test: /[\\/]node_modules[\\/](three[\\/](?!examples[\\/])|three-mesh-bvh[\\/]|three-stdlib[\\/])/, priority: 40 },
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
