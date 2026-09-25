// Pending organization invitations for the signed-in user (shown on Home).
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Building2, Check, X } from 'lucide-react'
import { Button, toast } from '../../ui'
import { useT } from '../../i18n'
import { useAuth } from '../../data/auth/AuthProvider'
import { authClient, unwrap } from '../../data/auth/client'
import { errorMessage } from '../components/Dialogs'
import { useMyInvitations } from './orgData'
import d from '../dashboard/dashboard.module.css'

export function PendingInvitations() {
  const t = useT()
  const auth = useAuth()
  const qc = useQueryClient()
  const invites = useMyInvitations(auth.status === 'signed-in' && !auth.offline)
  const [busy, setBusy] = useState<string | null>(null)
  const pending = (invites.data ?? []).filter((i) => i.status === 'pending')
  if (!pending.length) return null
  const respond = async (id: string, accept: boolean) => {
    setBusy(id)
    try {
      if (accept) await unwrap(authClient.organization.acceptInvitation({ invitationId: id }))
      else await unwrap(authClient.organization.rejectInvitation({ invitationId: id }))
      await qc.invalidateQueries({ queryKey: ['org'] })
      await auth.refresh()
      if (accept) toast.success(t('org.joined', 'You joined the organization'))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }
  return (
    <section aria-label={t('org.invitations', 'Invitations')} style={{ display: 'grid', gap: 8 }}>
      {pending.map((i) => (
        <div key={i.id} className={d.notice}>
          <Building2 size={16} />
          <span style={{ flex: 1 }}>
            {t('org.invitedTo', 'You are invited to join {org} as {role}.', { org: i.organizationName ?? t('org.anOrganization', 'an organization'), role: t(`org.role.${i.role}`, i.role) })}
          </span>
          <Button size="sm" variant="primary" icon={<Check size={14} />} loading={busy === i.id} onClick={() => void respond(i.id, true)}>
            {t('org.accept', 'Accept')}
          </Button>
          <Button size="sm" variant="ghost" icon={<X size={14} />} disabled={busy === i.id} onClick={() => void respond(i.id, false)}>
            {t('org.decline', 'Decline')}
          </Button>
        </div>
      ))}
    </section>
  )
}
