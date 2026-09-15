/**
 * The engine pin check has to accept the spelling the repository actually uses.
 *
 * `engine-drift.yml` hard-required a 40-hex revision. The packages moved to npm
 * versions, so the job failed on every scheduled run for months while reporting
 * nothing about the pins it names (#202). A check that cannot pass on a correct
 * repository measures nothing, so these assertions drive both spellings and the
 * failures each one still owns.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const checker = resolve(root, 'tools/check-engine-pin.mjs')
const DEP = '@markup-carve/carve'

/**
 * An upstream checkout with three commits on `origin/main`, the middle one
 * tagged, plus one commit on a branch that main never took.
 */
function upstream(tagName) {
	const dir = mkdtempSync(join(tmpdir(), 'vscode-carve-pin-'))
	const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim()
	git('init', '--quiet', '--initial-branch', 'main')
	git('config', 'user.email', 'test@example.invalid')
	git('config', 'user.name', 'Test')
	const commit = (message) => {
		writeFileSync(join(dir, 'file'), message)
		git('add', 'file')
		git('commit', '--quiet', '-m', message)
		return git('rev-parse', 'HEAD')
	}
	commit('first')
	const tagged = commit('second')
	if (tagName) git('tag', tagName, tagged)
	git('checkout', '--quiet', '-b', 'sidetrack')
	const unmerged = commit('never merged')
	if (tagName) git('tag', `${tagName}-unmerged`, unmerged)
	git('checkout', '--quiet', 'main')
	const head = commit('third')
	// The workflow reads `origin/main`; a local clone has no remote, so the ref
	// is created directly rather than by cloning a second copy.
	git('update-ref', 'refs/remotes/origin/main', head)
	return { dir, tagged, unmerged, head, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function manifest(spec) {
	const dir = mkdtempSync(join(tmpdir(), 'vscode-carve-manifest-'))
	const path = join(dir, 'package.json')
	writeFileSync(path, JSON.stringify({ dependencies: { [DEP]: spec } }))
	return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function run(spec, up) {
	const m = manifest(spec)
	try {
		return spawnSync(process.execPath, [checker, DEP, up.dir, '--manifest', m.path], { encoding: 'utf8' })
	} finally {
		m.cleanup()
	}
}

test('an exact npm version resolves through the matching tag and reports lag', () => {
	const up = upstream('0.1.6')
	try {
		const result = run('0.1.6', up)
		assert.equal(result.status, 0, result.stdout)
		assert.match(result.stdout, /bundled @markup-carve\/carve: 0\.1\.6 \(tag 0\.1\.6/)
		assert.match(result.stdout, /main is 1 commit\(s\) ahead/)
		assert.match(result.stdout, /::warning::.*1 .* commit\(s\) behind main/)
	} finally {
		up.cleanup()
	}
})

test('a v-prefixed tag is found too, because the two upstreams tag differently', () => {
	const up = upstream('v0.1.6')
	try {
		const result = run('0.1.6', up)
		assert.equal(result.status, 0, result.stdout)
		assert.match(result.stdout, /\(tag v0\.1\.6/)
	} finally {
		up.cleanup()
	}
})

test('a range is refused, whatever operator widens it', () => {
	const up = upstream('0.1.6')
	try {
		for (const spec of ['^0.1.6', '~0.1.6', '*', '0.1.x', 'latest', '>=0.1.5 <0.2.0']) {
			const result = run(spec, up)
			assert.equal(result.status, 1, `${spec} was accepted: ${result.stdout}`)
			assert.match(result.stdout, /::error::.*must pin an exact version or a 40-hex revision/)
		}
	} finally {
		up.cleanup()
	}
})

test('a 40-hex revision on main still passes, in either spelling', () => {
	const up = upstream('0.1.6')
	try {
		for (const spec of [up.tagged, `github:markup-carve/carve-js#${up.tagged}`]) {
			const result = run(spec, up)
			assert.equal(result.status, 0, result.stdout)
			assert.match(result.stdout, /main is 1 commit\(s\) ahead/)
		}
	} finally {
		up.cleanup()
	}
})

test('a revision that is not a commit upstream fails', () => {
	const up = upstream('0.1.6')
	try {
		const result = run('0'.repeat(40), up)
		assert.equal(result.status, 1)
		assert.match(result.stdout, /::error::.*which is not a commit in/)
	} finally {
		up.cleanup()
	}
})

test('a pin that never reached main fails, by revision and by tag', () => {
	const up = upstream('0.1.6')
	try {
		const byRevision = run(up.unmerged, up)
		assert.equal(byRevision.status, 1)
		assert.match(byRevision.stdout, /::error::.*is not on main/)
	} finally {
		up.cleanup()
	}
})

test('a tagged release off an unmerged branch fails', () => {
	const up = upstream('0.1.6')
	try {
		// `0.1.6-unmerged` is a valid exact semver prerelease, so it reaches the
		// tag path and is caught by the ancestry check rather than by its shape.
		const result = run('0.1.6-unmerged', up)
		assert.equal(result.status, 1, result.stdout)
		assert.match(result.stdout, /::error::.*is not on main/)
	} finally {
		up.cleanup()
	}
})

test('an exact version upstream never tagged warns rather than failing', () => {
	// carve-lsp published 0.1.5 to npm without a tag. Lag cannot be measured,
	// which is upstream's bookkeeping, not a broken build here.
	const up = upstream(null)
	try {
		const result = run('0.1.5', up)
		assert.equal(result.status, 0, result.stdout)
		assert.match(result.stdout, /lag not measurable/)
		assert.match(result.stdout, /::warning::.*has not tagged/)
		assert.doesNotMatch(result.stdout, /::error::/)
	} finally {
		up.cleanup()
	}
})

test('the scheduled workflow runs this checker rather than its own shape rule', () => {
	// Without this the script can be correct while CI still applies the old rule.
	const workflow = readFileSync(resolve(root, '.github/workflows/engine-drift.yml'), 'utf8')
	assert.match(workflow, /node tools\/check-engine-pin\.mjs/)
	assert.doesNotMatch(workflow, /\[0-9a-f\]\{40\}/)
})

test('the pins this repository ships today satisfy the checker', () => {
	// The check that would have caught #202: a rule no correct state can pass is
	// not a rule. Shape only - resolving them needs the upstream checkouts CI has.
	const deps = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).dependencies
	for (const dep of ['@markup-carve/carve', '@markup-carve/carve-lsp']) {
		const spec = deps[dep]
		const exact = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(spec)
		const revision = /^[0-9a-f]{40}$/.test(spec.includes('#') ? spec.slice(spec.lastIndexOf('#') + 1) : spec)
		assert.ok(exact || revision, `${dep} is "${spec}", which the drift check refuses`)
	}
})
