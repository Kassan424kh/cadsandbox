// English dictionary — the source catalog. Every key used with t(key, fallback) in src/app and
// src/data lives here; the German dictionary is type-checked against these keys.
import { account } from './account'
import { admin } from './admin'
import { analysis } from './analysis'
import { core } from './core'
import { dashboard } from './dashboard'
import { sharing } from './sharing'

const en = { ...core, ...dashboard, ...sharing, ...account, ...admin, ...analysis }

export type MessageKey = keyof typeof en
export type Messages = Record<MessageKey, string>
export default en as Readonly<Record<string, string>>
export { account, admin, analysis, core, dashboard, sharing }
