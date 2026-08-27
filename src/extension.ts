import { fileURLToPath } from 'node:url'
import * as vscode from 'vscode'
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from 'vscode-languageclient/node.js'
import { serverModulePath } from './paths.js'
import {
  exportHtmlDocument,
  previewDocument,
  type PreviewAssets,
  type PreviewRenderOptions,
} from './preview.js'

const RENDER_DEBOUNCE_MS = 250

let client: LanguageClient | undefined
let previewPanel: vscode.WebviewPanel | undefined
let previewUri: vscode.Uri | undefined
let suppressEditorScroll = false
let renderTimer: ReturnType<typeof setTimeout> | undefined

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(
    vscode.commands.registerCommand('carve.openPreview', () => openPreview(context)),
    vscode.commands.registerCommand('carve.exportHtml', () => exportHtml()),
    vscode.commands.registerCommand('carve.printPreview', () => printPreview(context)),
    vscode.commands.registerCommand('carve.restartLanguageServer', async () => {
      await stopLanguageServer()
      await startLanguageServer(context)
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (event.affectsConfiguration('carve.lsp.enabled')) {
        await stopLanguageServer()
        await startLanguageServer(context)
      }
      if (event.affectsConfiguration('carve.preview') && previewPanel && previewUri) {
        const document = vscode.workspace.textDocuments.find(
          (doc) => doc.uri.toString() === previewUri?.toString(),
        )
        if (document) renderPreview(context, document)
      }
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (previewPanel && previewUri && event.document.uri.toString() === previewUri.toString()) {
        scheduleRender(context, event.document)
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (previewPanel && editor && editor.document.languageId === 'carve') {
        if (renderTimer) {
          clearTimeout(renderTimer)
          renderTimer = undefined
        }
        previewUri = editor.document.uri
        renderPreview(context, editor.document)
      }
    }),
    vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
      syncPreviewToEditor(event.textEditor, event.visibleRanges)
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      highlightPreviewLine(event.textEditor, event.selections)
    }),
  )

  await startLanguageServer(context)
}

export async function deactivate(): Promise<void> {
  if (renderTimer) {
    clearTimeout(renderTimer)
    renderTimer = undefined
  }
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
      if (renderTimer) {
        clearTimeout(renderTimer)
        renderTimer = undefined
      }
    }, undefined, context.subscriptions)
    previewPanel.webview.onDidReceiveMessage((message) => {
      if (message?.type === 'reveal') {
        revealEditorLine(message.line)
      } else if (message?.type === 'copy') {
        void copyToClipboard(message.id, message.text)
      }
    }, undefined, context.subscriptions)
  }

  previewUri = editor.document.uri
  renderPreview(context, editor.document)
}

function scheduleRender(context: vscode.ExtensionContext, document: vscode.TextDocument): void {
  if (renderTimer) {
    clearTimeout(renderTimer)
  }
  renderTimer = setTimeout(() => {
    renderTimer = undefined
    // The preview may have switched to another document during the debounce
    // window; only render if this document is still the one being previewed.
    if (previewUri && document.uri.toString() === previewUri.toString()) {
      renderPreview(context, document)
    }
  }, RENDER_DEBOUNCE_MS)
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
    render: previewRenderOptions(),
  })
}

function previewRenderOptions(): PreviewRenderOptions {
  const config = vscode.workspace.getConfiguration('carve.preview')
  const mentionUrl = config.get<string>('mentionUrl')?.trim()
  const tagUrl = config.get<string>('tagUrl')?.trim()
  const emoji = config.get<Record<string, string>>('emoji')
  const options: PreviewRenderOptions = {}
  if (mentionUrl) options.mentionUrl = mentionUrl
  if (tagUrl) options.tagUrl = tagUrl
  if (emoji && Object.keys(emoji).length) options.emoji = emoji
  return options
}

async function exportHtml(): Promise<void> {
  const editor = vscode.window.activeTextEditor
  if (!editor || editor.document.languageId !== 'carve') {
    void vscode.window.showWarningMessage('Open a Carve document to export it.')
    return
  }
  const name = editor.document.fileName.split(/[\\/]/).pop() ?? 'Carve document'
  const html = exportHtmlDocument(editor.document.getText(), {
    title: name,
    render: previewRenderOptions(),
  })
  const defaultPath = editor.document.uri.path.replace(/\.crv$/i, '') + '.html'
  const target = await vscode.window.showSaveDialog({
    defaultUri: editor.document.uri.with({ path: defaultPath }),
    filters: { HTML: ['html'] },
    saveLabel: 'Export HTML',
  })
  if (!target) {
    return
  }
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(html))
  const pick = await vscode.window.showInformationMessage(
    `Exported ${target.path.split('/').pop()}`,
    'Open in Browser',
  )
  if (pick === 'Open in Browser') {
    await vscode.env.openExternal(target)
  }
}

