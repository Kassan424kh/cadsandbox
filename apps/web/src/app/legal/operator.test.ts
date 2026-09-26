import { describe, expect, it } from 'vitest'
import type { LegalOperatorDTO } from '@cadsandbox/shared'
import { imprint } from './imprint'
import { privacy } from './privacy'
import { terms } from './terms'
import { fillOperator } from './operator'

const soleTrader: LegalOperatorDTO = {
  name: 'Example Operator',
  street: 'Musterstraße 1',
  postalCity: '12345 Musterstadt',
  country: 'Deutschland',
  email: 'hello@example.com',
  phone: '+49 123 456789',
  vatId: 'DE000000000',
  registerCourt: '',
  registerNumber: '',
  representedBy: '',
  contentResponsible: '',
  privacyEmail: '',
}

const text = (v: unknown) => JSON.stringify(v)

describe('legal texts', () => {
  it('never hard-code operator details or placeholders', () => {
    for (const set of [imprint, privacy, terms]) {
      expect(text(set)).not.toContain('[PLACEHOLDER')
    }
  })

  it('fill in a sole trader and hide the company-only sections', () => {
    const de = fillOperator(imprint.de, soleTrader, 'de')
    const all = text(de)
    expect(all).not.toContain('[PLACEHOLDER')
    expect(all).toContain('Musterstraße 1')
    expect(all).toContain('DE000000000')
    expect(de.sections.map((s) => s.heading)).not.toContain('Registereintrag')
    expect(de.sections.map((s) => s.heading)).not.toContain('Vertreten durch')
    // Derived fields fall back to name/address and the contact email.
    expect(all).toContain('Example Operator, Musterstraße 1, 12345 Musterstadt')
    expect(text(fillOperator(privacy.en, soleTrader, 'en'))).toContain('Contact for privacy requests: hello@example.com')
  })

  it('mark missing required details and drop missing optional ones', () => {
    const en = text(fillOperator(imprint.en, null, 'en'))
    expect(en).toContain('[PLACEHOLDER: street and number]')
    expect(en).not.toContain('{op:')
    expect(en).not.toContain('VAT identification number')
  })
})
