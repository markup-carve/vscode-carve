# Changelog

All notable changes to the Carve VS Code extension are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- **A run of spaces is not heading content** (#46). `#` followed by two spaces scoped as a heading, because the rule's `.+` matches them; carve-rs renders it `<p>#</p>`. Found by a shared block battery, now vendored here and run against this grammar, so a rule fixed upstream and missed here fails a test instead of shipping.
- **A marker alone on its line is prose** (#44). MARKER REQUIRES CONTENT (markup-carve/carve#513) was in the rules already, written `\s+`, and `\s` matches the line's own newline - so the requirement never bit. `-`, `- `, `1.`, `1. `, `::` and `:: ` all scoped as markers where carve-rs renders every one as a paragraph. The guard is a line-end lookahead rather than `(?=\S)`, because only spaces and tabs separate a marker from its content: `#  Title` with a leading no-break space is still a heading. `- [ ] ` with nothing after it is a plain bullet holding the literal `[ ]`, not a checkbox.
- **A blockquote marker takes a space** (#42). markup-carve/carve#525 made the separator mandatory; the bundled grammar still matched `^\s*(>+)\s?`, so the editor colored lines the language calls prose. Verified against carve-rs: `>no space`, `>>x`, `>> x` and `>\tx` all render as paragraphs, `>>` is not a nested marker (that is `> > x`, a space per marker), and a tab does not separate. The spec pin moved 10 commits in the same change, which is what surfaced it.
- **The spec submodule is current again** (#37). It sat at 392 corpus documents while the spec had 529, so the coverage matrix and the snapshot suite were measuring a July language. Fifty-five new categories are classified: `symbols` and `inline-literal` are snapshot-covered (they are the only ones producing `constant.language.symbol` and `markup.raw.inline.literal` scopes), the other 49 are skipped with a reason naming the covered representative that already pins their tokens. Three entries were upstream renames, not removals: `emoji` -> `symbols`, `multi-line-headings` -> `single-line-headings`, `link-destination-stops-at-the-first-parenthesis` -> `link-destination-parentheses-balance`. No existing golden's tokens changed.

### Added

- Syntax highlighting for the inline literal `` !`…` `` (#25): a `!` before a verbatim backtick span, which renders as escaped prose rather than code.
- Syntax highlighting for inline footnotes `^[content]`, which had no rule at all. Its content is inline-parsed per the spec, so nested emphasis and code still highlight, a backslash escape such as `^[a \] b]` no longer terminates the span early, and the span is bounded to one line so an unclosed `^[` cannot leak. Table cells reach the rule too.
- The task-list marker now accepts every documented state. Only `[ ]`, `[x]` and `[X]` were recognized; the spec also defines `[-]`, `[_]`, `[>]` and `[?]`.

### Fixed

- Bare `*` and `~` emphasis no longer highlight intraword. The rules carried the word-boundary guard for `/`, `_` and `=` but not for `*` or `~`, so `foo*bar*baz` and `foo~bar~baz` highlighted as emphasis; the spec applies the restriction to every bare delimiter and the corpus pins both strings as literal.
- Symbols now honor the boundary rule. `:name:` matched with no left-boundary guard and allowed a leading underscore, so `a:b:c`, `10:30:` and `:_bad:` were wrongly highlighted; `(:tada:)`, `:+1:` and `:-1:` still parse.
- A quoted attribute value containing an escaped quote is scoped in full. `{title="a\"b"}` scoped only `"a\"`, leaving the rest of the value unstyled.
- Table cells now highlight the sigil-prefixed verbatim constructs. The table-row pattern list included `#inline-code` but omitted `#inline-literal`, `#math` and `#raw-inline`, so `` | !`x` | ``, `` | $`x` | `` and `` | `x`{=html} | `` were left unscoped inside a table.
- An escaped `\^[` is no longer highlighted as a footnote. A table cell does not include the escape rule that guards the opener at top level, so reaching the footnote rule from a cell made the documented literal form `\^[x]` scope as a real footnote. The opener now carries a negative lookbehind.
- A table continuation row must end with a pipe. The marker rule matched `^(+)(.*)$`, so a bare `+` continuation belonging to a block quote, definition list, list item or footnote was scoped as a table continuation; the corpus shows a table continuation row ends with a pipe (`+ cont |`).
- Table cells now highlight citations, mentions, tags and symbols. `#citations` and `#mentions-tags` were missing from the table-row pattern list, so `| [key] |`, `| user |`, `| #tag |` and `| :tada: |` were left unscoped inside a table.
- An unclosed `` !` `` or `` $` `` opener no longer leaks its highlighting into the rest of the document. Both rules used `begin`/`end`, so the scope stayed open until the next matching backtick run anywhere later in the file; they are now closed-span `match` rules with a run-length backreference, matching how inline code already worked.

## [0.1.0] - 2026-07-15

First release.

### Features

- Syntax highlighting for Carve (`.crv` / `.carve`) via a TextMate grammar: headings, inline markup, links, code fences with headers/labels, tables (including alignment colons), definition lists, fenced divs and admonitions, list and continuation markers, math, footnotes, citations, and code callouts.
- Live HTML preview (**Carve: Open Preview**) with editor scroll sync and caret tracking. The preview enables the interactive renderer extensions: mermaid diagrams, Chart.js charts, KaTeX math, `:::details` / `:::spoiler` disclosures, tabs, and code groups. Task lists, code-block language labels, tables, and admonitions are styled to match.
- Language server integration (diagnostics, hover, document symbols) via the bundled `@markup-carve/carve-lsp`.
- Export to a self-contained HTML document (**Carve: Export HTML**) and print (**Carve: Print Preview**).
