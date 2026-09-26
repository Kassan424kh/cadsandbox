// Operator-level settings (site_settings): the imprint details an admin edits in the admin panel.
import { eq } from 'drizzle-orm'
import { schemas, type LegalOperatorDTO, type LegalOperatorResponse } from '@cadsandbox/shared'
import type { DbOrTx } from '../db/client'
import { siteSettings } from '../db/schema'

const LEGAL_OPERATOR = 'legal.operator'

export async function getLegalOperator(db: DbOrTx): Promise<LegalOperatorResponse> {
  const [row] = await db.select().from(siteSettings).where(eq(siteSettings.key, LEGAL_OPERATOR)).limit(1)
  const parsed = row ? schemas.legalOperator.safeParse(row.value) : null
  return { operator: parsed?.success ? parsed.data : null, updatedAt: row ? row.updatedAt.toISOString() : null }
}

export async function setLegalOperator(db: DbOrTx, value: LegalOperatorDTO, userId: string): Promise<LegalOperatorResponse> {
  const now = new Date()
  await db
    .insert(siteSettings)
    .values({ key: LEGAL_OPERATOR, value, updatedAt: now, updatedBy: userId })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value, updatedAt: now, updatedBy: userId } })
  return { operator: value, updatedAt: now.toISOString() }
}
