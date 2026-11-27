import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const upstreamDir = process.env.CARVE_GRAMMARS_DIR

test('grammar declarations name rules in the current upstream grammar', { skip: !upstreamDir }, () => {
  const upstream = JSON.parse(readFileSync(resolve(upstreamDir, 'textmate/carve.tmLanguage.json'))).repository
  const declarations = JSON.parse(readFileSync(new URL('../tools/grammar-drift-declarations.json', import.meta.url)))
  const named = [
    ...Object.keys(declarations.upstreamRuleAliases),
    ...Object.keys(declarations.upstreamRulesGroupedLocally),
    ...Object.values(declarations.localRulesGroupedUpstream).map(({ upstream }) => upstream),
  ]
  const absent = named.filter((name) => !(name in upstream))
  assert.deepEqual(absent, [])
})
