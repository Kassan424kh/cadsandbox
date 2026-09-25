// /p/:projectId[/:fileId] — opens the project session (local or cloud) and mounts the editor.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, LogIn, RefreshCw } from 'lucide-react'
import { Button, toast } from '../../ui'
import { useT } from '../../i18n'
import { EditorPage, type EditorPageProps } from '../../editor/EditorPage'
import type { LibraryStore, ProjectSession } from '../../data/types'
import { useAuth } from '../../data/auth/AuthProvider'
import { acquireSession, closeSession, ProjectUnavailableError } from '../../data/session/manager'
import { forgetCloudProjectData } from '../../data/cloud-cache'
import { isApiError } from '../../data/api/client'
import { AccessDeniedError } from '../../data/session/session'
import { editorUser } from '../../data/session/user'
import { libraryFor } from '../../data/library'
import { importProjectFile } from '../../data/archive'
import { invalidateProjects } from '../../data/queries'
import { useDocumentTitle } from '../hooks'
import { ErrorCard, FullPageLoader, NotFoundPage } from '../components/PageStates'
import { loginHref } from '../components/Guards'
import { errorMessage } from '../components/Dialogs'
import c from '../components/components.module.css'
import { LinkButton } from '../components/LinkButton'

type State = { status: 'loading' } | { status: 'ready'; session: ProjectSession } | { status: 'error'; error: unknown }

