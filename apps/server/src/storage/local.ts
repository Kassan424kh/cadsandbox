// Local disk object store: <root>/ab/cd/<hash>[.enc]. Writes are atomic (fsync + rename on the same
// filesystem), so readers never observe partial files.
import { createReadStream } from 'node:fs'
import { access, copyFile, mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import type { Readable } from 'node:stream'
import type { ObjectStore } from './blob-store'

export class LocalDiskStore implements ObjectStore {
  readonly kind = 'local' as const
  private readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  private path(key: string): string {
    if (!/^[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{64}(\.enc)?$/.test(key)) throw new Error('invalid blob key')
    const p = resolve(join(this.root, key))
    if (!p.startsWith(this.root + sep)) throw new Error('invalid blob key')
    return p
  }

  async putFile(key: string, src: string): Promise<void> {
    const dest = this.path(key)
    await mkdir(dirname(dest), { recursive: true })
    const fh = await open(src, 'r')
    try {
      await fh.sync()
    } finally {
      await fh.close()
    }
    try {
      await rename(src, dest)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
      // Temp dir on another filesystem: copy next to the target, then rename atomically.
      const staging = `${dest}.${process.pid}.tmp`
      await copyFile(src, staging)
      await rename(staging, dest)
    }
  }

  async get(key: string): Promise<Readable | null> {
    const p = this.path(key)
    try {
      await access(p)
    } catch {
      return null
    }
    return createReadStream(p)
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.path(key))
      return true
    } catch {
      return false
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true })
  }
}
