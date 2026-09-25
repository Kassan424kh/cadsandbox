// Operator CLI (needs shell access to the server — the safest way to create the first admin).
//   node dist/cli.js grant-admin <email>     promote an existing account to admin
//   node dist/cli.js verify-email <email>    mark an account's e-mail as verified
//   node dist/cli.js generate-key            print a random 32-byte key (STORAGE_ENCRYPTION_KEY)
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { createRuntime } from './bootstrap'
import { user } from './db/schema'
import { loadConfig } from './env'
import { audit } from './services/audit'

async function main() {
  const [cmd, arg] = process.argv.slice(2)
  if (cmd === 'generate-key') {
    console.log(randomBytes(32).toString('base64'))
    return
  }
  if ((cmd !== 'grant-admin' && cmd !== 'verify-email') || !arg) {
    console.error('usage: cli.js grant-admin <email> | verify-email <email> | generate-key')
    process.exit(2)
  }
  const config = { ...loadConfig(), jobsEnabled: false }
  const runtime = await createRuntime(config)
  const { db, log } = runtime.deps
  try {
    const [u] = await db.select().from(user).where(eq(user.email, arg.toLowerCase())).limit(1)
    if (!u) throw new Error('No account with that e-mail — sign up first.')
    if (cmd === 'grant-admin') {
      await db.update(user).set({ role: 'admin', updatedAt: new Date() }).where(eq(user.id, u.id))
      await audit(db, { action: 'admin.bootstrap.cli', targetType: 'user', targetId: u.id }, log)
      console.log(`${u.email} is now an admin.`)
    } else {
      await db.update(user).set({ emailVerified: true, updatedAt: new Date() }).where(eq(user.id, u.id))
      await audit(db, { action: 'admin.user.verify_email.cli', targetType: 'user', targetId: u.id }, log)
      console.log(`${u.email} is now verified.`)
    }
  } finally {
    await runtime.close()
  }
}

main().catch((err: unknown) => {
  console.error((err as Error).message)
  process.exit(1)
})