function printPreview(context: vscode.ExtensionContext): void {
  if (!previewPanel) {
    const editor = vscode.window.activeTextEditor
    if (!editor || editor.document.languageId !== 'carve') {
      void vscode.window.showWarningMessage('Open a Carve document to print it.')
      return
    }
    openPreview(context)
    // Give the freshly created webview time to load before printing.
    setTimeout(() => void previewPanel?.webview.postMessage({ type: 'print' }), 700)
    return
  }
  void previewPanel.webview.postMessage({ type: 'print' })
}

/**
 * Write a code block to the clipboard on the webview's behalf, and tell it
 * whether that worked.
 *
 * The webview cannot do this itself: it runs in an iframe, and the async
 * clipboard API is gated behind a `clipboard-write` permission policy the frame
 * is not granted, so `navigator.clipboard.writeText` rejects there. The host has
 * `vscode.env.clipboard`, which carries no such restriction.
 *
 * The reply is keyed by the request id the webview sent, so two quick clicks
 * cannot answer each other, and a failure comes back as `ok: false` rather than
 * as silence - a copy button that quietly does nothing is worse than none.
 */
async function copyToClipboard(id: unknown, text: unknown): Promise<void> {
  let ok = false
  try {
    if (typeof text === 'string') {
      await vscode.env.clipboard.writeText(text)
      ok = true
    }
  } catch {
    ok = false
  }
  void previewPanel?.webview.postMessage({ type: 'copied', id, ok })
}

function previewAssets(context: vscode.ExtensionContext, webview: vscode.Webview): PreviewAssets {
  const asset = (...segments: string[]): string =>
    webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, ...segments)).toString()

  return {
    mermaid: asset('media', 'mermaid.min.js'),
    chartJs: asset('media', 'chart.umd.js'),
    katexJs: asset('media', 'katex', 'katex.min.js'),
    katexCss: asset('media', 'katex', 'katex.min.css'),
    katexAutoRender: asset('media', 'katex', 'auto-render.min.js'),
    hljsJs: asset('media', 'hljs', 'highlight.min.js'),
    hljsLightCss: asset('media', 'hljs', 'github.min.css'),
    hljsDarkCss: asset('media', 'hljs', 'github-dark.min.css'),
    carveTokensCss: asset('media', 'carve-css', 'tokens.css'),
    carveCoreCss: asset('media', 'carve-css', 'core.css'),
    carveExtensionsCss: asset('media', 'carve-css', 'extensions.css'),
    carveRecipesCss: asset('media', 'carve-css', 'recipes.css'),
  }
}

/** Webview reported its top block's source line; scroll the editor to match. */
function revealEditorLine(line: number): void {
  if (!previewUri || typeof line !== 'number') {
    return
  }
  const editor = vscode.window.visibleTextEditors.find(
    (candidate) => candidate.document.uri.toString() === previewUri?.toString(),
  )
  if (!editor) {
    return
  }
  // data-source-line is 1-based; editor lines are 0-based.
  const target = Math.min(Math.max(0, line - 1), Math.max(0, editor.document.lineCount - 1))
  const range = new vscode.Range(target, 0, target, 0)
  suppressEditorScroll = true
  editor.revealRange(range, vscode.TextEditorRevealType.AtTop)
  setTimeout(() => { suppressEditorScroll = false }, 100)
}

/** Editor scrolled; tell the webview which source line is at the top. */
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
  const line = visibleRanges[0].start.line + 1
  void previewPanel.webview.postMessage({ type: 'scrollToLine', line })
}

/** Cursor moved; highlight the block under the caret in the preview. */
function highlightPreviewLine(
  editor: vscode.TextEditor,
  selections: readonly vscode.Selection[],
): void {
  if (!previewPanel || !previewUri || selections.length === 0) {
    return
  }
  if (editor.document.uri.toString() !== previewUri.toString()) {
    return
  }
  const line = selections[0].active.line + 1
  void previewPanel.webview.postMessage({ type: 'highlightLine', line })
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
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.crv'),
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
