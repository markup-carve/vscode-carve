/**
 * Rebase a child's relative destinations against the child's own directory.
 *
 * Inlining a child into a document rendered against the PARENT's path makes
 * every relative link and image in the child resolve from the wrong folder. A
 * child at `chapters/intro.crv` writing `[see](figures/one.png)` means
 * `chapters/figures/one.png`; rendered as part of `book.crv` it silently becomes
 * `figures/one.png` relative to the book (#192).
 *
 * Nothing fails loudly when this is skipped, which is why it is its own module
 * with its own assertions. A broken image is the good case. The bad one is a
 * link that resolves to a DIFFERENT existing file - `figures/one.png` exists
 * beside the book too, and the reader is sent to the wrong page with no error
 * anywhere.
 *
 * `pos.file` carries the child's identity to the node, so the rebase is
 * measured rather than guessed. A node without one inherits its nearest
 * ancestor's, and a node whose file is the parent is left alone.
 *
 * Only genuinely relative destinations move. A scheme (`https:`, `mailto:`), a
 * root-relative path, a protocol-relative `//host`, and a bare fragment all
 * mean something independent of the document's folder, so rewriting them would
 * break what was correct.
 */
import path from 'node:path'

/** Destination fields the AST uses, per node type. */
const FIELDS: Record<string, string> = {
  link: 'href',
  image: 'src',
  link_reference_definition: 'href',
}

const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

/** Is `destination` resolved against the document's own folder? */
export function isRelativeDestination(destination: string): boolean {
  if (destination === '') return false
  if (destination.startsWith('#')) return false
  if (destination.startsWith('//')) return false
  if (destination.startsWith('/')) return false
  if (HAS_SCHEME.test(destination)) return false
  return true
}

/**
 * `destination`, written in a child at `childPath`, as the parent at
 * `parentPath` would have to write it.
 *
 * A query and a fragment are carried over untouched: they are not path, and
 * splitting them off is what keeps `figures/one.png#fig-1` from being resolved
 * as a filename containing a hash.
 */
export function rebaseDestination(destination: string, childPath: string, parentPath: string): string {
  if (!isRelativeDestination(destination)) return destination
  const cut = destination.search(/[?#]/)
  const target = cut === -1 ? destination : destination.slice(0, cut)
  const suffix = cut === -1 ? '' : destination.slice(cut)
  if (target === '') return destination
  const absolute = path.resolve(path.dirname(childPath), target)
  const rebased = path.relative(path.dirname(parentPath), absolute)
  if (rebased === '') return destination
  const posix = rebased.split(path.sep).join('/')
  // `path.relative` drops a leading `./`, which is fine, but it also produces a
  // bare name for a sibling - and a bare name is still relative, so it needs no
  // reintroduction.
  return posix + suffix
}

interface Node {
  type?: string
  pos?: { file?: string }
  [key: string]: unknown
}

/**
 * Rewrite every relative destination a child contributed, in place.
 *
 * Returns how many moved, so a caller can report it rather than assume it: a
 * rebase that silently did nothing looks exactly like a document with no child
 * links in it.
 */
export function rebaseChildDestinations(doc: unknown, parentPath: string): number {
  let moved = 0
  const walk = (node: unknown, inheritedFile: string | undefined): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child, inheritedFile)
      return
    }
    if (!node || typeof node !== 'object') return
    const current = node as Node
    const file = typeof current.pos?.file === 'string' ? current.pos.file : inheritedFile
    const field = current.type ? FIELDS[current.type] : undefined
    if (field !== undefined && file !== undefined && file !== parentPath) {
      const destination = current[field]
      if (typeof destination === 'string') {
        const rebased = rebaseDestination(destination, file, parentPath)
        if (rebased !== destination) {
          current[field] = rebased
          moved++
        }
      }
    }
    for (const [key, value] of Object.entries(current)) {
      if (key === 'pos') continue
      if (value && typeof value === 'object') walk(value, file)
    }
  }
  walk(doc, undefined)
  return moved
}
