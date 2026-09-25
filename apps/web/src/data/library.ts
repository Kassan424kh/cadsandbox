// "My Collections" — reusable objects/materials/components. Local (IndexedDB) when signed out,
// cloud (REST + user asset space) when signed in. Items carry the blobs they reference so they can
// be inserted into any project (`materialize` copies them into the target project's assets).
import type { CollectionDTO, CollectionItemDTO, CollectionItemKind } from '@cadsandbox/shared'
import type { DocSnapshot, MaterialDef } from '@cadsandbox/doc'
import type { EditorAssets } from '@cadsandbox/render'
import type { LibraryStore } from './types'
import { api } from './api/endpoints'
import { db } from './local/db'
import { getBlob, isHash, putBlob, sha256Hex } from './local/blobs'
import { randomId } from './ids'

type NewItem = Parameters<LibraryStore['addItem']>[1]

/** Blob hashes referenced by a library payload (snapshot assets or material texture maps). */
export function payloadAssets(kind: CollectionItemKind, payload: DocSnapshot | MaterialDef): string[] {
  const out = new Set<string>()
  if (kind === 'material') {
    for (const ref of Object.values((payload as MaterialDef).maps ?? {})) if (ref && 'asset' in ref) out.add(ref.asset)
  } else {
    for (const h of (payload as DocSnapshot).assets ?? []) out.add(h)
  }
  return [...out].filter(isHash)
}

const nowIso = () => new Date().toISOString()

/** MIME of an asset: project assets know it (ProjectAssets.mime); fall back to the local blob store. */
async function mimeOf(assets: EditorAssets, hash: string): Promise<string> {
  const fn = (assets as { mime?: (h: string) => Promise<string | null> }).mime
  return (fn ? await fn.call(assets, hash) : null) ?? (await getBlob(hash))?.mime ?? 'application/octet-stream'
}

export class LocalLibraryStore implements LibraryStore {
  async listCollections(): Promise<CollectionDTO[]> {
    const d = await db()
    const cols = await d.getAll('collections')
    const out: CollectionDTO[] = []
    for (const c of cols) out.push({ ...c, itemCount: await d.countFromIndex('collectionItems', 'byCollection', c.id) })
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  async createCollection(name: string): Promise<CollectionDTO> {
    const t = nowIso()
    const col: CollectionDTO = { id: randomId(12), name: name.trim().slice(0, 120) || 'Collection', orgId: null, itemCount: 0, createdAt: t, updatedAt: t }
    await (await db()).put('collections', col)
    return col
  }

  async renameCollection(id: string, name: string): Promise<void> {
    const d = await db()
    const cur = await d.get('collections', id)
    if (cur) await d.put('collections', { ...cur, name: name.trim().slice(0, 120) || cur.name, updatedAt: nowIso() })
  }

  async deleteCollection(id: string): Promise<void> {
    const d = await db()
    const tx = d.transaction(['collections', 'collectionItems'], 'readwrite')
    const items = tx.objectStore('collectionItems')
    for (const key of await items.index('byCollection').getAllKeys(id)) await items.delete(key)
    await tx.objectStore('collections').delete(id)
    await tx.done
  }

  async listItems(collectionId: string): Promise<CollectionItemDTO[]> {
    const items = await (await db()).getAllFromIndex('collectionItems', 'byCollection', collectionId)
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async addItem(collectionId: string, item: NewItem, assets: EditorAssets): Promise<CollectionItemDTO> {
    const hashes = payloadAssets(item.kind, item.payload)
    for (const hash of hashes) {
      if (await getBlob(hash)) continue
      const bytes = await assets.get(hash)
      if (bytes) await putBlob(bytes, await mimeOf(assets, hash), hash)
    }
    const rec: CollectionItemDTO = {
      id: randomId(12),
      collectionId,
      name: item.name.trim().slice(0, 120) || 'Item',
      kind: item.kind,
      tags: (item.tags ?? []).slice(0, 20),
      thumbnail: item.thumbnail,
      payload: structuredClone(item.payload),
      assets: hashes,
      createdAt: nowIso(),
    }
    const d = await db()
    await d.put('collectionItems', rec)
    const col = await d.get('collections', collectionId)
    if (col) await d.put('collections', { ...col, updatedAt: nowIso() })
    return rec
  }

  async removeItem(_collectionId: string, itemId: string): Promise<void> {
    await (await db()).delete('collectionItems', itemId)
  }

  async materialize(item: CollectionItemDTO, into: EditorAssets): Promise<void> {
    for (const hash of item.assets) {
      if (await into.get(hash)) continue
      const rec = await getBlob(hash)
      if (rec) await into.put(new Uint8Array(rec.bytes), rec.mime)
    }
  }
}

export class CloudLibraryStore implements LibraryStore {
  listCollections(): Promise<CollectionDTO[]> {
    return api.collections.list()
  }
  createCollection(name: string): Promise<CollectionDTO> {
    return api.collections.create(name)
  }
  async renameCollection(id: string, name: string): Promise<void> {
    await api.collections.update(id, name)
  }
  deleteCollection(id: string): Promise<void> {
    return api.collections.remove(id)
  }
  listItems(collectionId: string): Promise<CollectionItemDTO[]> {
    return api.collections.items(collectionId)
  }

  async addItem(collectionId: string, item: NewItem, assets: EditorAssets): Promise<CollectionItemDTO> {
    const hashes = payloadAssets(item.kind, item.payload)
    for (const hash of hashes) {
      const bytes = await assets.get(hash)
      if (!bytes) continue
      await api.assets.put(hash, bytes, await mimeOf(assets, hash))
    }
    return api.collections.addItem(collectionId, {
      name: item.name.trim().slice(0, 120) || 'Item',
      kind: item.kind,
      tags: item.tags ?? [],
      thumbnail: item.thumbnail,
      payload: item.payload,
      assets: hashes,
    })
  }

  removeItem(collectionId: string, itemId: string): Promise<void> {
    return api.collections.removeItem(collectionId, itemId)
  }

  async materialize(item: CollectionItemDTO, into: EditorAssets): Promise<void> {
    for (const hash of item.assets) {
      if (!isHash(hash) || (await into.get(hash))) continue
      const res = await api.assets.get(hash)
      const buf = await res.arrayBuffer()
      if ((await sha256Hex(buf)) !== hash) throw new Error('Library asset failed its integrity check')
      await into.put(new Uint8Array(buf), res.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream')
    }
  }
}

const local = new LocalLibraryStore()
const cloud = new CloudLibraryStore()

/** The library for the current viewer (cloud when signed in, device-local otherwise). */
export function libraryFor(signedIn: boolean): LibraryStore {
  return signedIn ? cloud : local
}
