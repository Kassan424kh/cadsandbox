// Bundle the server (and workspace TS packages) into dist/index.js; npm deps stay external.
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)))
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@cadsandbox/'))

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
})
console.log('server built → dist/index.js')
