// CadSandbox logomark: an isometric cube whose top face is an open "sandbox" filled with a
// gradient of sand (the accent). Pure inline SVG — no downloads, crisp at every size.
import type { CSSProperties, SVGProps } from 'react'

export interface LogomarkProps extends SVGProps<SVGSVGElement> {
  size?: number
  /** Single-color rendering (uses currentColor) instead of the accent gradient. */
  mono?: boolean
}

// Isometric cube geometry in a 32×32 box.
const TOP = '16 3.5 27.5 10.2 16 16.9 4.5 10.2'
const LEFT = '4.5 10.2 16 16.9 16 30.3 4.5 23.6'
const RIGHT = '16 16.9 27.5 10.2 27.5 23.6 16 30.3'
// Inset rhombus on the top face (the sand).
const SAND = '16 6.6 22.2 10.2 16 13.8 9.8 10.2'

export function Logomark({ size = 28, mono, style, ...rest }: LogomarkProps) {
  const id = mono ? undefined : 'cs-sand'
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="CadSandbox" style={style} {...rest}>
      {!mono && (
        <defs>
          <linearGradient id={id} x1="9.8" y1="6.6" x2="22.2" y2="13.8" gradientUnits="userSpaceOnUse">
            <stop stopColor="#b7a4ff" />
            <stop offset="1" stopColor="#6a47ff" />
          </linearGradient>
        </defs>
      )}
      <polygon points={LEFT} fill="currentColor" fillOpacity={mono ? 0.55 : 0.72} />
      <polygon points={RIGHT} fill="currentColor" fillOpacity={mono ? 0.35 : 0.42} />
      <polygon points={TOP} fill="currentColor" fillOpacity={mono ? 0.16 : 0.14} />
      <polygon points={SAND} fill={mono ? 'currentColor' : `url(#${id})`} fillOpacity={mono ? 0.9 : 1} />
      <polygon points={TOP} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <polyline points="4.5 10.2 4.5 23.6 16 30.3 27.5 23.6 27.5 10.2" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
      <line x1="16" y1="16.9" x2="16" y2="30.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export interface LogoProps {
  size?: number
  /** Show the wordmark next to the mark. */
  wordmark?: boolean
  className?: string
  style?: CSSProperties
  mono?: boolean
}

export function Logo({ size = 24, wordmark = true, className, style, mono }: LogoProps) {
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(size * 0.38), color: 'var(--cs-text)', ...style }}>
      <Logomark size={size} mono={mono} />
      {wordmark && (
        <span
          style={{
            fontFamily: 'var(--cs-font-display)',
            fontWeight: 600,
            fontSize: Math.round(size * 0.78),
            letterSpacing: '-0.025em',
            lineHeight: 1,
            whiteSpace: 'nowrap',
          }}
        >
          Cad<span style={{ color: 'var(--cs-text-2)' }}>Sandbox</span>
        </span>
      )}
    </span>
  )
}
