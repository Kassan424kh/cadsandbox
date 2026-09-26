# Technische und organisatorische Maßnahmen (Art. 32 DSGVO)

*Stand: [Datum]. Beschreibt die in CadSandbox implementierten Maßnahmen plus die organisatorischen
Pflichten des Betreibers ([Betreiber]). Organisatorische Punkte mit „☐" vor Go-live bestätigen.*

## 1. Vertraulichkeit (Art. 32 Abs. 1 lit. b)

**Zutrittskontrolle** — Rechenzentren des Hosters in der EU mit Zutrittskontrolle, Videoüberwachung,
ISO 27001 (Nachweis: [Zertifikat]). Keine eigenen Serverräume. ☐ Nachweis abgelegt.

**Zugangskontrolle (Systeme)**
- SSH nur mit Schlüsseln, kein Root-Login, Firewall (nur 80/443 + SSH), automatische Sicherheitsupdates.
- Datenbank nur im internen Docker-Netz erreichbar; Container ohne Root, schreibgeschütztes
  Dateisystem, alle Linux-Capabilities entzogen, `no-new-privileges`.
- Anwendung: Passwörter ≥ 10 Zeichen (scrypt-Hash), Rate Limits und Kontosperre bei 2FA-Fehlversuchen,
  Zwei-Faktor (TOTP + Backup-Codes), Passkeys (WebAuthn), E-Mail-Verifizierung, Sitzungs-Cookies
  HttpOnly/Secure/SameSite=Lax, sofortiger Widerruf (Sitzungsprüfung gegen die Datenbank).
- ☐ 2FA/Passkey für alle Admin- und Support-Konten verpflichtend.

**Zugriffskontrolle (Daten)**
- Rollenmodell je Projekt (Eigentümer/Bearbeiten/Kommentieren/Ansehen) und Systemrollen
  (Nutzer/Support/Admin); zentrale Rechteprüfung für API und WebSocket; fremde private Projekte
  sind nicht auffindbar (HTTP 404).
- Support sieht Projektinhalte nur mit zeitlich begrenzter, widerrufbarer Freigabe des Nutzers,
  nur lesend; jeder Zugriff wird protokolliert. Nutzeransicht (Impersonation) nur für Admins,
  max. 1 Stunde, protokolliert, ohne Zugriff auf Export/Löschung/Passwort/2FA/Passkeys/Sitzungen
  und ohne Freigabeänderungen (Mitglieder, Links, Sichtbarkeit, Organisationen).
- Impersonation umgeht die Inhaltsregel nicht: sichtbar sind nur Metadaten (Projektlisten,
  Einstellungen); Projektinhalte (Dokumente, Dateien, Versionen, Vorschaubilder, Kommentare,
  Bibliothek) nur mit aktiver Support-Freigabe der betroffenen Person für genau dieses Projekt und
  nur lesend. Jeder Inhaltszugriff während der Impersonation wird einzeln im Audit-Log erfasst
  (`admin.impersonate.content`), abgelehnte Versuche ebenfalls; zwischengespeicherte Cloud-Daten
  werden beim Wechsel der angemeldeten Identität vom Gerät gelöscht.
- Freigabelinks: 256-Bit-Zufall, nur Hash gespeichert, optional Passwort und Ablauf.

**Trennungskontrolle** — Mandantentrennung logisch über Eigentümer-/Organisations-IDs; jede
Abfrage filtert nach der effektiven Rolle. Entwicklungs-/Testsysteme nutzen keine Produktivdaten.

**Pseudonymisierung & Verschlüsselung (Art. 32 Abs. 1 lit. a)**
- TLS 1.2+ (Caddy, HSTS mit Preload), SMTP mit STARTTLS-Pflicht, Postgres-TLS optional.
- Ruhende Daten: AES-256-GCM für Dateien, Kollaborationsdokumente und Versionen (Schlüssel je Objekt
  via HKDF, Bindung an Objekt-ID); Backups clientseitig verschlüsselt (Datenbank: restic, AES-256;
  Dateien: rclone-crypt, XSalsa20-Poly1305, auch Objektnamen) — der Backup-Anbieter sieht nur Chiffrat,
  die Schlüssel liegen ausschließlich beim Betreiber (Offline-Kopie ☐).
