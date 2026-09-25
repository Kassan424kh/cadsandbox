// Line-art previews for the template gallery (inline SVG, theme-aware via currentColor).
import type { TemplateId } from '../templates'

const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

export function TemplateArt({ id }: { id: TemplateId }) {
  switch (id) {
    case 'floorplan':
      return (
        <svg viewBox="0 0 160 90" aria-hidden="true" {...common}>
          <rect x="22" y="12" width="116" height="66" rx="2" strokeWidth="3" />
          <path d="M92 12v30M92 54v24" strokeWidth="2" />
          <path d="M40 78v-2M56 78v-2" opacity=".6" />
          <path d="M40 78a16 16 0 0 1 16-16" strokeDasharray="3 3" opacity=".7" />
          <path d="M92 42a12 12 0 0 1 12 12" strokeDasharray="3 3" opacity=".7" />
          <rect x="30" y="22" width="10" height="26" rx="2" opacity=".8" />
          <rect x="48" y="28" width="16" height="10" rx="1.5" opacity=".8" />
          <rect x="106" y="22" width="24" height="28" rx="2" opacity=".8" />
          <path d="M106 30h24" opacity=".6" />
          <path d="M60 12h14M116 78h14" strokeWidth="4" opacity=".45" />
          <text x="60" y="66" fontSize="7" fill="currentColor" stroke="none" opacity=".7">0.01</text>
          <text x="112" y="66" fontSize="7" fill="currentColor" stroke="none" opacity=".7">0.02</text>
        </svg>
      )
    case 'product':
      return (
        <svg viewBox="0 0 160 90" aria-hidden="true" {...common}>
          <ellipse cx="80" cy="74" rx="40" ry="8" opacity=".5" />
          <path d="M62 72V34M98 72V34" />
          <ellipse cx="80" cy="34" rx="18" ry="5" />
          <path d="M62 72a18 5 0 0 0 36 0" />
          <ellipse cx="80" cy="52" rx="21" ry="6" strokeDasharray="2 3" opacity=".8" />
          <circle cx="80" cy="22" r="8" />
          <path d="M126 58l4 8 9 1-7 6 2 9-8-5-8 5 2-9-7-6 9-1z" opacity=".85" />
          <path d="M28 70l10-24 10 24z" opacity=".75" />
        </svg>
      )
    case 'drawing':
      return (
        <svg viewBox="0 0 160 90" aria-hidden="true" {...common}>
          <rect x="34" y="16" width="92" height="54" rx="6" strokeWidth="2.2" />
          <circle cx="80" cy="43" r="14" />
          <circle cx="46" cy="28" r="3" />
          <circle cx="114" cy="28" r="3" />
          <circle cx="46" cy="58" r="3" />
          <circle cx="114" cy="58" r="3" />
          <path d="M24 43h112M80 8v70" strokeDasharray="8 3 2 3" opacity=".55" />
          <path d="M34 80h92M34 76v8M126 76v8" opacity=".75" />
          <text x="72" y="88" fontSize="6.5" fill="currentColor" stroke="none" opacity=".75">200</text>
          <path d="M90 33l16-14h14" opacity=".75" />
        </svg>
      )
    default:
      return (
        <svg viewBox="0 0 160 90" aria-hidden="true" {...common}>
          <path d="M20 66l60-20 60 20-60 20z" opacity=".45" />
          <path d="M50 56l30-10 30 10M35 61l45-15 45 15" opacity=".3" />
          <path d="M80 46V14" strokeDasharray="3 3" opacity=".6" />
          <path d="M80 34l14 8M80 34l-14 8M80 34V18" strokeWidth="2" />
          <circle cx="80" cy="34" r="2.4" fill="currentColor" />
        </svg>
      )
  }
}
