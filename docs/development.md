# Development

## Setup

```bash
git submodule update --init   # check out the shared Carve corpus (spec/)
npm install
npm run build
npm test
npm run package
```

Open the repository in VS Code and press `F5` to launch an Extension
Development Host.

## Grammar token-snapshot tests

The TextMate grammar (`syntaxes/carve.tmLanguage.json`) is verified against the
shared [Carve corpus](https://github.com/markup-carve/carve/tree/main/tests/corpus),
vendored through the `spec/` submodule. Each category classified as covered has
a representative `.crv` document and a committed golden scope snapshot under
`tests/snapshots/`.

```bash
npm run test:grammar          # verify committed scopes
npm run test:grammar:update   # regenerate snapshots after a deliberate change
```

`tests/categories.json` is the coverage matrix. Every corpus category must be
either `covered` by a snapshot or `skip`ped with a reason why it has no distinct
TextMate scope. The coverage test rejects new unclassified categories.

A construct the shared corpus does not carry yet gets a hand-authored pair in
`tests/fixtures/` instead - a `.crv` source and its committed `.snap` golden,
verified by the same command. A snapshot only proves the grammar did not
change, so a construct whose reading is the point of the work also gets an
assertion test beside it (`tests/*.test.mjs`), registered in the `test:grammar`
script.

## Corpus through the extension

The grammar snapshots above measure TextMate scopes and cannot see engine output
at all, so they stay green whether the bundled engine is correct or months
stale. `npm run test:corpus` drives every corpus document through the two
surfaces the extension actually ships and is part of `npm test`:

```bash
npm run build                 # it measures dist/, not the sources
npm run test:corpus
npm run test:corpus -- --manifest /tmp/before.tsv   # one row per document
npm run test:corpus -- --record   # rewrite tools/corpus-baseline.tsv
```

- The preview and export path (`renderPreviewBody`) is compared byte-for-byte
  against the corpus `.html`.
- Every document is opened in the real language server process, spawned from the
  path `serverModulePath()` hands the client, and its diagnostics, outline and
  folding ranges are collected.
- The engine is resolved from BOTH module graphs - the extension's own and
  carve-lsp's - and the whole install tree is scanned for copies. The run fails
  if the tree holds more than one, or if the two graphs land on different ones.
  That is the state the extension shipped in before #133: the language server
  ran a parser the preview was not using.
- One copy is forced by the `overrides` entry in `package.json`, which has to
  name the same version the `dependencies` entry does. npm applies an override
  to the whole install tree, so one copy is hoisted whatever carve-lsp declares.
  The run fails if the override is missing or points somewhere else, because the
  override is what makes the single copy a property of every install rather than
  of this one (#183).
- What carve-lsp declares is reported, not asserted. Requiring an exact
  declaration there was a proxy for the single copy, and it deadlocked against
  carve-lsp#163, which moved that declaration to a range so an engine fix
  reaches users without a release of that repo.
- `overrides` is npm-specific and nothing downstream inherits it. That is sound
  while this package is a leaf - a VS Code extension, not a library. If it ever
  becomes one, this needs revisiting.

The run refuses to report anything over a population it did not check the size
of. The number of documents must equal the number of `carve` fences inside the
`::: compare` blocks of the spec's `resources/examples/` pages, so an empty or
truncated corpus is a failure rather than a fast green run.

Pass `--manifest` on both sides of an engine bump and diff the two files: totals
alone cannot tell a document that lost a diagnostic from another that gained
one.

### The recorded baseline

`tools/corpus-baseline.tsv` holds one row per corpus document: a hash of its
source, a hash of the engine's AST, and its diagnostic, outline and fold counts.
The run compares each figure by document and fails with the document names when
any of them moved, when a document has no row, or when a row names a document
the corpus no longer has. A total cannot do this job, because one document
gaining a fold while another loses one leaves it unchanged.

The AST hash is what gives the AST arm something to disagree with. With one
engine copy installed, comparing the preview's parse against the language
server's is a value compared with itself, so the run reports
`twoParserMismatches` as not measured instead of as zero.

An engine bump, a carve-lsp bump or a spec bump will usually move some rows.
When the change is intended, re-record with `npm run test:corpus -- --record`
and review the baseline diff by document before committing it.

## Updating the corpus

Update the submodule and regenerate the snapshots:

```bash
git -C spec fetch origin main
git -C spec checkout origin/main
npm run test:grammar:update
```

Review both the submodule change and generated snapshot diff. New categories
must be deliberately added to `covered` or `skip` in `tests/categories.json`.
New and changed corpus documents also need a row in the corpus baseline: run
`npm run test:corpus -- --record` and review its diff.

### When the engine is behind the spec

The spec moves ahead of the published engine routinely: a ruling lands, the
corpus gains a document for it, and `@markup-carve/carve` only carries it after
its next release. `npm run test:corpus` then reports `renders differently` for
documents nothing in this repository can fix.

`ENGINE_LAG` in `tools/corpus-through-extension.mjs` waives exactly those, and
it is keyed by `ENGINE_PIN`. Add a document only when the engine provably
predates the rule it pins, and name the ruling in the value.

**Empty it at the next engine bump.** This is part of releasing, not a cleanup
task for later:

1. Raise the engine dependency AND the `overrides` entry together - they have
   to name the same version, and the run fails if they drift apart.
2. Set `ENGINE_LAG = {}` and `ENGINE_PIN` to whatever `package.json` now
   declares - the version, or the revision if the pin is a git one.
3. Run `npm run test:corpus`. Whatever still mismatches goes back in the list,
   with its ruling named; everything else is fixed and stays out.

Two gates make the list expire loudly rather than quietly becoming permanent,
and both fail the run rather than only printing:

- a waived document that renders correctly again fails with
  `an engine-lag waiver is no longer needed`, because a stale waiver hides the
  next regression on that same document;
- moving the engine pin without emptying the list fails with
  `the engine pin moved and ENGINE_LAG was not emptied`, because every waiver in
  it was written against the old engine and says nothing about the new one.

A non-empty `ENGINE_LAG` at release time means the shipped extension renders
those documents differently from the spec. That is acceptable while it is
recorded and expiring; it is not acceptable as a permanent state.

## Packaging and local installation

```bash
npm run package
code --install-extension "$(ls -t vscode-carve-*.vsix | head -1)"
```

`npm run package` names the file after the version in `package.json`, so the
command above installs whatever it just wrote rather than a version spelled out
here, which goes stale at every release.

## Release notes

`scripts/release-notes.mjs <version>` prints the release body for a version,
derived from that version's `CHANGELOG.md` section:

```bash
node scripts/release-notes.mjs 0.1.8
```

`Fixed` becomes Fixes, `Added` and `Changed` become Improvements, `Breaking` and
`Removed` become Breaking, and Breaking is printed first. Bullets keep their
wording, unwrapped to one line and with the bold lead-in flattened. The footer
compares against whichever version's section follows in the file.

Derive rather than write the two by hand. The release workflow refuses to
publish without a draft, so the draft tends to get written first and the
CHANGELOG reconciled afterwards, which is how the two drift. Re-running this
reproduces the body byte for byte, so a diff against the published draft is
evidence that one of them moved.

It refuses to print an empty body, a version with no section, and a CHANGELOG
section it has no heading for, rather than silently dropping entries.
