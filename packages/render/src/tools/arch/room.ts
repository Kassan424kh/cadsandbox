// arch.room — click inside walls → room outline from the wall graph (inner faces) → 'room' node
// {auto: true} with the next free number ("0.01" = level 0, room 1); polygon mode draws it.
import type { AnyNode, RoomUsage, Vec2 } from '@cadsandbox/doc'
import type { ToolContext, ToolOptionSpec } from '../types'
import { boolOption, newNode, selectOption } from '../util/nodes'
import { roomOutlineAt } from '../util/regions'
import { RegionChainTool } from './regionTool'

const USAGES: { value: RoomUsage; label: string }[] = [
  { value: 'NUF1', label: 'NUF1 Living / lounge' },
  { value: 'NUF2', label: 'NUF2 Office' },
  { value: 'NUF3', label: 'NUF3 Production / workshop' },
  { value: 'NUF4', label: 'NUF4 Storage / sales' },
  { value: 'NUF5', label: 'NUF5 Education / culture' },
  { value: 'NUF6', label: 'NUF6 Healthcare' },
  { value: 'NUF7', label: 'NUF7 Other (WC, kitchen…)' },
  { value: 'TF', label: 'TF Technical' },
  { value: 'VF', label: 'VF Circulation' },
]

export const ROOM_OPTIONS: ToolOptionSpec[] = [
  selectOption('mode', 'Mode', 'auto', [
    { value: 'auto', label: 'Click inside walls' },
    { value: 'polygon', label: 'Draw outline' },
  ]),
  selectOption('usage', 'Usage (DIN 277)', 'NUF1', USAGES),
  boolOption('showLabel', 'Show label', true),
]

/** Next room number on the level: "<level>.<nn>" continuing the highest existing suffix. */
export function nextRoomNumber(ctx: ToolContext): string {
  const level = ctx.activeLevel()
  const levelNode = level ? ctx.node<'level'>(level.id) : undefined
  const prefix = levelNode && levelNode.type === 'level' ? (levelNode.params as { number?: number }).number ?? 0 : 0
  let max = 0
  const ids = level ? ctx.doc.getDescendants(level.id) : ctx.doc.nodeIds()
  for (const id of ids) {
    const n = ctx.node(id) as AnyNode | undefined
    if (!n || n.type !== 'room') continue
    const m = /(\d+)\s*$/.exec(n.params.number)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `${prefix}.${String(max + 1).padStart(2, '0')}`
}

export class RoomTool extends RegionChainTool {
  readonly id = 'arch.room' as const
  override readonly specs = ROOM_OPTIONS

  protected regionMode(): 'auto' | 'polygon' {
    return this.optStr('mode', 'auto', ['auto', 'polygon'])
  }
  protected autoHint(): string {
    return 'Room: click inside the walls · options: usage'
  }
  protected autoOutline(point: Vec2): Vec2[] | null {
    return roomOutlineAt(this.ctx, this.cache.get(), point)?.outline ?? null
  }
  protected commitOutline(outline: Vec2[], auto: boolean): void {
    const number = nextRoomNumber(this.ctx)
    this.commitNodes([
      newNode(
        'room',
        {
          outline: outline.map((p) => [p[0], p[1]] as Vec2),
          number,
          usage: this.optStr<RoomUsage>('usage', 'NUF1', USAGES.map((u) => u.value)),
          showLabel: this.optBool('showLabel', true),
          auto,
        },
        { parent: this.parent(), name: `Room ${number}` },
      ),
    ])
  }
}
