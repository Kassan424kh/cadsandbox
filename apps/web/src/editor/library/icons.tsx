// Custom crisp 24×24 outline icons (lucide style) for CAD/BIM concepts lucide has no glyph for.
import { forwardRef, type ReactNode, type SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

const mk = (name: string, children: ReactNode) => {
  const C = forwardRef<SVGSVGElement, IconProps>(function Icon({ size = 24, ...props }, ref) {
    return (
      <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
        {children}
      </svg>
    )
  })
  C.displayName = name
  return C
}

// ---- architecture
export const IconWall = mk('IconWall', <><rect x="3" y="5" width="18" height="14" rx="1" /><path d="M3 10h18M3 14.5h18M8 5v5M14 5v5M11 10v4.5M17 10v4.5M8 14.5V19M14 14.5V19" /></>)
export const IconDoor = mk('IconDoor', <><path d="M3 21h18" /><path d="M6 21V4h9v17" /><path d="M15 4a9 9 0 0 1 4 8" /></>)
export const IconWindow = mk('IconWindow', <><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M12 4v16M3 12h18" /></>)
export const IconOpening = mk('IconOpening', <><path d="M3 20V6h18v14" /><path d="M8 20V10h8v10" strokeDasharray="2.5 2.5" /></>)
export const IconSlab = mk('IconSlab', <><path d="M3 12l9-4 9 4-9 4z" /><path d="M3 12v3l9 4 9-4v-3" /></>)
export const IconRoof = mk('IconRoof', <><path d="M3 13L12 5l9 8" /><path d="M6 11v9h12v-9" /></>)
export const IconStair = mk('IconStair', <><path d="M3 21h4v-4h4v-4h4V9h4V5h3" /><path d="M3 21V16" /></>)
export const IconColumn = mk('IconColumn', <><path d="M7 4h10M7 20h10M9.5 4v16M14.5 4v16" /></>)
export const IconBeam = mk('IconBeam', <><rect x="2" y="9" width="20" height="6" rx="1" /><path d="M7 9v6M12 9v6M17 9v6" /></>)
export const IconRailing = mk('IconRailing', <><path d="M3 8h18M4 8v12M9.5 8v12M15 8v12M20 8v12" /></>)
export const IconRoom = mk('IconRoom', <><rect x="4" y="4" width="16" height="16" rx="1" /><path d="M4 12h6M10 12v8" /><circle cx="15" cy="9" r="1" fill="currentColor" /></>)
export const IconLevel = mk('IconLevel', <><path d="M2 13l10-5 10 5-10 5z" /><path d="M2 8l10-5 10 5" /></>)
export const IconLevelAdd = mk('IconLevelAdd', <><path d="M2 14l10-5 10 5-10 5z" /><path d="M12 2v6M9 5h6" /></>)

// ---- solids / shapes
export const IconSphere = mk('IconSphere', <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>)
export const IconTube = mk('IconTube', <><ellipse cx="12" cy="6" rx="8" ry="3" /><ellipse cx="12" cy="6" rx="3.5" ry="1.3" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /></>)
export const IconRevolve = mk('IconRevolve', <><path d="M9 3h6" /><path d="M10 3c0 3-3 5-3 9s2 9 5 9 5-5 5-9-3-6-3-9" /><path d="M5 12h14" strokeDasharray="2 2.5" /></>)
export const IconLoft = mk('IconLoft', <><rect x="5" y="16" width="14" height="4" rx="1" /><ellipse cx="12" cy="5" rx="5" ry="2" /><path d="M7 5v11M17 5v11" strokeDasharray="2 2.5" /></>)
export const IconRing = mk('IconRing', <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /></>)
export const IconWedge = mk('IconWedge', <><path d="M3 20h18V8z" /><path d="M3 20l4-3" /></>)
export const IconText3D = mk('IconText3D', <><path d="M5 5h10M10 5v14" /><path d="M15 5l4 3v14M10 19l4 3M14 22V8" /></>)

// ---- 2D drafting / annotation
export const IconPolyline = mk('IconPolyline', <><path d="M3 18l5-9 6 6 7-12" /><circle cx="3" cy="18" r="1.2" fill="currentColor" /><circle cx="8" cy="9" r="1.2" fill="currentColor" /><circle cx="14" cy="15" r="1.2" fill="currentColor" /><circle cx="21" cy="3" r="1.2" fill="currentColor" /></>)
export const IconArc = mk('IconArc', <><path d="M4 18a12 12 0 0 1 16 0" /><circle cx="4" cy="18" r="1.4" fill="currentColor" /><circle cx="20" cy="18" r="1.4" fill="currentColor" /></>)
export const IconEllipse = mk('IconEllipse', <ellipse cx="12" cy="12" rx="9" ry="6" />)
export const IconHatch = mk('IconHatch', <><rect x="3" y="3" width="18" height="18" rx="1.5" /><path d="M3 12l9-9M3 21L21 3M12 21l9-9" /></>)
export const IconLeader = mk('IconLeader', <><path d="M4 19l7-7h9" /><circle cx="4" cy="19" r="1.4" fill="currentColor" /></>)
export const IconDimension = mk('IconDimension', <><path d="M4 6v12M20 6v12M4 12h16" /><path d="M8 9l-4 3 4 3M16 9l4 3-4 3" /></>)
export const IconSection = mk('IconSection', <><rect x="4" y="4" width="16" height="16" rx="1.5" /><path d="M2 12h20" strokeDasharray="4 2.5" /><path d="M9 8l3 4-3 4" /></>)
export const IconAreaMeasure = mk('IconAreaMeasure', <><path d="M4 5h9l7 7v7H4z" /><path d="M8 9h3M8 13h6M8 17h8" /></>)
export const IconDistance = mk('IconDistance', <><path d="M3 19L19 3" /><path d="M3 15v4h4M15 3h4v4" /></>)

// ---- modify
export const IconPushPull = mk('IconPushPull', <><path d="M4 20h16V10H4z" /><path d="M12 10V3" /><path d="M8 6l4-3 4 3" /></>)
export const IconOffset = mk('IconOffset', <><rect x="3" y="3" width="18" height="18" rx="2" /><rect x="8" y="8" width="8" height="8" rx="1" strokeDasharray="2.5 2.5" /></>)
export const IconTrim = mk('IconTrim', <><path d="M3 8h18M3 16h9" /><path d="M12 16h9" strokeDasharray="2 3" /><path d="M12 4v16" /></>)
export const IconExtend = mk('IconExtend', <><path d="M3 8h18M3 16h9" /><path d="M12 16h6" strokeDasharray="2 3" /><path d="M18 13l3 3-3 3" /></>)
export const IconFillet = mk('IconFillet', <><path d="M4 20V12a8 8 0 0 1 8-8h8" /><path d="M4 8V4h4" strokeDasharray="2 2.5" /></>)
export const IconMirror = mk('IconMirror', <><path d="M12 3v18" strokeDasharray="3 2.5" /><path d="M9 7L4 12l5 5V7z" /><path d="M15 7l5 5-5 5V7z" fill="currentColor" fillOpacity="0.25" /></>)

// ---- furniture (kinds without a lucide glyph)
export const IconChair = mk('IconChair', <><path d="M7 4h10v7H7z" /><path d="M6 11h12v3H6z" /><path d="M7 14v6M17 14v6" /></>)
export const IconStool = mk('IconStool', <><ellipse cx="12" cy="7" rx="7" ry="2.5" /><path d="M6 8.5l-1 11.5M18 8.5l1 11.5M12 9.5V20" /></>)
export const IconDiningTable = mk('IconDiningTable', <><rect x="3" y="7" width="18" height="4" rx="1" /><path d="M6 11v8M18 11v8M9 19h-3M18 19h-3" /></>)
export const IconCoffeeTable = mk('IconCoffeeTable', <><rect x="3" y="9" width="18" height="3" rx="1" /><path d="M6 12v6M18 12v6M6 16h12" /></>)
export const IconDesk = mk('IconDesk', <><rect x="3" y="6" width="18" height="3" rx="1" /><path d="M5 9v10M19 9v10" /><rect x="12" y="9" width="7" height="6" /></>)
export const IconNightstand = mk('IconNightstand', <><rect x="5" y="6" width="14" height="12" rx="1.5" /><path d="M5 12h14M12 9v.5M12 15v.5M7 18v2M17 18v2" /></>)
export const IconWardrobe = mk('IconWardrobe', <><rect x="5" y="3" width="14" height="18" rx="1.5" /><path d="M12 3v18M10 11v2M14 11v2" /></>)
export const IconShelf = mk('IconShelf', <><rect x="5" y="3" width="14" height="18" rx="1.5" /><path d="M5 9h14M5 15h14" /></>)
export const IconDresser = mk('IconDresser', <><rect x="4" y="6" width="16" height="13" rx="1.5" /><path d="M4 10.3h16M4 14.6h16M12 8v.6M12 12.2v.6M12 16.5v.6" /></>)
export const IconKitchenBase = mk('IconKitchenBase', <><rect x="4" y="9" width="16" height="11" rx="1" /><path d="M3 9h18M4 7h16v2M12 9v11M9 14v1.5M15 14v1.5" /></>)
export const IconKitchenWall = mk('IconKitchenWall', <><rect x="4" y="4" width="16" height="10" rx="1" /><path d="M12 4v10M9 10v1.5M15 10v1.5" /></>)
export const IconKitchenIsland = mk('IconKitchenIsland', <><rect x="2" y="8" width="20" height="10" rx="1.5" /><path d="M2 12h20M8 12v6M16 12v6" /></>)
export const IconDishwasher = mk('IconDishwasher', <><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M4 8h16" /><circle cx="12" cy="14" r="3.5" /></>)
export const IconSink = mk('IconSink', <><path d="M3 9h18v3a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5z" /><path d="M12 9V5M9 5h6" /></>)
export const IconWashbasin = mk('IconWashbasin', <><path d="M4 11h16a8 8 0 0 1-16 0z" /><path d="M12 11V7M10 7h4" /></>)
export const IconRug = mk('IconRug', <><rect x="3" y="6" width="18" height="12" rx="1" /><rect x="6" y="9" width="12" height="6" /></>)
export const IconTerrain = mk('IconTerrain', <><path d="M3 18l5-8 4 5 3-4 6 7z" /><path d="M3 21h18" /></>)

// ---- misc chrome
export const IconViewCube = mk('IconViewCube', <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" /></>)
export const IconSplitView = mk('IconSplitView', <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16" /></>)
export const IconQuadView = mk('IconQuadView', <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16M3 12h18" /></>)
export const IconSingleView = mk('IconSingleView', <rect x="3" y="4" width="18" height="16" rx="2" />)
