// Activates the built extension in a real VS Code with the bundled language
// server. Needs a display: run it under xvfb-run on a headless host.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runTests } from '@vscode/test-electron'

const here = dirname(fileURLToPath(import.meta.url))
const workspace = mkdtempSync(join(tmpdir(), 'carve-activation-'))
writeFileSync(join(workspace, 'sample.crv'), '# Title\n\nSome *text*.\n')

try {
  await runTests({
    version: process.env.VSCODE_TEST_VERSION || 'stable',
    extensionDevelopmentPath: resolve(here, '..', '..'),
    extensionTestsPath: join(here, 'suite.cjs'),
    launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
  })
} catch (error) {
  console.error(error)
  process.exit(1)
}