- IP-Adressen: gekürzt gespeichert, in Logs nur als täglich wechselnder HMAC; Proxy-Logs ohne IP.

## 2. Integrität (Art. 32 Abs. 1 lit. b)

**Weitergabekontrolle** — ausschließlich verschlüsselte Übertragung; Uploads werden per sha256
verifiziert; Downloads mit sicheren Headern (nosniff, Sandbox-CSP, Attachment für aktive Inhalte);
strikte Content-Security-Policy, keine Drittanbieter-Ressourcen, CSRF-Schutz (Origin-Prüfung +
SameSite), WebSocket-Origin-Prüfung.

**Eingabekontrolle** — Audit-Log (365 Tage) für Anmeldungen, Konto- und Sicherheitsänderungen,
Freigaben, Löschungen, Wiederherstellungen, Admin- und Support-Aktionen inkl. Nutzeransichten;
Versionshistorie der Projektdokumente (benannte + stündliche Auto-Versionen).

## 3. Verfügbarkeit und Belastbarkeit (Art. 32 Abs. 1 lit. b, c)

- Tägliche verschlüsselte Offsite-Backups (Datenbank-Dump + Dateien) bei einem zweiten EU-Anbieter mit
  separatem Konto (Dienst `backup` in `docker-compose.dokploy.yml`); Aufbewahrung 7 täglich / 4 wöchentlich /
  6 monatlich, gelöschte Dateien bleiben höchstens 190 Tage in der Spiegelkopie; wöchentliche
  Integritätsprüfung (`restic check`). Ein fehlgeschlagenes Backup wird protokolliert, macht den
  Container „unhealthy" und meldet sich per Heartbeat (Alarm, wenn 26 h keine erfolgreiche Sicherung
  vorliegt) ☐ Monitor eingerichtet. Vierteljährlicher Wiederherstellungstest nach
  `apps/server/deploy/BACKUP-RESTORE.md` (Datenbank in leere Datenbank, Dateien in Test-Bucket,
  Zeilenzahlen und sha256-Stichproben) ☐ letzter Test: [Datum].
- Health-Checks, automatischer Neustart der Container, Datenbank mit Prüfsummen; Deployments ohne
  Unterbrechung (Standby-Container, Traefik-Health-Routing).
- Schutz vor Überlast: Rate Limits je IP/Nutzer, Größenlimits für Anfragen, Uploads und
  Kollaborationsnachrichten (4 MiB), Speicherquoten, Timeouts gegen Slowloris; CPU- und Speicherlimits je
  Container (App 2 CPU / 2 GB, Node-Heap 1,5 GB; Backup 1 CPU / 1 GB).
- ☐ Überwachung (Uptime, Fehlerquote, Speicherplatz, Backup-Heartbeat) mit Alarmierung.

## 4. Verfahren zur regelmäßigen Überprüfung (Art. 32 Abs. 1 lit. d)

- Automatisierte Tests für Rechteprüfung, Freigaben, CSRF, Uploads, Export (CI).
- ☐ Monatliche Abhängigkeits- und Image-Updates; ☐ jährlicher Penetrationstest / Code-Review;
  ☐ jährliche Überprüfung dieser TOMs, des Löschkonzepts und der Unterauftragsverarbeiter.
- Incident-Response-Prozess inkl. 72-h-Meldung: siehe `docs/SECURITY.md`.

## 5. Organisatorisch

- ☐ Vertraulichkeitsverpflichtung aller Beschäftigten; ☐ Schulung Datenschutz/Sicherheit jährlich.
- ☐ Rollen- und Rechtevergabe nach Need-to-know; Admin-Rollen regelmäßig überprüfen.
- ☐ AVV mit allen Unterauftragsverarbeitern ([subprocessors.md](subprocessors.md)).
- Datenschutz durch Technikgestaltung: lokale Nutzung ohne Konto, keine Tracker, minimale Cookies.
