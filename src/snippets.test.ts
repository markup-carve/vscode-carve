import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { renderPreviewBody } from './preview.js'

/**
 * Every block snippet has to BUILD the construct it is named for.
 *
 * Nothing read these bodies, and two of them were wrong in ways no reader of
 * the JSON would notice: `div` wrote `:::name` with no separator, and the raw
 * block wrote an info word instead of the `=` opener. Both render as ordinary
 * prose, so a user who reached for the snippet got a paragraph and no error.
 */

const snippets = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'snippets', 'carve.json'),
    'utf8',
  ),
) as Record<string, { prefix: string; body: string | string[] }>

/** A snippet body with its placeholders replaced by their default text. */
const expand = (body: string | string[]): string =>
  (Array.isArray(body) ? body.join('\n') : body)
    .replace(/\$\{\d+\|([^|]*)\|[^}]*\}/g, (_, choices: string) => choices.split(',')[0]!)
    .replace(/\$\{\d+:([^}]*)\}/g, '$1')
    .replace(/\$\{\d+\}/g, 'x')
    .replace(/\$\d+/g, 'x')

/**
 * What each block snippet must produce. Frontmatter and display math are left
 * out on purpose: the first renders nothing of its own, and the second is
 * wrapped in a paragraph, so neither says anything about its own opener.
 */
const MUST_BUILD: Record<string, RegExp> = {
  Div: /<(div|aside)\b/,
  'Line block': /class="line-block"/,
  'Fenced block quote': /<blockquote\b/,
  'Local hard-break block': /class="hardbreaks"/,
  Blockquote: /<blockquote\b/,
  'Code block': /<pre\b/,
  Table: /<table\b/,
  'Definition list': /<dl\b/,
  'Unordered list': /<ul\b/,
  'Ordered list': /<ol\b/,
  'Task list': /<(ul|li)\b/,
  'Heading 1': /<h1\b/,
  'Heading 2': /<h2\b/,
  'Heading 3': /<h3\b/,
}

for (const [name, expected] of Object.entries(MUST_BUILD)) {
  test(`the ${name} snippet builds its construct`, () => {
    const snippet = snippets[name]
    assert.ok(snippet, `no snippet named ${name}`)
    const html = renderPreviewBody(expand(snippet.body) + '\n')
    assert.match(html, expected, `${name} rendered as:\n${html}`)
  })
}

test('the div snippet keeps the separator its opener requires', () => {
  // `:::name` is a paragraph: the colon fence takes a separator before its
  // type word, and without one there is no container at all.
  assert.match(renderPreviewBody(':::note\nx\n:::\n'), /<p>/)
  assert.doesNotMatch(renderPreviewBody(':::note\nx\n:::\n'), /<aside\b/)
})

test('the raw block snippet uses the = opener, not an info word', () => {
  // A fence opened with an info word is a CODE fence whose language token is
  // that literal text. The raw block is spelled with a leading `=` (PART 9
  // SS20), and only that form passes its payload through.
  const body = snippets['Raw block']!.body as string[]
  assert.match(body[0]!, /^```=/)
  assert.match(renderPreviewBody('```=html\n<b>x</b>\n```\n'), /<b>x<\/b>/)
  assert.doesNotMatch(renderPreviewBody('```raw html\n<b>x</b>\n```\n'), /<b>x<\/b>/)
})

test('the definition separator is one space', () => {
  // A wider separator parses and means the same thing, but it sets the body's
  // content column, and one space is canonical - which is what a snippet
  // should teach.
  const body = snippets['Definition list']!.body as string[]
  assert.equal(body[1], ': ${2:Definition}')
})
