/**
 * The git-dependency guard runs at publish time only, so this file runs the real
 * script on every pull request: a guard first executed during a release is found
 * broken at the most expensive moment.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const guard = resolve(root, 'scripts/no-git-dependencies.mjs')
const baseline = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

function runGuard(manifest) {
	const dir = mkdtempSync(join(tmpdir(), 'vscode-carve-guard-'))
	try {
		const path = join(dir, 'package.json')
		writeFileSync(path, JSON.stringify(manifest))
		const run = spawnSync(process.execPath, [guard, path], { encoding: 'utf8' })
		assert.equal(run.error, undefined)
		return { status: run.status, out: `${run.stdout}${run.stderr}` }
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
}

const withDep = (field, spec) => ({
	...baseline,
	dependencies: { ...baseline.dependencies, '@markup-carve/carve': '0.1.15' },
	[field]: { ...(field === 'dependencies' ? baseline.dependencies : {}), '@markup-carve/carve': spec },
})

const REJECT = [
	['dependencies', 'github:markup-carve/carve-js#99ad0d2a4e5ec192440c3e5a1b4b95f50ed3cfcf'],
	['dependencies', 'git+https://github.com/markup-carve/carve-js.git#99ad0d2'],
	['dependencies', 'markup-carve/carve-js#99ad0d2'],
	['dependencies', 'git@github.com:markup-carve/carve-js.git'],
	['dependencies', 'file:../carve-js'],
	['dependencies', 'npm:foo@github:owner/repo'],
	['optionalDependencies', 'github:markup-carve/carve-js#99ad0d2'],
	['peerDependencies', 'github:markup-carve/carve-js#99ad0d2'],
]

const ACCEPT = ['0.1.15', '^0.1.15', 'latest', '>=0.1.15 <0.2.0', '0.2.0-beta.1', 'npm:@markup-carve/carve@^0.1.15']

test('a dependency that resolves over git or a path fails the guard', () => {
	for (const [field, spec] of REJECT) {
		const result = runGuard(withDep(field, spec))
		assert.equal(result.status, 1, `${field} ${spec} was accepted: ${result.out}`)
		assert.ok(result.out.includes(`${field}.@markup-carve/carve -> ${spec}`), result.out)
	}
})

test('a registry version, range, dist-tag or npm alias passes the guard', () => {
	for (const spec of ACCEPT) {
		const result = runGuard(withDep('dependencies', spec))
		assert.equal(result.status, 0, `${spec} was rejected: ${result.out}`)
	}
})

test('a git devDependency never reaches the vsix and is left alone', () => {
	const manifest = withDep('dependencies', '0.1.15')
	manifest.devDependencies = { '@markup-carve/carve-grammars': 'github:markup-carve/carve-grammars#e6ad26c' }
	assert.equal(runGuard(manifest).status, 0)
})

test('the committed manifest gets the verdict a publish run would give it', () => {
	// main and pull requests may pin a merged upstream commit; the release cut
	// re-points it to a published version, and until then publishing must refuse.
	const runtime = ['dependencies', 'optionalDependencies', 'peerDependencies']
		.flatMap((field) => Object.values(baseline[field] ?? {}))
	const gitPinned = runtime.some((spec) => /^(github|git\+[a-z.+-]+|git):|^[^/@:\s]+\/[^/\s]+#/.test(spec))
	const result = runGuard(baseline)
	assert.equal(result.status, gitPinned ? 1 : 0, result.out)
})

test('the publish workflows run the guard and pull request CI does not', () => {
	const read = (name) => readFileSync(resolve(root, '.github/workflows', name), 'utf8')
	const call = /run: node scripts\/no-git-dependencies\.mjs/g
	assert.equal(read('release.yml').match(call)?.length, 2, 'release.yml guards both the tag and the publish job')
	assert.equal(read('republish.yml').match(call)?.length, 1)
	assert.doesNotMatch(read('ci.yml'), /no-git-dependencies/)
})
