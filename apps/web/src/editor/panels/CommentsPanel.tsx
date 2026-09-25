// Comments: list (open / resolved), navigate to anchors, reply, resolve, delete, start a new one.
import { useEffect, useRef, useState } from 'react'
import { Check, MessageSquarePlus, RotateCcw, Trash } from 'lucide-react'
import type { CommentDef } from '@cadsandbox/doc'
import { useT } from '../../i18n'
import { Avatar, Button, EmptyState, IconButton, ScrollArea, SegmentedControl, Textarea, Tooltip, cx, timeAgo } from '../../ui'
import { onComments, useDocSelector, useEditorCtx } from '../EditorContext'
import { useActions } from '../commands/actions'
import { useUiStore } from '../ui-store'
import { PanelFrame } from './LeftRail'
import styles from './panels.module.css'

function CommentCard({ c }: { c: CommentDef }) {
  const t = useT()
  const { doc, editor, session, readOnly } = useEditorCtx()
  const active = useUiStore((s) => s.activeComment)
  const setActive = useUiStore((s) => s.setActiveComment)
  const [reply, setReply] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const isActive = active === c.id
  const canComment = !readOnly || session.role === 'commenter'
  const mine = c.author.id === session.user.id

  useEffect(() => {
    if (isActive) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [isActive])

  const goTo = () => {
    setActive(c.id)
    if (c.anchor.nodeId && doc.hasNode(c.anchor.nodeId)) {
      editor.select([c.anchor.nodeId])
      editor.zoomToFit([c.anchor.nodeId], true)
    } else if (c.anchor.point) {
      const cam = editor.getCamera()
      const p = c.anchor.point
      const d = [cam.position[0] - cam.target[0], cam.position[1] - cam.target[1], cam.position[2] - cam.target[2]]
      editor.setCamera({ ...cam, target: p, position: [p[0] + d[0], p[1] + d[1], p[2] + d[2]] }, true)
    }
  }
  const post = () => {
    const text = reply.trim()
    if (!text) return
    doc.addReply(c.id, { author: { id: session.user.id, name: session.user.name, color: session.user.color }, text })
    setReply('')
  }

  return (
    <div ref={ref} className={cx(styles.comment, isActive && styles.commentActive, c.resolved && styles.commentResolved)} onClick={goTo}>
      <div className={styles.commentHead}>
        <Avatar name={c.author.name} color={c.author.color} size={20} />
        <span className={styles.commentAuthor}>{c.author.name}</span>
        <span>{timeAgo(c.createdAt)}</span>
        <span style={{ flex: 1 }} />
        {canComment && (
          <Tooltip content={c.resolved ? t('comments.reopen', 'Re-open') : t('comments.resolve', 'Resolve')}>
            <IconButton
              size="sm"
              label={c.resolved ? t('comments.reopen', 'Re-open') : t('comments.resolve', 'Resolve')}
              icon={c.resolved ? <RotateCcw /> : <Check />}
              tooltip={false}
              onClick={(e) => {
                e.stopPropagation()
                doc.updateComment(c.id, { resolved: !c.resolved })
              }}
            />
          </Tooltip>
        )}
        {(mine || !readOnly) && (
          <IconButton
            size="sm"
            label={t('common.delete', 'Delete')}
            icon={<Trash />}
            onClick={(e) => {
              e.stopPropagation()
              if (window.confirm(t('comments.confirmDelete', 'Delete this comment thread?'))) doc.removeComment(c.id)
            }}
          />
        )}
      </div>
      <div className={styles.commentText}>{c.text}</div>
      {c.replies.map((r) => (
        <div key={r.id} className={styles.reply}>
          <div className={styles.commentHead}>
            <Avatar name={r.author.name} color={r.author.color} size={16} />
            <span className={styles.commentAuthor}>{r.author.name}</span>
            <span>{timeAgo(r.createdAt)}</span>
          </div>
          <div className={styles.commentText}>{r.text}</div>
        </div>
      ))}
      {isActive && canComment && !c.resolved && (
        <div className={styles.replyBox} onClick={(e) => e.stopPropagation()}>
          <Textarea rows={1} value={reply} placeholder={t('comments.replyPlaceholder', 'Reply…')} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && post()} style={{ minHeight: 32 }} />
          <Button size="sm" variant="primary" disabled={!reply.trim()} onClick={post}>
            {t('comments.reply', 'Reply')}
          </Button>
        </div>
      )}
    </div>
  )
}

export function CommentsPanel() {
  const t = useT()
  const actions = useActions()
  const { readOnly, session } = useEditorCtx()
  const comments = useDocSelector((d) => [...d.listComments()].sort((a, b) => b.createdAt - a.createdAt), onComments)
  const [filter, setFilter] = useState<'open' | 'resolved'>('open')
  const shown = comments.filter((c) => (filter === 'open' ? !c.resolved : c.resolved))
  const canComment = !readOnly || session.role === 'commenter'

  return (
    <PanelFrame
      title={t('panel.comments', 'Comments')}
      actions={canComment && <IconButton size="sm" label={t('comments.add', 'Add comment (click in the model)')} icon={<MessageSquarePlus />} onClick={() => actions.setTool('annotate.comment')} />}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ padding: '8px 10px' }}>
          <SegmentedControl<'open' | 'resolved'>
            full
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'open', label: t('comments.open', 'Open ({n})', { n: comments.filter((c) => !c.resolved).length }) },
              { value: 'resolved', label: t('comments.resolved', 'Resolved ({n})', { n: comments.filter((c) => c.resolved).length }) },
            ]}
            aria-label={t('comments.filter', 'Filter comments')}
          />
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <ScrollArea>
            {shown.length === 0 ? (
              <EmptyState compact icon={<MessageSquarePlus />} title={filter === 'open' ? t('comments.none', 'No open comments') : t('comments.noneResolved', 'Nothing resolved yet')} description={canComment && filter === 'open' ? t('comments.noneHint', 'Pin a comment to any point of the model to discuss it with your team.') : undefined} actions={canComment && filter === 'open' && <Button size="sm" onClick={() => actions.setTool('annotate.comment')}>{t('comments.addShort', 'Add comment')}</Button>} />
            ) : (
              <div className={styles.list}>
                {shown.map((c) => (
                  <CommentCard key={c.id} c={c} />
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </div>
    </PanelFrame>
  )
}
