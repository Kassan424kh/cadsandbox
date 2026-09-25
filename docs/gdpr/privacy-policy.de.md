# Datenschutzerklärung — [Produktname, z. B. CadSandbox]

*Stand: [Datum]. Vorlage — bitte Platzhalter ersetzen und rechtlich prüfen lassen.*

## 1. Verantwortlicher

[Firma], [Anschrift], [E-Mail], [Telefon]. Vertretungsberechtigt: [Name].
Datenschutzbeauftragte/r: [Name, Kontakt] (sofern benannt).

## 2. Überblick

CadSandbox ist ein browserbasiertes CAD- und Architekturwerkzeug. Modellierung und Darstellung
laufen auf Ihrem Gerät. Ohne Konto werden Ihre Projekte nur lokal im Browser gespeichert und nicht
an uns übertragen. Mit Konto speichern und synchronisieren wir Projekte auf Servern in der EU
([Hoster, Standort]). Wir setzen keine Tracking- oder Analyse-Werkzeuge ein, binden keine
Inhalte Dritter ein (Schriften, Skripte usw. liegen auf unserem Server) und verwenden nur ein
technisch notwendiges Sitzungs-Cookie.

## 3. Verarbeitungen im Einzelnen

**a) Aufruf der Anwendung / Server-Protokolle.** Beim Aufruf verarbeiten wir technisch notwendige
Daten (Zeitpunkt, angefragte Adresse, Statuscode, Browsertyp). IP-Adressen werden vom
vorgeschalteten Webserver nicht protokolliert; in Anwendungsprotokollen erscheinen sie nur als
täglich wechselnder, nicht umkehrbarer Hashwert. Protokolle werden nach wenigen Tagen
überschrieben (Rotation). Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (sicherer Betrieb).

**b) Benutzerkonto.** Name, E-Mail-Adresse, Passwort (nur als scrypt-Hash), optional Profilbild,
Sprache, Zwei-Faktor-Daten (TOTP-Geheimnis, Backup-Codes) und Passkeys (öffentlicher Schlüssel).
Pro Sitzung speichern wir Zeitpunkte, eine gekürzte IP-Adresse (z. B. 203.0.113.0) und die
Browserkennung, damit Sie Ihre aktiven Sitzungen sehen und beenden können. Rechtsgrundlage: Art. 6
Abs. 1 lit. b DSGVO (Vertrag). Speicherdauer: bis zur Löschung des Kontos; Sitzungen höchstens
30 Tage nach letzter Nutzung.

**c) Projekte und Zusammenarbeit.** Projektinhalte (Modelle, Pläne, Kommentare, Versionen),
hochgeladene Dateien, Ordner, Sammlungen sowie Freigaben (Mitglieder, Freigabelinks, Organisationen).
Bei gemeinsamer Bearbeitung sehen Beteiligte Ihren Namen, Ihre Farbe, Auswahl und Cursorposition.
Freigabelinks speichern wir nur als Hashwert. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.
Gelöschte Projekte liegen 30 Tage im Papierkorb und werden danach endgültig gelöscht.

**d) Einladungen.** Wenn Sie jemanden per E-Mail einladen, verarbeiten wir dessen Adresse, um die
Einladung zu versenden und die Freigabe nach Registrierung zuzuordnen (Art. 6 Abs. 1 lit. f;
Einladungen verfallen nach 30 Tagen bzw. Organisations-Einladungen nach 7 Tagen).

**e) Organisationen.** Name, Mitglieder und Rollen; Organisationen können Projekte gemeinsam nutzen.
Für geschäftliche Organisationen verarbeiten wir Projektdaten als Auftragsverarbeiter (AVV).

**f) Support.** Inhalt Ihrer Anfragen und Antworten. Unser Support sieht Projektinhalte **nur**,
wenn Sie in einem Ticket für ein bestimmtes Projekt zeitlich begrenzten Lesezugriff (1–30 Tage)
erteilen; Sie können ihn jederzeit widerrufen. Jeder Zugriff wird protokolliert. Rechtsgrundlage:
Art. 6 Abs. 1 lit. b, für den Projektzugriff lit. a DSGVO (Einwilligung, jederzeit widerruflich).

**g) Sicherheit und Missbrauchsschutz.** Wir protokollieren sicherheitsrelevante Ereignisse
(Anmeldungen inkl. Fehlversuche, Änderungen an Passwort/2FA, Freigaben, Löschungen,
Administratoraktionen) mit gekürzter IP-Adresse für 365 Tage und begrenzen Anfragen je
(gehashter) IP-Adresse und Konto. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO sowie Art. 32 DSGVO.

**h) E-Mails.** Wir senden ausschließlich transaktionale E-Mails (Bestätigung, Passwort-Reset,
Einladungen, Hinweise zu Datenexport und Kontolöschung) über [E-Mail-Dienstleister, Sitz EU].
Kein Newsletter, keine Öffnungs- oder Klickverfolgung.

**i) Datensicherung.** Verschlüsselte Sicherungen werden bis zu 6 Monate aufbewahrt; gelöschte
Daten verschwinden spätestens mit Ablauf dieser Frist auch aus den Sicherungen.

## 4. Empfänger

Hosting: [Hoster, Adresse] · Objektspeicher: [Anbieter] · E-Mail-Versand: [Anbieter] ·
Backup-Speicher: [Anbieter]. Alle Dienstleister sind Auftragsverarbeiter mit Sitz und
Rechenzentren in der EU. Eine Übermittlung in Drittländer findet nicht statt. Personen, mit denen
Sie Projekte teilen, sehen die freigegebenen Inhalte und Ihren Namen.

## 5. Cookies

Wir setzen nur das Sitzungs-Cookie `__Secure-csb.session_token` (HttpOnly, Secure, SameSite=Lax,
30 Tage, verlängert sich bei Nutzung), während einer Anmeldung mit Zwei-Faktor-Bestätigung ein
kurzlebiges Prüf-Cookie sowie für Administratoren während einer Nutzeransicht ein technisches
Hilfs-Cookie. Diese sind unbedingt erforderlich (§ 25 Abs. 2 Nr. 2
TDDDG); eine Einwilligung ist nicht nötig. Lokale Projektdaten liegen in IndexedDB Ihres Browsers.

## 6. Ihre Rechte

Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung (Art. 18),
Datenübertragbarkeit (Art. 20), Widerspruch (Art. 21), Widerruf erteilter Einwilligungen (Art. 7
Abs. 3). In den Einstellungen können Sie jederzeit **alle Ihre Daten als ZIP exportieren** und Ihr
**Konto löschen** (Löschung nach 7 Tagen, bis dahin widerrufbar). Sie haben das Recht auf
Beschwerde bei einer Aufsichtsbehörde, z. B. [zuständige Landesdatenschutzbehörde].

## 7. Pflicht zur Bereitstellung

Für ein Konto sind E-Mail-Adresse, Name und Passwort erforderlich. Ohne Konto können Sie
CadSandbox lokal nutzen. Es findet keine automatisierte Entscheidungsfindung statt.
