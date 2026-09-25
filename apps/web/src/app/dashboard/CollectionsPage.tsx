// /collections[/:collectionId] — the user's reusable library (objects, materials, components).
import { useState } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Box, FolderPlus, Layers, MoreHorizontal, Palette, Pencil, Puzzle, Trash2 } from 'lucide-react'
import type { CollectionItemDTO } from '@cadsandbox/shared'
import { Badge, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, EmptyState, IconButton, PageHeader, Skeleton, toast } from '../../ui'
import { useT } from '../../i18n'
import { useAuth } from '../../data/auth/AuthProvider'
import { libraryFor } from '../../data/library'
import { useDocumentTitle } from '../hooks'
import { ConfirmDialog, PromptDialog, errorMessage } from '../components/Dialogs'
import l from '../layout/layout.module.css'
import s from './dashboard.module.css'

const KIND_ICON = { object: Box, material: Palette, component: Puzzle } as const

function ItemCard({ item, onRemove }: { item: CollectionItemDTO; onRemove(): void }) {
  const t = useT()
  const Icon = KIND_ICON[item.kind]
  return (
    <div className={s.item}>
      <div className={s.itemThumb}>{item.thumbnail?.startsWith('data:image/') ? <img src={item.thumbnail} alt="" /> : <Icon size={28} strokeWidth={1.4} />}</div>
      <div className={s.itemBody}>
        <span title={item.name}>{item.name}</span>
        <Badge tone="outline">{t(`library.kind.${item.kind}`, item.kind === 'object' ? 'Object' : item.kind === 'material' ? 'Material' : 'Component')}</Badge>
        <IconButton size="sm" variant="ghost" label={t('library.removeItem', 'Remove from collection')} icon={<Trash2 size={13} />} onClick={onRemove} />
      </div>
    </div>
  )
}

export default function CollectionsPage() {
  const t = useT()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const auth = useAuth()
  const signedIn = auth.status === 'signed-in'
  const store = libraryFor(signedIn)
  const { collectionId } = useParams()
  const keyBase = ['library', signedIn ? 'cloud' : 'local'] as const
  const collections = useQuery({ queryKey: [...keyBase, 'collections'], queryFn: () => store.listCollections() })
  const selected = collectionId ?? collections.data?.[0]?.id ?? null
  const items = useQuery({ queryKey: [...keyBase, 'items', selected], queryFn: () => store.listItems(selected!), enabled: !!selected })
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null)
  useDocumentTitle(t('nav.collections', 'Collections'))

  const refresh = () => qc.invalidateQueries({ queryKey: keyBase })
  const removeItem = useMutation({
    mutationFn: (itemId: string) => store.removeItem(selected!, itemId),
    onSettled: refresh,
    onError: (err) => toast.error(errorMessage(err)),
  })
  const current = collections.data?.find((c) => c.id === selected)

  return (
    <div className={s.page}>
      <PageHeader
        title={t('nav.collections', 'Collections')}
        description={
          signedIn
            ? t('library.descCloud', 'Reusable objects, materials and components — available in every project and synced to your account.')
            : t('library.descLocal', 'Reusable objects, materials and components stored on this device. Sign in to sync them.')
        }
        actions={
          <Button variant="primary" icon={<FolderPlus size={16} />} onClick={() => setCreating(true)}>
            {t('library.newCollection', 'New collection')}
          </Button>
        }
      />
      {collections.isLoading ? (
        <Skeleton height={200} />
      ) : !collections.data?.length ? (
        <EmptyState
          icon={<Layers size={22} />}
          title={t('library.emptyTitle', 'No collections yet')}
          description={t('library.emptyDesc', 'In the editor, select objects and choose “Save to collection” to reuse them anywhere.')}
          actions={
            <Button variant="primary" onClick={() => setCreating(true)}>
              {t('library.newCollection', 'New collection')}
            </Button>
          }
        />
      ) : (
        <div className={s.collections}>
          <nav style={{ display: 'grid', gap: 2 }} aria-label={t('nav.collections', 'Collections')}>
            {collections.data.map((c) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <NavLink to={`/collections/${c.id}`} className={l.navLink} style={{ flex: 1 }} aria-current={c.id === selected ? 'page' : undefined}>
                  <Layers size={16} />
                  <span>{c.name}</span>
                  <Badge tone="neutral">{c.itemCount}</Badge>
                </NavLink>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton size="sm" variant="ghost" label={t('library.collectionActions', 'Collection actions')} icon={<MoreHorizontal size={15} />} tooltip={false} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem icon={<Pencil size={15} />} onSelect={() => setRenaming({ id: c.id, name: c.name })}>
                      {t('common.rename', 'Rename')}
                    </DropdownMenuItem>
                    <DropdownMenuItem danger icon={<Trash2 size={15} />} onSelect={() => setDeleting({ id: c.id, name: c.name })}>
                      {t('common.delete', 'Delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </nav>
          <section aria-label={current?.name}>
            {items.isLoading ? (
              <Skeleton height={160} />
            ) : !items.data?.length ? (
              <EmptyState compact icon={<Box size={20} />} title={t('library.emptyCollection', 'This collection is empty')} description={t('library.emptyCollectionDesc', 'Save objects or materials from the editor to fill it.')} />
            ) : (
              <div className={s.itemGrid}>
                {items.data.map((item) => (
                  <ItemCard key={item.id} item={item} onRemove={() => removeItem.mutate(item.id)} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
      <PromptDialog
        open={creating}
        onOpenChange={setCreating}
        title={t('library.newCollection', 'New collection')}
        label={t('library.collectionName', 'Collection name')}
        confirmLabel={t('common.create', 'Create')}
        onSubmit={async (name) => {
          const col = await store.createCollection(name)
          await refresh()
          navigate(`/collections/${col.id}`)
        }}
      />
      <PromptDialog
        open={!!renaming}
        onOpenChange={(o) => !o && setRenaming(null)}
        title={t('library.renameCollection', 'Rename collection')}
        label={t('library.collectionName', 'Collection name')}
        initialValue={renaming?.name ?? ''}
        confirmLabel={t('common.rename', 'Rename')}
        onSubmit={async (name) => {
          if (renaming) await store.renameCollection(renaming.id, name)
          await refresh()
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        danger
        title={t('library.deleteTitle', 'Delete collection “{name}”?', { name: deleting?.name ?? '' })}
        description={t('library.deleteDesc', 'The collection and its items are removed. Projects that already use these items are not affected.')}
        confirmLabel={t('common.delete', 'Delete')}
        onConfirm={async () => {
          if (!deleting) return
          await store.deleteCollection(deleting.id)
          await refresh()
          navigate('/collections')
        }}
      />
    </div>
  )
}
