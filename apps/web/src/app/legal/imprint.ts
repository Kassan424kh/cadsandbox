// Imprint / Impressum (§ 5 DDG, § 18 Abs. 2 MStV). "{op:…}" = operator details from Admin → Legal (see operator.ts).
import type { LegalSet } from './types'

export const imprint: LegalSet = {
  de: {
    title: 'Impressum',
    updated: '26. September 2026',
    sections: [
      {
        heading: 'Angaben gemäß § 5 DDG',
        body: [
          '{op:name}',
          '{op:street}',
          '{op:postalCity}',
          '{op:country}',
        ],
      },
      { heading: 'Vertreten durch', body: ['{op:representedBy}'] },
      {
        heading: 'Kontakt',
        body: [{ list: ['E-Mail: {op:email}', 'Telefon: {op:phone}'] }],
      },
      { heading: 'Registereintrag', body: ['Registergericht: {op:registerCourt}', 'Registernummer: {op:registerNumber}'] },
      { heading: 'Umsatzsteuer-ID', body: ['Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG: {op:vatId}'] },
      {
        heading: 'Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV',
        body: ['{op:contentResponsible}'],
      },
      {
        heading: 'Verbraucherstreitbeilegung',
        body: ['Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen (§ 36 VSBG).'],
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
    updated: '26 September 2026',
    intro: 'Legal notice pursuant to § 5 of the German Digital Services Act (DDG). The German version is legally binding.',
    sections: [
      {
        heading: 'Provider',
        body: [
          '{op:name}',
          '{op:street}',
          '{op:postalCity}',
          '{op:country}',
        ],
      },
      { heading: 'Represented by', body: ['{op:representedBy}'] },
      { heading: 'Contact', body: [{ list: ['Email: {op:email}', 'Phone: {op:phone}'] }] },
      { heading: 'Commercial register', body: ['Register court: {op:registerCourt}', 'Register number: {op:registerNumber}'] },
      { heading: 'VAT ID', body: ['VAT identification number according to § 27a UStG: {op:vatId}'] },
      { heading: 'Responsible for content (§ 18(2) MStV)', body: ['{op:contentResponsible}'] },
      {
        heading: 'Consumer dispute resolution',
        body: ['We are neither willing nor obliged to take part in dispute resolution proceedings before a consumer arbitration board (§ 36 VSBG).'],
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
