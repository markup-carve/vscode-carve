import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as vscode from 'vscode'
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from 'vscode-languageclient/node.js'
import { buildBundle, bundleDirectory, bundleSummary, type IncludeWalk } from './bundle.js'
import {
  expandForRender,
  IncludeCache,
  refusalSummary,
  utf16Offset,
  watchTargets,
  type Engine,
  type ExpansionResult,
  type ServerResolver,
} from './include-expansion.js'
import { flattenDocument, flattenPath, flattenSummary, type Writer } from './flatten.js'
import { carveInitializationOptions, type CarveInitializationOptions } from './includes.js'
import { serverInternalPath, serverModulePath } from './paths.js'
import { isLineOnScreen, isScrollNotTyping } from './scroll.js'
import {
  exportHtmlDocument,
  renderMarkdown,
  previewDocument,
  previewExtensions,
  type PreviewAssets,
  type PreviewRenderOptions,
} from './preview.js'

const RENDER_DEBOUNCE_MS = 250

let client: LanguageClient | undefined
let previewPanel: vscode.WebviewPanel | undefined
let previewUri: vscode.Uri | undefined
let suppressEditorScroll = false
/** When the previewed document last changed, to tell typing from scrolling. */
let lastEditAt = 0
let renderTimer: ReturnType<typeof setTimeout> | undefined
/** Include warnings for the previewed document, cleared when it stops failing. */
let includeDiagnostics: vscode.DiagnosticCollection | undefined
/** Watchers over the targets the last render touched, resolved or attempted. */
let includeWatchers: vscode.FileSystemWatcher[] = []
const includeCache = new IncludeCache()

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  includeDiagnostics = vscode.languages.createDiagnosticCollection('carve-includes')
  context.subscriptions.push(
    includeDiagnostics,
    vscode.commands.registerCommand('carve.openPreview', () => openPreview(context)),
    vscode.commands.registerCommand('carve.exportHtml', () => exportHtml(context)),
    vscode.commands.registerCommand('carve.exportMarkdown', () => exportMarkdown(context)),
    vscode.commands.registerCommand('carve.exportBundle', () => exportBundle(context)),
    vscode.commands.registerCommand('carve.exportFlattened', () => exportFlattened(context)),
    vscode.commands.registerCommand('carve.copyFlattened', () => copyFlattened(context)),
    vscode.commands.registerCommand('carve.printPreview', () => printPreview(context)),
    vscode.commands.registerCommand('carve.formatCanonical', async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor || editor.document.languageId !== 'carve') return
      const text = editor.document.getText()
      const { carveToCarve } = await import('@markup-carve/carve')
      const formatted = carveToCarve(text)
      if (formatted === text) {
        void vscode.window.showInformationMessage('Carve: already canonical.')
        return
      }
      const whole = new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(text.length),
      )
      await editor.edit((builder) => builder.replace(whole, formatted))
    }),
    vscode.commands.registerCommand('carve.restartLanguageServer', async () => {
      await stopLanguageServer()
      await startLanguageServer(context)
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (
        event.affectsConfiguration('carve.lsp.enabled') ||
        event.affectsConfiguration('carve.formatter') ||
        // The include settings ride in initializationOptions, which is read
        // once at startup, so a change to them only takes effect on a restart.
        event.affectsConfiguration('carve.includes')
      ) {
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
        lastEditAt = Date.now()
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
  for (const watcher of includeWatchers) watcher.dispose()
  includeWatchers = []
  includeCache.invalidate()
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
  void renderPreviewNow(context, document)
}

/**
 * Render the preview, expanding includes when the document is allowed them.
 *
 * On by default, rooted where the editor already is - the containment root the
 * language server decided, never the process working directory - so a document
 * previewed here and one rendered by `carve` agree (#185). The gate is the
 * server's: it returns nothing when includes are off for this document, and the
 * preview then renders the directive as written, exactly as before.
 *
 * Three obligations §19 puts on a host ride along, because each is invisible
 * when it is missing. INVALIDATION watches every target the expansion touched,
 * resolved and merely attempted, so creating a previously-missing file
 * re-renders. DIAGNOSTICS publish the warnings the spec already requires, so an
 * unresolved target, a cycle, a containment denial, a depth or a size refusal
 * does not sit on the page looking like ordinary prose. CACHING keys child
 * sources on identity plus modification time so a keystroke does not re-read
 * every chapter.
 */
async function renderPreviewNow(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
): Promise<void> {
  if (!previewPanel) {
    return
  }
  // ONE set for the parse and the render. Several of these change the parse
  // rather than the render, so a parse made without them reads the document
  // differently - and two fresh sets would split a stateful extension across
  // two instances (#209).
  const extensions = previewExtensions()
  const expansion = await expandIncludesFor(context, document, extensions)
  previewPanel.title = `Preview ${document.fileName.split(/[\\/]/).pop() ?? 'Carve'}`
  const render = previewRenderOptions()
  render.extensions = extensions
  if (expansion) render.document = expansion.doc
  previewPanel.webview.html = previewDocument(document.getText(), {
    nonce: nonce(),
    cspSource: previewPanel.webview.cspSource,
    assets: previewAssets(context, previewPanel.webview),
    render,
  })
  publishIncludeDiagnostics(document, expansion)
  watchIncludeTargets(context, document, expansion)
}

/**
 * The engine calls this render performs, as one object so a test can stand in
 * for them. Imported lazily: the module graph is the extension's own, and the
 * preview already resolves the engine from it.
 */
async function engineForExpansion(): Promise<Engine> {
  const engine = (await import('@markup-carve/carve')) as unknown as Engine
  return engine
}

/**
 * The server's include gate and its resolver for this document, or undefined
 * when includes are off for it.
 *
 * Everything comes out of the installed carve-lsp - the settings reader, the
 * trust reader, the gate, the resolver - so the containment decision the
 * preview obeys is the one the server is already enforcing for diagnostics and
 * go-to-definition. Two answers to "what may this document read" is one too
 * many.
 */
async function includeGateFor(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
): Promise<{ resolver: ServerResolver; includeRoot: string } | undefined> {
  const settings = (await import(
    pathToFileURL(serverInternalPath(context, 'include-settings.js')).href
  )) as Record<string, Function>
  const sent = includePayload()
  const options = settings.includeOptionsFor!({
    uri: document.uri.toString(),
    settings: settings.readIncludeSettings!(sent),
    workspaceTrusted: settings.readWorkspaceTrusted!(sent),
    workspaceRoots: (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),
  }) as { includeRoot?: string; resolver?: ServerResolver } | undefined
  if (!options?.includeRoot || !options.resolver) return undefined
  return { resolver: options.resolver, includeRoot: options.includeRoot }
}

async function expandIncludesFor(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  extensions: ReturnType<typeof previewExtensions>,
): Promise<ExpansionResult | undefined> {
  // An unsaved buffer has no folder to resolve a relative target against, so
  // there is nothing to expand rather than something to guess.
  if (document.isUntitled) return undefined
  const gate = await includeGateFor(context, document)
  if (!gate) return undefined
  try {
    return expandForRender(await engineForExpansion(), {
      source: document.getText(),
      sourcePath: document.uri.fsPath,
      resolve: gate.resolver,
      extensions,
      cache: includeCache,
    })
  } catch (error) {
    // A render that cannot expand still shows the document. The failure is
    // surfaced rather than swallowed; falling back silently is the behavior
    // this feature exists to end.
    void vscode.window.showWarningMessage(
      `Carve: includes could not be expanded, so the preview shows the directives as written. ${String(error)}`,
    )
    return undefined
  }
}

/**
 * Publish the include warnings against the document that raised them.
 *
 * §19 I7 keeps the failure CLASS out of the rendered message - a resolver's own
 * error text routinely carries absolute host paths - so the class travels in
 * the diagnostic's `code` instead, where tooling can read it and a screenshot
 * does not leak a home directory.
 */
function publishIncludeDiagnostics(
  document: vscode.TextDocument,
  expansion: ExpansionResult | undefined,
): void {
  if (!includeDiagnostics) return
  if (!expansion) {
    includeDiagnostics.delete(document.uri)
    return
  }
  const denialFor = new Map(expansion.refusals.map((refusal) => [refusal.path, refusal.denial]))
  // The engine counts codepoints and `positionAt` counts UTF-16 units (#212).
  const source = document.getText()
  const diagnostics = expansion.warnings.map((warning) => {
    const range = new vscode.Range(
      document.positionAt(utf16Offset(source, warning.start)),
      document.positionAt(utf16Offset(source, warning.end)),
    )
    const diagnostic = new vscode.Diagnostic(range, warning.message, vscode.DiagnosticSeverity.Warning)
    diagnostic.source = 'carve'
    const denial = [...denialFor].find(([path]) => warning.message.includes(path))?.[1]
    diagnostic.code = denial ? `${warning.rule}/${denial}` : warning.rule
    return diagnostic
  })
  if (expansion.suppressedWarnings > 0) {
    diagnostics.push(
      new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 0),
        `${expansion.suppressedWarnings} further include warnings were not reported.`,
        vscode.DiagnosticSeverity.Information,
      ),
    )
  }
  includeDiagnostics.set(document.uri, diagnostics)
}

