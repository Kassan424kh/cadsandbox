// Simple pagination control for admin tables.
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton } from '../../ui'
import { useT } from '../../i18n'
import p from '../pages/pages.module.css'

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage(page: number): void }) {
  const t = useT()
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className={p.pager}>
      <span>{t('admin.pageOf', 'Page {page} of {pages} · {total} total', { page, pages, total })}</span>
      <IconButton size="sm" variant="ghost" label={t('admin.prev', 'Previous page')} icon={<ChevronLeft size={15} />} disabled={page <= 1} onClick={() => onPage(page - 1)} />
      <IconButton size="sm" variant="ghost" label={t('admin.next', 'Next page')} icon={<ChevronRight size={15} />} disabled={page >= pages} onClick={() => onPage(page + 1)} />
    </div>
  )
}
