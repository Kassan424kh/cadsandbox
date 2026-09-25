// Bundle the server (and workspace TS packages) into dist/; npm deps stay external.
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)))
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@cadsandbox/'))

await build({
  entryPoints: { index: 'src/index.ts', cli: 'src/cli.ts' },
  outdir: 'dist',
  bundle: true,
  splitting: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external,
  banner: { js: "import { createRequire as __csbCreateRequire } from 'node:module'; const require = __csbCreateRequire(import.meta.url);" },
})
console.log('server built → dist/index.js, dist/cli.js')
