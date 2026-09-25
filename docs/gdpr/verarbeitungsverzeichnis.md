# Verzeichnis von Verarbeitungstätigkeiten (Art. 30 DSGVO)

*Vorlage passend zur Implementierung in `apps/server`. Stand: [Datum], Version [x].*

**Verantwortlicher:** [Firma, Anschrift, Vertretung] · **Datenschutzbeauftragte/r:** [Name, Kontakt]
**Allgemeine TOMs:** siehe [toms.md](toms.md) · **Löschfristen:** siehe [retention.md](retention.md)
**Drittlandübermittlung:** nur beim E-Mail-Versand über Google Workspace (Unterauftragsverarbeiter Google LLC, USA) — Angemessenheitsbeschluss EU-US Data Privacy Framework (Art. 45 DSGVO) + EU-Standardvertragsklauseln (Art. 46 Abs. 2 lit. c DSGVO); Hosting, Speicher und Backups ausschließlich in der EU

## Teil A — als Verantwortlicher (Art. 30 Abs. 1)

| Nr. | Verarbeitung | Zweck | Rechtsgrundlage | Betroffene | Datenkategorien | Empfänger | Löschung |
|---|---|---|---|---|---|---|---|
| 1 | Bereitstellung der Web-App, Server-/Proxy-Protokolle | sicherer, stabiler Betrieb, Fehleranalyse | Art. 6 (1) f | Besucher, Nutzer | Zeitpunkt, URL (ohne Tokens), Status, User-Agent, IP nur als täglich gesalzener Hash (App) bzw. gar nicht (Proxy), Request-ID, Nutzer-ID | Hoster | Log-Rotation (5 × 10 MB je Dienst, i. d. R. wenige Tage) |
| 2 | Benutzerkonto & Authentifizierung | Vertragserfüllung, Zugangsschutz | Art. 6 (1) b | Nutzer | Name, E-Mail, Passwort-Hash (scrypt), Profilbild, Sprache, Rolle, 2FA-Geheimnis/Backup-Codes, Passkey-Public-Keys, Sitzungen (Zeitpunkte, gekürzte IP, User-Agent) | Hoster, E-Mail-Dienst | Konto: bei Löschung (7 Tage Karenz); Sitzungen: Ablauf 30 Tage; Tokens: Ablauf (1–24 h) |
| 3 | Projekte, Dateien, Zusammenarbeit, Versionen, Kommentare | Kernleistung (Speichern, Teilen, gemeinsames Bearbeiten) | Art. 6 (1) b | Nutzer, in Projekten genannte Personen | Projektinhalte (Yjs-Dokumente), Dateien (sha256-adressiert), Metadaten, Kommentare mit Autor, Präsenzdaten (flüchtig) | Hoster, Objektspeicher, Mitwirkende | Papierkorb 30 Tage; automatische Versionen: letzte 50 je Dokument; Löschung mit Konto |
| 4 | Freigaben & Einladungen | Zusammenarbeit ermöglichen | Art. 6 (1) b / f (Eingeladene) | Nutzer, eingeladene Dritte | E-Mail der Eingeladenen, Rolle, Einladender; Freigabelinks nur als Hash, optional Passwort-Hash, Ablaufdatum, Nutzungszähler | E-Mail-Dienst | Projekteinladungen 30 Tage; Org-Einladungen 7 Tage (+90 Tage Protokoll); Links bei Ablauf/Löschung |
| 5 | Organisationen | Team-Arbeitsbereiche | Art. 6 (1) b | Mitglieder | Name/Slug/Logo, Mitgliedschaften, Rollen | — | bei Löschung der Organisation/des Kontos |
| 6 | Support & Support-Zugriff | Anfragen bearbeiten | Art. 6 (1) b; Projektzugriff Art. 6 (1) a | Nutzer, Support-Personal | Tickets, Nachrichten, Projektbezug, Zugriffsfreigaben (Zeitraum, Widerruf) | Support-Personal (intern) | mit Konto; Freigaben enden automatisch, Datensatz 90 Tage nach Ablauf gelöscht |
| 7 | Sicherheits-Audit-Log | Nachvollziehbarkeit, Missbrauchs- und Angriffserkennung (Art. 32) | Art. 6 (1) f | Nutzer, Admins | Aktion, Akteur-ID/E-Mail, Ziel, Metadaten, gekürzte IP (/24, /48) | — | 365 Tage; bei Kontolöschung anonymisiert |
| 8 | Missbrauchsschutz (Rate Limiting) | Schutz vor Überlastung/Brute-Force | Art. 6 (1) f | alle | Zähler je gehashter IP bzw. Nutzer-ID (nur im Arbeitsspeicher) | — | Zeitfenster (≤ 1 h), Neustart |
| 9 | Transaktionale E-Mails | Bestätigung, Passwort-Reset, Einladungen, Hinweise (Export, Löschung) | Art. 6 (1) b / f | Nutzer, Eingeladene | E-Mail-Adresse, Name, Link/Token | Google Ireland Ltd. (Google Workspace/Gmail; Unterauftragsverarbeiter Google LLC, USA) | Kopien im Postausgang des Absenderkontos bis zur Löschung durch den Betreiber (regelmäßig löschen, siehe subprocessors.md) |
| 10 | Datensicherung | Wiederherstellbarkeit (Art. 32 (1) c) | Art. 6 (1) f | alle | Datenbank-Dump, Dateien (verschlüsselt) | Backup-Speicher | 7 täglich / 4 wöchentlich / 6 monatlich |
| 11 | Betroffenenrechte | Auskunft, Export, Löschung | Art. 6 (1) c i. V. m. Art. 15–20 | Nutzer | Export-ZIP (on the fly erzeugt, nicht gespeichert), Löschanträge | — | Löschantrag bis Ausführung |
| 12 | Administration & Moderation | Sperrungen, Rollen, Ankündigungen, Nutzeransicht (Impersonation, max. 1 h; nur Metadaten, Inhalte nur mit Support-Freigabe der Person, lesend) | Art. 6 (1) b / f | Nutzer, Admins | Sperrgrund/-dauer, Rollen, Admin-Aktionen (Audit) | — | mit Konto bzw. Audit-Frist |

## Teil B — als Auftragsverarbeiter (Art. 30 Abs. 2)

| Feld | Inhalt |
|---|---|
| Auftraggeber | Organisationen, die CadSandbox geschäftlich nutzen und einen AVV abgeschlossen haben (Liste: [Ablage]) |
| Kategorien der Verarbeitung | Speicherung, Synchronisation, Versionierung, Bereitstellung und Löschung von Projektdaten und Dateien der Organisation |
| Unterauftragsverarbeiter | siehe [subprocessors.md](subprocessors.md) |
| Drittländer | keine |
| TOMs | siehe [toms.md](toms.md) |
