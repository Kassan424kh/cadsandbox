# Betroffenenrechte — procedures (Art. 12–22 GDPR)

**Deadline:** answer within **one month** of receipt (extendable by two months for complex cases —
inform the person within the first month, Art. 12(3)). Free of charge. Log every request (date,
person, right, identity check, outcome, date answered) in the DSR register [location].

**Identity check:** requests from the signed-in account (settings) are authenticated by the session.
E-mail requests must come from the account's address; otherwise ask the person to sign in or to
confirm via a link sent to the account address. Never send data to a different address.

| Right | Self-service (web app / API) | Staff procedure |
|---|---|---|
| **Access / copy (Art. 15)** and **portability (Art. 20)** | Settings → Privacy → *Export my data* (`GET /api/me/export`): ZIP with profile, sessions, orgs, folders, projects (Yjs binary + JSON), versions list, files, collections, tickets, audit entries. A notification e-mail is sent. | If the user cannot sign in: verify identity, sign in as admin, use *view as user* only if the user asks for it in writing, or run the export via a support session; add the Art. 15 information (purposes, recipients, retention, rights, source) from the privacy notice. |
| **Rectification (Art. 16)** | Settings → Profile (`PATCH /api/me`: name, avatar, language); e-mail change via account settings (verified). | Admin panel: verify e-mail; for other corrections update via the user. |
| **Erasure (Art. 17)** | Settings → Privacy → *Delete account* (`DELETE /api/me`, confirm e-mail) → executed after 7 days, cancellable (`POST /api/me/cancel-deletion`). Projects: trash → permanent delete. | Admin panel → user → *Delete* (immediate hard delete, audited). Remind that shared copies made by others (duplicates) belong to them; backups expire within 6 months. |
| **Restriction (Art. 18)** | — | Admin panel → *Ban* with reason "Art. 18 restriction" (blocks processing via login/collab while data is kept); lift with *Unban*. |
| **Objection (Art. 21)** | — | Assess legitimate-interest processing (logs, audit, rate limits); if upheld, delete/anonymise the respective records (e.g. audit entries for the user via DB, documented). |
| **Withdraw consent (Art. 7(3))** | Support tickets → *Revoke support access* (`POST /api/support/tickets/:id/revoke-access`). | Close the ticket (also ends access). |
| **Complaint (Art. 77)** | Point to the supervisory authority named in the privacy notice. | — |

**Organisations (processor role):** requests about data inside an organisation's projects are
forwarded to that organisation (the controller) without delay; we assist per DPA § 7.

**After completion:** confirm to the person in writing; keep the DSR register entry for 3 years
(accountability), without copies of the exported data.
