// Structured legal documents (rendered as plain text — never as HTML).
// "[PLACEHOLDER: …]" marks operator data that must be filled in before going live.

export type LegalBlock = string | { list: string[] }

export interface LegalSection {
  heading: string
  body: LegalBlock[]
}

export interface LegalDoc {
  title: string
  updated: string
  intro?: string
  sections: LegalSection[]
}

export type LegalDocId = 'imprint' | 'privacy' | 'terms'
export type LegalSet = { en: LegalDoc; de: LegalDoc }
