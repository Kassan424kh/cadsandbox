# Privacy notice — [Product name, e.g. CadSandbox]

*Last updated: [date]. Template — replace placeholders and have it legally reviewed. The German
version prevails where required.*

## 1. Controller

[Company], [address], [e-mail], [phone]. Represented by: [name].
Data protection officer: [name, contact] (if appointed).

## 2. Overview

CadSandbox is a browser-based CAD and architecture tool. Modelling and rendering run on your
device. Without an account your projects stay in your browser and are never sent to us. With an
account we store and sync projects on servers in the EU ([host, location]). We use no tracking or
analytics, load no third-party content (fonts, scripts etc. are served by us) and set only one
strictly necessary session cookie.

## 3. What we process and why

**a) Using the app / server logs.** Technically necessary request data (time, URL, status,
browser type). Our reverse proxy does not log IP addresses; application logs contain only a
non-reversible hash that changes daily. Logs are rotated after a few days. Legal basis: Art. 6(1)(f)
GDPR (secure operation). When technical errors occur we record the error message, stack trace, page
and browser identifier in an error tracker we run ourselves (GlitchTip) on our servers, without project
content; retention 90 days, legal basis Art. 6(1)(f) GDPR (fixing bugs).

**b) Your account.** Name, e-mail, password (stored only as a scrypt hash), optional avatar,
language, two-factor data (TOTP secret, backup codes) and passkeys (public key). Per session we
keep timestamps, a truncated IP address (e.g. 203.0.113.0) and the browser's user agent so you can
review and end sessions. Legal basis: Art. 6(1)(b) GDPR (contract). Retention: until the account
is deleted; sessions at most 30 days after last use.

**c) Projects and collaboration.** Project content (models, drawings, comments, versions),
uploaded files, folders, collections and sharing settings (members, share links, organisations).
Collaborators see your name, colour, selection and cursor while you work together. Share links are
stored only as a hash. Legal basis: Art. 6(1)(b). Deleted projects stay in the trash for 30 days,
then they are permanently removed.

**d) Invitations.** When you invite someone by e-mail we process that address to send the
invitation and to link the share once they register (Art. 6(1)(f)); project invitations expire
after 30 days, organisation invitations after 7 days.

**e) Organisations.** Name, members and roles. For business organisations we process project
data as a processor under a data processing agreement.

**f) Support.** The content of your requests and our replies. Support staff can see project
content **only** if you grant time-limited read access (1–30 days) to a specific project in a
ticket; you can revoke it at any time and every access is logged. Legal basis: Art. 6(1)(b), for
project access Art. 6(1)(a) (consent, revocable at any time).

**g) Security and abuse prevention.** We log security-relevant events (sign-ins incl. failed
attempts, password/2FA changes, sharing, deletions, administrator actions) with a truncated IP
address for 365 days and rate-limit requests per (hashed) IP and account. Legal basis: Art. 6(1)(f)
and Art. 32 GDPR.

**h) E-mails.** Only transactional e-mails (verification, password reset, invitations, data export
and account deletion notices) via Google Workspace (Gmail) provided by Google Ireland Limited, Gordon House,
Barrow Street, Dublin 4, Ireland, acting as our processor (Art. 28 GDPR). This involves your e-mail address, name
and the message content (e.g. confirmation links). Processing by Google LLC in the USA may occur; it relies on the
EU-US Data Privacy Framework adequacy decision (Art. 45 GDPR), under which Google LLC is certified, supplemented
by EU Standard Contractual Clauses (Art. 46(2)(c) GDPR). Legal basis: Art. 6(1)(b) GDPR. No newsletters, no open
or click tracking.

**i) Backups.** We create daily encrypted backups of the database and the stored files with a second
provider in the EU (section 4). The backups can only be read with our key and are kept on a rolling
schedule (7 daily, 4 weekly, 6 monthly backups), i.e. for up to 6 months; deleted data disappears from
the backups when that period ends at the latest. Legal basis: Art. 6(1)(f) GDPR (security and
recoverability, Art. 32 GDPR).

## 4. Recipients

Hosting: [host] · object storage: [provider] · e-mail delivery: Google Ireland Limited (Google Workspace, see
3 h) · backup storage: [provider]. All are processors. Hosting and storage take place exclusively in the EU. A
transfer to a third country (USA) can only occur for e-mail delivery via Google; it is safeguarded by the EU-US
Data Privacy Framework adequacy decision (Art. 45 GDPR) and EU Standard Contractual Clauses (Art. 46(2)(c) GDPR). People you share
projects with see the shared content and your name.

## 5. Cookies

Only the session cookie `__Secure-csb.session_token` (HttpOnly, Secure, SameSite=Lax, 30 days,
renewed on use), a short-lived verification cookie during two-factor sign-in and, for
administrators while viewing as a user, a technical helper cookie. All of them are strictly
necessary; no consent is required. Local project data is kept in your browser's IndexedDB.

## 6. Your rights

Access (Art. 15), rectification (16), erasure (17), restriction (18), portability (20), objection
(21), withdrawal of consent (7(3)). In the settings you can **export all your data as a ZIP** and
**delete your account** (executed after 7 days, cancellable until then). You may lodge a complaint
with a supervisory authority, e.g. [competent authority].

## 7. Obligation to provide data

An account requires e-mail, name and password. You can use CadSandbox locally without an account.
There is no automated decision-making.
