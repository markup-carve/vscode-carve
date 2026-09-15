# vscode-carve

VS Code support for [Carve](https://github.com/markup-carve/carve), a post-Markdown lightweight markup language.

## Features

- Language registration for `.crv` files, with a dedicated file icon in the Explorer.
- Carve highlighting in the Markdown editor for fences labeled `carve` or `crv`.
- Syntax highlighting for headings, emphasis, strong, links, images, lists, tables, code, raw blocks, comments, attributes, footnotes, mentions, tags, math, and frontmatter.
- Language server integration via [`markup-carve/carve-lsp`](https://github.com/markup-carve/carve-lsp):
  - diagnostics for parser errors and Djot/Markdown migration warnings,
  - quick fixes for migration warnings where the rewrite is mechanical,
  - hover help for common Carve syntax,
  - document symbols generated from heading structure,
  - semantic tokens for parser-aware highlighting in themes that support LSP semantic colorization,
  - context-aware completion: admonition kinds after `:::`, heading ids after `</#`, footnote labels after `[^`, and link reference labels after `][`,
  - document formatting (and format-on-save) that trims trailing whitespace, collapses blank-line runs, and normalizes the final newline without touching code, raw, or comment blocks,
  - folding for headings/sections and multi-line blocks,
  - rename for footnote and link reference labels (definition and all references),
  - code lens showing the reference count above each footnote definition.
- Snippets for common constructs: headings, emphasis, links, images, tables, lists, code/raw blocks, footnotes, math, divs, attributes, and frontmatter (type `h2`, `link`, `table`, `codeblock`, etc.).
- Preview command: **Carve: Open Preview** renders the active document in a VS Code webview, reachable from the editor title bar button, the command palette, or `ctrl+shift+v` (`cmd+shift+v` on macOS). The preview:
  - renders [Mermaid](https://mermaid.js.org/) diagrams from ` ```mermaid ` code blocks,
  - typesets inline and display math with [KaTeX](https://katex.org/),
  - syntax-highlights fenced code blocks with highlight.js (light/dark aware),
  - follows the active Carve editor, syncs scrolling line-by-line in both directions, and highlights the block under the cursor,
  - links `@mentions` and `#tags` and renders `:emoji:` shortcodes when configured (see settings below).
- Export commands:
  - **Carve: Export to HTML** writes a self-contained HTML file (Mermaid, KaTeX, and highlight.js load from a CDN; theming follows the reader's color scheme).
  - **Carve: Export Bundle (document and its includes)** writes the document and every file it pulls in into a folder beside it, keeping the directives and the file boundaries.
  - **Carve: Print Preview / Export PDF** opens the system print dialog on the preview, so you can save to PDF.
- Editor rules for comments, brackets, autoclosing pairs, folding markers, and word patterns.
- An example document in the repository, `examples/demo.crv`, exercising every supported construct - open it and run **Carve: Open Preview** to see the rendering features in action.

The canonical structural grammar for Carve lives in [`markup-carve/tree-sitter-carve`](https://github.com/markup-carve/tree-sitter-carve). VS Code extensions currently use TextMate grammars for built-in syntax colorization, so this extension ships a TextMate grammar aligned with the Tree-sitter grammar and uses the LSP for semantic behavior.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `carve.lsp.enabled` | `true` | Enable the Carve language server. |
| `carve.trace.server` | `"off"` | Trace VS Code ↔ language-server communication (`off`/`messages`/`verbose`) in the output channel, for debugging. |
| `carve.preview.mentionUrl` | `""` | URL template for `@mention` links in the preview; `{name}` is replaced (e.g. `https://example.com/u/{name}`). Empty renders mentions as plain text. |
| `carve.preview.tagUrl` | `""` | URL template for `#tag` links in the preview; `{name}` is replaced. Empty renders tags as plain text. |
| `carve.preview.emoji` | `{}` | Map of emoji shortcodes to glyphs, e.g. `{ "smile": "😄" }` renders `:smile:` as the glyph. Unmapped shortcodes render literally. |
| `carve.includes.enabled` | `"auto"` | Resolve `{{ path }}` include directives (`auto`/`on`/`off`). `auto` resolves them in a trusted workspace and leaves them literal in an untrusted one. |
| `carve.includes.includeRoot` | `""` | Containment root for include targets, the equivalent of `carve --include-root`. Empty uses the workspace folder the document belongs to, then the document's own folder. |
| `carve.includes.allowAbsolute` | `false` | Allow an absolute include path. Still subject to root containment. |

### Includes

A `{{ chapters/intro.crv }}` directive is resolved against the workspace folder
the document belongs to, falling back to the document's own folder - never the
process working directory, so a document here and the same document rendered by
the `carve` CLI agree on what is reachable. With the gate open you get
go-to-definition and path completion on the target, headings from an included
file in the document's symbol list, and a diagnostic where a directive would
otherwise sit in the page looking like ordinary prose. A target that does not
exist yet is watched too, so creating it refreshes the document that wanted it.

The include settings are read when the language server starts, so changing one
restarts it. The same gate governs the **preview** and the HTML and Markdown
exports, so one setting answers "may this document read that file" everywhere.

**The preview expands includes.** The children are merged through the engine's
own expansion pass, so what you see is what `carve` renders. Three things ride
along, each invisible when it is missing: the preview re-renders when an
*included* file changes, including a target that did not exist yet, so creating
it refreshes the page; every refusal the spec names - an unresolved target, a
cycle, a containment denial, a depth or a size refusal - is published as a
diagnostic rather than left looking like ordinary prose; and child sources are
cached on identity plus modification time, so a keystroke does not re-read every
chapter.

A child's relative links and images are rebased against the CHILD's folder. A
chapter at `chapters/intro.crv` writing `[see](figures/one.png)` means
`chapters/figures/one.png`, and that is what the preview and the exports resolve
- not `figures/one.png` beside the book, which is how a link silently reaches a
different existing file.

**Bundling** hands the whole document over as a set of files. **Carve: Export
Bundle** writes the open document and every file it includes, transitively, into
`name.bundle` beside it, laid out relative to the containment root so the
directives still resolve. The files are copied, not merged, which is what makes
it the right shape for "send it to a colleague who will keep editing it". A
target that could not be read is named in the result rather than quietly left
out, and nothing outside the containment root is written into the bundle.

The bundle runs the language server's own include walk, through the same gate
and the same containment root the server enforces, so it cannot reach a file the
server would have refused. With includes off for a document there is nothing to
bundle and the command says so.

**Flattening** hands the whole document over as ONE document. **Carve: Export as
a self-contained Carve file** writes `name.flat.crv` beside the original, and
**Carve: Copy as a single document** puts the same text on the clipboard.

It is deliberately a separate command rather than a mode of the Carve export:
spec I15 requires writing a document back as Carve to return the author's
document, so a plain Carve export must never expand. Both commands report the
two side effects that are invisible in the result - the output is canonical
Carve, so formatting is normalized rather than preserved, and colliding explicit
ids and footnote labels are renamed (spec I5), so a flattened document can carry
`intro-2`.

A child's relative links are NOT rebased when flattening, unlike in the preview:
`carve flatten` does not rewrite them, and matching the CLI byte for byte is
worth more here than being independently right.

## Development

See the [development guide](docs/development.md) for setup, testing, corpus
updates, and local packaging.
