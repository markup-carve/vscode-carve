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
