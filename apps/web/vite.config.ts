import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Cross-origin isolation enables SharedArrayBuffer + multithreaded WASM. Everything (fonts, wasm,
// workers, blobs via /api) is served same-origin, so require-corp costs nothing — and it also
// guarantees no third-party requests leak user data (GDPR).
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
}

const API = process.env.CADSANDBOX_API ?? 'http://localhost:8787'

export default defineConfig({
  plugins: [react()],
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
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 4000 },
})
