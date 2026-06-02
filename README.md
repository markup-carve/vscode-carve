# vscode-carve

VS Code support for [Carve](https://github.com/markup-carve/carve), a post-Djot lightweight markup language.

## Features

- Language registration for `.crv` and `.carve` files, with a dedicated file icon in the Explorer.
- Syntax highlighting for headings, emphasis, strong, links, images, lists, tables, code, raw blocks, comments, attributes, footnotes, mentions, tags, math, and frontmatter.
- Language server integration via [`markup-carve/carve-lsp`](https://github.com/markup-carve/carve-lsp):
  - diagnostics for parser errors and Djot/Markdown migration warnings,
  - quick fixes for migration warnings where the rewrite is mechanical,
  - hover help for common Carve syntax,
  - document symbols generated from heading structure.
  - semantic tokens for parser-aware highlighting in themes that support LSP semantic colorization.
- Snippets for common constructs: headings, emphasis, links, images, tables, lists, code/raw blocks, footnotes, math, divs, attributes, and frontmatter (type `h2`, `link`, `table`, `codeblock`, etc.).
- Preview command: **Carve: Open Preview** renders the active document in a VS Code webview, reachable from the editor title bar button or the command palette.
- Editor rules for comments, brackets, autoclosing pairs, folding markers, and word patterns.

The canonical structural grammar for Carve lives in [`markup-carve/tree-sitter-carve`](https://github.com/markup-carve/tree-sitter-carve). VS Code extensions currently use TextMate grammars for built-in syntax colorization, so this extension ships a TextMate grammar aligned with the Tree-sitter grammar and uses the LSP for semantic behavior.

## Development

```bash
npm install
npm run build
npm test
npm run package
```

Open this folder in VS Code and press `F5` to launch an Extension Development Host.

To install the local VSIX after packaging:

```bash
code --install-extension vscode-carve-0.1.0.vsix
```

## License

MIT
