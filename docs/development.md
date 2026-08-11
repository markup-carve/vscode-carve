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
