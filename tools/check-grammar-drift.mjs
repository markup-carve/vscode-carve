#!/usr/bin/env node
// Three arms over the same declarations file.
//
//   missing       upstream rules with no local counterpart and no declaration
//   declarations  the declarations are well-formed, and each cites a fixture
//                 that exercises its own local rule
//   constructs    each declaration is true of the CONSTRUCT, not just the names
//
// The third arm exists because the first two cannot see a declaration that is
// well-formed but substantively wrong (#200). `checkFixture` used to assert the
// cited fixture's snapshot held a scope the LOCAL rule declares, which any
// well-covered unrelated rule satisfies: pointing a missing port at
// `{ "local": "tables", "fixture": "table-patterns" }` silenced it with both
// arms green.
//
// Attribution now comes from grammar-attribution.mjs, and the spans are taken
// from the side that OWNS the rule the declaration is about. That is the part
// that matters: reading a grouped declaration's spans off the local rule is
// exactly what lets an unrelated one pass.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { highlightedAt, spansOwnedBy, tokenize } from './grammar-attribution.mjs'

const rootFlag = process.argv.indexOf('--root')
const root = rootFlag === -1
  ? dirname(dirname(fileURLToPath(import.meta.url)))
  : resolve(process.argv[rootFlag + 1])
const mode = process.argv[2]
const upstreamRoot = process.env.CARVE_GRAMMARS_DIR

if (!['missing', 'declarations', 'constructs'].includes(mode)) {
  console.error('usage: check-grammar-drift.mjs missing|declarations|constructs [--root <dir>]')
  process.exit(2)
}
if (!upstreamRoot) {
  console.error('CARVE_GRAMMARS_DIR must name the shared carve-grammars checkout')
  process.exit(2)
}

const load = (path) => JSON.parse(readFileSync(path, 'utf8'))
const localGrammar = load(resolve(root, 'syntaxes/carve.tmLanguage.json'))
const upstreamGrammar = load(resolve(upstreamRoot, 'textmate/carve.tmLanguage.json'))
const local = localGrammar.repository
const upstream = upstreamGrammar.repository
const declarations = load(resolve(root, 'tools/grammar-drift-declarations.json'))
const fixtureSource = (fixture) => readFileSync(resolve(root, 'tests/fixtures', fixture + '.crv'), 'utf8')
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

// The fixture must contain the construct, not merely some text another rule
// scopes. Ownership is measured, never inferred from the scopes the rule names:
// two rules routinely declare the same scope.
async function checkFixture(owner, fixture, localName) {
  for (const suffix of ['.crv', '.crv.snap']) {
    if (!existsSync(resolve(root, 'tests/fixtures', fixture + suffix))) {
      problems.push(`${owner} cites missing fixture tests/fixtures/${fixture}${suffix}`)
      return
    }
  }
  if (!(localName in local)) return
  // A pure factoring rule declares no scope anywhere, so nothing can attribute a
  // token to it. It is not measurable rather than false, and `missing` already
  // treats it as non-highlighting.
  if (structuralOnly(local[localName])) return
  const { spans: owned } = await spansOwnedBy(localGrammar, localName, fixtureSource(fixture))
  if (owned.length === 0) {
    problems.push(`${owner} cites ${fixture}, in which the local rule ${localName} owns nothing`)
  }
}

