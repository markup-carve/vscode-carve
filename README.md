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
restarts it.

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

Two halves are NOT here yet, and both are the same blocker rather than an
oversight:

- The **preview** does not expand includes - it renders the directive as
  written.
- There is no **flatten**: no export or copy of one self-contained `.crv` with
  the children merged in.

Merging is the engine's expansion pass, and the engine this extension bundles
carries no include code at all. It cannot be bumped while the pin question is
open - see [#183](https://github.com/markup-carve/vscode-carve/issues/183) and
[#185](https://github.com/markup-carve/vscode-carve/issues/185). Bundling needs
none of that, which is why it is here and flattening is not.

## Development

See the [development guide](docs/development.md) for setup, testing, corpus
updates, and local packaging.
