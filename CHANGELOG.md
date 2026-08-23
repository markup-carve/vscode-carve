# Changelog

All notable changes to the Carve VS Code extension are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **A reference image is highlighted as an image** (markup-carve/carve-grammars#307). `![alt][ref]` and the collapsed `![alt][]` had no rule, so they fell through to the reference-LINK rule, which matches from the `[` and leaves the `!` as prose - the alt text carried a link title scope, and the output said the document held a link where it holds an image.

- **A cross-reference with auto text is highlighted** (markup-carve/carve-grammars#308). `</#id>` had no rule and the id was not left alone: it begins with `#`, so the tag rule claimed it and every crossref coloured as a hashtag.

- **The braced highlight `{=text=}` has a rule of its own.** The forced-emphasis context carried the other four braced spellings; what stood in for the fifth was the bare `=` rule matching the run inside the braces, which scoped nothing at all once the content held a delimiter (`{=a=b=}`).

- Highlight the delimited inline comment `{% ... %}` (#147, markup-carve/carve#1239).
  The payload is scoped as a comment whole, in paragraphs and in table cells, so
  emphasis and attribute markers inside it no longer highlight.

### Fixed

- **A footnote definition no longer highlights as a link reference definition.** The rule was right and every scope on it named the other construct, so `[^a]: note text` scoped the whole line `meta.link.reference.definition.carve` and coloured `note` - the first word of the prose - as a URL. It carries `meta.footnote.definition.carve` and `constant.other.reference.footnote.carve` now, and the body has no destination scope (markup-carve/carve-grammars#307).
- **A `{% ... %}` comment and a `{# ... #}` editorial comment spanning a line break are one comment.** Both were line-bounded, so a comment written across a break was not recognized at all and the markup inside it coloured - 144 of 469 and 87 of 286 generated documents (markup-carve/carve-grammars#320).
- **An unpartnered verbatim run is a code span to the end of its paragraph,** as it is in the engine, instead of leaving the rest of the paragraph live markup. The same rule closes a code span opened on one line and closed on the next, which nothing scoped before (markup-carve/carve-grammars#320).

## [0.1.2] - 2026-08-19

### Added

- **The attribute production accepts the language attribute** (#105). `{:fr}` is
  sugar for `lang=`, so `[Le Bon Usage]{:fr}` highlights as an attribute rather
  than as prose with stray punctuation.

- **A bare `::: figure` opener is a composite figure, not an admonition** (markup-carve/carve#1215, ported from markup-carve/carve-grammars#223). PART 9 §4c reserves the kind word `figure` among the `:::` types: the fence, its separator, the word, and nothing else is one figure of ordered panels. The same opener carrying a quoted title or a `[label]` is not that production at all and stays the generic container it has always been, with both preserved. Before this the two coloured identically, so the editor could not show which reading a line had - and the whole distinction sits in the tail of one line.

  The opener now carries `markup.other.figure-group.carve`, with `punctuation.definition.figure-group.carve` on the fence and `entity.name.type.figure-group.carve` on the kind word, so a theme can tell the two apart. The separator is a space run and never a tab (`:::<TAB>figure` renders as a paragraph), which is narrower than the generic div rule beside it; a tab-separated opener falls through to that rule and reads exactly as it did.

  The group caption needed no rule: it is an ordinary `^ ` line below the closing fence, which the caption pattern already claims at document level and inside every container body. Known limitation, shared with the flat `:::` rule it sits beside: groups do not nest, but a per-line `match` has no notion of being inside one, so a bare `::: figure` inside an open group still colours as a group. Eight opener spellings and the caption lines around them are pinned in `tests/fixtures/composite-figures.crv`, both outcomes.

### Fixed

- **A colon-leading unquoted value is not a language attribute** (#106). `{k::v}`
  was read as one, so an ordinary value beginning with a colon coloured wrong.
- **A trailing backslash is a hard break, and the grammar had no rule for it**
  (#119). It highlighted as an escape of the newline, which is not what it means.
- **A comment fence opened on a list marker line hides its body** (#114), and the
  same on a block-quote marker line (#116). The body coloured as live markup, so
  a commented-out block looked active in the editor.
- **A quote on a list item's marker line takes the rest of that line** (#126).
- **Container grammar boundaries** (#142).

- **Five block rules were unreachable behind a container prefix** (#127, #128, #129, #130, #131). A heading, a code fence, a table row and a thematic break all scoped only at column 0, so none of them reached a list item's marker line, its body column, or a quote - and the thematic break was not silent but scoped as an em dash. The fence gap also left the code block's body tokenized as live markup. A comment fence opened on a NESTED marker line ended only at column 0, which a nested line never reaches, so it swallowed its own sibling item.

## [0.1.1] - 2026-08-11

### Changed

- **A bracketed run is a span only when a real attribute block follows it** (markup-carve/carve#870). The rule looked ahead for a brace and nothing more, so `[a]{xlink:href=u}` colored as a span where every engine renders the whole line as literal text: an attribute name admits no colon, and a block that fails that rule is not an attribute block. The lookahead now requires the same block the attribute rule matches, including the empty `{}` form that is valid only when glued to a preceding `]`. Valid spans - `[a]{.c}`, `[a]{k=v.w}`, `[a]{disabled}` - are unchanged.

- **A list item's content column decides whether an indented definition is one** (#61, ported from markup-carve/carve-grammars#94). A link or footnote reference definition indented under a list item scoped as a definition at any indent, because the rule allowed leading whitespace and nothing in the grammar knew where the item's content started. `- - a` over ` [^f]: x` therefore coloured as inert markup that resolves a reference, where the corpus renders it as the item's own text.

  List items, task items and footnote definitions are now `begin`/`end` containers that close on the first nonblank line indented below their own content column, and the document-level definition rule narrowed to flush-left, so an indented definition is reachable only through a container that has already established the line sits at or beyond that column. The column is the marker's actual width - `- a` puts it at 2, `-   a` at 4, `10. a` at 4 - measured against carve-php and carve-js rather than assumed, which is also how the two exceptions were found: a task item's body is two columns in whatever its separator is, and so is a footnote body's. A link reference definition gets no container at all, because it has no body: an indented definition under one is a paragraph.

  Exact for bullets at any indent and separator width, for task items and footnote bodies, and for ordered markers one to five characters wide; approximate for wider markers and for the attribute-glued forms, whose width is not whitespace and cannot be counted - both hold the container open a column or two too long rather than closing it early. A definition indented PAST the content column is still scoped, where the language folds it into the item's text; that limit is unchanged from before and shared with carve-grammars.

  Corpus `a-definition-below-every-content-column-folds-as-text` moves from `skip` to `covered`, which is what its skip reason asked for, and `tests/fixtures/definition-at-a-content-column.crv` pins the paired positive alongside it - the case that a flush-left-only rule would have broken silently.

- **A bullet glued to an attribute block is a marker, and both marker rules validate the payload** (markup-carve/carve-grammars#126). The ordered rule learned the glued form; the bullet rule beside it never did, so `-{#x} item`, `*{.c} item` and `-{title="a}b"} item` went uncoloured on lines that ARE list items. Corpus document `90-list-item-attributes` pinned the wrong answer, which a snapshot cannot report.

  Copying the ordered guard verbatim would have coloured `-{+a+} text` as a list, where it renders as a paragraph - `{+a+}` is an insertion span, not attributes. So the guard requires valid attribute syntax and both branches share it; the ordered rule had the same hole. Identifiers are strict (PART 9 §14) and admit no colon, matching carve-js. The guard is a lookahead rather than a consuming group, so the attribute rule keeps the block.

  Known limitation, shared with every Carve TextMate grammar: the checkbox after a glued block (`-{.c} [x] done`) is not scoped; the bullet is. Twelve shapes are pinned in `tests/fixtures/bullet-glued-attributes.crv`, both outcomes.

- **A mixed-case roman run is not an ordered marker** (markup-carve/carve-grammars#118). The rule spelled a roman run as one class, `[ivxlcdmIVXLCDM]+`, which matches any mixture of the two cases - so `Vim. text`, `Mix. text` and `Ix. text` coloured as lists where carve-js renders paragraphs. Those are the shape of a word starting a sentence, which is the risk the rule was written to avoid: it names `Note.` as the case to keep literal, and `Note` falls outside the class while `Vim` does not. Not a length rule - `mix.`, `civil.` and `did.` DO open lists, and so do `ivx.` and `IVX.` - so the fix is two classes. Eleven spellings are pinned in `tests/fixtures/roman-ordered-markers.crv`, both outcomes.

- **An ordered marker glued to an attribute block needs content after it too** (markup-carve/carve-grammars#85). `1.{#x}` renders as a paragraph and `1.{#x} item` as a list item; the grammar scoped the marker in both, because the guard was `(?= |\{)` and any brace satisfied it, so MARKER REQUIRES CONTENT never reached past the block. The fix spells the attribute block out in full rather than skipping it: the block is not brace-balanced text, so a `\{[^}]*\}` run stops at a `}` inside a quoted value and rejects `1.{title="a}b"} item`, which is a valid item. Nine shapes are pinned in `tests/fixtures/marker-requires-content.crv`, both outcomes, including a `}` inside either quote style, an escaped quote in a value, and two glued blocks (a paragraph even with content after them).

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
