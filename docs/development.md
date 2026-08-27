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

## Corpus through the extension

The grammar snapshots above measure TextMate scopes and cannot see engine output
at all, so they stay green whether the bundled engine is correct or months
stale. `npm run test:corpus` drives every corpus document through the two
surfaces the extension actually ships and is part of `npm test`:

```bash
npm run build                 # it measures dist/, not the sources
npm run test:corpus
npm run test:corpus -- --manifest /tmp/before.tsv   # one row per document
```

- The preview and export path (`renderPreviewBody`) is compared byte-for-byte
  against the corpus `.html`.
- Every document is opened in the real language server process, spawned from the
  path `serverModulePath()` hands the client, and its diagnostics, outline and
  folding ranges are collected.
- The engine is resolved from BOTH module graphs - the extension's own and
  carve-lsp's - and the run fails if they land on different copies, or if the two
  packages pin different engines. That is the state the extension shipped in
  before #133: the language server ran a parser the preview was not using.
- A pin is anything that admits exactly ONE engine: an exact registry version
  (`0.1.5`) or a 40-hex git revision. Both are accepted and compared by value;
  `^0.1.5`, `~0.1.5`, `>=0.1.5`, `*` and a branch URL are refused, because a
  range is what let npm satisfy the two dependents with two different copies.
  The revision spelling stays available for pinning an engine that has not been
  released yet (#156).

The run refuses to report anything over a population it did not check the size
of. The number of documents must equal the number of `::: compare` blocks the
spec's `resources/examples/` pages declare, so an empty or truncated corpus is a
failure rather than a fast green run.

Pass `--manifest` on both sides of an engine bump and diff the two files: totals
alone cannot tell a document that lost a diagnostic from another that gained
one.

## Updating the corpus

Update the submodule and regenerate the snapshots:

```bash
git -C spec fetch origin main
git -C spec checkout origin/main
npm run test:grammar:update
```

Review both the submodule change and generated snapshot diff. New categories
must be deliberately added to `covered` or `skip` in `tests/categories.json`.

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

1. Raise the engine dependency.
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
