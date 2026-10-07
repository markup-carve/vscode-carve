import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { convertToCarve, IMPORT_EXTENSIONS, importFormatFor, importTargetPath } from './import.js'

const here = dirname(fileURLToPath(import.meta.url))

test('the import format follows the file extension, case-insensitively', () => {
  assert.equal(importFormatFor('/docs/readme.md'), 'markdown')
  assert.equal(importFormatFor('/docs/README.MARKDOWN'), 'markdown')
  assert.equal(importFormatFor('/site/page.html'), 'html')
  assert.equal(importFormatFor('/site/page.HTM'), 'html')
  assert.equal(importFormatFor('/docs/notes.crv'), undefined)
  assert.equal(importFormatFor('/docs.md/notes'), undefined)
  assert.equal(importFormatFor('/docs/.md'), undefined)
})

test('the target is the sibling .crv with only the last extension swapped', () => {
  assert.equal(importTargetPath('/docs/readme.md'), '/docs/readme.crv')
  assert.equal(importTargetPath('/docs/v1.2/page.html'), '/docs/v1.2/page.crv')
  assert.equal(importTargetPath('/docs/archive.tar.md'), '/docs/archive.tar.crv')
})

test('Markdown converts through the engine migration', () => {
  const { carve, diagnostics } = convertToCarve('# Title\n\n**bold** and *em*\n', 'markdown')
  assert.equal(carve, '# Title\n\n*bold* and /em/\n')
  assert.equal(diagnostics, 0)
})

// Three Markdown shapes the engine imported wrongly until 0.1.10. The command
// writes whatever the engine returns straight to a .crv file, so a fidelity
// regression here reaches the user's document rather than a diagnostic. Each
// case fails against 0.1.9.
test('Markdown import escapes a bracket an emphasis span crosses', () => {
  // 0.1.9 returned "/a [b/ c]", whose bracket re-reads as Carve markup and
  // loses the emphasis outright.
  assert.equal(convertToCarve('*a [b* c]\n', 'markdown').carve, '/a \\[b/ c]\n')
})

test('Markdown import keeps a lazy continuation inside its quote', () => {
  // 0.1.9 read the line below as a setext underline and hoisted a heading out
  // of the quote.
  assert.equal(convertToCarve('> text\nlazy\n===\n', 'markdown').carve, '> text\n> lazy\n> ===\n')
})

test('Markdown import keeps the deactivated outer link as text', () => {
  // Carve links never nest, so 0.1.9's "[a [b](/in) c](/out)" collapsed to one
  // outer link and dropped the inner one.
  assert.equal(
    convertToCarve('[a [b](/in) c](/out)\n', 'markdown').carve,
    '\\[a [b](/in) c\\](\\/out)\n',
  )
})

test('HTML converts through the engine importer and counts its diagnostics', () => {
  assert.deepEqual(convertToCarve('<h1>Title</h1><p><b>bold</b></p>', 'html'), {
    carve: '# Title\n\n*bold*\n',
    diagnostics: 0,
  })
  assert.ok(convertToCarve('<p>x<script>alert(1)</script></p>', 'html').diagnostics > 0)
})

test('the explorer menu offers the import on every extension the command accepts', () => {
  const manifest = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
    contributes: { menus: Record<string, { command: string; when?: string }[]> }
  }
  const entry = manifest.contributes.menus['explorer/context']?.find(
    (item) => item.command === 'carve.importFile',
  )
  assert.ok(entry?.when, 'carve.importFile is missing from the explorer context menu')
  const [, pattern, flags] = /\/(.+)\/(\w*)$/.exec(entry.when) ?? []
  const matcher = new RegExp(pattern, flags)
  for (const ext of IMPORT_EXTENSIONS) assert.ok(matcher.test(ext), `${ext} is not matched`)
  assert.equal(matcher.test('.crv'), false)
})
