import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: { NODE_ENV: 'test', BETTER_AUTH_TELEMETRY: '0' },
  },
})
