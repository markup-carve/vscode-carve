import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const checker = resolve(root, 'tools/check-grammar-drift.mjs')
const declarations = JSON.parse(readFileSync(resolve(root, 'tools/grammar-drift-declarations.json')))
const local = JSON.parse(readFileSync(resolve(root, 'syntaxes/carve.tmLanguage.json'))).repository

function fakeUpstream() {
  const declaredLocals = new Set([
    ...Object.values(declarations.upstreamRuleAliases).map(({ local: name }) => name),
    ...Object.values(declarations.upstreamRulesGroupedLocally).map(({ local: name }) => name),
    ...Object.keys(declarations.localRulesGroupedUpstream),
    ...Object.keys(declarations.localOnlyRules),
  ])
  const names = new Set(Object.keys(local).filter((name) => !declaredLocals.has(name)).map((name) => name.replaceAll('-', '_')))
  Object.keys(declarations.upstreamRuleAliases).forEach((name) => names.add(name))
  Object.keys(declarations.upstreamRulesGroupedLocally).forEach((name) => names.add(name))
  Object.values(declarations.localRulesGroupedUpstream).forEach(({ upstream: name }) => names.add(name))
  const repository = Object.fromEntries([...names].map((name) => [name, { name: `meta.${name}.carve`, match: 'x' }]))
  repository.container_blocks = { patterns: [] }
  return { scopeName: 'text.carve', patterns: [], repository }
}

function withUpstream(grammar, callback) {
  const dir = mkdtempSync(resolve(tmpdir(), 'vscode-carve-drift-'))
  try {
    mkdirSync(resolve(dir, 'textmate'))
    writeFileSync(resolve(dir, 'textmate/carve.tmLanguage.json'), JSON.stringify(grammar))
    callback({ ...process.env, CARVE_GRAMMARS_DIR: dir })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('declaration bookkeeping accepts current declared relationships', () => {
  withUpstream(fakeUpstream(), (env) => {
    assert.doesNotThrow(() => execFileSync(process.execPath, [checker, 'declarations'], { env }))
  })
})

test('declaration bookkeeping gates when an upstream alias goes stale', () => {
  const grammar = fakeUpstream()
  delete grammar.repository.fenced_code
  withUpstream(grammar, (env) => {
    const result = spawnSync(process.execPath, [checker, 'declarations'], { env, encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /alias fenced_code names no upstream rule/)
  })
})

test('missing check succeeds when every highlighting rule has a counterpart', () => {
  withUpstream(fakeUpstream(), (env) => {
    const output = execFileSync(process.execPath, [checker, 'missing'], { env, encoding: 'utf8' })
    assert.match(output, /ACTIONABLE: 0 upstream rules/)
  })
})

test('missing check reports only an undeclared, highlighting rule', () => {
  const grammar = fakeUpstream()
  grammar.repository.new_construct = { name: 'meta.new.carve', match: 'new' }
  grammar.repository.factoring_only = { patterns: [{ include: '#new_construct' }] }
  withUpstream(grammar, (env) => {
    const result = spawnSync(process.execPath, [checker, 'missing'], { env, encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stdout, /ACTIONABLE: 1 upstream rule/)
    assert.match(result.stdout, /\+ new_construct/)
    assert.doesNotMatch(result.stdout, /factoring_only/)
  })
})

test('scheduled reporter warns only for an actionable checker result', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'vscode-carve-reporter-'))
  try {
    const checker = resolve(dir, 'checker')
    writeFileSync(checker, '#!/bin/sh\necho "ACTIONABLE: 1 missing"\nexit 1\n')
    chmodSync(checker, 0o755)
    const result = spawnSync(resolve(root, 'tools/report-grammar-drift.sh'), [], {
      env: { ...process.env, GRAMMAR_DRIFT_CHECKER: checker, RUNNER_TEMP: dir }, encoding: 'utf8',
    })
    assert.equal(result.status, 0)
    assert.match(result.stdout, /::warning::ACTIONABLE: 1 missing/)

    writeFileSync(checker, '#!/bin/sh\necho "checker crashed"\nexit 2\n')
    const broken = spawnSync(resolve(root, 'tools/report-grammar-drift.sh'), [], {
      env: { ...process.env, GRAMMAR_DRIFT_CHECKER: checker, RUNNER_TEMP: dir }, encoding: 'utf8',
    })
    assert.equal(broken.status, 2)
    assert.match(broken.stdout, /::error::Grammar drift could not be checked/)
    assert.doesNotMatch(broken.stdout, /::warning::/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
