// Consistent API errors: { error: { code, message, details? } } — never stack traces.
import type { ApiError, ApiErrorCode } from '@cadsandbox/shared'

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 500 | 503

export class HttpError extends Error {
  constructor(
    readonly status: ErrorStatus,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message)
    this.name = 'HttpError'
  }

  body(): ApiError {
    return { error: { code: this.code, message: this.message, ...(this.details !== undefined ? { details: this.details } : {}) } }
  }
}

export const badRequest = (message = 'Bad request', details?: unknown) => new HttpError(400, 'bad_request', message, details)
export const unauthorized = (message = 'Authentication required') => new HttpError(401, 'unauthorized', message)
export const forbidden = (message = 'Forbidden') => new HttpError(403, 'forbidden', message)
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message)
export const conflict = (message = 'Conflict') => new HttpError(409, 'conflict', message)
export const payloadTooLarge = (message = 'Payload too large') => new HttpError(413, 'payload_too_large', message)
export const quotaExceeded = (message = 'Storage quota exceeded') => new HttpError(403, 'quota_exceeded', message)
export const rateLimited = (retryAfterSec: number) =>
  new HttpError(429, 'rate_limited', 'Too many requests', undefined, { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSec))) })
export const internal = () => new HttpError(500, 'internal', 'Internal server error')

export function errorJson(code: ApiErrorCode, message: string): ApiError {
  return { error: { code, message } }
}
