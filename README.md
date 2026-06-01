# vscode-carve

VS Code support for [Carve](https://github.com/markup-carve/carve), a post-Djot lightweight markup language.

## Features

- Language registration for `.crv` and `.carve` files.
- Syntax highlighting for headings, emphasis, strong, links, images, lists, tables, code, raw blocks, comments, attributes, footnotes, mentions, tags, math, and frontmatter.
- Language server integration via [`markup-carve/carve-lsp`](https://github.com/markup-carve/carve-lsp):
  - diagnostics for parser errors and Djot/Markdown migration warnings,
  - document symbols generated from heading structure.
  - semantic tokens for parser-aware highlighting in themes that support LSP semantic colorization.
- Editor rules for comments, brackets, autoclosing pairs, folding markers, and word patterns.

The canonical structural grammar for Carve lives in [`markup-carve/tree-sitter-carve`](https://github.com/markup-carve/tree-sitter-carve). VS Code extensions currently use TextMate grammars for built-in syntax colorization, so this extension ships a TextMate grammar aligned with the Tree-sitter grammar and uses the LSP for semantic behavior.

## Development

```bash
npm install
npm run build
npm test
```

Open this folder in VS Code and press `F5` to launch an Extension Development Host.

## License

MIT
