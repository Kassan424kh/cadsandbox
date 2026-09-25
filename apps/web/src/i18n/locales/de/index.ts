// German dictionary. App-shell modules are type-checked against the English catalog (`satisfies`),
// so a missing translation is a compile error. Editor keys (src/editor/i18n-keys.md) live in
// editor.ts/editor2.ts; unknown keys fall back to the English text at runtime.
import { account } from './account'
import { admin } from './admin'
import { analysis } from './analysis'
import { core } from './core'
import { dashboard } from './dashboard'
import { editor } from './editor'
import { sharing } from './sharing'

const de: Readonly<Record<string, string>> = { ...editor, ...analysis, ...core, ...dashboard, ...sharing, ...account, ...admin }

export default de
