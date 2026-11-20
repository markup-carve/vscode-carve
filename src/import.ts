import { importDocument } from '@markup-carve/carve/import'

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
  /** Constructs the importer dropped, unwrapped or degraded. */
  diagnostics: number
}

export function convertToCarve(source: string, format: ImportFormat): ImportResult {
  // Markdown files are read as GFM, the dialect the 0.1 Markdown importer took.
  const result = importDocument(source, { from: format === 'markdown' ? 'gfm' : 'html' })
  return { carve: result.source, diagnostics: result.diagnostics.length }
}
