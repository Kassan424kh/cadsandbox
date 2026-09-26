// Throwaway e-mail providers refused at sign-up and e-mail change: accounts must be reachable for
// security notices, and free storage should not be farmed with disposable identities.
// Extend with BLOCKED_EMAIL_DOMAINS; subdomains of listed domains are refused too.
const DISPOSABLE = new Set([
  '10minutemail.com', '10minutemail.net', '10minutemail.co.uk', '20minutemail.com',
  'anonbox.net', 'burnermail.io', 'byom.de', 'deadaddress.com', 'discard.email', 'dispostable.com',
  'dodgit.com', 'dropmail.me', 'emailfake.com', 'emailondeck.com', 'eyepaste.com', 'fakeinbox.com',
  'fakemail.net', 'filzmail.com', 'generator.email', 'getairmail.com', 'getnada.com', 'grr.la',
  'guerrillamail.biz', 'guerrillamail.com', 'guerrillamail.de', 'guerrillamail.info', 'guerrillamail.net',
  'guerrillamail.org', 'guerrillamailblock.com', 'harakirimail.com', 'inboxkitten.com', 'incognitomail.org',
  'jetable.org', 'mailcatch.com', 'maildrop.cc', 'mailexpire.com', 'mailforspam.com', 'mailinator.com',
  'mailnesia.com', 'mailpoof.com', 'meltmail.com', 'mintemail.com', 'moakt.com', 'mohmal.com',
  'mytemp.email', 'pokemail.net', 'sharklasers.com', 'sofort-mail.de', 'spam4.me', 'spambog.com',
  'spambog.de', 'spamfree24.org', 'spamgourmet.com', 'temp-mail.io', 'temp-mail.org', 'tempail.com',
  'tempinbox.com', 'tempmailo.com', 'tempomail.fr', 'tempr.email', 'throwawaymail.com', 'trash-mail.com',
  'trashmail.com', 'trashmail.de', 'trashmail.me', 'trashmail.net', 'wegwerfemail.de', 'wegwerfmail.de',
  'wegwerfmail.net', 'yopmail.com', 'yopmail.fr', 'yopmail.net', '1secmail.com', '1secmail.net', '1secmail.org',
])

export function isBlockedEmail(email: string, extra: readonly string[] = []): boolean {
  const domain = email.trim().toLowerCase().split('@')[1] ?? ''
  if (!domain) return false
  const parts = domain.split('.')
  for (let i = 0; i < parts.length - 1; i++) {
    const d = parts.slice(i).join('.')
    if (DISPOSABLE.has(d) || extra.includes(d)) return true
  }
  return false
}
