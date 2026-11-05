import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { browserPdfArgs, crv2pdfArgs, executablePath, findBrowser, MISSING_PDF_TOOL_MESSAGE, pdfPrintHtml, runPdfTool } from './pdf-export.js'

const available = (paths: string[]) => (path: string) => paths.includes(path)

test('discovers browsers at platform defaults and PATH, including paths with spaces', () => {
  assert.equal(findBrowser('linux', { PATH: '/custom/bin' }, available(['/custom/bin/chromium'])), '/custom/bin/chromium')
  assert.equal(findBrowser('darwin', { PATH: '' }, available(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'])), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  assert.equal(findBrowser('win32', { PATH: '', PROGRAMFILES: 'C:\\Program Files' }, available(['C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'])), 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe')
  assert.equal(findBrowser('linux', { PATH: '' }, available(['/installed/Chrome Browser']), '/installed/Chrome Browser'), '/installed/Chrome Browser')
  assert.equal(executablePath('crv2pdf', 'linux', { PATH: '/a:/b' }, available(['/b/crv2pdf'])), '/b/crv2pdf')
})

test('builds shell-free PDF arguments and page style', () => {
  assert.deepEqual(crv2pdfArgs('/a b/doc.crv', '/a b/doc.pdf'), ['/a b/doc.crv', '/a b/doc.pdf', '--pdf'])
  assert.deepEqual(browserPdfArgs('/a b/page.html', '/a b/doc.pdf', false), [
    '--headless', '--disable-gpu', '--no-first-run', '--no-pdf-header-footer', '--print-to-pdf=/a b/doc.pdf', 'file:///a%20b/page.html',
  ])
  assert.ok(browserPdfArgs('/a b/page.html', '/a b/doc.pdf', true).includes('--no-sandbox'))
  assert.match(pdfPrintHtml('<html><head></head><body>x</body></html>', 'Letter', 'narrow'), /@page \{ size: Letter; margin: 10mm; \}/)
  assert.match(pdfPrintHtml('<html><head></head><body><img src="x.png"></body></html>', 'A4', 'default', '/read only/source'), /<base href="file:\/\/\/read%20only\/source\/">/)
})

test('missing tools give installation and configuration options', () => {
  assert.equal(findBrowser('linux', { PATH: '' }, available([])), undefined)
  assert.equal(executablePath('crv2pdf', 'linux', { PATH: '' }, available([])), undefined)
  assert.match(MISSING_PDF_TOOL_MESSAGE, /markup-carve\/carve-pdf/)
  assert.match(MISSING_PDF_TOOL_MESSAGE, /Chrome, Chromium, or Edge/)
})

test('process failure includes tool stderr', async () => {
  await assert.rejects(
    runPdfTool(process.execPath, ['-e', 'process.stderr.write("render failed\\n"); process.exit(7)'], '/nonexistent/output.pdf'),
    /exit 7.*render failed/,
  )
})

test('browser fallback produces a PDF when headless Chromium is installed', async (t) => {
  const browser = findBrowser(process.platform as 'linux' | 'darwin' | 'win32')
  if (!browser) {
    t.skip('No installed Chrome, Chromium, or Edge browser in CI')
    return
  }
  const dir = await mkdtemp(join(tmpdir(), 'carve-pdf-test-'))
  const html = join(dir, 'page with spaces.html')
  const pdf = join(dir, 'page with spaces.pdf')
  await writeFile(html, pdfPrintHtml('<html><head></head><body>Carve PDF test</body></html>', 'A4', 'default'))
  await runPdfTool(browser, browserPdfArgs(html, pdf), pdf, 60_000)
  assert.equal((await readFile(pdf)).subarray(0, 5).toString(), '%PDF-')
})
