import { fileURLToPath } from 'node:url'
import * as vscode from 'vscode'
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from 'vscode-languageclient/node.js'
import { serverModulePath } from './paths.js'

let client: LanguageClient | undefined

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(
    vscode.commands.registerCommand('carve.restartLanguageServer', async () => {
      await stopLanguageServer()
      await startLanguageServer(context)
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (event.affectsConfiguration('carve.lsp.enabled')) {
        await stopLanguageServer()
        await startLanguageServer(context)
      }
    }),
  )

  await startLanguageServer(context)
}

export async function deactivate(): Promise<void> {
  await stopLanguageServer()
}

async function startLanguageServer(context: vscode.ExtensionContext): Promise<void> {
  if (client || !vscode.workspace.getConfiguration('carve').get('lsp.enabled', true)) {
    return
  }

  const serverModule = serverModulePath(context)
  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc,
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: {
        execArgv: ['--nolazy', '--inspect=6009'],
      },
    },
  }

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'carve' }],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{crv,carve}'),
    },
  }

  client = new LanguageClient('carve', 'Carve Language Server', serverOptions, clientOptions)
  context.subscriptions.push(client)
  await client.start()
}

async function stopLanguageServer(): Promise<void> {
  const running = client
  client = undefined
  await running?.stop()
}

export const extensionFile = fileURLToPath(import.meta.url)
