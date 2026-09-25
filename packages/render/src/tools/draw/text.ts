// draw.text — click → inline prompt → 'text' node (flat annotation text) on the annotation layer.
import type { TextFont, TextParams } from '@cadsandbox/doc'
import type { ToolOptionSpec, ToolPointerEvent } from '../types'
import { ToolBase, isPrimary } from '../util/base'
import { nodeTransformOnPlane } from '../util/frame'
import { LAYERS, boolOption, lengthOption, newNode, selectOption } from '../util/nodes'
import { toPlane } from '../util/vec'

const FONTS: TextFont[] = ['sans', 'serif', 'mono', 'display']
const ALIGNS: TextParams['align'][] = ['left', 'center', 'right']

export const TEXT_OPTIONS: ToolOptionSpec[] = [
  lengthOption('size', 'Size (cap height)', 0.25, 0.001),
  selectOption('font', 'Font', 'sans', FONTS),
  selectOption('align', 'Align', 'left', ALIGNS),
  boolOption('annotative', 'Annotative (paper size)', false),
  boolOption('multiline', 'Multi-line', false),
]

export class TextTool extends ToolBase {
  readonly id = 'draw.text' as const
  override readonly specs = TEXT_OPTIONS
  private prompting = false

  protected override start(): void {
    this.hint('Text: click the insertion point, then type · Enter confirms, Esc cancels')
  }
  protected isBusy(): boolean {
    return this.prompting
  }
  protected reset(): void {
    this.clearAll()
  }

  onPointerMove(e: ToolPointerEvent): void {
    if (this.prompting) return
    this.clearAll()
    this.snap(e)
  }

  onPointerDown(e: ToolPointerEvent): boolean {
    if (!isPrimary(e) || this.prompting) return false
    const s = this.snap(e)
    const world = s.point
    const plane = this.plane()
    const parent = this.parent()
    this.prompting = true
    this.hint('Type the text · Enter confirms · Esc cancels')
    void this.ctx.overlay
      .prompt(world, '', { multiline: this.optBool('multiline', false), placeholder: 'Text' })
      .then((text) => {
        this.prompting = false
        if (!this.isActive()) return
        this.clearAll()
        this.hint('Text: click the insertion point, then type · Enter confirms, Esc cancels')
        if (text === null || !text.trim()) return
        const t = nodeTransformOnPlane(this.ctx, parent, plane, toPlane(plane, world))
        this.commitNodes([
          newNode(
            'text',
            {
              text,
              size: Math.max(0.001, this.optNum('size', 0.25)),
              font: this.optStr<TextFont>('font', 'sans', FONTS),
              align: this.optStr<TextParams['align']>('align', 'left', ALIGNS),
              depth: 0,
              annotative: this.optBool('annotative', false),
            },
            { parent, t, layer: LAYERS.anno, name: text.length > 24 ? `${text.slice(0, 24)}…` : text },
          ),
        ])
      })
    return true
  }
}
