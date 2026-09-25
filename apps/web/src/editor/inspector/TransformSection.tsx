// Transform: position / rotation (Euler degrees) / scale with uniform lock; multi-selection aware.
import { useState } from 'react'
import { Link, Unlink } from 'lucide-react'
import { eulerFromQuat, quatFromEuler, type AnyNode, type Vec3 } from '@cadsandbox/doc'
import { useT } from '../../i18n'
import { FieldRow, NumberField, Tooltip, cx } from '../../ui'
import { useEditorCtx, useUnits } from '../EditorContext'
import { Vec3Field, commonVec } from './fields'
import styles from './inspector.module.css'

const RAD = Math.PI / 180
const same = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - (b[i] ?? NaN)) < 1e-9)

export function TransformSection({ nodes }: { nodes: AnyNode[] }) {
  const t = useT()
  const { doc, readOnly } = useEditorCtx()
  const units = useUnits()
  const [uniform, setUniform] = useState(true)
  const first = nodes[0]!
  const isLevel = nodes.every((n) => n.type === 'level')
  const isOpening = nodes.some((n) => n.type === 'opening')
  const pos = commonVec(nodes.map((n) => n.t.p), 3)
  const rotDeg = nodes.every((n) => same(n.t.r, first.t.r)) ? (eulerFromQuat(first.t.r).map((v) => v / RAD) as Vec3) : null
  const scale = nodes.every((n) => same(n.t.s, first.t.s)) ? first.t.s : null
  const stop = () => doc.stopCapturing()

  const setAll = (fn: (n: AnyNode) => AnyNode['t']) => {
    if (readOnly) return
    doc.transact(() => doc.setTransforms(nodes.map((n) => [n.id, fn(n)] as [string, AnyNode['t']])))
  }

  if (isOpening) return <div className={styles.summary}>{t('inspector.openingPlacement', 'Openings are positioned along their wall — use "Position along wall" below.')}</div>

  return (
    <>
      <FieldRow label={t('transform.position', 'Position')}>
        <Vec3Field
          unit={units.length}
          precision={units.precision}
          value={pos}
          min={-Infinity}
          disabled={readOnly}
          onScrubStart={stop}
          onScrubEnd={stop}
          onChange={(v, axis) =>
            setAll((n) => {
              // Only the edited axis changes, per node: other (possibly mixed) axes are preserved.
              const p = [...n.t.p] as Vec3
              p[axis] = v[axis]!
              return { ...n.t, p: isLevel ? [0, 0, p[2]] : p }
            })
          }
          name={t('transform.position', 'Position')}
        />
      </FieldRow>
      {!isLevel && (
        <>
          <FieldRow label={t('transform.rotation', 'Rotation')}>
            <div className={styles.vec}>
              {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                <NumberField
                  key={axis}
                  size="sm"
                  prefix={axis}
                  axis={axis.toLowerCase() as 'x' | 'y' | 'z'}
                  unit="°"
                  precision={1}
                  step={1}
                  scrubScale={0.5}
                  value={rotDeg ? rotDeg[i]! : null}
                  disabled={readOnly}
                  onScrubStart={stop}
                  onScrubEnd={stop}
                  onChange={(v) =>
                    setAll((n) => {
                      const e = eulerFromQuat(n.t.r).map((x) => x / RAD) as Vec3
                      e[i] = v
                      return { ...n.t, r: quatFromEuler(e[0] * RAD, e[1] * RAD, e[2] * RAD) }
                    })
                  }
                  mixedLabel={t('common.mixed', 'Mixed')}
                  aria-label={`${t('transform.rotation', 'Rotation')} ${axis}`}
                />
              ))}
            </div>
          </FieldRow>
          <FieldRow label={t('transform.scale', 'Scale')}>
            <div className={styles.vec}>
              {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                <NumberField
                  key={axis}
                  size="sm"
                  prefix={axis}
                  axis={axis.toLowerCase() as 'x' | 'y' | 'z'}
                  precision={3}
                  step={0.1}
                  scrubScale={0.01}
                  value={scale ? scale[i]! : null}
                  disabled={readOnly}
                  onScrubStart={stop}
                  onScrubEnd={stop}
                  onChange={(v) =>
                    setAll((n) => {
                      if (uniform) {
                        const ratio = n.t.s[i] !== 0 ? v / n.t.s[i] : 1
                        return { ...n.t, s: n.t.s.map((x) => (x === 0 ? v : x * ratio)) as Vec3 }
                      }
                      const s = [...n.t.s] as Vec3
                      s[i] = v
                      return { ...n.t, s }
                    })
                  }
                  mixedLabel={t('common.mixed', 'Mixed')}
                  aria-label={`${t('transform.scale', 'Scale')} ${axis}`}
                />
              ))}
            </div>
            <Tooltip content={uniform ? t('transform.uniformOn', 'Uniform scale (linked)') : t('transform.uniformOff', 'Scale axes independently')}>
              <button type="button" className={cx(styles.lockBtn, uniform && styles.lockOn)} aria-pressed={uniform} aria-label={t('transform.uniform', 'Uniform scale')} onClick={() => setUniform(!uniform)}>
                {uniform ? <Link /> : <Unlink />}
              </button>
            </Tooltip>
          </FieldRow>
        </>
      )}
    </>
  )
}
