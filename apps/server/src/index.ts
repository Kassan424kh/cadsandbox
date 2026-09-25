// CadSandbox server entry: HTTP API + better-auth + Hocuspocus (/collab) + static web app + jobs.
import { serve } from '@hono/node-server'
import type { Server } from 'node:http'
import { createRuntime } from './bootstrap'
import { loadConfig } from './env'
import { createApp } from './http/app'
import { startScheduler } from './jobs/scheduler'
import { lifecycle } from './lifecycle'

process.env.BETTER_AUTH_TELEMETRY = '0'

async function main() {
  const config = loadConfig()
  const runtime = await createRuntime(config)
  const { deps } = runtime
  const app = createApp(deps)

  const server = serve({
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
    serverOptions: {
      // Large uploads on slow links need time; headers must still arrive quickly (slowloris).
      requestTimeout: 15 * 60_000,
      headersTimeout: 30_000,
      keepAliveTimeout: 65_000,
      maxHeaderSize: 32 * 1024,
    },
  }) as Server
  server.on('upgrade', (req, socket, head) => deps.collab.handleUpgrade(req, socket, head))

  const scheduler = startScheduler(deps, { autoStart: config.jobsEnabled })
  deps.log.info(
    {
      port: config.port,
      env: config.env,
      db: deps.dbDriver,
      storage: config.storage.driver,
      encryption: !!config.storage.encryptionKey,
      web: config.webDistDir ? 'served' : 'not bundled',
      version: config.version,
    },
    `CadSandbox server listening on http://${config.host}:${config.port}`,
  )

  let stopping = false
  const shutdown = async (signal: string) => {
    if (stopping) return
    stopping = true
    deps.log.info({ signal }, 'shutting down')
    const force = setTimeout(() => process.exit(1), 18_000)
    force.unref()
    // Zero-downtime replacement, step 1: report unhealthy but keep serving, so Traefik's active health
    // check (1 s interval) takes this instance out of rotation while it is still reachable.
    lifecycle.draining = true
    await new Promise((r) => setTimeout(r, Number(process.env.SHUTDOWN_DRAIN_MS ?? 4000)))
    // Step 2: stop accepting connections and drop idle keep-alive sockets; in-flight requests get a
    // short grace period while the database is still open.
    server.close()
    server.closeIdleConnections()
    await new Promise((r) => setTimeout(r, 1500))
    server.closeAllConnections()
    await scheduler.stop()
    await runtime.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('unhandledRejection', (err) => deps.log.error({ err: (err as Error)?.message }, 'unhandled rejection'))
}

main().catch((err: unknown) => {
  console.error(`Fatal: ${(err as Error).message}`)
  process.exit(1)
})
