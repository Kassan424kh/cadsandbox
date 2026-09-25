// Route registration straight from the shared contract table (`routes` in @cadsandbox/shared), so
// paths/methods cannot drift from what the web app calls.
import type { Handler, Hono, MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { routes, type RouteKey } from '@cadsandbox/shared'
import { errorJson } from '../lib/errors'
import type { AppEnv } from './context'

export type AppHandler = Handler<AppEnv>

export function register(app: Hono<AppEnv>, key: RouteKey, ...handlers: (AppHandler | MiddlewareHandler<AppEnv>)[]): void {
  const [method, path] = routes[key].split(' ') as [string, string]
  if (method === 'WS' || method === 'ALL') throw new Error(`route ${key} is not a plain HTTP route`)
  app.on(method, path, ...(handlers as [AppHandler]))
}

/** Reject bodies larger than `maxBytes` (declared or streamed). */
export const jsonLimit = (maxBytes: number): MiddlewareHandler<AppEnv> =>
  bodyLimit({ maxSize: maxBytes, onError: (c) => c.json(errorJson('payload_too_large', 'Payload too large'), 413) })

export const KB = 1024
export const MB = 1024 * 1024