/**
 * Re-render when an included file changes.
 *
 * The attempted targets are watched too, not only the resolved ones: a preview
 * that followed successful reads alone would never notice a missing chapter
 * being created, and would stay stale in exactly the case includes are for.
 */
function watchIncludeTargets(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  expansion: ExpansionResult | undefined,
): void {
  for (const watcher of includeWatchers) watcher.dispose()
  includeWatchers = []
  if (!expansion) return
  for (const target of watchTargets(expansion)) {
    const watcher = vscode.workspace.createFileSystemWatcher(target)
    const invalidate = (): void => {
      includeCache.invalidate(target)
      if (previewUri && document.uri.toString() === previewUri.toString()) {
        scheduleRender(context, document)
      }
    }
    watcher.onDidChange(invalidate, undefined, context.subscriptions)
    watcher.onDidCreate(invalidate, undefined, context.subscriptions)
    watcher.onDidDelete(invalidate, undefined, context.subscriptions)
    includeWatchers.push(watcher)
  }
}

/**
 * Say out loud what a one-shot export refused to read.
 *
 * A preview reports refusals as diagnostics, which sit beside the text. An
 * export writes a file and walks away, so a swallowed denial reaches whoever
 * the file is sent to - a missing chapter and a chapter that was never included
 * look identical on the page.
 */
