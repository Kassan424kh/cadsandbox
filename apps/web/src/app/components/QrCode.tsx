// QR code rendered locally as SVG (no third-party service; the secret never leaves the device).
import { useMemo } from 'react'
import { encode } from 'uqr'
import s from './components.module.css'

export function QrCode({ value, size = 184, label }: { value: string; size?: number; label: string }) {
  const { path, dim } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 1 })
    let d = ''
    qr.data.forEach((row, y) =>
      row.forEach((on, x) => {
        if (on) d += `M${x} ${y}h1v1h-1z`
      }),
    )
    return { path: d, dim: qr.size }
  }, [value])
  return (
    <svg className={s.qr} width={size} height={size} viewBox={`0 0 ${dim} ${dim}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <path d={path} fill="#000" />
    </svg>
  )
}
