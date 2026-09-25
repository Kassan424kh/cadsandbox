// Tiny typed event emitter (no dependencies, no per-emit allocations besides the listener loop).
export type Listener<T> = (payload: T) => void

export class Emitter<Events extends object> {
  private listeners = new Map<keyof Events, Set<Listener<never>>>()

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event)
    if (!set) this.listeners.set(event, (set = new Set()))
    set.add(listener as Listener<never>)
    return () => {
      set!.delete(listener as Listener<never>)
    }
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const l of set) {
      try {
        ;(l as Listener<Events[K]>)(payload)
      } catch (err) {
        console.error(`[cadsandbox/render] listener for "${String(event)}" failed`, err)
      }
    }
  }

  clear(): void {
    this.listeners.clear()
  }
}

/** Run `fn` at most once per animation frame; returns a cancel function. */
export function rafThrottle<A extends unknown[]>(fn: (...args: A) => void): ((...args: A) => void) & { cancel(): void } {
  let handle = 0
  let pending: A | null = null
  const wrapped = ((...args: A) => {
    pending = args
    if (handle) return
    handle = requestAnimationFrame(() => {
      handle = 0
      const a = pending
      pending = null
      if (a) fn(...a)
    })
  }) as ((...args: A) => void) & { cancel(): void }
  wrapped.cancel = () => {
    if (handle) cancelAnimationFrame(handle)
    handle = 0
    pending = null
  }
  return wrapped
}

/** Rate limiter: at most one call per `ms`, trailing call preserved. */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number): ((...args: A) => void) & { cancel(): void } {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: A | null = null
  const wrapped = ((...args: A) => {
    const now = performance.now()
    const wait = ms - (now - last)
    if (wait <= 0) {
      last = now
      fn(...args)
      return
    }
    pending = args
    if (!timer) {
      timer = setTimeout(() => {
        timer = null
        last = performance.now()
        const a = pending
        pending = null
        if (a) fn(...a)
      }, wait)
    }
  }) as ((...args: A) => void) & { cancel(): void }
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    pending = null
  }
  return wrapped
}
