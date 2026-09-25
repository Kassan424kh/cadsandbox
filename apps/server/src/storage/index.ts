import { join } from 'node:path'
import type { Config } from '../env'
import type { KeyRing } from '../lib/crypto'
import { BlobStore } from './blob-store'
import { LocalDiskStore } from './local'
import { S3Store } from './s3'

export { BlobStore, blobKey, isSha256Hex } from './blob-store'
export { sniffMime, safeContentType, isInlineSafe } from './sniff'

export function createBlobStore(config: Config, ring: KeyRing): BlobStore {
  const tmp = join(config.dataDir, 'tmp')
  if (config.storage.driver === 's3') {
    const s3 = config.storage.s3
    return new BlobStore(
      new S3Store({
        endpoint: s3.endpoint!,
        region: s3.region,
        bucket: s3.bucket!,
        accessKeyId: s3.accessKeyId!,
        secretAccessKey: s3.secretAccessKey!,
        forcePathStyle: s3.forcePathStyle,
        prefix: s3.prefix,
      }),
      ring,
      tmp,
    )
  }
  return new BlobStore(new LocalDiskStore(join(config.dataDir, 'blobs')), ring, tmp)
}
