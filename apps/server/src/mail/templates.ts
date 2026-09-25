// Transactional e-mail templates (English + German). No tracking pixels, no remote images/fonts.
import { BRAND } from '@cadsandbox/shared'

export type Locale = 'en' | 'de'
export const pickLocale = (l: string | null | undefined): Locale => (l && l.toLowerCase().startsWith('de') ? 'de' : 'en')

export type MailTemplate =
  | { kind: 'verify'; url: string }
  | { kind: 'reset'; url: string }
  | { kind: 'changeEmail'; url: string; newEmail: string }
  | { kind: 'projectInvite'; inviter: string; project: string; role: string; url: string; hasAccount: boolean }
  | { kind: 'orgInvite'; inviter: string; org: string; role: string; url: string }
  | { kind: 'deletionScheduled'; date: string; url: string }
  | { kind: 'exportReady'; date: string; url: string }
  | { kind: 'accountDeleted' }

export interface RenderedMail {
  subject: string
  text: string
  html: string
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

interface Parts {
  subject: string
  lines: string[]
  cta?: { label: string; url: string }
  footer: string
}

const ROLE_DE: Record<string, string> = { editor: 'Bearbeiten', commenter: 'Kommentieren', viewer: 'Ansehen', member: 'Mitglied', admin: 'Admin', owner: 'Inhaber' }
const ROLE_EN: Record<string, string> = { editor: 'can edit', commenter: 'can comment', viewer: 'can view', member: 'member', admin: 'admin', owner: 'owner' }

function parts(t: MailTemplate, l: Locale): Parts {
  const de = l === 'de'
  const footer = de
    ? `Diese E-Mail wurde automatisch von ${BRAND.name} gesendet. Falls du diese Aktion nicht ausgelöst hast, kannst du sie ignorieren.`
    : `This e-mail was sent automatically by ${BRAND.name}. If you did not request this, you can safely ignore it.`
  switch (t.kind) {
    case 'verify':
      return de
        ? { subject: `Bestätige deine E-Mail-Adresse für ${BRAND.name}`, lines: ['Bitte bestätige deine E-Mail-Adresse, um dein Konto zu aktivieren. Der Link ist 24 Stunden gültig.'], cta: { label: 'E-Mail bestätigen', url: t.url }, footer }
        : { subject: `Verify your e-mail for ${BRAND.name}`, lines: ['Please confirm your e-mail address to activate your account. The link is valid for 24 hours.'], cta: { label: 'Verify e-mail', url: t.url }, footer }
    case 'reset':
      return de
        ? { subject: `Passwort zurücksetzen – ${BRAND.name}`, lines: ['Jemand (hoffentlich du) hat angefordert, dein Passwort zurückzusetzen. Der Link ist 1 Stunde gültig.'], cta: { label: 'Neues Passwort festlegen', url: t.url }, footer }
        : { subject: `Reset your ${BRAND.name} password`, lines: ['Someone (hopefully you) asked to reset your password. The link is valid for 1 hour.'], cta: { label: 'Choose a new password', url: t.url }, footer }
    case 'changeEmail':
      return de
        ? { subject: `E-Mail-Adresse ändern – ${BRAND.name}`, lines: [`Es wurde angefordert, die E-Mail-Adresse deines Kontos auf ${t.newEmail} zu ändern. Bestätige die Änderung über den Link (1 Stunde gültig).`], cta: { label: 'Änderung bestätigen', url: t.url }, footer }
        : { subject: `Confirm your new ${BRAND.name} e-mail`, lines: [`A change of your account e-mail to ${t.newEmail} was requested. Confirm it with the link below (valid for 1 hour).`], cta: { label: 'Confirm change', url: t.url }, footer }
    case 'projectInvite': {
      const role = de ? (ROLE_DE[t.role] ?? t.role) : (ROLE_EN[t.role] ?? t.role)
      const extra = t.hasAccount
        ? []
        : [de ? 'Erstelle ein kostenloses Konto mit dieser E-Mail-Adresse, um das Projekt zu öffnen.' : 'Create a free account with this e-mail address to open the project.']
      return de
        ? { subject: `${t.inviter} hat „${t.project}“ mit dir geteilt`, lines: [`${t.inviter} hat das Projekt „${t.project}“ mit dir geteilt (Berechtigung: ${role}).`, ...extra], cta: { label: 'Projekt öffnen', url: t.url }, footer }
        : { subject: `${t.inviter} shared "${t.project}" with you`, lines: [`${t.inviter} shared the project "${t.project}" with you (${role}).`, ...extra], cta: { label: 'Open project', url: t.url }, footer }
    }
    case 'orgInvite': {
      const role = de ? (ROLE_DE[t.role] ?? t.role) : (ROLE_EN[t.role] ?? t.role)
      return de
        ? { subject: `Einladung zur Organisation „${t.org}“`, lines: [`${t.inviter} lädt dich ein, der Organisation „${t.org}“ auf ${BRAND.name} beizutreten (Rolle: ${role}).`], cta: { label: 'Einladung ansehen', url: t.url }, footer }
        : { subject: `You're invited to join "${t.org}"`, lines: [`${t.inviter} invited you to join the organisation "${t.org}" on ${BRAND.name} (role: ${role}).`], cta: { label: 'View invitation', url: t.url }, footer }
    }
    case 'deletionScheduled':
      return de
        ? { subject: `Dein ${BRAND.name}-Konto wird gelöscht`, lines: [`Du hast die Löschung deines Kontos beantragt. Am ${t.date} werden dein Konto und alle deine Projekte endgültig gelöscht.`, 'Bis dahin kannst du die Löschung in den Einstellungen jederzeit widerrufen.'], cta: { label: 'Löschung widerrufen', url: t.url }, footer }
        : { subject: `Your ${BRAND.name} account is scheduled for deletion`, lines: [`You asked us to delete your account. On ${t.date} your account and all your projects will be permanently deleted.`, 'Until then you can cancel the deletion in your settings at any time.'], cta: { label: 'Cancel deletion', url: t.url }, footer }
    case 'exportReady':
      return de
        ? { subject: `Deine Datenkopie wurde erstellt – ${BRAND.name}`, lines: [`Am ${t.date} wurde eine vollständige Kopie deiner Daten (Art. 15/20 DSGVO) erstellt und heruntergeladen.`, 'Warst du das nicht? Ändere sofort dein Passwort und melde alle Sitzungen ab.'], cta: { label: 'Sicherheitseinstellungen', url: t.url }, footer }
        : { subject: `Your ${BRAND.name} data export was created`, lines: [`On ${t.date} a full copy of your data (GDPR Art. 15/20) was generated and downloaded.`, "Wasn't you? Change your password and sign out all sessions right away."], cta: { label: 'Security settings', url: t.url }, footer }
    case 'accountDeleted':
      return de
        ? { subject: `Dein ${BRAND.name}-Konto wurde gelöscht`, lines: ['Dein Konto und alle zugehörigen Daten wurden endgültig gelöscht. Danke, dass du CadSandbox genutzt hast.'], footer }
        : { subject: `Your ${BRAND.name} account was deleted`, lines: ['Your account and all associated data have been permanently deleted. Thank you for using CadSandbox.'], footer }
  }
}

export function renderMail(t: MailTemplate, locale: Locale): RenderedMail {
  const p = parts(t, locale)
  const text = [...p.lines, ...(p.cta ? ['', `${p.cta.label}: ${p.cta.url}`] : []), '', '—', p.footer].join('\n')
  const body = p.lines.map((l) => `<p style="margin:0 0 16px">${esc(l)}</p>`).join('')
  const button = p.cta
    ? `<p style="margin:24px 0"><a href="${esc(p.cta.url)}" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">${esc(p.cta.label)}</a></p><p style="margin:0 0 16px;font-size:12px;color:#555;word-break:break-all">${esc(p.cta.url)}</p>`
    : ''
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(p.subject)}</title></head><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px"><p style="margin:0 0 24px;font-weight:600;font-size:18px">${esc(BRAND.name)}</p>${body}${button}<p style="margin:32px 0 0;font-size:12px;color:#777">${esc(p.footer)}</p></div></body></html>`
  return { subject: p.subject, text, html }
}
