// Fills the operator details (edited in Admin → Legal, stored on the server) into the legal texts.
// Texts reference them as "{op:field}". A line with an empty *optional* field is left out (e.g. no
// VAT ID or commercial register for a sole trader) and a section left without lines disappears;
// a missing *required* field becomes a "[PLACEHOLDER: …]" marker that the page highlights.
import type { LegalOperatorDTO } from '@cadsandbox/shared'
import type { LegalBlock, LegalDoc } from './types'

export type OperatorField = keyof LegalOperatorDTO

const OPTIONAL: ReadonlySet<OperatorField> = new Set(['country', 'vatId', 'registerCourt', 'registerNumber', 'representedBy'])

const LABEL: Record<'de' | 'en', Partial<Record<OperatorField, string>>> = {
  de: { name: 'Name bzw. Firma inkl. Rechtsform', street: 'Straße und Hausnummer', postalCity: 'PLZ und Ort', email: 'E-Mail-Adresse', phone: 'Telefonnummer' },
  en: { name: 'name or company incl. legal form', street: 'street and number', postalCity: 'postcode and city', email: 'email address', phone: 'phone number' },
}

const TOKEN = /\{op:(\w+)\}/g

function valueOf(op: LegalOperatorDTO | null, field: OperatorField): string {
  if (!op) return ''
  if (field === 'contentResponsible') return op.contentResponsible || [op.name, op.street, op.postalCity].filter(Boolean).join(', ')
  if (field === 'privacyEmail') return op.privacyEmail || op.email
  return op[field] ?? ''
}

/** One text line; null = leave the line out. */
function fillLine(line: string, op: LegalOperatorDTO | null, lang: 'de' | 'en'): string | null {
  let drop = false
  const out = line.replace(TOKEN, (_, raw: string) => {
    const field = raw as OperatorField
    const v = valueOf(op, field).trim()
    if (v) return v
    if (OPTIONAL.has(field)) drop = true
    const base = field === 'contentResponsible' ? 'name' : field === 'privacyEmail' ? 'email' : field
    return `[PLACEHOLDER: ${LABEL[lang][base] ?? base}]`
  })
  return drop ? null : out
}

function fillBlock(b: LegalBlock, op: LegalOperatorDTO | null, lang: 'de' | 'en'): LegalBlock | null {
  if (typeof b === 'string') return fillLine(b, op, lang)
  const list = b.list.map((l) => fillLine(l, op, lang)).filter((l): l is string => l !== null)
  return list.length ? { list } : null
}

export function fillOperator(doc: LegalDoc, op: LegalOperatorDTO | null, lang: 'de' | 'en'): LegalDoc {
  return {
    ...doc,
    intro: doc.intro === undefined ? undefined : (fillLine(doc.intro, op, lang) ?? undefined),
    sections: doc.sections
      .map((sec) => ({ ...sec, body: sec.body.map((b) => fillBlock(b, op, lang)).filter((b): b is LegalBlock => b !== null) }))
      .filter((sec) => sec.body.length > 0),
  }
}
