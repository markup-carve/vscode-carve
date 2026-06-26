// Snapshot harness for hand-authored grammar fixtures.
//
// Tests grammar constructs that are not yet in the shared markup-carve/carve
// corpus (e.g. citations, code callouts). Each pair of files in tests/fixtures/
// is a source `.crv` and a committed `.snap` golden; this script verifies them
// against the current grammar without touching the corpus-driven pipeline.
//
//   node tests/run-fixtures.mjs          verify against committed snapshots
//   node tests/run-fixtures.mjs -u       (re)generate snapshots
//
// Exits non-zero on any snapshot mismatch.

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const fixturesDir = join(here, "fixtures");
const grammar = join(root, "syntaxes", "carve.tmLanguage.json");
const scope = "text.carve";

const update = process.argv.includes("-u") || process.argv.includes("--updateSnapshot");

const crvFiles = readdirSync(fixturesDir)
  .filter((f) => f.endsWith(".crv"))
  .map((f) => join(fixturesDir, f));

if (crvFiles.length === 0) {
  console.log("No fixture .crv files found.");
  process.exit(0);
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

process.exit(result.status ?? 1);