if (mode === 'declarations') {
for (const [upstreamName, { local: localName, fixture }] of Object.entries(aliases)) {
  if (!(upstreamName in upstream)) problems.push(`alias ${upstreamName} names no upstream rule`)
  if (!(localName in local)) problems.push(`alias ${upstreamName} -> ${localName} names no local rule`)
  if (canonical(upstreamName) === canonical(localName)) problems.push(`alias ${upstreamName} -> ${localName} is redundant`)
  await checkFixture(`alias ${upstreamName}`, fixture, localName)
}
for (const [upstreamName, { local: localName, fixture }] of Object.entries(groupedUpstream)) {
  if (!(upstreamName in upstream)) problems.push(`grouped upstream rule ${upstreamName} no longer exists`)
  if (!(localName in local)) problems.push(`${upstreamName} maps to missing local rule ${localName}`)
  if (localByCanonical.has(canonical(upstreamName))) problems.push(`grouped upstream rule ${upstreamName} now has a direct local counterpart`)
  await checkFixture(`grouped upstream rule ${upstreamName}`, fixture, localName)
}
for (const [localName, { upstream: upstreamName, fixture }] of Object.entries(groupedLocal)) {
  if (!(localName in local)) problems.push(`grouped local rule ${localName} no longer exists`)
  if (!(upstreamName in upstream)) problems.push(`${localName} maps to missing upstream rule ${upstreamName}`)
  if (upstreamCanonicalNames.has(canonical(localName))) problems.push(`grouped local rule ${localName} now has a direct upstream counterpart`)
  await checkFixture(`grouped local rule ${localName}`, fixture, localName)
}
for (const [localName, fixture] of Object.entries(declarations.localOnlyRules)) {
  if (!(localName in local)) problems.push(`local-only rule ${localName} no longer exists`)
  if (upstreamCanonicalNames.has(canonical(localName))) problems.push(`local-only rule ${localName} now exists upstream`)
  await checkFixture(`local-only rule ${localName}`, fixture, localName)
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
}

/*
 * CONSTRUCTS. The three declaration maps are one measurement pointed three
 * different ways, so they are one helper used three times:
 *
 *   an alias or a grouped upstream rule   this grammar highlights EVERYTHING
 *                                         the UPSTREAM rule owns
 *   a grouped local rule                  upstream highlights EVERYTHING the
 *                                         LOCAL rule owns
 *   a local-only rule                     upstream highlights NOTHING the
 *                                         LOCAL rule owns
 *
 * They differ only in which grammar owns the rule and which way the assertion
 * points. Taking the spans from the wrong side is the whole defect: read a
 * grouped declaration's spans off the local rule and any well-covered unrelated
 * rule satisfies it.
 *
 * EVERY span, never "at least one". Measured in the sibling repository: with an
 * upstream alternative deleted, another upstream rule still reached part of the
 * run, so an any-span assertion stayed green on a construct upstream had just
 * lost.
 */
const unmeasurable = []
// A declaration known false today. The backlog is enumerated rather than
// tolerated by a count, and it can only shrink: an entry naming a declaration
// that has since become true fails, and so does one naming no declaration at
// all. Anything false and NOT listed here fails immediately, which is what makes
// this a gate rather than a report.
const baselinePath = resolve(root, 'tools/grammar-construct-baseline.json')
const baseline = existsSync(baselinePath) ? load(baselinePath) : {}
const known = []
const fatal = []
const seenIds = new Set()
const falseIds = new Set()
const localRoot = localGrammar.scopeName
const upstreamRoot_ = upstreamGrammar.scopeName
const tokenCache = new Map()
const tokensFor = async (grammar, fixture) => {
  const key = `${grammar.scopeName}:${fixture}`
  if (!tokenCache.has(key)) tokenCache.set(key, await tokenize(grammar, fixtureSource(fixture)))
  return tokenCache.get(key)
}

async function assertCoverage({ id, owner, fixture, ownerGrammar, ownerRule, otherGrammar, otherRoot, expect, hint }) {
  seenIds.add(id)
  const problems = []
  for (const suffix of ['.crv', '.crv.snap']) {
    if (!existsSync(resolve(root, 'tests/fixtures', fixture + suffix))) {
      problems.push(`${owner} cites missing fixture tests/fixtures/${fixture}${suffix}`)
      return problems
    }
  }
  if (structuralOnly(ownerGrammar.repository[ownerRule])) {
    unmeasurable.push(`${owner}: ${ownerRule} declares no scope, so no token can be attributed to it`)
    return problems
  }
  const attributed = await spansOwnedBy(ownerGrammar, ownerRule, fixtureSource(fixture))
  if (attributed === null) {
    problems.push(`${owner} names ${ownerRule}, which ${ownerGrammar.scopeName} does not have`)
    return problems
  }
  const owned = attributed.spans
  if (owned.length === 0) {
    problems.push(
      `${owner} is declared against ${fixture}, but ${ownerRule} owns nothing in it - ` +
        'the fixture must contain the construct, not merely some text another rule scopes',
    )
    return problems
  }
  const other = await tokensFor(otherGrammar, fixture)
  for (const span of owned) {
    const highlighted = highlightedAt(other, otherRoot, span.row, span.start)
    if (highlighted !== expect) {
      problems.push(
        `${owner}: ${JSON.stringify(span.text)} at ${fixture}.crv:${span.row + 1}:${span.start + 1} is ` +
          `${highlighted ? 'highlighted' : 'left unhighlighted'} by ${otherGrammar.scopeName}. ${hint}`,
      )
      break
    }
  }
  return problems
}

async function measure(args) {
  const found = await assertCoverage(args)
  if (!found || found.length === 0) return
  falseIds.add(args.id)
  if (args.id in baseline) known.push(`${found[0]} [${baseline[args.id]}]`)
  else fatal.push(found[0])
}

for (const [upstreamName, { local: localName, fixture }] of Object.entries({ ...aliases, ...groupedUpstream })) {
  if (!(upstreamName in upstream) || !(localName in local)) continue // the declarations arm owns this
  await measure({
    id: `upstream:${upstreamName}`,
    owner: `upstream rule ${upstreamName} declared covered by ${localName}`,
    fixture,
    ownerGrammar: upstreamGrammar,
    ownerRule: upstreamName,
    otherGrammar: localGrammar,
    otherRoot: localRoot,
    expect: true,
    hint: 'That is a construct this grammar does not cover, so the declaration is false.',
  })
}
for (const [localName, { upstream: upstreamName, fixture }] of Object.entries(groupedLocal)) {
  if (!(upstreamName in upstream) || !(localName in local)) continue
  await measure({
    id: `local:${localName}`,
    owner: `local rule ${localName} declared grouped into upstream ${upstreamName}`,
    fixture,
    ownerGrammar: localGrammar,
    ownerRule: localName,
    otherGrammar: upstreamGrammar,
    otherRoot: upstreamRoot_,
    expect: true,
    hint: 'That is a construct upstream does not have, which is localOnlyRules, not a grouping delta.',
  })
}
for (const [localName, fixture] of Object.entries(declarations.localOnlyRules)) {
  if (!(localName in local)) continue
  await measure({
    id: `localOnly:${localName}`,
    owner: `local-only rule ${localName}`,
    fixture,
    ownerGrammar: localGrammar,
    ownerRule: localName,
    otherGrammar: upstreamGrammar,
    otherRoot: upstreamRoot_,
    expect: false,
    hint: 'It is not a construct upstream lacks - find the upstream rule that scopes it and declare the grouping instead.',
  })
}

for (const [id, reason] of Object.entries(baseline)) {
  if (!seenIds.has(id)) fatal.push(`baseline entry ${id} names no declaration - remove it (${reason})`)
  else if (!falseIds.has(id)) fatal.push(`baseline entry ${id} is no longer false - remove it (${reason})`)
}

const declared =
  Object.keys(aliases).length +
  Object.keys(groupedUpstream).length +
  Object.keys(groupedLocal).length +
  Object.keys(declarations.localOnlyRules).length
console.log(
  `Grammar constructs: ${declared - unmeasurable.length} of ${declared} declaration(s) measured, ` +
    `${falseIds.size} false (${known.length} known, ${fatal.length} new or stale).`,
)
// Named rather than counted as green: a declaration nothing could measure is
// vacuous, and a vacuous row hiding inside a total is how this check got here.
unmeasurable.forEach((line) => console.log(`  ~ not measurable: ${line}`))
known.forEach((line) => console.log(`  . known: ${line}`))
fatal.forEach((line) => console.error(`  ! ${line}`))
process.exit(fatal.length === 0 ? 0 : 1)
