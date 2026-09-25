// Tools-module test config (the package config only includes test/**).
// Run: cd packages/render && ../../node_modules/.bin/vitest run -c src/tools/vitest.config.ts
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    root: fileURLToPath(new URL('../..', import.meta.url)),
    include: ['src/tools/**/*.test.ts'],
  },
})
