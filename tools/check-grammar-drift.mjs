#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const mode = process.argv[2]
const upstreamRoot = process.env.CARVE_GRAMMARS_DIR

if (!['missing', 'declarations'].includes(mode)) {
  console.error('usage: check-grammar-drift.mjs missing|declarations')
  process.exit(2)
}
if (!upstreamRoot) {
  console.error('CARVE_GRAMMARS_DIR must name the shared carve-grammars checkout')
  process.exit(2)
}

const load = (path) => JSON.parse(readFileSync(path, 'utf8'))
const local = load(resolve(root, 'syntaxes/carve.tmLanguage.json')).repository
const upstream = load(resolve(upstreamRoot, 'textmate/carve.tmLanguage.json')).repository
const declarations = load(resolve(root, 'tools/grammar-drift-declarations.json'))
const canonical = (name) => name.replaceAll('_', '-')
const localByCanonical = new Map(Object.keys(local).map((name) => [canonical(name), name]))
const upstreamCanonicalNames = new Set(Object.keys(upstream).map(canonical))

function structuralOnly(rule) {
  if (Array.isArray(rule)) return rule.every(structuralOnly)
  if (!rule || typeof rule !== 'object') return true
  return !Object.entries(rule).some(([key, value]) =>
    ((key === 'name' || key === 'contentName') && typeof value === 'string') || !structuralOnly(value))
}

const aliases = declarations.upstreamRuleAliases
const groupedUpstream = declarations.upstreamRulesGroupedLocally
const groupedLocal = declarations.localRulesGroupedUpstream
const upstreamCoveredByLocalGrouping = new Set(Object.values(groupedLocal).map(({ upstream: name }) => name))
const missing = Object.entries(upstream)
  .filter(([, rule]) => !structuralOnly(rule))
  .filter(([name]) => !localByCanonical.has(canonical(name)))
  .filter(([name]) => !(name in aliases))
  .filter(([name]) => !(name in groupedUpstream))
  .filter(([name]) => !upstreamCoveredByLocalGrouping.has(name))
  .map(([name]) => name)
  .sort()

if (mode === 'missing') {
  console.log(`Grammar rule coverage: ${Object.keys(upstream).length} upstream, ${Object.keys(local).length} local.`)
  if (missing.length === 0) {
    console.log('ACTIONABLE: 0 upstream rules have no local counterpart.')
    process.exit(0)
  }
  console.log(`ACTIONABLE: ${missing.length} upstream rule(s) have no local counterpart:`)
  missing.forEach((name) => console.log(`  + ${name}`))
  process.exit(1)
}

const problems = []
const declaredLocal = new Set([
  ...Object.values(aliases).map(({ local: name }) => name),
  ...Object.values(groupedUpstream).map(({ local: name }) => name),
  ...Object.keys(groupedLocal),
  ...Object.keys(declarations.localOnlyRules),
])

function scopesIn(rule, found = new Set()) {
  if (Array.isArray(rule)) rule.forEach((value) => scopesIn(value, found))
  else if (rule && typeof rule === 'object') {
    for (const [key, value] of Object.entries(rule)) {
      if ((key === 'name' || key === 'contentName') && typeof value === 'string') found.add(value)
      scopesIn(value, found)
    }
  }
  return found
}

function checkFixture(owner, fixture, localName) {
  for (const suffix of ['.crv', '.crv.snap']) {
    if (!existsSync(resolve(root, 'tests/fixtures', fixture + suffix))) {
      problems.push(`${owner} cites missing fixture tests/fixtures/${fixture}${suffix}`)
    }
  }
  const snapshot = resolve(root, 'tests/fixtures', fixture + '.crv.snap')
  const scopes = [...scopesIn(local[localName])]
  if (scopes.length > 0 && existsSync(snapshot) && !scopes.some((scope) => readFileSync(snapshot, 'utf8').includes(scope))) {
    problems.push(`${owner} cites ${fixture}, whose snapshot contains none of ${localName}'s scopes`)
  }
}

for (const [upstreamName, { local: localName, fixture }] of Object.entries(aliases)) {
  if (!(upstreamName in upstream)) problems.push(`alias ${upstreamName} names no upstream rule`)
  if (!(localName in local)) problems.push(`alias ${upstreamName} -> ${localName} names no local rule`)
  if (canonical(upstreamName) === canonical(localName)) problems.push(`alias ${upstreamName} -> ${localName} is redundant`)
  checkFixture(`alias ${upstreamName}`, fixture, localName)
}
for (const [upstreamName, { local: localName, fixture }] of Object.entries(groupedUpstream)) {
  if (!(upstreamName in upstream)) problems.push(`grouped upstream rule ${upstreamName} no longer exists`)
  if (!(localName in local)) problems.push(`${upstreamName} maps to missing local rule ${localName}`)
  if (localByCanonical.has(canonical(upstreamName))) problems.push(`grouped upstream rule ${upstreamName} now has a direct local counterpart`)
  checkFixture(`grouped upstream rule ${upstreamName}`, fixture, localName)
}
for (const [localName, { upstream: upstreamName, fixture }] of Object.entries(groupedLocal)) {
  if (!(localName in local)) problems.push(`grouped local rule ${localName} no longer exists`)
  if (!(upstreamName in upstream)) problems.push(`${localName} maps to missing upstream rule ${upstreamName}`)
  if (upstreamCanonicalNames.has(canonical(localName))) problems.push(`grouped local rule ${localName} now has a direct upstream counterpart`)
  checkFixture(`grouped local rule ${localName}`, fixture, localName)
}
for (const [localName, fixture] of Object.entries(declarations.localOnlyRules)) {
  if (!(localName in local)) problems.push(`local-only rule ${localName} no longer exists`)
  if (upstreamCanonicalNames.has(canonical(localName))) problems.push(`local-only rule ${localName} now exists upstream`)
  checkFixture(`local-only rule ${localName}`, fixture, localName)
}

for (const localName of Object.keys(local)) {
  const direct = Object.keys(upstream).some((name) => canonical(name) === canonical(localName))
  if (!direct && !declaredLocal.has(localName) && !structuralOnly(local[localName])) {
    problems.push(`local rule ${localName} has no direct upstream match and no declaration`)
  }
}

console.log(`Grammar declarations: ${problems.length} stale or incomplete.`)
problems.forEach((problem) => console.error(`  ! ${problem}`))
process.exit(problems.length === 0 ? 0 : 1)
