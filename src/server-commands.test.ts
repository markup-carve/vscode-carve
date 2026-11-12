import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import Module, { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { contributedCommands, skipOwnedCommands, type CommandFeature } from './server-commands.js'
import { serverModulePath } from './paths.js'

const require = createRequire(import.meta.url)
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJSON = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))

/** VS Code's command registry: a second registration of an id throws, as in the extension host. */
function commandRegistry(): { ids: Set<string>, registerCommand(id: string): { dispose(): void } } {
  const ids = new Set<string>()
  return {
    ids,
    registerCommand(id: string) {
      if (ids.has(id)) throw new Error(`command '${id}' already exists`)
      ids.add(id)
      return { dispose: () => ids.delete(id) }
    },
  }
}

let activeRegistry: ReturnType<typeof commandRegistry> | undefined
let ExecuteCommandFeature: new (client: unknown) => CommandFeature<{ commands?: string[] }>

/** vscode-languageclient's own ExecuteCommandFeature, loaded once against a stand-in `vscode` module. */
function executeCommandFeature(registry: ReturnType<typeof commandRegistry>): CommandFeature<{ commands?: string[] }> {
  activeRegistry = registry
  if (!ExecuteCommandFeature) {
    const loader = Module as unknown as { _load(request: string, ...rest: unknown[]): unknown }
    const load = loader._load
    const commands = { registerCommand: (id: string) => activeRegistry!.registerCommand(id) }
    loader._load = function (request: string, ...rest: unknown[]) {
      // features.js subclasses a few vscode classes at load time; any stand-in class will do.
      if (request === 'vscode') return new Proxy({ commands }, { get: (target, key) => key === 'commands' ? target.commands : class {} })
      return load.call(this, request, ...rest)
    }
    try {
      ExecuteCommandFeature = require('vscode-languageclient/lib/common/executeCommand.js').ExecuteCommandFeature
    } finally {
      loader._load = load
    }
  }
  return new ExecuteCommandFeature({ middleware: {} })
}

/** The command ids the bundled language server advertises in its initialize result. */
async function serverCommands(): Promise<string[]> {
  const server = spawn(process.execPath, [serverModulePath({ asAbsolutePath: (path) => join(projectRoot, path) }), '--stdio'])
  try {
    const body = JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { processId: null, rootUri: null, capabilities: {} },
    })
    server.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
    let buffer = ''
    for await (const chunk of server.stdout) {
      buffer += chunk
      const start = buffer.indexOf('\r\n\r\n')
      const length = Number(/Content-Length: (\d+)/.exec(buffer)?.[1])
      if (start < 0 || Buffer.byteLength(buffer.slice(start + 4)) < length) continue
      const message = JSON.parse(buffer.slice(start + 4, start + 4 + length))
      if (message.id === 1) return message.result.capabilities.executeCommandProvider?.commands ?? []
      buffer = buffer.slice(start + 4 + length)
    }
    throw new Error('the language server closed before answering initialize')
  } finally {
    server.kill()
  }
}

test('contributedCommands reads the command ids from package.json', () => {
  const owned = contributedCommands(packageJSON)
  assert.ok(owned.has('carve.exportPdf'))
  assert.ok(owned.has('carve.restartLanguageServer'))
  assert.deepEqual(contributedCommands(undefined), new Set())
})

test('the bundled server commands register next to the extension commands', async () => {
  const commands = await serverCommands()
  assert.ok(commands.includes('carve.listIndent'))
  const owned = contributedCommands(packageJSON)
  const registry = commandRegistry()
  for (const id of owned) registry.registerCommand(id)
  const feature = executeCommandFeature(registry)
  skipOwnedCommands(feature, owned)
  assert.doesNotThrow(() => feature.register({ id: 'static', registerOptions: { commands } }))
  for (const command of commands) assert.ok(registry.ids.has(command), command)
})

test('without skipping, a server id the extension owns fails registration', () => {
  const registry = commandRegistry()
  registry.registerCommand('carve.exportPdf')
  const feature = executeCommandFeature(registry)
  assert.throws(
    () => feature.register({ id: 'static', registerOptions: { commands: ['carve.listIndent', 'carve.exportPdf'] } }),
    /command 'carve.exportPdf' already exists/,
  )
})

test('skipOwnedCommands leaves registrations without owned ids unchanged', () => {
  const seen: (string[] | undefined)[] = []
  const feature: CommandFeature<{ commands?: string[], workDoneProgress?: boolean }> = {
    register: (data) => { seen.push(data.registerOptions.commands) },
  }
  skipOwnedCommands(feature, new Set(['carve.exportPdf']))
  feature.register({ id: 'a', registerOptions: { commands: ['carve.listIndent', 'carve.exportPdf'] } })
  feature.register({ id: 'b', registerOptions: { workDoneProgress: true } })
  assert.deepEqual(seen, [['carve.listIndent'], undefined])
})
