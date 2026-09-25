// Access-change notifications. Emitted after ACL mutations; the collab server listens and re-checks
// (or kicks) live connections so revoked users lose access immediately.
import { EventEmitter } from 'node:events'

interface AccessEventMap {
  project: [projectId: string]
  org: [orgId: string]
  user: [userId: string]
  session: [sessionId: string]
}

export class AccessEvents {
  private readonly emitter = new EventEmitter()

  constructor() {
    this.emitter.setMaxListeners(50)
  }

  projectChanged(projectId: string): void {
    this.emitter.emit('project', projectId)
  }
  orgChanged(orgId: string): void {
    this.emitter.emit('org', orgId)
  }
  userChanged(userId: string): void {
    this.emitter.emit('user', userId)
  }
  sessionRevoked(sessionId: string): void {
    this.emitter.emit('session', sessionId)
  }

  on<K extends keyof AccessEventMap>(event: K, listener: (...args: AccessEventMap[K]) => void): () => void {
    this.emitter.on(event, listener as (...args: unknown[]) => void)
    return () => this.emitter.off(event, listener as (...args: unknown[]) => void)
  }
}
