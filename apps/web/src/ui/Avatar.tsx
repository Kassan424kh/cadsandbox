import type { CSSProperties, HTMLAttributes } from 'react'
import styles from './Layout.module.css'
import { Tooltip } from './Tooltip'
import { colorFromString, cx, initials } from './utils'

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  name: string
  color?: string
  src?: string | null
  size?: number
  /** Presence ring (following / active) */
  ring?: boolean
  /** Dim (idle / offline) */
  muted?: boolean
}

export function Avatar({ name, color, src, size = 28, ring, muted, className, style, ...rest }: AvatarProps) {
  const bg = color ?? colorFromString(name)
  const s: CSSProperties = { width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.38)), ['--avatar-color' as string]: bg, ...style }
  return (
    <span className={cx(styles.avatar, ring && styles.avatarRing, muted && styles.avatarMuted, className)} style={s} title={name} aria-label={name} role="img" {...rest}>
      {src ? <img src={src} alt="" /> : initials(name)}
    </span>
  )
}

export interface AvatarStackUser {
  id: string | number
  name: string
  color?: string
  src?: string | null
  /** Extra tooltip line, e.g. the file they are viewing */
  hint?: string
  active?: boolean
}

export interface AvatarStackProps {
  users: AvatarStackUser[]
  max?: number
  size?: number
  onClick?(user: AvatarStackUser): void
  /** id of a highlighted user (e.g. currently followed) */
  highlight?: string | number | null
  className?: string
  moreLabel?(count: number): string
}

export function AvatarStack({ users, max = 4, size = 28, onClick, highlight, className, moreLabel = (n) => `+${n}` }: AvatarStackProps) {
  const shown = users.slice(0, max)
  const rest = users.length - shown.length
  return (
    <div className={cx(styles.avatarStack, className)} style={{ ['--avatar-size' as string]: `${size}px` }}>
      {shown.map((u) => {
        const av = <Avatar name={u.name} color={u.color} src={u.src} size={size} ring={highlight === u.id} />
        return (
          <Tooltip
            key={u.id}
            content={
              <span>
                {u.name}
                {u.hint ? <span style={{ opacity: 0.7 }}> · {u.hint}</span> : null}
              </span>
            }
          >
            {onClick ? (
              <button type="button" className={styles.avatarBtn} onClick={() => onClick(u)} aria-label={u.name} aria-pressed={highlight === u.id}>
                {av}
              </button>
            ) : (
              <span className={styles.avatarBtn}>{av}</span>
            )}
          </Tooltip>
        )
      })}
      {rest > 0 && (
        <Tooltip content={users.slice(max).map((u) => u.name).join(', ')}>
          <span className={cx(styles.avatarBtn, styles.avatarMore)} style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.36)) }}>
            {moreLabel(rest)}
          </span>
        </Tooltip>
      )}
    </div>
  )
}
