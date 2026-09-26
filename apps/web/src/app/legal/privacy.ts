// Privacy policy (Art. 13 GDPR) describing CadSandbox's real data flows. Operator data are placeholders.
import { LIMITS } from '@cadsandbox/shared'
import type { LegalSet } from './types'

const TRASH = LIMITS.trashRetentionDays
const GRACE = LIMITS.accountDeletionGraceDays
const AUDIT = LIMITS.auditRetentionDays

export const privacy: LegalSet = {
  de: {
    title: 'Datenschutzerklärung',
    updated: '[PLACEHOLDER: Datum der letzten Änderung]',
    intro:
      'CadSandbox ist „local-first“: Modelle und Zeichnungen werden auf Ihrem Gerät berechnet und gespeichert. Ohne Konto verlassen Ihre Projekte Ihr Gerät nicht. Wir setzen keine Analyse-, Tracking- oder Werbedienste ein und laden keine Inhalte von Dritten (Schriften, Skripte und Programmbibliotheken liefern wir selbst aus).',
    sections: [
      {
        heading: '1. Verantwortlicher',
        body: [
          '[PLACEHOLDER: Firmenname, Anschrift, E-Mail, Telefon — wie im Impressum]',
          'Datenschutzbeauftragte/r: [PLACEHOLDER: Name und Kontakt, sofern benannt; sonst Abschnitt entfernen]',
        ],
      },
      {
        heading: '2. Hosting und Server-Protokolle',
        body: [
          'Unsere Server stehen in der Europäischen Union bei [PLACEHOLDER: Hosting-Anbieter, Standort]. Mit dem Anbieter besteht ein Auftragsverarbeitungsvertrag nach Art. 28 DSGVO.',
          'Zur Wiederherstellbarkeit erstellen wir täglich verschlüsselte Sicherungen der Datenbank und der gespeicherten Dateien bei einem zweiten Anbieter in der EU ([PLACEHOLDER: Backup-Anbieter, Standort]; Auftragsverarbeitungsvertrag nach Art. 28 DSGVO). Die Sicherungen sind nur mit unserem Schlüssel lesbar und werden gestaffelt bis zu 6 Monate aufbewahrt (7 tägliche, 4 wöchentliche, 6 monatliche Sicherungen); gelöschte Daten verschwinden spätestens mit Ablauf dieser Frist auch aus den Sicherungen. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO.',
          'Beim Aufruf verarbeitet der Server technisch notwendige Daten: gekürzte IP-Adresse, Zeitpunkt, angefragte Adresse, Statuscode und Browserkennung. Zweck: sicherer und stabiler Betrieb, Abwehr von Angriffen. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO. Speicherdauer: [PLACEHOLDER: 14] Tage.',
          'Tritt ein technischer Fehler auf, erfassen wir Fehlermeldung, Programmstelle (Stacktrace), aufgerufene Seite und Browserkennung in einem selbst betriebenen Fehlerverfolgungssystem auf unseren Servern — ohne Inhalte Ihrer Projekte und ohne Weitergabe an Dritte. Zweck: Fehler finden und beheben. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO. Speicherdauer: 90 Tage.',
        ],
      },
      {
        heading: '3. Nutzung ohne Konto (Speicherung auf Ihrem Gerät)',
        body: [
          'Lokale Projekte, Dateien, Versionen und Ihre Einstellungen (Design, Sprache, Einheiten) werden ausschließlich im Speicher Ihres Browsers (IndexedDB, localStorage, Cache) abgelegt. Für die farbliche Unterscheidung bei gemeinsamer Bearbeitung erzeugen wir eine zufällige Gast-Kennung, die ebenfalls nur lokal liegt.',
          'Diese Speicherung ist für den von Ihnen gewünschten Dienst unbedingt erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG; Art. 6 Abs. 1 lit. b DSGVO). Sie können die Daten jederzeit über die Einstellungen Ihres Browsers löschen.',
        ],
      },
      {
        heading: '4. Konto',
        body: [
          'Bei der Registrierung verarbeiten wir Name, E-Mail-Adresse und Passwort (nur als gesalzener Hash gespeichert), optional ein Profilbild, Ihre Sprache sowie — falls aktiviert — das Geheimnis für die Zwei-Faktor-Authentifizierung und die öffentlichen Schlüssel Ihrer Passkeys.',
          `Zweck: Bereitstellung des Kontos, Anmeldung, Synchronisation und Zusammenarbeit. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO. Speicherdauer: bis zur Löschung des Kontos; nach Ihrem Löschauftrag gilt eine Wartefrist von ${GRACE} Tagen, danach werden die Daten endgültig gelöscht.`,
        ],
      },
      {
        heading: '5. Cookies',
        body: [
          'Wir verwenden ausschließlich ein technisch notwendiges Sitzungs-Cookie (HttpOnly, Secure, SameSite=Lax), das erst bei der Anmeldung gesetzt wird und eine zufällige Sitzungskennung enthält. Es ist für den Dienst unbedingt erforderlich; eine Einwilligung ist nicht nötig (§ 25 Abs. 2 Nr. 2 TDDDG). Es wird bei Abmeldung bzw. nach [PLACEHOLDER: 30] Tagen Inaktivität ungültig.',
          'Es gibt keine Analyse-, Marketing- oder Drittanbieter-Cookies.',
        ],
      },
      {
        heading: '6. Projekte, Synchronisation und Zusammenarbeit',
        body: [
          'Wenn Sie ein Projekt mit Ihrem Konto synchronisieren, speichern wir Projektdokumente, hochgeladene Dateien, Vorschaubilder, Versionen und Kommentare auf unseren Servern. Eine Kopie bleibt für die Offline-Nutzung auf Ihrem Gerät und wird bei der Abmeldung entfernt.',
          'Inhalte sind nur für Sie sichtbar, bis Sie sie teilen: mit eingeladenen Personen, Organisationen, Inhabern eines Freigabelinks oder — wenn Sie das Projekt öffentlich machen — für alle. Während der gemeinsamen Bearbeitung sehen Mitwirkende Ihren Namen, Ihre Farbe, Cursor und Auswahl; diese Anwesenheitsdaten werden nicht gespeichert.',
          `Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO. Speicherdauer: bis Sie die Inhalte löschen; Projekte im Papierkorb werden nach ${TRASH} Tagen endgültig gelöscht.`,
        ],
      },
      {
        heading: '7. Organisationen',
        body: ['Wenn Sie einer Organisation angehören, sehen deren Mitglieder Ihren Namen, Ihre E-Mail-Adresse und Ihre Rolle; Administratoren der Organisation können Mitglieder verwalten. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.'],
      },
      {
        heading: '8. E-Mails',
        body: [
          'Wir versenden ausschließlich dienstbezogene E-Mails (Bestätigung der Adresse, Passwort-Zurücksetzung, Einladungen, Sicherheitshinweise, Antworten des Supports) über Google Workspace (Gmail) der Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland, als Auftragsverarbeiter (Art. 28 DSGVO). Dabei werden Ihre E-Mail-Adresse, Ihr Name und der Inhalt der Nachricht (z. B. Bestätigungslinks) verarbeitet. Eine Verarbeitung durch die Google LLC in den USA ist möglich; sie erfolgt auf Grundlage des Angemessenheitsbeschlusses zum EU-US Data Privacy Framework (Art. 45 DSGVO), nach dem Google LLC zertifiziert ist, ergänzend auf Grundlage der EU-Standardvertragsklauseln (Art. 46 Abs. 2 lit. c DSGVO). Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO. Newsletter versenden wir nur mit Ihrer Einwilligung.',
        ],
      },
      {
        heading: '9. Support und Zugriff auf Projekte',
        body: [
          'Support-Anfragen (Betreff, Nachrichten, E-Mail-Adresse) verarbeiten wir zur Bearbeitung Ihres Anliegens (Art. 6 Abs. 1 lit. b DSGVO).',
          'Unsere Mitarbeitenden können Projektinhalte grundsätzlich nicht einsehen. Nur wenn Sie in einer Anfrage ausdrücklich zustimmen, dürfen sie ein einzelnes Projekt für einen von Ihnen gewählten Zeitraum ausschließlich lesend öffnen (Art. 6 Abs. 1 lit. a DSGVO). Sie können diese Einwilligung jederzeit auf der Support-Seite widerrufen; jeder Zugriff wird protokolliert.',
          'Zur Lösung von Supportfällen können Administratoren in Ausnahmefällen die Ansicht eines Kontos übernehmen („Impersonation“). Dies wird protokolliert und ist während der gesamten Dauer deutlich gekennzeichnet (Art. 6 Abs. 1 lit. f DSGVO).',
        ],
      },
      {
        heading: '10. Sicherheits- und Audit-Protokoll',
        body: [
          `Anmeldungen, sicherheitsrelevante Änderungen und alle privilegierten Aktionen werden mit gekürzter IP-Adresse protokolliert, um Konten zu schützen und Missbrauch aufzuklären (Art. 6 Abs. 1 lit. f DSGVO). Speicherdauer: ${AUDIT} Tage.`,
        ],
      },
      {
        heading: '11. Empfänger und Drittlandübermittlung',
        body: [
          'Empfänger sind ausschließlich unsere Auftragsverarbeiter für Hosting und E-Mail-Versand (Google Ireland Limited, siehe Abschnitt 8) sowie Personen, mit denen Sie Inhalte teilen. Wir verkaufen keine Daten.',
          'Hosting und Speicherung erfolgen ausschließlich in der EU/im EWR. Eine Übermittlung in ein Drittland (USA) ist nur beim E-Mail-Versand über Google möglich; sie ist durch den Angemessenheitsbeschluss zum EU-US Data Privacy Framework (Art. 45 DSGVO) sowie die EU-Standardvertragsklauseln (Art. 46 Abs. 2 lit. c DSGVO) abgesichert.',
        ],
      },
      {
        heading: '12. Ihre Rechte',
        body: [
          {
            list: [
              'Auskunft (Art. 15 DSGVO) — den vollständigen Datenexport erhalten Sie jederzeit im Datenschutz-Center.',
              'Berichtigung (Art. 16 DSGVO).',
              'Löschung (Art. 17 DSGVO) — direkt im Datenschutz-Center.',
              'Einschränkung der Verarbeitung (Art. 18 DSGVO).',
              'Datenübertragbarkeit (Art. 20 DSGVO) — der Export erfolgt in offenen, maschinenlesbaren Formaten.',
              'Widerspruch gegen Verarbeitungen auf Grundlage berechtigter Interessen (Art. 21 DSGVO).',
              'Widerruf erteilter Einwilligungen mit Wirkung für die Zukunft (Art. 7 Abs. 3 DSGVO).',
            ],
          },
          'Sie haben das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren (Art. 77 DSGVO). Zuständig ist: [PLACEHOLDER: zuständige Aufsichtsbehörde, z. B. Landesbeauftragte/r für Datenschutz des Sitzlandes, mit Anschrift].',
          'Kontakt für Datenschutzanfragen: [PLACEHOLDER: datenschutz@example.com]',
        ],
      },
      {
        heading: '13. Keine automatisierten Entscheidungen',
        body: ['Wir treffen keine automatisierten Einzelentscheidungen und betreiben kein Profiling (Art. 22 DSGVO).'],
      },
      {
        heading: '14. Änderungen',
        body: ['Wir passen diese Erklärung an, wenn sich unser Dienst oder die Rechtslage ändert. Über wesentliche Änderungen informieren wir angemeldete Nutzerinnen und Nutzer vorab.'],
      },
    ],
  },
  en: {
    title: 'Privacy policy',
    updated: '[PLACEHOLDER: date of last change]',
    intro:
      'CadSandbox is local-first: models and drawings are computed and stored on your device. Without an account, your projects never leave it. We use no analytics, tracking or advertising services and load nothing from third parties (fonts, scripts and libraries are served by us).',
    sections: [
      {
        heading: '1. Controller',
        body: ['[PLACEHOLDER: company name, address, email, phone — as in the imprint]', 'Data protection officer: [PLACEHOLDER: name and contact if appointed; otherwise remove]'],
      },
      {
        heading: '2. Hosting and server logs',
        body: [
          'Our servers are located in the European Union at [PLACEHOLDER: hosting provider, location]. A data processing agreement under Art. 28 GDPR is in place.',
          'To be able to recover from failures we create daily encrypted backups of the database and the stored files with a second provider in the EU ([PLACEHOLDER: backup provider, location]; data processing agreement under Art. 28 GDPR). The backups can only be read with our key and are kept on a rolling schedule for up to 6 months (7 daily, 4 weekly, 6 monthly backups); deleted data disappears from the backups when that period ends at the latest. Legal basis: Art. 6(1)(f) GDPR.',
          'When you use the service, the server processes technically necessary data: shortened IP address, time, requested address, status code and browser identifier — to operate the service securely and fend off attacks. Legal basis: Art. 6(1)(f) GDPR. Retention: [PLACEHOLDER: 14] days.',
          'When a technical error occurs we record the error message, the code location (stack trace), the page and the browser identifier in an error tracker we run ourselves on our servers — without the content of your projects and without passing it to third parties. Purpose: finding and fixing bugs. Legal basis: Art. 6(1)(f) GDPR. Retention: 90 days.',
        ],
      },
      {
        heading: '3. Using CadSandbox without an account (storage on your device)',
        body: [
          'Local projects, files, versions and your preferences (theme, language, units) are stored only in your browser (IndexedDB, localStorage, cache). For colour-coding during collaboration we create a random guest identifier, which also stays on your device.',
          'This storage is strictly necessary for the service you request (§ 25(2) no. 2 TDDDG; Art. 6(1)(b) GDPR). You can delete it at any time in your browser settings.',
        ],
      },
      {
        heading: '4. Account',
        body: [
          'When you sign up we process your name, email address and password (stored only as a salted hash), optionally a profile picture, your language and — if enabled — your two-factor secret and the public keys of your passkeys.',
          `Purpose: providing your account, sign-in, sync and collaboration. Legal basis: Art. 6(1)(b) GDPR. Retention: until you delete your account; after a deletion request there is a ${GRACE}-day grace period, after which the data are permanently erased.`,
        ],
      },
      {
        heading: '5. Cookies',
        body: [
          'We use exactly one strictly necessary session cookie (HttpOnly, Secure, SameSite=Lax). It is set only when you sign in and contains a random session identifier. No consent is required (§ 25(2) no. 2 TDDDG). It becomes invalid when you sign out or after [PLACEHOLDER: 30] days of inactivity.',
          'There are no analytics, marketing or third-party cookies.',
        ],
      },
      {
        heading: '6. Projects, sync and collaboration',
        body: [
          'When you sync a project with your account, we store project documents, uploaded files, thumbnails, versions and comments on our servers. A copy stays on your device for offline use and is removed when you sign out.',
          'Content is visible only to you until you share it: with invited people, organisations, holders of a share link or — if you make it public — everyone. While collaborating, others see your name, colour, cursor and selection; this presence information is not stored.',
          `Legal basis: Art. 6(1)(b) GDPR. Retention: until you delete the content; projects in the trash are permanently deleted after ${TRASH} days.`,
        ],
      },
      {
        heading: '7. Organisations',
        body: ['If you belong to an organisation, its members see your name, email address and role; the organisation’s admins can manage members. Legal basis: Art. 6(1)(b) GDPR.'],
      },
      {
        heading: '8. Emails',
        body: [
          'We only send service emails (address confirmation, password reset, invitations, security notices, support replies) through Google Workspace (Gmail) provided by Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Ireland, acting as our processor (Art. 28 GDPR). This involves your email address, your name and the message content (e.g. confirmation links). Processing by Google LLC in the USA may occur; it is based on the EU-US Data Privacy Framework adequacy decision (Art. 45 GDPR), under which Google LLC is certified, supplemented by the EU Standard Contractual Clauses (Art. 46(2)(c) GDPR). Legal basis: Art. 6(1)(b) GDPR. Newsletters are sent only with your consent.',
        ],
      },
      {
        heading: '9. Support and access to projects',
        body: [
          'We process support requests (subject, messages, email address) to handle your request (Art. 6(1)(b) GDPR).',
          'Our staff cannot see project content. Only if you explicitly agree in a request may they open one project, read-only, for the period you choose (Art. 6(1)(a) GDPR). You can withdraw this consent at any time on the Support page; every access is logged.',
          'To resolve support cases, administrators may in exceptional cases view the service as a specific user (“impersonation”). This is logged and clearly indicated for its entire duration (Art. 6(1)(f) GDPR).',
        ],
      },
      {
        heading: '10. Security and audit log',
        body: [
          `Sign-ins, security-relevant changes and all privileged actions are logged with shortened IP addresses to protect accounts and investigate abuse (Art. 6(1)(f) GDPR). Retention: ${AUDIT} days.`,
        ],
      },
      {
        heading: '11. Recipients and international transfers',
        body: [
          'Recipients are only our processors for hosting and email delivery (Google Ireland Limited, see section 8) and the people you share content with. We do not sell data.',
          'Hosting and storage take place exclusively in the EU/EEA. A transfer to a third country (USA) can only occur for email delivery via Google; it is safeguarded by the EU-US Data Privacy Framework adequacy decision (Art. 45 GDPR) and the EU Standard Contractual Clauses (Art. 46(2)(c) GDPR).',
        ],
      },
      {
        heading: '12. Your rights',
        body: [
          {
            list: [
              'Access (Art. 15 GDPR) — download a complete export at any time in the privacy center.',
              'Rectification (Art. 16 GDPR).',
              'Erasure (Art. 17 GDPR) — directly in the privacy center.',
              'Restriction of processing (Art. 18 GDPR).',
              'Data portability (Art. 20 GDPR) — exports use open, machine-readable formats.',
              'Objection to processing based on legitimate interests (Art. 21 GDPR).',
              'Withdrawal of consent with effect for the future (Art. 7(3) GDPR).',
            ],
          },
          'You have the right to lodge a complaint with a data protection supervisory authority (Art. 77 GDPR). The competent authority is: [PLACEHOLDER: competent supervisory authority with address].',
          'Contact for privacy requests: [PLACEHOLDER: privacy@example.com]',
        ],
      },
      { heading: '13. No automated decisions', body: ['We do not make automated individual decisions or carry out profiling (Art. 22 GDPR).'] },
      { heading: '14. Changes', body: ['We update this policy when our service or the law changes and inform signed-in users of material changes in advance.'] },
    ],
  },
}
