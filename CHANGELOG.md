# Changelog

All notable changes to the Carve VS Code extension are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Syntax highlighting for the inline literal `` !`…` `` (#25): a `!` before a verbatim backtick span, which renders as escaped prose rather than code.

### Fixed

- Table cells now highlight the sigil-prefixed verbatim constructs. The table-row pattern list included `#inline-code` but omitted `#inline-literal`, `#math` and `#raw-inline`, so `` | !`x` | ``, `` | $`x` | `` and `` | `x`{=html} | `` were left unscoped inside a table.
- An unclosed `` !` `` or `` $` `` opener no longer leaks its highlighting into the rest of the document. Both rules used `begin`/`end`, so the scope stayed open until the next matching backtick run anywhere later in the file; they are now closed-span `match` rules with a run-length backreference, matching how inline code already worked.

## [0.1.0] - 2026-07-15

First release.

### Features

- Syntax highlighting for Carve (`.crv` / `.carve`) via a TextMate grammar: headings, inline markup, links, code fences with headers/labels, tables (including alignment colons), definition lists, fenced divs and admonitions, list and continuation markers, math, footnotes, citations, and code callouts.
- Live HTML preview (**Carve: Open Preview**) with editor scroll sync and caret tracking. The preview enables the interactive renderer extensions: mermaid diagrams, Chart.js charts, KaTeX math, `:::details` / `:::spoiler` disclosures, tabs, and code groups. Task lists, code-block language labels, tables, and admonitions are styled to match.
- Language server integration (diagnostics, hover, document symbols) via the bundled `@markup-carve/carve-lsp`.
- Export to a self-contained HTML document (**Carve: Export HTML**) and print (**Carve: Print Preview**).
