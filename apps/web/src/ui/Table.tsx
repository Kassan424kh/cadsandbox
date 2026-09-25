import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import styles from './Layout.module.css'
import { cx } from './utils'

export interface TableColumn<Row> {
  key: string
  label: ReactNode
  align?: 'left' | 'right' | 'center'
  width?: number | string
  sortable?: boolean
  /** Value used for sorting (default: row[key]) */
  sortValue?(row: Row): string | number | null | undefined
  render?(row: Row): ReactNode
  /** Footer cell (totals) */
  footer?: ReactNode
}

export interface TableProps<Row> {
  columns: TableColumn<Row>[]
  rows: Row[]
  rowKey(row: Row): string
  selectedKey?: string | null
  onRowClick?(row: Row): void
  onRowDoubleClick?(row: Row): void
  dense?: boolean
  emptyLabel?: string
  defaultSort?: { key: string; dir: 'asc' | 'desc' }
  className?: string
  'aria-label'?: string
  /** Show the footer row (from column.footer) */
  footer?: boolean
}

export function Table<Row>({ columns, rows, rowKey, selectedKey, onRowClick, onRowDoubleClick, dense, emptyLabel = 'No data', defaultSort, className, footer, ...rest }: TableProps<Row>) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(defaultSort ?? null)
  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return rows
    const val = (r: Row) => (col.sortValue ? col.sortValue(r) : (r as Record<string, unknown>)[col.key]) as string | number | null | undefined
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' }) * dir
    })
  }, [rows, sort, columns])

  const toggleSort = (key: string) => {
    setSort((s) => (s?.key === key ? (s.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' }))
  }
  const alignClass = (a?: 'left' | 'right' | 'center') => (a === 'right' ? styles.alignRight : a === 'center' ? styles.alignCenter : undefined)

  return (
    <div className={cx(styles.tableWrap, className)}>
      <table className={cx(styles.table, dense && styles.tableDense)} aria-label={rest['aria-label']}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={alignClass(c.align)} style={{ width: c.width }} aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                {c.sortable ? (
                  <button type="button" className={cx(styles.sortBtn, sort?.key === c.key && styles.sortActive)} onClick={() => toggleSort(c.key)}>
                    {c.label}
                    {sort?.key === c.key ? sort.dir === 'asc' ? <ArrowUp /> : <ArrowDown /> : <ArrowUpDown />}
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className={styles.tableEmpty}>
                {emptyLabel}
              </td>
            </tr>
          ) : (
            sorted.map((r) => {
              const k = rowKey(r)
              return (
                <tr
                  key={k}
                  className={cx(k === selectedKey && styles.tableRowSelected, (onRowClick || onRowDoubleClick) && styles.tableRowClickable)}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  onDoubleClick={onRowDoubleClick ? () => onRowDoubleClick(r) : undefined}
                  aria-selected={k === selectedKey || undefined}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={alignClass(c.align)}>
                      {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? '')}
                    </td>
                  ))}
                </tr>
              )
            })
          )}
        </tbody>
        {footer && sorted.length > 0 && (
          <tfoot>
            <tr className={styles.tableFoot}>
              {columns.map((c) => (
                <td key={c.key} className={alignClass(c.align)}>
                  {c.footer}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
