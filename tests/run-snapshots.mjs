// Token-snapshot harness for the Carve TextMate grammar.
//
// For every corpus category marked `covered` in tests/categories.json, the
// representative `.crv` file from the shared markup-carve/carve corpus
// (spec/tests/corpus) is copied into tests/snapshots/ and tokenized with the
// grammar via vscode-tmgrammar-snap. The resulting `.snap` files are committed
// as golden snapshots.
//
//   node tests/run-snapshots.mjs        verify against committed snapshots
//   node tests/run-snapshots.mjs -u     (re)generate snapshots
//
// Exits non-zero on any snapshot mismatch.

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const corpusDir = join(root, "spec", "tests", "corpus");
const snapDir = join(here, "snapshots");
const grammar = join(root, "syntaxes", "carve.tmLanguage.json");
const scope = "text.carve";

const update = process.argv.includes("-u") || process.argv.includes("--updateSnapshot");

const matrix = JSON.parse(readFileSync(join(here, "categories.json"), "utf8"));

mkdirSync(snapDir, { recursive: true });

// Refresh the `.crv` copies from the corpus so they always reflect the pinned
// submodule. The matching `.snap` files are the committed golden artifacts and
// are NOT deleted here - in verify mode they are what the tool compares against.
const crvFiles = [];
const wantedBasenames = new Set();
for (const [category, file] of Object.entries(matrix.covered)) {
  const src = join(corpusDir, file);
  const dest = join(snapDir, file);
  try {
    copyFileSync(src, dest);
  } catch (err) {
    console.error(`Cannot copy corpus file for "${category}": ${file}`);
    console.error("Is the `spec` submodule checked out? Run: git submodule update --init");
    throw err;
  }
  crvFiles.push(dest);
  wantedBasenames.add(file);
}

// Drop staging files (both `.crv` and `.snap`) for categories that are no
// longer covered, so removed categories do not leave dangling artifacts.
for (const f of readdirSync(snapDir)) {
  const crvName = f.endsWith(".snap") ? f.slice(0, -".snap".length) : f;
  if (!wantedBasenames.has(crvName)) {
    rmSync(join(snapDir, f));
  }
}

const bin = join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vscode-tmgrammar-snap.cmd" : "vscode-tmgrammar-snap",
);

const args = ["-g", grammar, "-s", scope];
if (update) {
  args.push("-u");
}
args.push(...crvFiles);

const result = spawnSync(bin, args, { stdio: "inherit" });

if (result.error) {
  throw result.error;
}

if (update) {
  console.log(`\nGenerated ${crvFiles.length} snapshot(s) in tests/snapshots/.`);
}

process.exit(result.status ?? 1);
