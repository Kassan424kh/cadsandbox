// Search, sort and grid/list toggle shared by the project list pages.
import type { ReactNode } from 'react'
import { LayoutGrid, List, Search } from 'lucide-react'
import { Input, SegmentedControl, Select } from '../../ui'
import { useT } from '../../i18n'
import type { SortKey } from '../../data/projects'
import { useDashboardUI, type ViewMode } from './store'
import s from './dashboard.module.css'

export function ListToolbar({ q, onQ, sort, onSort, children }: { q: string; onQ(q: string): void; sort: SortKey; onSort(s: SortKey): void; children?: ReactNode }) {
  const t = useT()
  const view = useDashboardUI((st) => st.view)
  const setView = useDashboardUI((st) => st.setView)
  return (
    <div className={s.toolbar}>
      <Input
        wrapperClassName={s.search}
        type="search"
        value={q}
        onChange={(e) => onQ(e.target.value)}
        placeholder={t('dashboard.search', 'Search projects')}
        aria-label={t('dashboard.search', 'Search projects')}
        prefix={<Search size={15} />}
      />
      <div className={s.spacer} />
      {children}
      <Select<SortKey>
        className={s.sortSelect}
        value={sort}
        onChange={onSort}
        aria-label={t('dashboard.sort', 'Sort')}
        options={[
          { value: 'updated', label: t('dashboard.sort.updated', 'Last edited') },
          { value: 'name', label: t('dashboard.sort.name', 'Name') },
          { value: 'created', label: t('dashboard.sort.created', 'Date created') },
        ]}
      />
      <SegmentedControl<ViewMode>
        value={view}
        onChange={setView}
        aria-label={t('dashboard.view', 'View')}
        options={[
          { value: 'grid', label: t('dashboard.view.grid', 'Grid'), icon: <LayoutGrid size={15} />, iconOnly: true },
          { value: 'list', label: t('dashboard.view.list', 'List'), icon: <List size={15} />, iconOnly: true },
        ]}
      />
    </div>
  )
}
