// /invite/:id — accept or decline an organization invitation (link from the invitation e-mail).
import { useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Check, LogIn, UserPlus, X } from 'lucide-react'
import { Button, toast } from '../../ui'
import { formatDate, useT } from '../../i18n'
import { useAuth } from '../../data/auth/AuthProvider'
import { authClient, unwrap } from '../../data/auth/client'
import { useDocumentTitle } from '../hooks'
import { ErrorCard, FullPageLoader } from '../components/PageStates'
import { LinkButton } from '../components/LinkButton'
import { loginHref } from '../components/Guards'
import { errorMessage } from '../components/Dialogs'
import c from '../components/components.module.css'

interface InvitationInfo {
  id: string
  organizationId: string
  organizationName?: string
  inviterEmail?: string
  email: string
  role: string
  status: string
  expiresAt?: string | Date
}

export default function InvitePage() {
  const t = useT()
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const auth = useAuth()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)
  useDocumentTitle(t('invite.title', 'Invitation'))
  const signedIn = auth.status === 'signed-in'
  const invitation = useQuery({
    queryKey: ['org', 'invitation', id],
    enabled: signedIn,
    retry: false,
    queryFn: async () => (await unwrap(authClient.organization.getInvitation({ query: { id } }))) as unknown as InvitationInfo,
  })

  if (auth.status === 'loading' || (signedIn && invitation.isLoading)) return <FullPageLoader />

  if (!signedIn)
    return (
      <ErrorCard title={t('invite.signInTitle', 'You are invited to an organization')} message={t('invite.signInDesc', 'Sign in — or create an account with the e-mail address the invitation was sent to — to accept it.')}>
        <div className={c.row}>
          <LinkButton to={loginHref(location.pathname)} variant="primary" icon={<LogIn size={16} />}>
            {t('auth.signIn', 'Sign in')}
          </LinkButton>
          <LinkButton to={`/signup?next=${encodeURIComponent(location.pathname)}`} variant="secondary" icon={<UserPlus size={16} />}>
            {t('auth.createAccount', 'Create account')}
          </LinkButton>
        </div>
      </ErrorCard>
    )

  const inv = invitation.data
  if (!inv || inv.status !== 'pending')
    return (
      <ErrorCard
        title={t('invite.invalid', 'This invitation is no longer valid')}
        message={
          invitation.error
            ? t('invite.invalidDesc', 'It may have expired, been withdrawn, or been sent to a different e-mail address than the one you are signed in with ({email}).', { email: auth.user?.email ?? '' })
            : t('invite.used', 'It has already been accepted or declined.')
        }
      >
        <LinkButton to="/" variant="primary">
          {t('common.home', 'Home')}
        </LinkButton>
      </ErrorCard>
    )

  const respond = async (accept: boolean) => {
    setBusy(accept ? 'accept' : 'decline')
    try {
      if (accept) await unwrap(authClient.organization.acceptInvitation({ invitationId: inv.id }))
      else await unwrap(authClient.organization.rejectInvitation({ invitationId: inv.id }))
      await qc.invalidateQueries({ queryKey: ['org'] })
      await auth.refresh()
      if (accept) {
        toast.success(t('org.joined', 'You joined the organization'))
        navigate(`/org/${inv.organizationId}`, { replace: true })
      } else navigate('/', { replace: true })
    } catch (err) {
      toast.error(errorMessage(err))
      setBusy(null)
    }
  }

  return (
    <ErrorCard
      title={t('invite.join', 'Join {org}?', { org: inv.organizationName ?? t('org.anOrganization', 'an organization') })}
      message={t('invite.details', '{inviter} invited you as {role}.', {
        inviter: inv.inviterEmail ?? t('invite.someone', 'Someone'),
        role: t(`org.role.${inv.role}`, inv.role),
      })}
    >
      <Building2 size={28} color="var(--cs-accent-2)" aria-hidden="true" />
      {inv.expiresAt && <p className={c.hint}>{t('invite.expires', 'The invitation expires on {date}.', { date: formatDate(inv.expiresAt) })}</p>}
      <div className={c.row}>
        <Button variant="primary" icon={<Check size={16} />} loading={busy === 'accept'} disabled={!!busy} onClick={() => void respond(true)}>
          {t('org.accept', 'Accept')}
        </Button>
        <Button variant="ghost" icon={<X size={16} />} loading={busy === 'decline'} disabled={!!busy} onClick={() => void respond(false)}>
          {t('org.decline', 'Decline')}
        </Button>
      </div>
    </ErrorCard>
  )
}

