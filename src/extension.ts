import { fileURLToPath } from 'node:url'
import * as vscode from 'vscode'
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from 'vscode-languageclient/node.js'
import { serverModulePath } from './paths.js'
import { previewDocument } from './preview.js'

let client: LanguageClient | undefined
let previewPanel: vscode.WebviewPanel | undefined
let previewUri: vscode.Uri | undefined

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(
    vscode.commands.registerCommand('carve.openPreview', () => openPreview(context)),
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
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (previewPanel && previewUri && event.document.uri.toString() === previewUri.toString()) {
        renderPreview(event.document)
      }
    }),
  )

  await startLanguageServer(context)
}

export async function deactivate(): Promise<void> {
  previewPanel?.dispose()
  await stopLanguageServer()
}

function openPreview(context: vscode.ExtensionContext): void {
  const editor = vscode.window.activeTextEditor
  if (!editor || editor.document.languageId !== 'carve') {
    void vscode.window.showWarningMessage('Open a Carve document to preview it.')
    return
  }

  previewPanel ??= vscode.window.createWebviewPanel(
    'carvePreview',
    'Carve Preview',
    vscode.ViewColumn.Beside,
    {
      enableScripts: false,
      retainContextWhenHidden: true,
    },
  )
  previewPanel.onDidDispose(() => {
    previewPanel = undefined
    previewUri = undefined
  }, undefined, context.subscriptions)

  previewUri = editor.document.uri
  renderPreview(editor.document)
}

function renderPreview(document: vscode.TextDocument): void {
  if (!previewPanel) {
    return
  }
  previewPanel.title = `Preview ${document.fileName.split(/[\\/]/).pop() ?? 'Carve'}`
  previewPanel.webview.html = previewDocument(document.getText(), nonce())
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

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let value = ''
  for (let index = 0; index < 32; index++) {
    value += chars[Math.floor(Math.random() * chars.length)]
  }
  return value
}
