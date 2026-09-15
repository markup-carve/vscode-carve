/**
 * A declaration is a claim about a CONSTRUCT, and these assertions measure it.
 *
 * The arm that came before could not: it asserted the cited fixture's snapshot
 * held a scope the LOCAL rule declares, so any well-covered unrelated rule
 * satisfied it. Pointing a missing port at a broad, well-exercised local rule
 * silenced it with every arm green (#200).
 *
 * Attribution comes from rewriting the declared rule's scope names to a probe
 * and tokenizing: a scope name never affects what a regex matches, so the probe
 * marks exactly the tokens that rule won in real competition with every other
 * rule. The spans are taken from the side that OWNS the rule the declaration is
 * about - reading a grouped declaration's spans off the LOCAL rule is what let
 * an unrelated one pass.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spansOwnedBy } from '../tools/grammar-attribution.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const checker = resolve(root, 'tools/check-grammar-drift.mjs')

const FIXTURE = '*bold* and @@mine and a [ref]: /u\n'

const localGrammar = {
	scopeName: 'text.carve',
	patterns: [{ include: '#emphasis' }, { include: '#mine' }, { include: '#definitions' }],
	repository: {
		emphasis: {
			match: '(\\*)([^*]+)(\\*)',
			captures: { 1: { name: 'punctuation.definition.bold.carve' }, 2: { name: 'markup.bold.carve' }, 3: { name: 'punctuation.definition.bold.carve' } },
		},
		mine: { match: '@@[a-z]+', name: 'markup.mine.carve' },
		definitions: { match: '(\\[)([a-z]+)(\\]:)', name: 'meta.definition.carve' },
		combined: { match: '\\*[^*]+\\*|##[a-z]+', name: 'markup.combined.carve' },
	},
}

const upstreamGrammar = {
	scopeName: 'source.carve',
	patterns: [{ include: '#strong' }, { include: '#link_ref_def' }],
	repository: {
		strong: {
			match: '(\\*)([^*]+)(\\*)',
			captures: { 1: { name: 'punctuation.definition.bold.carve' }, 2: { name: 'markup.bold.carve' }, 3: { name: 'punctuation.definition.bold.carve' } },
		},
		link_ref_def: { match: '(\\[)([a-z]+)(\\]:)', name: 'meta.link.reference.definition.carve' },
		hashy: { match: '##[a-z]+', name: 'markup.hashy.carve' },
	},
}

const declarations = {
	upstreamRuleAliases: {},
	upstreamRulesGroupedLocally: { strong: { local: 'emphasis', fixture: 'sample' } },
	localRulesGroupedUpstream: { definitions: { upstream: 'link_ref_def', fixture: 'sample' } },
	localOnlyRules: { mine: 'sample' },
}

/** A throwaway repository holding just enough for the checker to run. */
function scratch({ local = localGrammar, upstream = upstreamGrammar, decls = declarations, fixture = FIXTURE, baseline } = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'vscode-carve-constructs-'))
	mkdirSync(join(dir, 'syntaxes'))
	mkdirSync(join(dir, 'tools'))
	mkdirSync(join(dir, 'tests/fixtures'), { recursive: true })
	mkdirSync(join(dir, 'upstream/textmate'), { recursive: true })
	writeFileSync(join(dir, 'syntaxes/carve.tmLanguage.json'), JSON.stringify(local))
	writeFileSync(join(dir, 'upstream/textmate/carve.tmLanguage.json'), JSON.stringify(upstream))
	writeFileSync(join(dir, 'tools/grammar-drift-declarations.json'), JSON.stringify(decls))
	if (baseline) writeFileSync(join(dir, 'tools/grammar-construct-baseline.json'), JSON.stringify(baseline))
	writeFileSync(join(dir, 'tests/fixtures/sample.crv'), fixture)
	writeFileSync(join(dir, 'tests/fixtures/sample.crv.snap'), '')
	writeFileSync(join(dir, 'tests/fixtures/elsewhere.crv'), 'nothing interesting here\n')
	writeFileSync(join(dir, 'tests/fixtures/elsewhere.crv.snap'), '')
	writeFileSync(join(dir, 'tests/fixtures/bold-only.crv'), '*bold*\n')
	writeFileSync(join(dir, 'tests/fixtures/bold-only.crv.snap'), '')
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function run(mode, scope) {
	return spawnSync(process.execPath, [checker, mode, '--root', scope.dir], {
		env: { ...process.env, CARVE_GRAMMARS_DIR: join(scope.dir, 'upstream') },
		encoding: 'utf8',
	})
}

test('a rule is attributed the tokens it wins, not the ones sharing its scope name', async () => {
	// `mine` and `emphasis` both declare a markup scope; only one owns "@@mine".
	const mine = await spansOwnedBy(localGrammar, 'mine', FIXTURE)
	assert.deepEqual(mine.spans.map((span) => span.text), ['@@mine'])
	const emphasis = await spansOwnedBy(localGrammar, 'emphasis', FIXTURE)
	assert.deepEqual(emphasis.spans.map((span) => span.text), ['*', 'bold', '*'])
})

test('true declarations pass every arm', () => {
	const scope = scratch()
	try {
		const result = run('constructs', scope)
		assert.equal(result.status, 0, result.stdout + result.stderr)
		assert.match(result.stdout, /3 of 3 declaration\(s\) measured, 0 false/)
	} finally {
		scope.cleanup()
	}
})

