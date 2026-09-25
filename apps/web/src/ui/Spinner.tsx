import styles from './Misc.module.css'
import { cx } from './utils'

export function Spinner({ size = 16, className, label }: { size?: number; className?: string; label?: string }) {
  return <span role="status" aria-label={label ?? 'Loading'} className={cx(styles.spinner, className)} style={{ width: size, height: size }} />
}
