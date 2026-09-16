/**
 * A workflow step that reaches node_modules runs `npm ci` in the same job.
 *
 * `grammar-drift.yml` shipped with all three arms running tools that require
 * `vscode-textmate`, and no install step. Every run died at import, and a
 * scheduled workflow nobody reads reported nothing for as long as it took
 * someone to open the run (#218). Not every tool needs an install -
 * `check-engine-pin.mjs` is node builtins only - so the check follows each
 * referenced script's own import graph rather than demanding an install
 * everywhere.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const workflowDir = join(root, '.github', 'workflows')

const IMPORT = /(?:^|\s)(?:import\s[^'"]*from\s*|import\s*|require\s*\()\s*['"]([^'"]+)['"]/gm
const SCRIPT = /\btools\/[A-Za-z0-9._-]+\.(?:mjs|js|sh)\b/g

/** Does running `file` need an installed package? Follows relative imports. */
function needsNodeModules(file, seen = new Set()) {
	const path = resolve(root, file)
	if (seen.has(path) || !existsSync(path)) return false
	seen.add(path)
	const source = readFileSync(path, 'utf8')
	if (path.endsWith('.sh')) {
		return (source.match(SCRIPT) ?? []).some((ref) => needsNodeModules(ref, seen))
	}
	for (const [, specifier] of source.matchAll(IMPORT)) {
		if (specifier.startsWith('node:')) continue
		if (!specifier.startsWith('.') && !specifier.startsWith('/')) return true
		if (needsNodeModules(join(dirname(file), specifier), seen)) return true
	}
	return false
}

/** Each job of each workflow, as `{ id, text }`, split on the 2-space job keys. */
function jobs() {
	const found = []
	for (const name of readdirSync(workflowDir)) {
		if (!/\.ya?ml$/.test(name)) continue
		const lines = readFileSync(join(workflowDir, name), 'utf8').split('\n')
		let current = null
		let inJobs = false
		for (const line of lines) {
			if (/^jobs:/.test(line)) {
				inJobs = true
				continue
			}
			if (!inJobs) continue
			if (/^\S/.test(line)) break
			const start = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/)
			if (start) {
				current = { id: name + ':' + start[1], text: '' }
				found.push(current)
				continue
			}
			if (current) current.text += line + '\n'
		}
	}
	return found
}

/** The jobs that run a script needing an installed package. */
const dependent = jobs().filter((job) =>
	(job.text.match(SCRIPT) ?? []).some((ref) => needsNodeModules(ref)),
)

test('the sweep finds jobs that reach node_modules at all', () => {
	assert.ok(dependent.length > 0, 'no job runs a tool with a bare-specifier import; the check below is vacuous')
})

test('every job that reaches node_modules installs first', () => {
	const offenders = dependent.filter((job) => !/npm (ci|install)\b/.test(job.text)).map((job) => job.id)
	assert.deepEqual(offenders, [], 'these jobs run a tool that imports an installed package without installing it')
})