export default function EditorRoute() {
  const t = useT()
  const { projectId = '', fileId = null } = useParams()
  const [search] = useSearchParams()
  const shareToken = search.get('share')
  const navigate = useNavigate()
  const location = useLocation()
  const auth = useAuth()
  const qc = useQueryClient()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  // The server closed our documents because access was revoked or changed (see onAccessChange).
  const [accessChanged, setAccessChanged] = useState(false)
  const lastAccessReopen = useRef(0)
  const userKey = auth.user?.id ?? 'guest'
  const authPending = auth.status === 'loading'
  // Set by flows that replace the session under an open editor (e.g. "Upload to cloud").
  const reopen = (location.state as { reopen?: number } | null)?.reopen ?? 0

  useEffect(() => {
    if (authPending) return
    let cancelled = false
    let release: (() => void) | null = null
    setState({ status: 'loading' })
    const user = editorUser(auth.user, t('editor.guest', 'Guest'))
    acquireSession(projectId, { user, shareToken })
      .then(async (r) => {
        release = r.release
        if (cancelled) return r.release()
        await r.session.ready
        if (!cancelled) setState({ status: 'ready', session: r.session })
      })
      .catch((error: unknown) => !cancelled && setState({ status: 'error', error }))
    return () => {
      cancelled = true
      release?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reopen only when project/identity changes
  }, [projectId, shareToken, userKey, authPending, attempt, reopen])

  const session = state.status === 'ready' ? state.session : null
  useDocumentTitle(session ? (session.project?.name ?? session.manifest.info.name) : null)

  // Live access changes (member removed, role changed, link deleted, project trashed): the open session
  // keeps its old role and would silently stop syncing, so unmount the editor, drop the stale local
  // copy (a demoted editor's unsynced edits can never be pushed) and reopen from the server — which
  // either yields a session with the new role or the "no longer have access" card below.
  // Transport disconnects / server restarts never get here: the session reconnects by itself.
  useEffect(() => {
    if (!session?.onAccessChange) return
    let handled = false
    return session.onAccessChange((reason, denied) => {
      if (handled) return
      handled = true
      // The REST check said "come in" but collab keeps refusing: stop reopening in a loop. Only the
      // server's explicit refusal may end on the no-access card; any other repeated change (e.g. a
      // granted scope that keeps differing from the REST role) ends on the generic card with Retry.
      const looping = Date.now() - lastAccessReopen.current < 15_000
      lastAccessReopen.current = Date.now()
      const loopError = denied ? new AccessDeniedError(reason) : new Error(t('editor.accessChanged', 'Your access to this project changed'))
      flushSync(() => {
        setAccessChanged(true)
        setState(looping ? { status: 'error', error: loopError } : { status: 'loading' })
      })
      closeSession(session.projectId)
      if (looping) return
      void forgetCloudProjectData(session.projectId)
        .catch(() => undefined)
        .finally(() => setAttempt((a) => a + 1))
    })
  }, [session, t])

  // Reopened with a (possibly different) role after a live access change: say so once.
  useEffect(() => {
    if (!accessChanged || !session) return
    setAccessChanged(false)
    toast(t('editor.accessChanged', 'Your access to this project changed'))
  }, [accessChanged, session, t])

  const library = useMemo<LibraryStore>(() => libraryFor(auth.status === 'signed-in'), [auth.status])

  // A project archive (.csbx) dropped or picked in the editor is a whole project: import it as a new
  // project on this device and open it (the dashboard's "Import project"), never into this design.
  const importProject = useCallback(
    (file: File) => {
      const run = importProjectFile(file).then(async (id) => {
        await invalidateProjects(qc)
        navigate(`/p/${id}`)
      })
      toast.promise(run, {
        loading: t('dashboard.importing', 'Importing project…'),
        success: t('dashboard.imported', 'Project imported to this device'),
        error: (err: unknown) => errorMessage(err),
      })
    },
    [qc, navigate, t],
  )

  if (state.status === 'error') {
    const err = state.error
    // Admin impersonation (privacy by design): project content needs the user's support grant.
    const impersonationBlocked =
      (err instanceof AccessDeniedError && err.reason === 'impersonation-content-blocked') || (isApiError(err) && err.reason === 'impersonation')
    if (impersonationBlocked)
      return (
        <ErrorCard
          title={t('editor.error.impersonation', 'Project content is hidden while you act as this user')}
          message={t(
            'editor.error.impersonationDesc',
            'While impersonating you can see project names and settings, but not their content. The user can give support read-only access to this project for a limited time in a support request — every access is recorded in the audit log.',
          )}
        >
          <div className={c.row}>
            <LinkButton to="/" variant="secondary" icon={<ArrowLeft size={16} />}>{t('editor.backToDashboard', 'Back to dashboard')}</LinkButton>
            <Button variant="primary" icon={<RefreshCw size={16} />} onClick={() => setAttempt((a) => a + 1)}>
              {t('common.retry', 'Retry')}
            </Button>
          </div>
        </ErrorCard>
      )
    // After a live revocation a private project answers 404 like any unknown id — but the user was
    // just working in it, so tell them what happened instead of showing "page not found".
    const revoked = accessChanged && err instanceof ProjectUnavailableError && (err.reason === 'not_found' || err.reason === 'forbidden')
    if (!revoked && err instanceof ProjectUnavailableError && err.reason === 'not_found') return <NotFoundPage />
    const unauthorized = err instanceof ProjectUnavailableError && err.reason === 'unauthorized'
    const title = revoked
      ? t('editor.error.revoked', 'You no longer have access to this project')
      : err instanceof ProjectUnavailableError
        ? {
            unauthorized: t('editor.error.unauthorized', 'Sign in to open this project'),
            forbidden: t('editor.error.forbidden', 'You don’t have access to this project'),
            offline: t('editor.error.offline', 'This project is not available offline'),
            trashed: t('editor.error.trashed', 'This project is in the trash'),
            not_found: '',
          }[err.reason]
        : err instanceof AccessDeniedError
          ? t('editor.error.forbidden', 'You don’t have access to this project')
          : t('editor.error.generic', 'The project could not be opened')
    const message = revoked
      ? t('editor.error.revokedDesc', 'The owner changed who can open it, or it was deleted. Ask the owner to share it with you again.')
      : err instanceof ProjectUnavailableError && err.reason === 'offline'
        ? t('editor.error.offlineDesc', 'It has not been opened on this device before. Connect to the internet once to make it available offline.')
        : err instanceof ProjectUnavailableError && err.reason === 'forbidden'
          ? t('editor.error.forbiddenDesc', 'Ask the owner to invite you or to send you a share link.')
          : err instanceof ProjectUnavailableError && err.reason === 'trashed'
            ? t('editor.error.trashedDesc', 'Restore it from the trash to open it again.')
            : unauthorized
              ? undefined
              : errorMessage(err)
    return (
      <ErrorCard title={title} message={message}>
        <div className={c.row}>
          <LinkButton to="/" variant="secondary" icon={<ArrowLeft size={16} />}>{t('editor.backToDashboard', 'Back to dashboard')}</LinkButton>
          {unauthorized ? (
            <LinkButton to={loginHref(location.pathname + location.search)} variant="primary" icon={<LogIn size={16} />}>{t('auth.signIn', 'Sign in')}</LinkButton>
          ) : (
            <Button variant="primary" icon={<RefreshCw size={16} />} onClick={() => setAttempt((a) => a + 1)}>
              {t('common.retry', 'Retry')}
            </Button>
          )}
        </div>
      </ErrorCard>
    )
  }

  if (!session) return <FullPageLoader label={t('editor.opening', 'Opening project…')} />

  const suffix = shareToken ? `?share=${encodeURIComponent(shareToken)}` : ''
  const props: EditorPageProps = {
    session,
    fileId,
    library,
    onOpenFile: (id) => navigate(`/p/${projectId}/${id}${suffix}`),
    onExit: () => navigate((location.state as { from?: string } | null)?.from ?? '/projects'),
    onImportProject: importProject,
  }
  return <EditorPage key={projectId} {...props} />
}
