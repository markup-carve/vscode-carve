#!/usr/bin/env node
// Writes tools/conformance-0.2.json from a markup-carve/carve checkout:
//
//   node tools/vendor-conformance.mjs <carve-checkout> [--check]
//
// Keeps the option-free render examples of spec/0.2/conformance/examples.json
// (id, input, html, reported codes) and the spec commit they came from. The
// commit should be the one the pinned carve-js engine reads.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { argv, exit, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

const checkout = argv[2]
if (!checkout) {
  stdout.write('usage: vendor-conformance.mjs <carve-checkout> [--check]\n')
  exit(2)
}
const out = join(resolve(dirname(fileURLToPath(import.meta.url))), 'conformance-0.2.json')
const commit = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const { examples } = JSON.parse(readFileSync(join(checkout, 'spec/0.2/conformance/examples.json'), 'utf8'))
const kept = examples
  .filter((example) => example.kind === 'render' && Object.keys(example.options ?? {}).length === 0
    && typeof example.expected?.html === 'string')
  .map((example) => ({
    id: example.id,
    input: example.input,
    html: example.expected.html,
    ...(example.expected.diagnostics?.length ? { diagnostics: example.expected.diagnostics } : {}),
  }))
const text = JSON.stringify({ commit, examples: kept }, null, 1) + '\n'
if (argv.includes('--check')) {
  if (readFileSync(out, 'utf8') !== text) {
    stdout.write(`${out} differs from carve ${commit}; run without --check to rewrite it.\n`)
    exit(1)
  }
  stdout.write(`conformance-0.2.json matches carve ${commit} (${kept.length} examples).\n`)
} else {
  writeFileSync(out, text)
  stdout.write(`wrote ${out}: ${kept.length} examples from carve ${commit}\n`)
}
