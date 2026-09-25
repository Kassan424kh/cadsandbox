// A real link (<a>/<Link>) that looks like a UI-kit Button — navigation stays navigation
// (middle-click, "open in new tab", correct semantics for screen readers).
import type { MouseEventHandler, ReactNode } from 'react'
import { Link } from 'react-router'
import { cx } from '../../ui'
import s from './LinkButton.module.css'

export interface LinkButtonProps {
  /** In-app route. */
  to?: string
  /** Plain URL (downloads, API endpoints). */
  href?: string
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  icon?: ReactNode
  iconRight?: ReactNode
  download?: boolean | string
  target?: string
  className?: string
  onClick?: MouseEventHandler<HTMLAnchorElement>
  children: ReactNode
}

export function LinkButton({ to, href, variant = 'secondary', size = 'md', icon, iconRight, download, target, className, onClick, children }: LinkButtonProps) {
  const cls = cx(s.button, s[variant], size !== 'md' && s[size], className)
  const content = (
    <>
      {icon}
      <span>{children}</span>
      {iconRight}
    </>
  )
  if (to !== undefined)
    return (
      <Link to={to} className={cls} target={target} onClick={onClick} rel={target === '_blank' ? 'noopener noreferrer' : undefined}>
        {content}
      </Link>
    )
  return (
    <a href={href} className={cls} download={download} target={target} onClick={onClick} rel={target === '_blank' ? 'noopener noreferrer' : undefined}>
      {content}
    </a>
  )
}
