import path from 'node:path'

export interface ExtensionPathResolver {
  asAbsolutePath(relativePath: string): string
}

export function serverModulePath(context: ExtensionPathResolver): string {
  return context.asAbsolutePath(
    path.join('node_modules', '@markup-carve', 'carve-lsp', 'dist', 'server.js'),
  )
}
