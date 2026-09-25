// Save the selection (snapshot + thumbnail) into one of the user's collections.
import { useEffect, useState } from 'react'
import type { CollectionDTO } from '@cadsandbox/shared'
import { useT } from '../../i18n'
import { Button, Dialog, DialogContent, FieldRow, Input, Select, toast } from '../../ui'
import { useEditorCtx } from '../EditorContext'
import { useUiStore } from '../ui-store'

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

export function SaveToCollectionDialog() {
  const t = useT()
  const { library, doc, editor, session } = useEditorCtx()
  const open = useUiStore((s) => s.dialog === 'saveToCollection')
  const ids = useUiStore((s) => s.saveToCollectionIds)
  const close = useUiStore((s) => s.closeDialog)
  const [collections, setCollections] = useState<CollectionDTO[]>([])
  const [collectionId, setCollectionId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [name, setName] = useState('')
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || !library) return
    void library.listCollections().then((list) => {
      setCollections(list)
      setCollectionId((c) => c ?? list[0]?.id ?? null)
    })
    const first = ids[0] ? doc.getNode(ids[0]) : undefined
    setName(ids.length === 1 && first ? first.name : t('collections.itemName', '{count} objects', { count: ids.length }))
  }, [open, library, ids, doc, t])

  if (!library) return null

  const save = async () => {
    setBusy(true)
    try {
      let cid = collectionId
      if (!cid || newName.trim()) {
        const c = await library.createCollection(newName.trim() || t('collections.defaultName', 'My collection'))
        cid = c.id
      }
      const snapshot = doc.snapshot(ids)
      let thumbnail: string | null = null
      try {
        const blob = await editor.screenshot({ width: 256, height: 160, mime: 'image/webp' })
        if (blob.size <= 64 * 1024) thumbnail = await blobToDataUrl(blob)
      } catch {
        /* optional */
      }
      const isComponent = ids.length === 1 && doc.getNode(ids[0])?.type === 'instance'
      await library.addItem(cid, { name: name.trim() || 'Item', kind: isComponent ? 'component' : 'object', payload: snapshot, thumbnail, tags: tags.split(',').map((x) => x.trim()).filter(Boolean) }, session.assets)
      toast.success(t('collections.saved', 'Saved to collection'))
      close()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        title={t('collections.saveTitle', 'Save to collection')}
        description={t('collections.saveDesc', 'Reuse this selection in any project. Referenced textures travel with it.')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void save()} disabled={ids.length === 0}>
              {t('common.save', 'Save')}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <FieldRow label={t('collections.item', 'Name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} aria-label={t('collections.item', 'Name')} />
          </FieldRow>
          <FieldRow label={t('collections.tags', 'Tags')} hint={t('collections.tagsHint', 'Comma separated')}>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="kitchen, oak" aria-label={t('collections.tags', 'Tags')} />
          </FieldRow>
          <FieldRow label={t('collections.collection', 'Collection')}>
            <Select value={collectionId} onChange={setCollectionId} options={collections.map((c) => ({ value: c.id, label: c.name }))} placeholder={t('collections.none', 'No collections yet')} aria-label={t('collections.collection', 'Collection')} />
          </FieldRow>
          <FieldRow label={t('collections.orNew', 'Or new')}>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('collections.newPlaceholder', 'New collection name')} aria-label={t('collections.orNew', 'Or new')} />
          </FieldRow>
        </div>
      </DialogContent>
    </Dialog>
  )
}