test('a grouped declaration pointed at a well-covered but unrelated fixture fails', () => {
	// The failure mode #200 demonstrated: the local rule is exercised somewhere,
	// so the old snapshot-substring reading stayed green.
	const scope = scratch({
		decls: { ...declarations, upstreamRulesGroupedLocally: { strong: { local: 'emphasis', fixture: 'elsewhere' } } },
	})
	try {
		const result = run('constructs', scope)
		assert.equal(result.status, 1, result.stdout)
		assert.match(result.stderr, /strong owns nothing in it/)
	} finally {
		scope.cleanup()
	}
})

test('a grouped declaration reads its spans from the UPSTREAM rule it names', () => {
	// The discriminating case. `combined` owns "*bold*" in bold-only.crv, so a
	// reading that took the spans from the LOCAL rule would pass this. Upstream's
	// `hashy` owns nothing there, which is the truth being asserted.
	const scope = scratch({
		decls: { ...declarations, upstreamRulesGroupedLocally: { hashy: { local: 'combined', fixture: 'bold-only' } } },
	})
	try {
		const result = run('constructs', scope)
		assert.equal(result.status, 1, result.stdout)
		assert.match(result.stderr, /hashy owns nothing in it/)
	} finally {
		scope.cleanup()
	}
})

test('a grouped declaration whose construct this grammar does not cover fails', () => {
	const local = { ...localGrammar, repository: { ...localGrammar.repository, emphasis: { match: 'zzz', name: 'markup.bold.carve' } } }
	const scope = scratch({ local })
	try {
		const result = run('constructs', scope)
		assert.equal(result.status, 1, result.stdout)
		assert.match(result.stderr, /left unhighlighted by text\.carve/)
	} finally {
		scope.cleanup()
	}
})

test('EVERY span is asserted, not merely one of them', () => {
	// Local emphasis keeps the opening and closing markers but drops the body, so
	// an "at least one span" reading would stay green on a partial port.
	const local = {
		...localGrammar,
		repository: { ...localGrammar.repository, emphasis: { match: '\\*', name: 'punctuation.definition.bold.carve' } },
	}
	const scope = scratch({ local })
	try {
		const result = run('constructs', scope)
		assert.equal(result.status, 1, result.stdout)
		assert.match(result.stderr, /"bold" at sample\.crv:1:2 is left unhighlighted/)
	} finally {
		scope.cleanup()
	}
})

test('a local-only declaration upstream actually highlights fails', () => {
	const upstream = {
		...upstreamGrammar,
		patterns: [...upstreamGrammar.patterns, { include: '#mention' }],
		repository: { ...upstreamGrammar.repository, mention: { match: '@@[a-z]+', name: 'markup.mention.carve' } },
	}
	const scope = scratch({ upstream })
	try {
		const result = run('constructs', scope)
		assert.equal(result.status, 1, result.stdout)
		assert.match(result.stderr, /local-only rule mine: "@@mine".*is highlighted by source\.carve/)
	} finally {
		scope.cleanup()
	}
})

test('a grouped LOCAL declaration takes its spans from the local rule', () => {
	const upstream = { ...upstreamGrammar, patterns: [{ include: '#strong' }], repository: { ...upstreamGrammar.repository, link_ref_def: { match: 'zzz', name: 'meta.link.reference.definition.carve' } } }
	const scope = scratch({ upstream })
	try {
		const result = run('constructs', scope)
		assert.equal(result.status, 1, result.stdout)
		assert.match(result.stderr, /local rule definitions declared grouped into upstream link_ref_def/)
	} finally {
		scope.cleanup()
	}
})

test('the baseline tolerates a known false declaration and nothing else', () => {
	const decls = { ...declarations, upstreamRulesGroupedLocally: { strong: { local: 'emphasis', fixture: 'elsewhere' } } }
	const listed = scratch({ decls, baseline: { 'upstream:strong': 'no fixture holds it yet' } })
	try {
		const result = run('constructs', listed)
		assert.equal(result.status, 0, result.stdout + result.stderr)
		assert.match(result.stdout, /1 false \(1 known, 0 new or stale\)/)
	} finally {
		listed.cleanup()
	}
})

test('the baseline can only shrink: an entry that came true fails', () => {
	const scope = scratch({ baseline: { 'upstream:strong': 'no fixture holds it yet' } })
	try {
		const result = run('constructs', scope)
		assert.equal(result.status, 1, result.stdout)
		assert.match(result.stderr, /baseline entry upstream:strong is no longer false/)
	} finally {
		scope.cleanup()
	}
})

test('a baseline entry naming no declaration fails', () => {
	const scope = scratch({ baseline: { 'upstream:gone': 'stale' } })
	try {
		const result = run('constructs', scope)
		assert.equal(result.status, 1, result.stdout)
		assert.match(result.stderr, /baseline entry upstream:gone names no declaration/)
	} finally {
		scope.cleanup()
	}
})

test('the offline arm requires the fixture to exercise its own local rule', () => {
	const scope = scratch({
		decls: { ...declarations, localOnlyRules: { mine: 'elsewhere' } },
	})
	try {
		const result = run('declarations', scope)
		assert.equal(result.status, 1, result.stdout)
		assert.match(result.stderr, /local rule mine owns nothing/)
	} finally {
		scope.cleanup()
	}
})

test('the scheduled workflow gates on the construct arm', () => {
	const workflow = readFileSync(resolve(root, '.github/workflows/grammar-drift.yml'), 'utf8')
	assert.match(workflow, /check-grammar-drift\.mjs constructs/)
})
