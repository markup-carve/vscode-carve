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
  packages pin different engine revisions. That is the state the extension
  shipped in before #133: the language server ran a parser the preview was not
  using.

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

## Packaging and local installation

```bash
npm run package
code --install-extension vscode-carve-0.1.0.vsix
```

Use the filename emitted by `npm run package` if its version differs from the
example above.
