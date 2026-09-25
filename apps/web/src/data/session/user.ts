// Presence identity (EditorUser) for the current viewer: the account when signed in, otherwise a
// per-device guest id (not a credential — it only keeps cursor colours stable between reloads).
import type { EditorUser } from '@cadsandbox/render'
import { randomId } from '../ids'

const PALETTE = ['#7c5cff', '#ff5c8a', '#2fd67b', '#ffb020', '#3fb6ff', '#ff7a45', '#b45cff', '#14c8b4', '#f25cff', '#8bd22f', '#ff4d5e', '#5c8aff']

export function userColor(id: string): string {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0
  return PALETTE[h % PALETTE.length]!
}

const GUEST_KEY = 'cadsandbox.guestId'

export function guestId(): string {
  try {
    let id = localStorage.getItem(GUEST_KEY)
    if (!id) {
      id = `guest-${randomId(10)}`
      localStorage.setItem(GUEST_KEY, id)
    }
    return id
  } catch {
    return `guest-${randomId(10)}`
  }
}

export function editorUser(user: { id: string; name: string } | null | undefined, guestName = 'Guest'): EditorUser {
  if (user) return { id: user.id, name: user.name || guestName, color: userColor(user.id) }
  const id = guestId()
  return { id, name: guestName, color: userColor(id) }
}
