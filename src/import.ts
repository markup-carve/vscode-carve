import { htmlToCarve, markdownToCarve } from '@markup-carve/carve'

export type ImportFormat = 'markdown' | 'html'

const FORMAT_BY_EXTENSION: Record<string, ImportFormat> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.html': 'html',
  '.htm': 'html',
}

export const IMPORT_EXTENSIONS = Object.keys(FORMAT_BY_EXTENSION)

function extensionOf(path: string): string {
  const slash = path.lastIndexOf('/')
  const dot = path.lastIndexOf('.')
  return dot > slash + 1 ? path.slice(dot).toLowerCase() : ''
}

export function importFormatFor(path: string): ImportFormat | undefined {
  return FORMAT_BY_EXTENSION[extensionOf(path)]
}

/** The sibling `.crv` path for a source path, with its extension swapped. */
export function importTargetPath(path: string): string {
  const ext = extensionOf(path)
  return (ext ? path.slice(0, -ext.length) : path) + '.crv'
}

export interface ImportResult {
  carve: string
  /** Constructs the HTML importer dropped, unwrapped or degraded. Always 0 for Markdown. */
  diagnostics: number
}

export function convertToCarve(source: string, format: ImportFormat): ImportResult {
  if (format === 'markdown') return { carve: markdownToCarve(source), diagnostics: 0 }
  const result = htmlToCarve(source)
  return { carve: result.value, diagnostics: result.report.diagnostics.length }
}
