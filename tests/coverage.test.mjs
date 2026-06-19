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
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const corpusDir = join(root, "spec", "tests", "corpus");

function corpusCategories() {
  const categories = new Set();
  for (const file of readdirSync(corpusDir)) {
    if (!file.endsWith(".crv")) {
      continue;
    }
    categories.add(file.replace(/-[0-9]+\.crv$/, "").replace(/\.crv$/, ""));
  }
  return categories;
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
    if (!existsSync(join(corpusDir, file))) {
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
