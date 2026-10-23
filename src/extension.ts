import { existsSync, realpathSync } from 'node:fs'
import { basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as vscode from 'vscode'
import {
  DidChangeConfigurationNotification,
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
import { enterCaretTarget, parkedCaret } from './enter-caret.js'
import { convertToCarve, IMPORT_EXTENSIONS, importFormatFor, importTargetPath } from './import.js'
import { carveInitializationOptions, type CarveInitializationOptions } from './includes.js'
import {
  LIST_INDENT_COMMAND,
  listIndentEdits,
  mergeListIndentEdits,
  selectedListLines,
  serverHasListIndent,
  useDefaultKey,
  type ListIndentDirection,
  type LspRange,
} from './list-indent.js'
import { serverInternalPath, serverModulePath } from './paths.js'
import { shouldHoldRender } from './preview-hold.js'
import { isLineOnScreen, isScrollNotTyping } from './scroll.js'
import { createTableMarkerScanner } from './table-colors.js'
import { columnColorGroups } from './delimited-columns.js'
import { carveColors, colorHex } from './color-picker.js'
import {
  exportHtmlDocument,
  renderMarkdown,
  previewDocument,
  previewExtensions,
  symbolsFromEmojiSetting,
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
/** Line (0-based) whose bare list marker is holding back a render. */
let heldRenderLine: number | undefined
/** Include warnings for the previewed document, cleared when it stops failing. */
let includeDiagnostics: vscode.DiagnosticCollection | undefined
/** Watchers over the targets the last render touched, resolved or attempted. */
let includeWatchers: vscode.FileSystemWatcher[] = []
let includeWatchedPaths = new Set<string>()
const includeCache = new IncludeCache()

/** Per-column colors for csv and tsv fence bodies, as [light, dark]. It cycles past the last one. */
const COLUMN_PALETTE: ReadonlyArray<readonly [string, string]> = [
  ['#0550ae', '#79c0ff'],
  ['#8250df', '#d2a8ff'],
  ['#116329', '#7ee787'],
  ['#953800', '#ffa657'],
  ['#bf3989', '#ff9bce'],
  ['#0a7d85', '#56d4dd'],
]

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(vscode.languages.registerColorProvider('carve', {
    provideDocumentColors(document) {
      return carveColors(document.getText()).map((match) => new vscode.ColorInformation(
        new vscode.Range(document.positionAt(match.start), document.positionAt(match.end)),
        new vscode.Color(match.red, match.green, match.blue, match.alpha),
      ))
    },
    provideColorPresentations(color, { document, range }) {
      const original = document.getText(range)
      return [new vscode.ColorPresentation(colorHex(color, original))]
    },
  }))
  const boundaryDecoration = vscode.window.createTextEditorDecorationType({
    light: { color: '#4f7f8d' },
    dark: { color: '#79a8b5' },
  })
  const operatorDecoration = vscode.window.createTextEditorDecorationType({
    light: { color: '#cf222e', fontWeight: 'bold' },
    dark: { color: '#ff7b72', fontWeight: 'bold' },
  })
  const plainDecoration = vscode.window.createTextEditorDecorationType({
    color: new vscode.ThemeColor('editor.foreground'),
    fontStyle: 'normal',
    fontWeight: 'normal',
  })
  const tableBodyDecoration = vscode.window.createTextEditorDecorationType({
    light: { backgroundColor: '#f2f7fb' },
    dark: { backgroundColor: '#25313a' },
  })
  const markerDecoration = vscode.window.createTextEditorDecorationType({
    light: { color: '#98680d' },
    dark: { color: '#d8aa57' },
  })
  const strongDecoration = vscode.window.createTextEditorDecorationType({ fontWeight: 'bold' })
  const emphasisDecoration = vscode.window.createTextEditorDecorationType({ fontStyle: 'italic' })
  const diffAddDecoration = vscode.window.createTextEditorDecorationType({
    light: { color: '#22863a', backgroundColor: 'rgba(46, 160, 67, 0.16)', fontWeight: 'bold' },
    dark: { color: '#85e89d', backgroundColor: 'rgba(46, 160, 67, 0.16)', fontWeight: 'bold' },
  })
  const diffRemoveDecoration = vscode.window.createTextEditorDecorationType({
    light: { color: '#b31d28', backgroundColor: 'rgba(248, 81, 73, 0.16)', fontWeight: 'bold' },
    dark: { color: '#fdaeb7', backgroundColor: 'rgba(248, 81, 73, 0.16)', fontWeight: 'bold' },
  })
  const columnDecorations = COLUMN_PALETTE.map(([light, dark]) => vscode.window.createTextEditorDecorationType({
    light: { color: light },
    dark: { color: dark },
  }))
  const decorations = [boundaryDecoration, operatorDecoration, plainDecoration, tableBodyDecoration,
    markerDecoration, strongDecoration, emphasisDecoration, diffAddDecoration, diffRemoveDecoration, ...columnDecorations]
  context.subscriptions.push(...decorations)
  void createTableMarkerScanner(context.extensionPath).then((scanTableMarkers) => {
    const updateTableMarkers = (editor: vscode.TextEditor): void => {
      if (editor.document.languageId !== 'carve') {
        for (const decoration of decorations) editor.setDecorations(decoration, [])
        return
      }
      const markers = scanTableMarkers(editor.document.getText(), editor.document.uri.toString())
      const ranges = (kind: typeof markers[number]['kind']) => markers
        .filter((marker) => marker.kind === kind)
        .map((marker) => new vscode.Range(marker.line, marker.start, marker.line, marker.end))
      editor.setDecorations(boundaryDecoration, ranges('boundary'))
      editor.setDecorations(operatorDecoration, ranges('operator'))
      editor.setDecorations(plainDecoration, ranges('plain'))
      editor.setDecorations(tableBodyDecoration, ranges('tableBody'))
      editor.setDecorations(markerDecoration, [...ranges('listMarker'), ...ranges('definitionMarker'), ...ranges('containerMarker')])
      editor.setDecorations(strongDecoration, ranges('strong'))
      editor.setDecorations(emphasisDecoration, ranges('emphasis'))
      editor.setDecorations(diffAddDecoration, ranges('diffAdd'))
      editor.setDecorations(diffRemoveDecoration, ranges('diffRemove'))
      const columnColors = vscode.workspace.getConfiguration('carve', editor.document.uri).get('csv.columnColors', false)
      columnColorGroups(markers, columnColors, columnDecorations.length).forEach((group, index) => editor.setDecorations(
        columnDecorations[index],
        group.map((marker) => new vscode.Range(marker.line, marker.start, marker.line, marker.end)),
      ))
    }
    const tableTimers = new Map<vscode.TextEditor, ReturnType<typeof setTimeout>>()
    const scheduleTableMarkers = (editor: vscode.TextEditor): void => {
      const previous = tableTimers.get(editor)
      if (previous) clearTimeout(previous)
      tableTimers.set(editor, setTimeout(() => {
        tableTimers.delete(editor)
        updateTableMarkers(editor)
      }, 120))
    }
    for (const editor of vscode.window.visibleTextEditors) updateTableMarkers(editor)
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration('carve.csv.columnColors')) return
        for (const editor of vscode.window.visibleTextEditors) updateTableMarkers(editor)
      }),
      vscode.window.onDidChangeVisibleTextEditors((editors) => {
        for (const editor of editors) updateTableMarkers(editor)
      }),
      vscode.workspace.onDidOpenTextDocument((document) => {
        for (const editor of vscode.window.visibleTextEditors) {
          if (editor.document === document) updateTableMarkers(editor)
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        for (const editor of vscode.window.visibleTextEditors) {
          if (editor.document === event.document) scheduleTableMarkers(editor)
        }
      }),
      { dispose: () => { for (const timer of tableTimers.values()) clearTimeout(timer) } },
    )
  }).catch((error) => {
    console.error('Carve table highlighting could not start', error)
  })
  includeDiagnostics = vscode.languages.createDiagnosticCollection('carve-includes')
  context.subscriptions.push(
    includeDiagnostics,
    vscode.commands.registerCommand('carve.openPreview', () => openPreview(context)),
    vscode.commands.registerCommand('carve.exportHtml', () => exportHtml(context)),
    vscode.commands.registerCommand('carve.exportMarkdown', () => exportMarkdown(context)),
    vscode.commands.registerCommand('carve.importFile', (uri?: vscode.Uri) => importFile(uri)),
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
    vscode.commands.registerCommand('carve.indentListItem', () => queueListShift('indent')),
    vscode.commands.registerCommand('carve.outdentListItem', () => queueListShift('outdent')),
    vscode.commands.registerCommand('carve.restartLanguageServer', async () => {
      await stopLanguageServer()
      await startLanguageServer(context)
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (
        event.affectsConfiguration('carve.lsp.enabled') ||
        event.affectsConfiguration('carve.formatter') ||
        event.affectsConfiguration('carve.format') ||
        event.affectsConfiguration('carve.extensions') ||
        event.affectsConfiguration('carve.platforms') ||
        event.affectsConfiguration('carve.severities') ||
        event.affectsConfiguration('carve.inlayHints') ||
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
      } else if (previewPanel && previewUri && watchedOpenPath(event.document)) {
        const parent = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === previewUri?.toString())
        if (parent) {
          includeCache.invalidate(canonicalPath(event.document.uri.fsPath))
          scheduleRender(context, parent)
        }
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (!previewPanel || !previewUri || !watchedOpenPath(document)) return
      includeCache.invalidate(canonicalPath(document.uri.fsPath))
      const parent = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === previewUri?.toString())
      if (parent) scheduleRender(context, parent)
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (previewPanel && editor && editor.document.languageId === 'carve') {
        // Keep the parent preview visible while editing one of its children.
        if (watchedOpenPath(editor.document)) {
          if (heldRenderLine !== undefined && !renderTimer && previewUri) {
            const held = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === previewUri?.toString())
            if (held) renderPreview(context, held)
          }
          return
        }
        if (renderTimer) {
          clearTimeout(renderTimer)
          renderTimer = undefined
        }
        previewUri = editor.document.uri
        renderPreview(context, editor.document)
      } else if (previewPanel && heldRenderLine !== undefined && !renderTimer) {
        // Focus left the Carve editor (another file, or the preview itself).
        const held = vscode.workspace.textDocuments.find(
          (doc) => doc.uri.toString() === previewUri?.toString(),
        )
        if (held) renderPreview(context, held)
      }
    }),
    vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
      syncPreviewToEditor(event.textEditor, event.visibleRanges)
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      highlightPreviewLine(event.textEditor, event.selections)
      releaseHeldRender(context, event.textEditor)
      if (event.textEditor === vscode.window.activeTextEditor) updateListItemContext(event.textEditor)
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => updateListItemContext(editor)),
    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.activeTextEditor
      if (editor?.document === event.document) updateListItemContext(editor)
    }),
  )
  updateListItemContext(vscode.window.activeTextEditor)

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
        localResourceRoots: previewResourceRoots(context, editor.document),
      },
    )
    previewRootsKey = previewResourceRoots(context, editor.document).map(String).join('\n')
    previewPanel.onDidDispose(() => {
      previewPanel = undefined
      previewUri = undefined
      previewRootsKey = undefined
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

let previewRootsKey: string | undefined

/**
 * What the preview may load: the extension's own assets, plus the document's
 * folder and its workspace folder, so a relative image can be shown.
 */
function previewResourceRoots(context: vscode.ExtensionContext, document: vscode.TextDocument): vscode.Uri[] {
  const roots = [context.extensionUri]
  if (document.isUntitled) return roots
  const folder = vscode.workspace.getWorkspaceFolder(document.uri)
  if (folder) roots.push(folder.uri)
  roots.push(vscode.Uri.joinPath(document.uri, '..'))
  return roots
}

/** A relative image source as a webview URI, resolved against the document's folder. */
function imageSourceResolver(
  webview: vscode.Webview,
  document: vscode.TextDocument,
): ((relative: string) => string | undefined) | undefined {
  if (document.isUntitled) return undefined
  return (relative) => {
    const [, path = '', suffix = ''] = /^([^?#]*)(.*)$/s.exec(relative) ?? []
    let decoded: string
    try {
      decoded = decodeURIComponent(path)
    } catch {
      return undefined
    }
    return webview.asWebviewUri(vscode.Uri.joinPath(document.uri, '..', decoded)).toString() + suffix
  }
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
      const line = cursorLineIn(document)
      if (line !== undefined && shouldHoldRender(document.getText(), line)) {
        heldRenderLine = line
        return
      }
      renderPreview(context, document)
    }
  }, RENDER_DEBOUNCE_MS)
}

/** The primary cursor line when `document` is in the active editor. */
function cursorLineIn(document: vscode.TextDocument): number | undefined {
  const editor = vscode.window.activeTextEditor
  if (!editor || editor.document.uri.toString() !== document.uri.toString()) return undefined
  return editor.selection.active.line
}

/** Render a held preview once the cursor has left the bare-marker line. */
function releaseHeldRender(context: vscode.ExtensionContext, editor: vscode.TextEditor): void {
  if (heldRenderLine === undefined || !previewUri) return
  if (editor.document.uri.toString() !== previewUri.toString()) return
  const line = editor.selection.active.line
  if (line === heldRenderLine && shouldHoldRender(editor.document.getText(), line)) return
  // A pending debounce renders with the same rules; let it.
  if (renderTimer) return
  renderPreview(context, editor.document)
}

function renderPreview(context: vscode.ExtensionContext, document: vscode.TextDocument): void {
  heldRenderLine = undefined
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
  const roots = previewResourceRoots(context, document)
  const rootsKey = roots.map(String).join('\n')
  if (rootsKey !== previewRootsKey) {
    previewRootsKey = rootsKey
    previewPanel.webview.options = { ...previewPanel.webview.options, localResourceRoots: roots }
  }
  previewPanel.webview.html = previewDocument(document.getText(), {
    nonce: nonce(),
    cspSource: previewPanel.webview.cspSource,
    assets: previewAssets(context, previewPanel.webview),
    render,
    resolveImageSource: imageSourceResolver(previewPanel.webview, document),
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
  openBuffers = false,
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
  const diskResolver = options.resolver
  if (!openBuffers) return { resolver: diskResolver, includeRoot: options.includeRoot }
  const openByPath = new Map<string, vscode.TextDocument>()
  for (const candidate of vscode.workspace.textDocuments) {
    if (candidate.uri.scheme !== 'file') continue
    const target = canonicalPath(candidate.uri.fsPath)
    if (target) openByPath.set(target, candidate)
  }
  const resolver: ServerResolver = (includePath, ctx) => {
    const result = diskResolver(includePath, ctx)
    if (!result.ok) return result
    const open = openByPath.get(result.id)
    if (!open) return result
    const source = open.getText()
    return { ...result, source, bytes: Buffer.byteLength(source), version: `open:${open.version}` }
  }
  return { resolver, includeRoot: options.includeRoot }
}

function canonicalPath(target: string): string | undefined {
  try { return realpathSync(target) } catch { return undefined }
}

function watchedOpenPath(document: vscode.TextDocument): boolean {
  if (document.uri.scheme !== 'file' || includeWatchedPaths.size === 0) return false
  return includeWatchedPaths.has(document.uri.fsPath)
    || includeWatchedPaths.has(canonicalPath(document.uri.fsPath) ?? '')
}

async function expandIncludesFor(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  extensions: ReturnType<typeof previewExtensions>,
): Promise<ExpansionResult | undefined> {
  // An unsaved buffer has no folder to resolve a relative target against, so
  // there is nothing to expand rather than something to guess.
  if (document.isUntitled) return undefined
  const gate = await includeGateFor(context, document, true)
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
  includeWatchedPaths = new Set()
  if (!expansion) return
  for (const target of watchTargets(expansion)) {
    includeWatchedPaths.add(target)
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
  const symbols = symbolsFromEmojiSetting(config.get<Record<string, string>>('emoji'))
  const options: PreviewRenderOptions = {}
  if (mentionUrl) options.mentionUrl = mentionUrl
  if (tagUrl) options.tagUrl = tagUrl
  if (symbols) options.symbols = symbols
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
  const gate = await includeGateFor(context, document, true)
  if (!gate) {
    void vscode.window.showWarningMessage(
      'Carve: include resolution is off for this document, so there is nothing to flatten. Trust the workspace, or set carve.includes.enabled.',
    )
    return undefined
  }
  const engine = (await import('@markup-carve/carve')) as unknown as Engine & Writer
  // No extension set: flatten keeps the CLI's parsing rules. Open editor
  // buffers, including children, are the source for this editor command.
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

async function importSource(uri: unknown): Promise<vscode.Uri | undefined> {
  if (uri instanceof vscode.Uri && importFormatFor(uri.path)) return uri
  const active = vscode.window.activeTextEditor?.document.uri
  if (active && importFormatFor(active.path)) return active
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { 'Markdown or HTML': IMPORT_EXTENSIONS.map((ext) => ext.slice(1)) },
    openLabel: 'Import to Carve',
  })
  return picked?.[0]
}

async function importFile(uri: unknown): Promise<void> {
  const source = await importSource(uri)
  if (!source) return
  const format = importFormatFor(source.path)
  if (!format) {
    void vscode.window.showWarningMessage('Pick a Markdown or HTML file to import.')
    return
  }
  const open = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === source.toString())
  const text = open
    ? open.getText()
    : new TextDecoder().decode(await vscode.workspace.fs.readFile(source))
  let result
  try {
    result = convertToCarve(text, format)
  } catch (error) {
    void vscode.window.showErrorMessage(`Carve import failed: ${(error as Error).message}`)
    return
  }
  const target = source.with({ path: importTargetPath(source.path) })
  const name = target.path.split('/').pop()
  if (await exists(target)) {
    const overwrite = await vscode.window.showWarningMessage(
      `${name} already exists. Overwrite it?`,
      { modal: true },
      'Overwrite',
    )
    if (overwrite !== 'Overwrite') return
  }
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(result.carve))
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target))
  if (result.diagnostics > 0) {
    void vscode.window.showInformationMessage(
      `Imported ${name}; ${result.diagnostics} HTML construct(s) were dropped or simplified.`,
    )
  }
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri)
    return true
  } catch {
    return false
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
    hljsCarveJs: asset('media', 'hljs', 'carve.js'),
    hljsDelimitedJs: asset('media', 'hljs', 'delimited.js'),
    hljsLightCss: asset('media', 'hljs', 'github.min.css'),
    hljsDarkCss: asset('media', 'hljs', 'github-dark.min.css'),
    hljsTableCss: asset('media', 'hljs', 'table-tokens.css'),
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
// A setting the user never set stays unsent, so `.carverc.json` decides it.
function explicitSetting<T>(key: string): T | undefined {
  const inspected = vscode.workspace.getConfiguration('carve').inspect<T>(key)
  return inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue
}

function includePayload(): CarveInitializationOptions {
  return carveInitializationOptions({
    formatter: explicitSetting<string>('formatter'),
    alignTables: explicitSetting<boolean>('format.alignTables'),
    extensions: explicitSetting('extensions'),
    platforms: explicitSetting('platforms'),
    severities: explicitSetting('severities'),
    inlayHintsEnabled: explicitSetting('inlayHints.enabled'),
    bareListMarkerHints: explicitSetting('inlayHints.bareListMarkers'),
    includes: {
      enabled: vscode.workspace.getConfiguration('carve.includes').get('enabled'),
      includeRoot: vscode.workspace.getConfiguration('carve.includes').get('includeRoot'),
      allowAbsolute: vscode.workspace.getConfiguration('carve.includes').get('allowAbsolute'),
    },
    workspaceTrusted: vscode.workspace.isTrusted,
  })
}

let onListItem = false

/** Sets `carve.onListItem`, which routes Tab / Shift+Tab to the list commands. */
function updateListItemContext(editor: vscode.TextEditor | undefined): void {
  const next = !!editor && editor.document.languageId === 'carve'
    && selectedListLines(editor.document.getText(), editor.selections).length > 0
  if (next === onListItem) return
  onListItem = next
  void vscode.commands.executeCommand('setContext', 'carve.onListItem', next)
}

/**
 * The one place that talks to `carve.listIndent`; its answer is read by
 * `listIndentEdits`.
 */
async function requestListIndent(
  running: LanguageClient,
  uri: string,
  line: number,
  direction: ListIndentDirection,
): Promise<unknown> {
  return running.sendRequest('workspace/executeCommand', {
    command: LIST_INDENT_COMMAND,
    arguments: [{ uri, line, direction }],
  })
}

let listShiftQueue: Promise<void> = Promise.resolve()

/**
 * Runs key presses one at a time, so a second Tab typed before the server
 * answers the first reads the document after the first edit, not before it.
 */
function queueListShift(direction: ListIndentDirection): Promise<void> {
  const editor = vscode.window.activeTextEditor
  listShiftQueue = listShiftQueue.then(() => shiftListItems(direction, editor)).catch((error) => {
    console.error('Carve list indent failed', error)
  })
  return listShiftQueue
}

/** Tab / Shift+Tab on list items, falling back to VS Code's own key. */
async function shiftListItems(
  direction: ListIndentDirection,
  editor: vscode.TextEditor | undefined,
): Promise<void> {
  // A press queued behind a slow answer is dropped once its editor lost focus.
  if (editor !== vscode.window.activeTextEditor) return
  const fallback = direction === 'indent' ? 'tab' : 'outdent'
  const running = client
  const serverReady = !!editor && !!running?.isRunning()
    && serverHasListIndent(running.initializeResult?.capabilities.executeCommandProvider?.commands)
  if (!editor || !running || !serverReady) {
    await vscode.commands.executeCommand(fallback)
    return
  }
  const { document } = editor
  const version = document.version
  const selections = editor.selections
  const uri = document.uri.toString()
  const lines = selectedListLines(document.getText(), editor.selections as readonly LspRange[])
  let answers: Awaited<ReturnType<typeof listIndentEdits>>[]
  try {
    answers = await Promise.all(lines.map(async (line) =>
      listIndentEdits(await requestListIndent(running, uri, line, direction), uri)))
  } catch (error) {
    console.error('carve.listIndent failed', error)
    answers = []
  }
  // The key belongs to the editor and cursors it was pressed in; if they moved
  // while the server answered, neither its edit nor the default key applies.
  const moved = vscode.window.activeTextEditor !== editor
    || editor.selections.length !== selections.length
    || editor.selections.some((selection, index) => !selection.isEqual(selections[index]))
  if (moved && document.version === version) return
  const edits = document.version === version ? mergeListIndentEdits(answers) : []
  if (useDefaultKey({ serverReady, edits: edits.length, documentChanged: document.version !== version })) {
    await vscode.commands.executeCommand(fallback)
    return
  }
  if (edits.length === 0) return
  await editor.edit((builder) => {
    for (const edit of edits) {
      const { start, end } = edit.range
      builder.replace(new vscode.Range(start.line, start.character, end.line, end.character), edit.newText)
    }
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
    middleware: {
      workspace: {
        // Without this the client sends `settings: null` on every VS Code
        // settings change, which carve-lsp 0.1.13 reads as "all defaults".
        didChangeConfiguration: async () => {
          await client?.sendNotification(DidChangeConfigurationNotification.type, { settings: includePayload() })
        },
      },
      provideOnTypeFormattingEdits: async (document, position, ch, options, token, next) => {
        const edits = await next(document, position, ch, options, token)
        if (ch === '\n' && edits) {
          const target = enterCaretTarget(position, edits)
          if (target) {
            const insert = edits.find((edit) => edit.range.isEmpty && edit.range.start.isEqual(position))
            if (insert) keepCaretAfterEnter(document, insert, new vscode.Position(target.line, target.character))
          }
        }
        return edits
      },
    },
  }

  client = new LanguageClient('carve', 'Carve Language Server', serverOptions, clientOptions)
  context.subscriptions.push(client)
  await client.start()
}

/**
 * Moves the caret back to the body line once VS Code has applied an on-type
 * insert that carries a closer, since VS Code parks the caret after the whole
 * insert. Acts only on that exact change and only while the caret sits where
 * VS Code parked it, so typing in between is left alone.
 */
function keepCaretAfterEnter(document: vscode.TextDocument, insert: vscode.TextEdit, target: vscode.Position): void {
  const normalize = (text: string): string => text.replace(/\r\n?/g, '\n')
  const expected = normalize(insert.newText)
  const start = insert.range.start
  const end = parkedCaret(start, insert.newText)
  const parked = new vscode.Position(end.line, end.character)
  let applied = false
  const moveIfParked = (editor: vscode.TextEditor | undefined): void => {
    if (editor?.document !== document || editor.selections.length !== 1) return
    if (!editor.selection.isEmpty || !editor.selection.active.isEqual(parked)) return
    dispose()
    editor.selection = new vscode.Selection(target, target)
  }
  const onChange = vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document !== document || applied) return
    applied = event.contentChanges.some(
      (change) => change.range.isEmpty && change.range.start.isEqual(start) && normalize(change.text) === expected,
    )
    if (!applied) return dispose()
    moveIfParked(vscode.window.activeTextEditor)
  })
  // VS Code may report the edit before its own caret placement; catch that placement too.
  const onSelection = vscode.window.onDidChangeTextEditorSelection((event) => {
    if (applied) moveIfParked(event.textEditor)
  })
  const timer = setTimeout(dispose, 2000)
  function dispose(): void {
    clearTimeout(timer)
    onChange.dispose()
    onSelection.dispose()
  }
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
