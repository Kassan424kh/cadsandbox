// Imprint / Impressum (§ 5 DDG, § 18 Abs. 2 MStV). Operator data are placeholders.
import type { LegalSet } from './types'

export const imprint: LegalSet = {
  de: {
    title: 'Impressum',
    updated: '[PLACEHOLDER: Datum der letzten Änderung]',
    sections: [
      {
        heading: 'Angaben gemäß § 5 DDG',
        body: [
          '[PLACEHOLDER: Firmenname inkl. Rechtsform, z. B. „CadSandbox GmbH“]',
          '[PLACEHOLDER: Straße und Hausnummer]',
          '[PLACEHOLDER: PLZ und Ort], [PLACEHOLDER: Land]',
        ],
      },
      { heading: 'Vertreten durch', body: ['[PLACEHOLDER: Geschäftsführer/in bzw. vertretungsberechtigte Person(en)]'] },
      {
        heading: 'Kontakt',
        body: [{ list: ['E-Mail: [PLACEHOLDER: kontakt@example.com]', 'Telefon: [PLACEHOLDER: +49 …]'] }],
      },
      {
        heading: 'Registereintrag',
        body: ['Registergericht: [PLACEHOLDER: Amtsgericht …]', 'Registernummer: [PLACEHOLDER: HRB …]'],
      },
      { heading: 'Umsatzsteuer-ID', body: ['Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG: [PLACEHOLDER: DE…]'] },
      {
        heading: 'Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV',
        body: ['[PLACEHOLDER: Name, Anschrift wie oben]'],
      },
      {
        heading: 'Verbraucherstreitbeilegung',
        body: ['Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen (§ 36 VSBG). [PLACEHOLDER: anpassen, falls abweichend]'],
      },
      {
        heading: 'Haftung für Inhalte und Links',
        body: [
          'Als Diensteanbieter sind wir für eigene Inhalte auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich. Für Inhalte, die Nutzerinnen und Nutzer in ihren Projekten erstellen oder teilen, sind diese selbst verantwortlich. Nach Kenntnis einer Rechtsverletzung entfernen wir entsprechende Inhalte unverzüglich.',
          'Unser Angebot enthält keine Einbindungen externer Dienste. Für Inhalte verlinkter externer Seiten sind ausschließlich deren Betreiber verantwortlich.',
        ],
      },
    ],
  },
  en: {
    title: 'Imprint',
    updated: '[PLACEHOLDER: date of last change]',
    intro: 'Legal notice pursuant to § 5 of the German Digital Services Act (DDG). The German version is legally binding.',
    sections: [
      {
        heading: 'Provider',
        body: [
          '[PLACEHOLDER: company name incl. legal form, e.g. “CadSandbox GmbH”]',
          '[PLACEHOLDER: street and number]',
          '[PLACEHOLDER: postcode and city], [PLACEHOLDER: country]',
        ],
      },
      { heading: 'Represented by', body: ['[PLACEHOLDER: managing director(s) / authorised representative(s)]'] },
      { heading: 'Contact', body: [{ list: ['Email: [PLACEHOLDER: contact@example.com]', 'Phone: [PLACEHOLDER: +49 …]'] }] },
      { heading: 'Commercial register', body: ['Register court: [PLACEHOLDER: Local Court …]', 'Register number: [PLACEHOLDER: HRB …]'] },
      { heading: 'VAT ID', body: ['VAT identification number according to § 27a UStG: [PLACEHOLDER: DE…]'] },
      { heading: 'Responsible for content (§ 18(2) MStV)', body: ['[PLACEHOLDER: name, address as above]'] },
      {
        heading: 'Consumer dispute resolution',
        body: ['We are neither willing nor obliged to take part in dispute resolution proceedings before a consumer arbitration board (§ 36 VSBG). [PLACEHOLDER: adjust if different]'],
      },
      {
        heading: 'Liability for content and links',
        body: [
          'We are responsible for our own content on these pages under general law. Users are responsible for the content they create or share in their projects. We remove unlawful content promptly once we become aware of it.',
          'Our service does not embed any external services. Operators of linked external sites are solely responsible for their content.',
        ],
      },
    ],
  },
}
