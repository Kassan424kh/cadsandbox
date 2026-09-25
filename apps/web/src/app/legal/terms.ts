// Terms of service template (German law). Operator data and commercial terms are placeholders.
import { LIMITS } from '@cadsandbox/shared'
import type { LegalSet } from './types'

export const terms: LegalSet = {
  de: {
    title: 'Nutzungsbedingungen',
    updated: '[PLACEHOLDER: Datum der letzten Änderung]',
    sections: [
      {
        heading: '1. Geltungsbereich',
        body: ['Diese Bedingungen gelten für die Nutzung von CadSandbox, angeboten von [PLACEHOLDER: Firmenname, Anschrift] („wir“). Abweichende Bedingungen von Nutzerinnen und Nutzern gelten nicht.'],
      },
      {
        heading: '2. Leistungen',
        body: [
          'CadSandbox ist ein browserbasiertes CAD- und Architekturwerkzeug. Ohne Konto werden Projekte ausschließlich auf Ihrem Gerät gespeichert. Mit Konto stehen zusätzlich Synchronisation, Freigaben, Zusammenarbeit und Organisationen zur Verfügung.',
          'Kostenpflichtige Tarife, Speicherkontingente und Preise: [PLACEHOLDER: Tarifmodell beschreiben oder „Die Nutzung ist derzeit kostenlos.“]',
        ],
      },
      {
        heading: '3. Konto',
        body: ['Sie müssen bei der Registrierung wahre Angaben machen, Ihre Zugangsdaten geheim halten und uns über Missbrauch informieren. Ein Konto ist nicht übertragbar. Die Nutzung ist ab [PLACEHOLDER: 16] Jahren erlaubt.'],
      },
      {
        heading: '4. Ihre Inhalte',
        body: [
          'Alle Rechte an Ihren Projekten verbleiben bei Ihnen. Sie räumen uns nur die Rechte ein, die zur Erbringung des Dienstes nötig sind (Speichern, Synchronisieren, Anzeigen gegenüber Personen, mit denen Sie teilen).',
          'Sie sind dafür verantwortlich, dass Ihre Inhalte keine Rechte Dritter verletzen, und entscheiden selbst, mit wem Sie Projekte teilen oder ob Sie sie öffentlich machen.',
        ],
      },
      {
        heading: '5. Unzulässige Nutzung',
        body: [
          {
            list: [
              'rechtswidrige Inhalte zu speichern oder zu verbreiten,',
              'den Dienst oder andere Nutzer anzugreifen, zu überlasten oder Sicherheitsmaßnahmen zu umgehen,',
              'automatisiert Daten abzurufen, soweit dies nicht ausdrücklich erlaubt ist,',
              'Zugänge weiterzuverkaufen.',
            ],
          },
          'Bei Verstößen können wir Inhalte sperren und Konten vorübergehend oder dauerhaft sperren.',
        ],
      },
      {
        heading: '6. Verfügbarkeit und Datensicherung',
        body: [
          'Wir bemühen uns um eine hohe Verfügbarkeit, schulden aber keine ununterbrochene Erreichbarkeit. Da CadSandbox lokal arbeitet, bleiben Ihre Projekte auch bei Störungen auf Ihrem Gerät nutzbar.',
          'Lokale Projekte liegen nur in Ihrem Browser. Bitte sichern Sie wichtige Projekte regelmäßig (z. B. über „.csbx herunterladen“ oder die Synchronisation).',
        ],
      },
      {
        heading: '7. Kündigung und Löschung',
        body: [`Sie können Ihr Konto jederzeit im Datenschutz-Center löschen; nach einer Wartefrist von ${LIMITS.accountDeletionGraceDays} Tagen werden alle Daten endgültig gelöscht. Wir können den Vertrag mit einer Frist von [PLACEHOLDER: 4 Wochen] kündigen; das Recht zur außerordentlichen Kündigung bleibt unberührt.`],
      },
      {
        heading: '8. Haftung',
        body: [
          'Wir haften unbeschränkt bei Vorsatz und grober Fahrlässigkeit, bei Verletzung von Leben, Körper oder Gesundheit sowie nach dem Produkthaftungsgesetz.',
          'Bei leicht fahrlässiger Verletzung wesentlicher Vertragspflichten ist die Haftung auf den vertragstypisch vorhersehbaren Schaden begrenzt. Im Übrigen ist die Haftung für leichte Fahrlässigkeit ausgeschlossen.',
          'CadSandbox ist ein Planungswerkzeug. Berechnungen, Maße und Mengen sind vor ihrer Verwendung (z. B. für Bauanträge oder Fertigung) fachlich zu prüfen.',
        ],
      },
      {
        heading: '9. Änderungen dieser Bedingungen',
        body: ['Wir können diese Bedingungen mit Wirkung für die Zukunft ändern. Über Änderungen informieren wir mindestens [PLACEHOLDER: 4 Wochen] vorher per E-Mail; widersprechen Sie nicht, gelten die Änderungen als angenommen. Auf dieses Widerspruchsrecht weisen wir in der Mitteilung hin.'],
      },
      {
        heading: '10. Schlussbestimmungen',
        body: [
          'Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts; zwingende Verbraucherschutzvorschriften Ihres Aufenthaltsstaates bleiben unberührt.',
          'Gerichtsstand für Kaufleute ist [PLACEHOLDER: Ort]. Sollte eine Bestimmung unwirksam sein, bleibt der Vertrag im Übrigen wirksam.',
        ],
      },
    ],
  },
  en: {
    title: 'Terms of service',
    updated: '[PLACEHOLDER: date of last change]',
    intro: 'Convenience translation — the German version is legally binding.',
    sections: [
      { heading: '1. Scope', body: ['These terms govern the use of CadSandbox, provided by [PLACEHOLDER: company name, address] (“we”). Conflicting terms of users do not apply.'] },
      {
        heading: '2. Services',
        body: [
          'CadSandbox is a browser-based CAD and architecture tool. Without an account, projects are stored only on your device. With an account you additionally get sync, sharing, real-time collaboration and organisations.',
          'Paid plans, storage quotas and prices: [PLACEHOLDER: describe the plans or state “Use is currently free of charge.”]',
        ],
      },
      { heading: '3. Account', body: ['You must provide truthful information, keep your credentials secret and tell us about misuse. Accounts are not transferable. Minimum age: [PLACEHOLDER: 16].'] },
      {
        heading: '4. Your content',
        body: [
          'You keep all rights to your projects. You grant us only the rights needed to provide the service (storing, syncing, displaying to people you share with).',
          'You are responsible for ensuring your content does not infringe third-party rights, and you decide whom you share projects with or whether you make them public.',
        ],
      },
      {
        heading: '5. Prohibited use',
        body: [
          { list: ['storing or distributing unlawful content,', 'attacking or overloading the service or other users, or circumventing security measures,', 'automated data retrieval unless expressly permitted,', 'reselling access.'] },
          'In case of violations we may block content and suspend or terminate accounts.',
        ],
      },
      {
        heading: '6. Availability and backups',
        body: [
          'We aim for high availability but do not guarantee uninterrupted access. Because CadSandbox works locally, your projects remain usable on your device during outages.',
          'Local projects exist only in your browser. Please back up important projects regularly (e.g. “Download .csbx” or sync).',
        ],
      },
      {
        heading: '7. Termination and deletion',
        body: [`You can delete your account at any time in the privacy center; after a ${LIMITS.accountDeletionGraceDays}-day grace period all data are permanently deleted. We may terminate with [PLACEHOLDER: 4 weeks’] notice; the right to terminate for cause remains unaffected.`],
      },
      {
        heading: '8. Liability',
        body: [
          'We are liable without limitation for intent and gross negligence, for injury to life, body or health and under the Product Liability Act.',
          'For slightly negligent breaches of essential contractual obligations, liability is limited to the foreseeable damage typical for the contract. Otherwise, liability for slight negligence is excluded.',
          'CadSandbox is a design tool. Verify calculations, dimensions and quantities professionally before relying on them (e.g. for permits or manufacturing).',
        ],
      },
      {
        heading: '9. Changes to these terms',
        body: ['We may change these terms for the future. We will notify you by email at least [PLACEHOLDER: 4 weeks] in advance; if you do not object, the changes are deemed accepted. The notice will point out this right to object.'],
      },
      {
        heading: '10. Final provisions',
        body: [
          'German law applies, excluding the UN Convention on Contracts for the International Sale of Goods; mandatory consumer protection rules of your country of residence remain unaffected.',
          'Place of jurisdiction for merchants: [PLACEHOLDER: city]. If a provision is invalid, the remainder of the contract stays in effect.',
        ],
      },
    ],
  },
}
