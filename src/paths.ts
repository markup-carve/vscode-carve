import path from 'node:path'

export interface ExtensionPathResolver {
  asAbsolutePath(relativePath: string): string
}

/**
 * A module inside the installed language server.
 *
 * carve-lsp's export map exposes only its analyzer, so everything else in it is
 * addressed by path - the assumption `serverModulePath` has always made, and the
 * one `src/includes.test.ts` already drives the include gate through.
 */
export function serverInternalPath(context: ExtensionPathResolver, file: string): string {
  return context.asAbsolutePath(
    path.join('node_modules', '@markup-carve', 'carve-lsp', 'dist', file),
  )
}

export function serverModulePath(context: ExtensionPathResolver): string {
  return serverInternalPath(context, 'server.js')
}
