# vscode-carve

Carve support for VS Code, with TextMate highlighting, preview, and a bundled language server. Extension version 0.1.18 bundles `carve-lsp` 0.1.16. See the [Carve documentation](https://markup-carve.github.io/carve/) for the markup language.

## Features

- Highlighting for `.crv` files and code fences.
- Preview, import, export, and language server features.

## Install

Install the [Carve extension from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=markup-carve.vscode-carve).

## Usage

Open a `.crv` file and run **Carve: Open Preview** from the command palette.

Run **Carve: Export to PDF** to save a PDF next to the document or choose another path. The extension uses [crv2pdf](https://github.com/markup-carve/carve-pdf) when installed on `PATH` or configured with `carve.pdf.crv2pdfPath`. Install it with `make install` from the carve-pdf repository. This path supplies carve-pdf's pagination, localized byline and footer, and code listing layout.

When crv2pdf is unavailable, the extension renders the same HTML as **Carve: Export to HTML** and prints it with an installed Chrome, Chromium, or Edge browser. It searches common Linux, macOS, and Windows locations and `PATH`; `carve.pdf.browserPath` selects a browser explicitly. `carve.pdf.paperSize` (`A4`, `Letter`, or `Legal`) and `carve.pdf.margins` (`default`, `none`, `narrow`, or `wide`) apply to this browser path. If neither tool is installed, the command explains both options. **Carve: Print Preview** still opens the print dialog under its existing `carve.printPreview` command ID.

## Documentation

- [Carve documentation](https://markup-carve.github.io/carve/)
- [Setup and full guide](docs/guide.md)
- [Documentation index](docs/README.md)

## License

[MIT](LICENSE)
