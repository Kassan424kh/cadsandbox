#!/usr/bin/env node
// Regenerates the English catalog (src/i18n/locales/en/*.ts) from every t('key', 'fallback'),
// tn('key', n, 'one', 'other') and ['templates.…', '…'] tuple in src/app and src/data.
// Afterwards `tsc` reports every German key that is missing (de/*.ts use `satisfies`).
//   usage (from apps/web):  node src/i18n/tools/sync-en.mjs
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../../..', import.meta.url).pathname // apps/web
const SOURCES = ['src/app', 'src/data', 'src/i18n/format.ts']
const OUT = join(ROOT, 'src/i18n/locales/en')

/** Keys built at runtime (template literals / non-literal fallbacks) that must still exist. */
const DYNAMIC = {
  'share.role.owner': 'Owner',
  'share.role.editor': 'Can edit',
  'share.role.commenter': 'Can comment',
  'share.role.viewer': 'Can view',
  'units.mm': 'mm',
  'units.cm': 'cm',
  'units.m': 'm',
  'units.in': 'in',
  'units.ft': 'ft',
  'library.kind.object': 'Object',
  'library.kind.material': 'Material',
  'library.kind.component': 'Component',
}

const GROUPS = {
  core: ['banner', 'common', 'editor', 'errors', 'gate', 'home', 'legal', 'menu', 'nav', 'nudge', 'pwa', 'templates', 'theme', 'time', 'units', 'upload', 'shareLink', 'invite'],
  dashboard: ['dashboard', 'library', 'org'],
  sharing: ['share', 'versions', 'support'],
  account: ['auth', 'settings', 'security', 'privacy'],
  admin: ['admin'],
}

const files = []
const walk = (p) => {
  if (statSync(p).isDirectory()) for (const f of readdirSync(p)) walk(join(p, f))
  else if (/\.(ts|tsx)$/.test(p) && !p.includes('/locales/')) files.push(p)
}
for (const s of SOURCES) walk(join(ROOT, s))

const str = String.raw`'((?:[^'\\]|\\.)*)'`
const reT = new RegExp(String.raw`\b(?:t|translate)\(\s*` + str + String.raw`\s*,\s*` + str, 'g')
const reTn = new RegExp(String.raw`\btn\(\s*` + str + String.raw`\s*,[^,]+,\s*` + str + String.raw`\s*,\s*` + str, 'g')
const reTuple = new RegExp(String.raw`\[\s*` + str + String.raw`\s*,\s*` + str + String.raw`\s*\]`, 'g')
const unescape = (s) => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\')

const keys = new Map(Object.entries(DYNAMIC))
const conflicts = []
const add = (k, v, file) => {
  if (keys.has(k) && keys.get(k) !== v && !(k in DYNAMIC)) conflicts.push(`${k}: "${keys.get(k)}" ≠ "${v}" (${file})`)
  if (!keys.has(k)) keys.set(k, v)
}
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(reT)) add(m[1], unescape(m[2]), f)
  for (const m of src.matchAll(reTn)) {
    add(`${m[1]}.one`, unescape(m[2]), f)
    add(`${m[1]}.other`, unescape(m[3]), f)
  }
  for (const m of src.matchAll(reTuple)) if (m[1].startsWith('templates.')) add(m[1], unescape(m[2]), f)
}

const q = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const all = [...keys.keys()]
for (const [name, namespaces] of Object.entries(GROUPS)) {
  const ks = all.filter((k) => namespaces.includes(k.split('.')[0])).sort()
  const body = ks.map((k) => `  ${q(k)}: ${q(keys.get(k))},`).join('\n')
  const type = name[0].toUpperCase() + name.slice(1)
  writeFileSync(
    join(OUT, `${name}.ts`),
    `// English UI strings (${namespaces.join(', ')}). Source of truth for keys; generated from t(key, fallback) calls.\nexport const ${name} = {\n${body}\n} as const\n\nexport type ${type}Key = keyof typeof ${name}\n`,
  )
}
const grouped = new Set(Object.values(GROUPS).flat())
const orphans = all.filter((k) => !grouped.has(k.split('.')[0]))
console.log(`${keys.size} keys from ${files.length} files`)
if (orphans.length) console.warn(`Add these namespaces to GROUPS: ${[...new Set(orphans.map((k) => k.split('.')[0]))].join(', ')}`)
if (conflicts.length) console.warn(`Same key, different fallback:\n${conflicts.join('\n')}`)
