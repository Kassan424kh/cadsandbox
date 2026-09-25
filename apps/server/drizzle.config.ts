import { defineConfig } from 'drizzle-kit'

// `pnpm db:generate` → SQL migrations in ./drizzle (applied automatically at server startup).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
})