function reportRefusals(expansion: ExpansionResult | undefined): void {
  const summary = expansion ? refusalSummary(expansion) : null
  if (summary) void vscode.window.showWarningMessage(summary)
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

/**
 * Every target except Carve source expands, so HTML, Markdown and anything
 * downstream of them carry the children in (#191, flavor 1). Writing the
 * document back as Carve deliberately does NOT - spec I15 requires the writer
 * to return the author's document - which is why flattening is a separate,
 * named command rather than a mode of this one.
 */
async function exportHtml(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor
  if (!editor || editor.document.languageId !== 'carve') {
    void vscode.window.showWarningMessage('Open a Carve document to export it.')
    return
  }
  const name = editor.document.fileName.split(/[\\/]/).pop() ?? 'Carve document'
  const extensions = previewExtensions()
  const expansion = await expandIncludesFor(context, editor.document, extensions)
  reportRefusals(expansion)
  const render = previewRenderOptions()
  render.extensions = extensions
  if (expansion) render.document = expansion.doc
  const html = exportHtmlDocument(editor.document.getText(), {
    title: name,
    render,
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

/**
 * Run the include walk the language server performs, through the server's own
 * gate.
 *
 * Every piece of this - the settings reader, the trust reader, the gate, the
 * walk - comes out of the installed carve-lsp rather than being rebuilt here,
 * so the containment decision the bundle obeys is the one the server is already
 * enforcing. The gate returns undefined when includes are off for this document
 * (spec section 19 makes the capability opt-in, and silence means no); the
 * bundle is then just the document itself.
 */
async function walkIncludes(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
): Promise<{ walk: IncludeWalk; includeRoot: string } | undefined> {
  const settings = (await import(
    pathToFileURL(serverInternalPath(context, 'include-settings.js')).href
  )) as Record<string, Function>
  const includes = (await import(
    pathToFileURL(serverInternalPath(context, 'includes.js')).href
  )) as Record<string, Function>
  const sent = includePayload()
  const options = settings.includeOptionsFor!({
    uri: document.uri.toString(),
    settings: settings.readIncludeSettings!(sent),
    workspaceTrusted: settings.readWorkspaceTrusted!(sent),
    workspaceRoots: (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),
  }) as { includeRoot?: string } | undefined
  if (!options?.includeRoot) return undefined
  return {
    walk: includes.resolveIncludes!(document.getText(), options) as IncludeWalk,
    includeRoot: options.includeRoot,
  }
}

/**
 * Write the document and every file it includes into a folder beside it.
 *
 * Flattening - one self-contained `.crv` - is the other half of this ticket and
 * is a separate command by design: a Carve export must NOT expand, because spec
 * I15 requires writing a document back as Carve to return the author's
 * document. Issue 198 carries it.
 */
async function exportBundle(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor
  if (!editor || editor.document.languageId !== 'carve') {
    void vscode.window.showWarningMessage('Open a Carve document to bundle it.')
    return
  }
  if (editor.document.isUntitled) {
    void vscode.window.showWarningMessage('Save the document before bundling it: an unsaved file has no folder to resolve its includes against.')
    return
  }
  const walked = await walkIncludes(context, editor.document)
  if (!walked) {
    void vscode.window.showWarningMessage('Carve: include resolution is off for this document, so there is nothing to bundle. Trust the workspace, or set carve.includes.enabled.')
    return
  }
  const documentPath = editor.document.uri.fsPath
  const bundle = buildBundle({
    documentPath,
    source: editor.document.getText(),
    includeRoot: walked.includeRoot,
    walk: walked.walk,
  })
  const directory = bundleDirectory(documentPath, (candidate) => existsSync(candidate))
  if (directory === null) {
    void vscode.window.showWarningMessage('Carve: no free name left for a bundle of this document.')
    return
  }
  const root = vscode.Uri.file(directory)
  for (const file of bundle.files) {
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, ...file.path.split('/')), new TextEncoder().encode(file.source))
  }
  const pick = await vscode.window.showInformationMessage(bundleSummary(bundle, basename(directory)), 'Reveal')
  if (pick === 'Reveal') await vscode.commands.executeCommand('revealFileInOS', root)
}

/**
 * Flatten the open document, or report why it could not be.
 *
 * Returns undefined rather than throwing when includes are off for the
 * document: flattening a document whose directives may not be resolved would
 * echo it back unchanged, which looks exactly like a document with no includes.
 */
async function flattenOpenDocument(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
): Promise<ReturnType<typeof flattenDocument> | undefined> {
  if (document.isUntitled) {
    void vscode.window.showWarningMessage(
      'Save the document first: an unsaved file has no folder to resolve its includes against.',
    )
    return undefined
  }
  const gate = await includeGateFor(context, document)
  if (!gate) {
    void vscode.window.showWarningMessage(
      'Carve: include resolution is off for this document, so there is nothing to flatten. Trust the workspace, or set carve.includes.enabled.',
    )
    return undefined
  }
  const engine = (await import('@markup-carve/carve')) as unknown as Engine & Writer
  // No extension set, deliberately: `carve flatten` parses without one, and the
  // output has to match the CLI byte for byte. A render passes the set it
  // renders with (#209); this is the other case.
  return flattenDocument(engine, {
    source: document.getText(),
    sourcePath: document.uri.fsPath,
    resolve: gate.resolver,
    extensions: [],
    cache: includeCache,
  })
}

/** One self-contained `.crv` beside the original, never overwriting it. */
async function exportFlattened(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor
  if (!editor || editor.document.languageId !== 'carve') {
    void vscode.window.showWarningMessage('Open a Carve document to flatten it.')
    return
  }
  const flattened = await flattenOpenDocument(context, editor.document)
  if (!flattened) return
  const destination = flattenPath(editor.document.uri.fsPath, (candidate) => existsSync(candidate))
  if (destination === null) {
    void vscode.window.showWarningMessage('Carve: no free name left for a flattened copy of this document.')
    return
  }
  const target = vscode.Uri.file(destination)
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(flattened.text))
  const pick = await vscode.window.showInformationMessage(
    flattenSummary(flattened, basename(destination)),
    'Open File',
  )
  if (pick === 'Open File') {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target))
  }
}

