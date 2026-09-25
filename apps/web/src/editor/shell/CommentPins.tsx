// Comment pins over the canvas + the "new comment" composer opened by the engine's commentRequest.
// Pins need a world→screen projection: the Editor API has no `project()` yet, so we use it when
// present (duck-typed, contract request) and otherwise show pins only in the Comments panel.
import { useEffect, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import type { Vec3 } from '@cadsandbox/doc'
import { useT } from '../../i18n'
import { Avatar, Button, Popover, PopoverAnchor, PopoverContent, Textarea, cx } from '../../ui'
import { onComments, useDocSelector, useEditorCtx, useEditorState } from '../EditorContext'
import { useUiStore } from '../ui-store'
import styles from './pins.module.css'

type Projector = (world: Vec3, viewport?: number) => { x: number; y: number; visible: boolean } | null

function useProjector(): Projector | null {
  const { editor } = useEditorCtx()
  const maybe = (editor as unknown as { project?: Projector }).project
  return typeof maybe === 'function' ? maybe.bind(editor) : null
}

export function CommentPins() {
  const t = useT()
  const { editor, doc, session, readOnly } = useEditorCtx()
  const project = useProjector()
  const comments = useDocSelector((d) => d.listComments().filter((c) => !c.resolved && c.anchor.point), onComments)
  const composer = useUiStore((s) => s.commentComposer)
  const setComposer = useUiStore((s) => s.setCommentComposer)
  const active = useUiStore((s) => s.activeComment)
  const setActive = useUiStore((s) => s.setActiveComment)
  const setLeftTab = useUiStore((s) => s.setLeftTab)
  const [text, setText] = useState('')
  // Re-project on every engine state change (camera moves update cursorWorld/stats frequently).
  useEditorState((s) => s.stats.frameMs)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!project) return
    let raf = 0
    const loop = () => {
      tick((n) => (n + 1) % 1000)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [project])

  useEffect(() => editor.on('commentRequest', (e) => setComposer({ point: e.point, nodeId: e.nodeId, clientX: e.clientX, clientY: e.clientY })), [editor, setComposer])

  const submit = () => {
    if (!composer || !text.trim()) return
    const id = doc.addComment({
      author: { id: session.user.id, name: session.user.name, color: session.user.color },
      text: text.trim(),
      anchor: { point: composer.point ?? undefined, nodeId: composer.nodeId ?? undefined },
    })
    setText('')
    setComposer(null)
    setActive(id)
    setLeftTab('comments')
    editor.setTool('select')
  }

  return (
    <>
      {project &&
        comments.map((c) => {
          const p = project(c.anchor.point!)
          if (!p || !p.visible) return null
          return (
            <button
              key={c.id}
              type="button"
              className={cx(styles.pin, active === c.id && styles.pinActive)}
              style={{ left: p.x, top: p.y }}
              aria-label={t('comments.openPin', 'Comment by {name}', { name: c.author.name })}
              onClick={() => {
                setActive(c.id)
                setLeftTab('comments')
              }}
            >
              <Avatar name={c.author.name} color={c.author.color} size={24} />
              {c.replies.length > 0 && <span className={styles.pinCount}>{c.replies.length + 1}</span>}
            </button>
          )
        })}
      {composer && !readOnly && (
        <Popover open onOpenChange={(o) => !o && setComposer(null)}>
          <PopoverAnchor asChild>
            <span className={styles.composerAnchor} style={{ left: composer.clientX, top: composer.clientY }} />
          </PopoverAnchor>
          <PopoverContent side="right" align="start" sideOffset={12} style={{ width: 300 }} onOpenAutoFocus={(e) => e.preventDefault()}>
            <div className={styles.composerHead}>
              <MessageSquare size={14} />
              {t('comments.new', 'New comment')}
            </div>
            <Textarea autoFocus value={text} placeholder={t('comments.placeholder', 'Write a comment… (Mod+Enter to post)')} rows={3} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && submit()} />
            <div className={styles.composerActions}>
              <Button variant="ghost" size="sm" onClick={() => setComposer(null)}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button variant="primary" size="sm" onClick={submit} disabled={!text.trim()}>
                {t('comments.post', 'Post')}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </>
  )
}
