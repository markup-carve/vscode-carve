/**
 * Every `git config ... insteadOf` line in a workflow uses `--add`.
 *
 * `git config <key> <value>` REPLACES the key's value. It does not append. So
 * two consecutive plain sets of the same key leave ONE value behind, not two -
 * the second silently discards the first. Measured with an isolated HOME:
 *
 *     git config --global url."https://github.com/".insteadOf ssh://git@github.com/
 *     git config --global url."https://github.com/".insteadOf git@github.com:
 *     git config --global --get-all url."https://github.com/".insteadOf
 *     -> git@github.com:                                     (1 value)
 *
 * With `--add` on both lines the same three commands print two values, and
 * `git ls-remote --get-url ssh://git@github.com/o/r.git` is rewritten to the
 * https form instead of being returned unchanged.
 *
 * WHY A TEST AND NOT JUST THE FIX. Nothing fails when the first line is
 * discarded. The rewrite that survives works, the one that was dropped simply
 * never applies, and the workflow reads as correct while being half
 * configured - so the only thing that catches a regression is a check that
 * counts the lines. It also travels: this repo's copy of the step was
 * duplicated into a sibling repo verbatim, defect included, which is how one
 * mis-set key becomes several.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const workflowDir = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows');

/** Every `git config`-with-`insteadOf` line across every workflow file. */
function gitConfigInsteadOfLines() {
	const found = [];
	for (const name of readdirSync(workflowDir)) {
		if (!/\.ya?ml$/.test(name)) continue;
		const lines = readFileSync(join(workflowDir, name), 'utf8').split('\n');
		lines.forEach((line, i) => {
			if (!/\bgit config\b/.test(line)) return;
			if (!/\binsteadOf\b/.test(line)) return;
			// `--get-all` reads the key back; it sets nothing, so it is not a writer.
			if (/--get-all|--get\b|--unset/.test(line)) return;
			found.push({ file: name, line: i + 1, text: line.trim() });
		});
	}
	return found;
}

test('the workflows actually write an insteadOf rewrite', () => {
	// Guards the guard: if the step is ever renamed or removed, an empty sweep
	// must not pass as "no violations found".
	const lines = gitConfigInsteadOfLines();
	assert.ok(
		lines.length >= 2,
		'expected at least two `git config ... insteadOf` writers across ' +
			workflowDir + ', found ' + lines.length,
	);
});

test('every insteadOf writer uses --add, so none discards the one before it', () => {
	const offenders = gitConfigInsteadOfLines().filter((l) => !/--add\b/.test(l.text));
	assert.deepEqual(
		offenders.map((l) => l.file + ':' + l.line + ': ' + l.text),
		[],
		'a plain `git config` REPLACES the key, dropping every value written before it - use `--add`',
	);
});
