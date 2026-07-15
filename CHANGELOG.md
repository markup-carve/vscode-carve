# Changelog

All notable changes to the Carve VS Code extension are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-07-15

First release.

### Features

- Syntax highlighting for Carve (`.crv` / `.carve`) via a TextMate grammar: headings, inline markup, links, code fences with headers/labels, tables (including alignment colons), definition lists, fenced divs and admonitions, list and continuation markers, math, footnotes, citations, and code callouts.
- Live HTML preview (**Carve: Open Preview**) with editor scroll sync and caret tracking. The preview enables the interactive renderer extensions: mermaid diagrams, Chart.js charts, KaTeX math, `:::details` / `:::spoiler` disclosures, tabs, and code groups. Task lists, code-block language labels, tables, and admonitions are styled to match.
- Language server integration (diagnostics, hover, document symbols) via the bundled `@markup-carve/carve-lsp`.
- Export to a self-contained HTML document (**Carve: Export HTML**) and print (**Carve: Print Preview**).
