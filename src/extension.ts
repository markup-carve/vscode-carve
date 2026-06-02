import { fileURLToPath } from 'node:url'
import * as vscode from 'vscode'
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from 'vscode-languageclient/node.js'
import { serverModulePath } from './paths.js'
import { previewDocument, type PreviewAssets } from './preview.js'

let client: LanguageClient | undefined
let previewPanel: vscode.WebviewPanel | undefined
let previewUri: vscode.Uri | undefined
let suppressEditorScroll = false

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
        renderPreview(context, event.document)
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (previewPanel && editor && editor.document.languageId === 'carve') {
        previewUri = editor.document.uri
        renderPreview(context, editor.document)
      }
    }),
    vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
      syncPreviewToEditor(event.textEditor, event.visibleRanges)
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

  if (!previewPanel) {
    previewPanel = vscode.window.createWebviewPanel(
      'carvePreview',
      'Carve Preview',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [context.extensionUri],
      },
    )
    previewPanel.onDidDispose(() => {
      previewPanel = undefined
      previewUri = undefined
    }, undefined, context.subscriptions)
    previewPanel.webview.onDidReceiveMessage((message) => {
      if (message?.type === 'scroll') {
        syncEditorToPreview(message.ratio)
      }
    }, undefined, context.subscriptions)
  }

  previewUri = editor.document.uri
  renderPreview(context, editor.document)
}

function renderPreview(context: vscode.ExtensionContext, document: vscode.TextDocument): void {
  if (!previewPanel) {
    return
  }
  previewPanel.title = `Preview ${document.fileName.split(/[\\/]/).pop() ?? 'Carve'}`
  previewPanel.webview.html = previewDocument(document.getText(), {
    nonce: nonce(),
    cspSource: previewPanel.webview.cspSource,
    assets: previewAssets(context, previewPanel.webview),
  })
}

function previewAssets(context: vscode.ExtensionContext, webview: vscode.Webview): PreviewAssets {
  const asset = (...segments: string[]): string =>
    webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, ...segments)).toString()

  return {
    mermaid: asset('node_modules', 'mermaid', 'dist', 'mermaid.min.js'),
    katexJs: asset('node_modules', 'katex', 'dist', 'katex.min.js'),
    katexCss: asset('node_modules', 'katex', 'dist', 'katex.min.css'),
    katexAutoRender: asset('node_modules', 'katex', 'dist', 'contrib', 'auto-render.min.js'),
    hljsJs: asset('node_modules', '@highlightjs', 'cdn-assets', 'highlight.min.js'),
    hljsLightCss: asset('node_modules', '@highlightjs', 'cdn-assets', 'styles', 'github.min.css'),
    hljsDarkCss: asset('node_modules', '@highlightjs', 'cdn-assets', 'styles', 'github-dark.min.css'),
  }
}

function syncEditorToPreview(ratio: number): void {
  if (!previewUri) {
    return
  }
  const editor = vscode.window.visibleTextEditors.find(
    (candidate) => candidate.document.uri.toString() === previewUri?.toString(),
  )
  if (!editor) {
    return
  }
  const line = Math.round(ratio * Math.max(0, editor.document.lineCount - 1))
  const range = new vscode.Range(line, 0, line, 0)
  suppressEditorScroll = true
  editor.revealRange(range, vscode.TextEditorRevealType.AtTop)
  setTimeout(() => { suppressEditorScroll = false }, 100)
}

function syncPreviewToEditor(
  editor: vscode.TextEditor,
  visibleRanges: readonly vscode.Range[],
): void {
  if (suppressEditorScroll || !previewPanel || !previewUri) {
    return
  }
  if (editor.document.uri.toString() !== previewUri.toString() || visibleRanges.length === 0) {
    return
  }
  const topLine = visibleRanges[0].start.line
  const ratio = topLine / Math.max(1, editor.document.lineCount - 1)
  void previewPanel.webview.postMessage({ type: 'scrollTo', ratio })
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
    documentSelector: [
      { scheme: 'file', language: 'carve' },
      { scheme: 'untitled', language: 'carve' },
    ],
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
