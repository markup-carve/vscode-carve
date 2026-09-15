#!/usr/bin/env node
// Is the engine this extension bundles pinned exactly, and how far behind
// upstream is it?
//
// The .vsix ships the engine INSIDE it, so there is no later resolution step a
// user could inspect: two builds a day apart must produce the same extension for
// the same version number (#35). A pin that resolves differently over time
// breaks that, whatever spelling it is written in.
//
// This check used to demand a 40-hex revision. The packages moved to npm
// versions, so the check reported on a shape the repo no longer uses and was red
// on every scheduled run for months (#202) - the same defect #201 fixed one file
// over, where `pinsAgree` named the old spelling instead of the property.
//
// The property is EXACTNESS, not the spelling. A 40-hex revision has it; so does
// an exact npm version. A range (`^0.1.6`, `~0.1.6`, `*`, `0.1.x`, `latest`) does
// not, and that is the only failure this arm owns.
//
// Lag is REPORTED, not gated: upstream moving is not a defect here, and a job
// that goes red for something outside the repository teaches everyone to ignore
// it. It DOES fail when a pin cannot be resolved to a commit on upstream main -
// a typo, a force-pushed branch, a revision that no longer exists - because that
// is a broken build waiting to happen (carve#499).
//
// Usage: node tools/check-engine-pin.mjs <dep> <upstream-dir> [--manifest <path>]

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const [dep, upstreamDir] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const manifestIndex = process.argv.indexOf('--manifest')
const manifestPath = manifestIndex === -1 ? resolve(root, 'package.json') : process.argv[manifestIndex + 1]

if (!dep || !upstreamDir) {
  console.error('usage: check-engine-pin.mjs <dep> <upstream-dir> [--manifest <path>]')
  process.exit(2)
}

const say = (line) => console.log(line)
const die = (line) => {
  console.log(`::error::${line}`)
  process.exit(1)
}

const git = (...args) =>
  execFileSync('git', ['-C', upstreamDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const gitOk = (...args) => {
  try {
    git(...args)
    return true
  } catch {
    return false
  }
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const spec = manifest.dependencies?.[dep]
if (spec === undefined) die(`${dep} is not a dependency of ${manifestPath}`)

const REVISION = /^[0-9a-f]{40}$/
// Exact semver only. Anything a range operator can widen is rejected by omission
// rather than by listing the operators, so a spelling nobody thought of - `1.x`,
// `>=1 <2`, `latest`, `npm:other@^1` - fails rather than passing unrecognized.
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

const afterHash = spec.includes('#') ? spec.slice(spec.lastIndexOf('#') + 1) : spec

let commit
let described
if (REVISION.test(afterHash)) {
  commit = afterHash
  described = `revision ${commit}`
  if (!gitOk('cat-file', '-e', `${commit}^{commit}`)) {
    die(`${dep} pins ${commit}, which is not a commit in ${upstreamDir}`)
  }
} else if (EXACT_VERSION.test(spec)) {
  // The two upstreams tag differently - carve-js writes `0.1.6`, carve-lsp
  // writes `v0.1.6` - so both spellings are tried rather than one being assumed.
  const tag = [spec, `v${spec}`].find((name) => gitOk('rev-parse', '--verify', `refs/tags/${name}^{commit}`))
  if (!tag) {
    // Upstream's bookkeeping, not this repository's build: carve-lsp published
    // 0.1.5 to npm and never tagged it. Lag cannot be computed, which is the
    // only thing lost.
    say(`bundled ${dep}: ${spec} (no matching tag in ${upstreamDir}; lag not measurable)`)
    say(`::warning::${dep} pins ${spec}, which ${upstreamDir} has not tagged - upstream published without a tag`)
    process.exit(0)
  }
  commit = git('rev-parse', `refs/tags/${tag}^{commit}`)
  described = `${spec} (tag ${tag}, ${commit.slice(0, 12)})`
} else {
  die(
    `${dep} is "${spec}" - it must pin an exact version or a 40-hex revision. ` +
      'A range resolves differently over time, so two builds of the same extension version bundle different engines',
  )
}

if (!gitOk('merge-base', '--is-ancestor', commit, 'origin/main')) {
  die(`${upstreamDir} ${commit} is not on main, so the pin came from an unmerged or rewritten branch`)
}

const behind = Number(git('rev-list', '--count', `${commit}..origin/main`))
say(`bundled ${dep}: ${described} - ${git('log', '-1', '--format=%s', commit)}`)
say(`${upstreamDir} main is ${behind} commit(s) ahead`)
if (behind > 0) say(`::warning::${dep} is ${behind} ${upstreamDir} commit(s) behind main`)
