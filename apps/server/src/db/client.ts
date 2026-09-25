// Database: Postgres (DATABASE_URL) in production, PGlite (embedded Postgres) as zero-config fallback.
// Same pg dialect + migrations for both.
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from './schema'

export type Schema = typeof schema
export type Db = PgDatabase<PgQueryResultHKT, Schema>
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type DbOrTx = Db | Tx

export interface Database {
  db: Db
  driver: 'pg' | 'pglite'
  close(): Promise<void>
}

export interface OpenOptions {
  databaseUrl?: string
  poolMax?: number
  ssl?: boolean
  /** PGlite data directory; 'memory://' for tests. */
  pgliteDir: string
  migrationsDir: string
}

export async function openDatabase(opts: OpenOptions): Promise<Database> {
  if (!existsSync(join(opts.migrationsDir, 'meta', '_journal.json'))) {
    throw new Error(`migrations not found in ${opts.migrationsDir} (run pnpm --filter @cadsandbox/server db:generate)`)
  }
  if (opts.databaseUrl) {
    const { Pool } = await import('pg')
    const { drizzle } = await import('drizzle-orm/node-postgres')
    const { migrate } = await import('drizzle-orm/node-postgres/migrator')
    const pool = new Pool({
      connectionString: opts.databaseUrl,
      max: opts.poolMax ?? 10,
      ssl: opts.ssl ? { rejectUnauthorized: true } : undefined,
      idleTimeoutMillis: 30_000,
      statement_timeout: 60_000,
    })
    const db = drizzle(pool, { schema })
    await migrate(db, { migrationsFolder: opts.migrationsDir })
    return { db: db as unknown as Db, driver: 'pg', close: () => pool.end() }
  }
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle } = await import('drizzle-orm/pglite')
  const { migrate } = await import('drizzle-orm/pglite/migrator')
  if (!opts.pgliteDir.startsWith('memory://')) mkdirSync(opts.pgliteDir, { recursive: true })
  const client = new PGlite(opts.pgliteDir)
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: opts.migrationsDir })
  return { db: db as unknown as Db, driver: 'pglite', close: () => client.close() }
}

/** Rows of a raw `db.execute()` result (pg and PGlite both expose `.rows`). */
export function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[]
}
