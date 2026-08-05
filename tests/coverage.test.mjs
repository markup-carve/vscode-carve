// Coverage-matrix test for the Carve TextMate grammar snapshots.
//
// Asserts that every category in the shared markup-carve/carve corpus
// (spec/tests/corpus/*.crv) is accounted for in tests/categories.json - either
// `covered` (a representative file is snapshot-tested) or `skip` (with a reason
// why TextMate highlighting does not produce a distinct, snapshot-worthy scope).
//
// A new spec category therefore fails this test until someone deliberately adds
// it to `covered` or `skip`.

import { strict as assert } from "node:assert";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const corpusDir = join(root, "spec", "tests", "corpus");

// A corpus file is `NN-slug.crv` or `NN-slug-VARIANT.crv`. The CATEGORY is the
// slug alone: the leading number is the spec's ordering, not an identity.
// Keying the matrix on it meant every upstream renumbering invalidated all 126
// entries at once, none of which had changed - so a bump read as 126 decisions
// rather than as the nothing it was.
const slug = (file) =>
  file
    .replace(/^[0-9]+-/, "")
    .replace(/-[0-9]+\.crv$/, "")
    .replace(/\.crv$/, "");

function corpusCategories() {
  const categories = new Set();
  for (const file of readdirSync(corpusDir)) {
    if (file.endsWith(".crv")) {
      categories.add(slug(file));
    }
  }
  return categories;
}

// `covered` names its representative example by slug too, so resolve it back to
// whatever number the corpus currently gives that file.
function corpusFileForSlug(wanted) {
  return readdirSync(corpusDir).find(
    (file) => file.endsWith(".crv") && file.replace(/^[0-9]+-/, "") === wanted,
  );
}

const matrix = JSON.parse(readFileSync(join(here, "categories.json"), "utf8"));
const covered = matrix.covered;
const skip = matrix.skip;

test("spec submodule is checked out", () => {
  assert.ok(
    existsSync(corpusDir),
    `Corpus directory ${corpusDir} is missing. Run: git submodule update --init`,
  );
  assert.ok(readdirSync(corpusDir).some((f) => f.endsWith(".crv")), "Corpus has no .crv files");
});

test("every corpus category is covered or skipped", () => {
  const categories = corpusCategories();
  const coveredKeys = new Set(Object.keys(covered));
  const skipKeys = new Set(Object.keys(skip));

  const undecided = [...categories]
    .filter((c) => !coveredKeys.has(c) && !skipKeys.has(c))
    .sort();

  assert.deepEqual(
    undecided,
    [],
    `New corpus categories are neither covered nor skipped. ` +
      `Add each to "covered" (with a representative .crv) or "skip" (with a reason) ` +
      `in tests/categories.json:\n  ${undecided.join("\n  ")}`,
  );
});

test("no category is both covered and skipped", () => {
  const both = Object.keys(covered)
    .filter((c) => c in skip)
    .sort();
  assert.deepEqual(both, [], `Categories listed in both covered and skip: ${both.join(", ")}`);
});

test("covered and skip entries reference real corpus categories", () => {
  const categories = corpusCategories();
  const stale = [...Object.keys(covered), ...Object.keys(skip)]
    .filter((c) => !categories.has(c))
    .sort();
  assert.deepEqual(
    stale,
    [],
    `Matrix references categories that no longer exist in the corpus: ${stale.join(", ")}`,
  );
});

test("every covered category points at an existing corpus file", () => {
  const missing = [];
  for (const [category, file] of Object.entries(covered)) {
    if (!corpusFileForSlug(file)) {
      missing.push(`${category} -> ${file}`);
    }
  }
  assert.deepEqual(missing, [], `Covered files missing from corpus:\n  ${missing.join("\n  ")}`);
});

test("every skip entry has a non-empty reason", () => {
  const empty = Object.entries(skip)
    .filter(([, reason]) => typeof reason !== "string" || reason.trim().length === 0)
    .map(([c]) => c);
  assert.deepEqual(empty, [], `Skip entries without a reason: ${empty.join(", ")}`);
});

// ---------------------------------------------------------------------------
// A SKIP'S PREMISE, CHECKED.
//
// Every skip reason here says some version of "this category produces no scope
// that is not already snapshotted elsewhere". That is a claim about the GRAMMAR,
// and nothing re-asked it. It holds today - checked by removing the two fixtures
// that carry `markup.table.continuation` and the quoted-attribute-value scopes,
// which makes this fail and names them - but it holds by nobody's design: the
// entries say "covered by 17 and 75-style cases" and by "100/83", and those are
// corpus categories that do not produce the scopes at all. What actually covers
// them is `attr-payload` and `table-patterns` in tests/fixtures.
//
// So the premise is measured: tokenize each skipped category and require every
// scope it produces to appear in a COVERED corpus file or a committed FIXTURE.
// The fixtures count because they are exactly the hand-authored home for a
// construct the corpus cannot represent in one file - no corpus document carries
// both a single- and a double-quoted attribute value.
const vsctm = require("vscode-textmate");
const oniguruma = require("vscode-oniguruma");

async function grammarForScopes() {
  await oniguruma.loadWASM(
    readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")).buffer,
  );
  const registry = new vsctm.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
      createOnigString: (str) => new oniguruma.OnigString(str),
    }),
    loadGrammar: async () =>
      vsctm.parseRawGrammar(
        readFileSync(join(root, "syntaxes", "carve.tmLanguage.json"), "utf8"),
        "carve.tmLanguage.json",
      ),
  });

  return registry.loadGrammar("text.carve");
}

function scopesOf(grammar, source) {
  const found = new Set();
  let rules = vsctm.INITIAL;
  for (const line of source.split("\n")) {
    const result = grammar.tokenizeLine(line, rules);
    for (const token of result.tokens) {
      for (const scope of token.scopes) if (scope !== "text.carve") found.add(scope);
    }
    rules = result.ruleStack;
  }

  return found;
}

test("no scope lives only in a skipped category", async () => {
  const grammar = await grammarForScopes();
  const corpusFiles = readdirSync(corpusDir).filter((f) => f.endsWith(".crv"));

  const snapshotted = new Set();
  for (const file of Object.values(covered)) {
    const numbered = corpusFileForSlug(file);
    assert.ok(numbered, `covered file missing from the corpus: ${file}`);
    for (const scope of scopesOf(grammar, readFileSync(join(corpusDir, numbered), "utf8"))) {
      snapshotted.add(scope);
    }
  }
  const fixturesDir = join(here, "fixtures");
  for (const file of readdirSync(fixturesDir).filter((f) => f.endsWith(".crv"))) {
    for (const scope of scopesOf(grammar, readFileSync(join(fixturesDir, file), "utf8"))) {
      snapshotted.add(scope);
    }
  }

  const orphans = [];
  for (const category of Object.keys(skip)) {
    const files = corpusFiles.filter((f) => slug(f) === category);
    const only = new Set();
    for (const file of files) {
      for (const scope of scopesOf(grammar, readFileSync(join(corpusDir, file), "utf8"))) {
        if (!snapshotted.has(scope)) only.add(scope);
      }
    }
    if (only.size) orphans.push(`${category}: ${[...only].sort().join(", ")}`);
  }

  assert.deepEqual(
    orphans,
    [],
    "These skipped categories produce scopes that no covered file and no fixture " +
      "produces, so the scope is in the grammar and in no snapshot:\n  " +
      orphans.join("\n  ") +
      "\nEither cover the category or add a fixture that exercises the scope.",
  );
});
