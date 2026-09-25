// Process lifecycle shared between the shutdown handler and the health endpoint.
// While `draining`, /api/health answers 503 so the proxy (Traefik's active health check) takes this
// instance out of rotation BEFORE it stops accepting connections — no request is ever routed to a
// container that is already gone.
export const lifecycle = { draining: false }