/** The same primitive, with the clipboard as the destination. */
async function copyFlattened(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor
  if (!editor || editor.document.languageId !== 'carve') {
    void vscode.window.showWarningMessage('Open a Carve document to copy it.')
    return
  }
  const flattened = await flattenOpenDocument(context, editor.document)
  if (!flattened) return
  await vscode.env.clipboard.writeText(flattened.text)
  void vscode.window.showInformationMessage(flattenSummary(flattened, 'the clipboard'))
}

async function exportMarkdown(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor
  if (!editor || editor.document.languageId !== 'carve') {
    void vscode.window.showWarningMessage('Open a Carve document to export it.')
    return
  }
  // The Markdown target is the engine's own and enables no extension set, so
  // the expansion parses the same way: with none.
  const expansion = await expandIncludesFor(context, editor.document, [])
  reportRefusals(expansion)
  const markdown = renderMarkdown(editor.document.getText(), expansion?.doc)
  const defaultPath = editor.document.uri.path.replace(/\.crv$/i, '') + '.md'
  const target = await vscode.window.showSaveDialog({
    defaultUri: editor.document.uri.with({ path: defaultPath }),
    filters: { Markdown: ['md'] },
    saveLabel: 'Export Markdown',
  })
  if (!target) {
    return
  }
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(markdown))
  const pick = await vscode.window.showInformationMessage(
    `Exported ${target.path.split('/').pop()}`,
    'Open File',
  )
  if (pick === 'Open File') {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target))
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
  if (isLineOnScreen(target, editor.visibleRanges)) return
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
  // Sync on a real scroll, not on the viewport shifting because a line was
  // added. Syncing on typing is what starts the editor-preview-editor loop.
  if (!isScrollNotTyping(Date.now(), lastEditAt)) {
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

/**
 * The payload the language server is started with.
 *
 * Anything that asks the server's include gate a question asks it this exact
 * question, so a second caller cannot end up with a different containment root
 * than the one the server is enforcing.
 */
function includePayload(): CarveInitializationOptions {
  return carveInitializationOptions({
    formatter: vscode.workspace.getConfiguration('carve').get('formatter', 'conservative'),
    includes: {
      enabled: vscode.workspace.getConfiguration('carve.includes').get('enabled'),
      includeRoot: vscode.workspace.getConfiguration('carve.includes').get('includeRoot'),
      allowAbsolute: vscode.workspace.getConfiguration('carve.includes').get('allowAbsolute'),
    },
    workspaceTrusted: vscode.workspace.isTrusted,
  })
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
    initializationOptions: includePayload(),
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
