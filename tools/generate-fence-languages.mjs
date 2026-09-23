#!/usr/bin/env node
// Writes the per-language fenced code rules into syntaxes/carve.tmLanguage.json.
//
//   node tools/generate-fence-languages.mjs          rewrite the generated entries
//   node tools/generate-fence-languages.mjs --check  exit 1 when they are stale
//
// Each generated rule is a copy of a hand-written generic fence rule with its
// language capture narrowed to one language, so the fence, title, label and
// closer handling cannot drift from the generic rule. When a language grammar is
// not installed, vscode-textmate skips the rule and the generic one matches.
//
// The file is spliced, never re-serialized: the rest of it keeps its own layout.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const grammarPath = resolve(root, 'syntaxes/carve.tmLanguage.json')
const manifestPath = resolve(root, 'package.json')

// [VS Code language id, info-string words, grammar scopes to include]
export const LANGUAGES = [
  ['carve', ['carve', 'crv'], ['text.carve']],
  ['javascript', ['js', 'javascript', 'mjs', 'cjs'], ['source.js']],
  ['javascriptreact', ['jsx'], ['source.js.jsx']],
  ['typescript', ['ts', 'typescript', 'mts', 'cts'], ['source.ts']],
  ['typescriptreact', ['tsx'], ['source.tsx']],
  ['json', ['json', 'json5'], ['source.json']],
  ['jsonc', ['jsonc'], ['source.json.comments']],
  ['yaml', ['yaml', 'yml'], ['source.yaml']],
  ['toml', ['toml'], ['source.toml']],
  ['html', ['html', 'htm', 'xhtml'], ['text.html.basic']],
  ['xml', ['xml', 'svg', 'xsd'], ['text.xml']],
  ['css', ['css'], ['source.css']],
  ['scss', ['scss'], ['source.css.scss']],
  ['less', ['less'], ['source.css.less']],
  ['php', ['php'], ['text.html.basic', 'source.php']],
  ['python', ['python', 'py', 'py3'], ['source.python']],
  ['ruby', ['ruby', 'rb'], ['source.ruby']],
  ['rust', ['rust', 'rs'], ['source.rust']],
  ['go', ['go', 'golang'], ['source.go']],
  ['java', ['java'], ['source.java']],
  ['kotlin', ['kotlin', 'kt', 'kts'], ['source.kotlin']],
  ['swift', ['swift'], ['source.swift']],
  ['dart', ['dart'], ['source.dart']],
  ['c', ['c', 'h'], ['source.c']],
  ['cpp', ['cpp', 'c\\+\\+', 'cxx', 'cc', 'hpp'], ['source.cpp']],
  ['csharp', ['cs', 'csharp', 'c#'], ['source.cs']],
  ['shellscript', ['sh', 'bash', 'shell', 'zsh'], ['source.shell']],
  ['powershell', ['powershell', 'ps1', 'pwsh'], ['source.powershell']],
  ['bat', ['bat', 'batch', 'cmd'], ['source.batchfile']],
  ['sql', ['sql'], ['source.sql']],
  ['lua', ['lua'], ['source.lua']],
  ['perl', ['perl', 'pl'], ['source.perl']],
  ['r', ['r'], ['source.r']],
  ['markdown', ['markdown', 'md'], ['text.html.markdown']],
  ['diff', ['diff', 'patch'], ['source.diff']],
  ['dockerfile', ['dockerfile', 'docker'], ['source.dockerfile']],
  ['makefile', ['makefile', 'make'], ['source.makefile']],
  ['ini', ['ini', 'cfg'], ['source.ini']],
]

const LANGUAGE_CAPTURE = '([^`~\\s\\["]+)?'
const BARE_FENCE = '[ \\t]*[`~]{3,}[ \\t]*$'

// [generated entry, hand-written entry, index among its begin rules, while guard]
// Inside a container the embedded body must also stop at a column-0 line so the
// generic rule's zero-width container boundary gets to close an unclosed fence.
const VARIANTS = [
  ['fenced-code-languages', 'code-blocks', 0, `(^|\\G)(?!${BARE_FENCE})`],
  ['fenced-code-languages-on-a-marker-line', 'code-block-behind-a-container-prefix', 0, `(^|\\G)(?!${BARE_FENCE})(?=[ \\t]|$)`],
  ['fenced-code-languages-at-a-body-column', 'code-block-behind-a-container-prefix', 1, `(^|\\G)(?!${BARE_FENCE})(?=[ \\t]|$)`],
]

function languageRule(generic, [id, words, scopes], whileGuard) {
  if (generic.begin.split(LANGUAGE_CAPTURE).length !== 2) {
    throw new Error(`generic fence rule no longer has exactly one language capture: ${generic.begin}`)
  }
  const { comment, ...rule } = generic
  rule.begin = generic.begin.replace(LANGUAGE_CAPTURE, `((?i:${words.join('|')}))`)
  const include = scopes.map((scope) => ({ include: scope }))
  // Carve holds fences of its own, so it gets the exact closer from the outer
  // `end`. Other languages sit under a `while` that stops at any bare fence
  // line: `while` is checked through every nested region, so an unterminated
  // string or comment in the embedded language cannot swallow the closer.
  if (id === 'carve') {
    return { ...rule, contentName: `meta.embedded.block.${id}`, patterns: include }
  }
  return {
    ...rule,
    patterns: [{ begin: '\\G', while: whileGuard, contentName: `meta.embedded.block.${id}`, patterns: include }],
  }
}

export function generate(grammar) {
  const entries = {}
  for (const [key, source, index, whileGuard] of VARIANTS) {
    const generic = grammar.repository[source].patterns.filter((rule) => rule.begin)[index]
    entries[key] = { patterns: LANGUAGES.map((language) => languageRule(generic, language, whileGuard)) }
  }
  return entries
}

export function embeddedLanguages() {
  return Object.fromEntries(LANGUAGES.map(([id]) => [`meta.embedded.block.${id}`, id]))
}

// Returns [start, end) of the JSON value that follows `"key":` at `depth` 2
// (a repository entry), skipping over strings so braces inside regexes do not count.
function valueSpan(text, key) {
  const needle = `"${key}": `
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      if (depth === 2 && text.startsWith(needle, i)) {
        const start = i + needle.length
        return [start, skipValue(text, start)]
      }
      i = skipString(text, i)
    } else if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') depth--
  }
  return null
}

function skipString(text, i) {
  for (i++; text[i] !== '"'; i++) if (text[i] === '\\') i++
  return i
}

function skipValue(text, i) {
  let depth = 0
  for (; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') i = skipString(text, i)
    else if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  throw new Error('unterminated JSON value')
}

// One rule per line keeps a language's three variants reviewable as one-line diffs.
const indentValue = (value) =>
  `{\n      "patterns": [\n${value.patterns.map((rule) => `        ${JSON.stringify(rule)}`).join(',\n')}\n      ]\n    }`

function splice(text, entries) {
  for (const [key, value] of Object.entries(entries)) {
    const span = valueSpan(text, key)
    if (span) {
      text = text.slice(0, span[0]) + indentValue(value) + text.slice(span[1])
    } else {
      const anchor = valueSpan(text, 'code-block-behind-a-container-prefix')
      text = `${text.slice(0, anchor[1])},\n    "${key}": ${indentValue(value)}${text.slice(anchor[1])}`
    }
  }
  return text
}

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
}

if (isMain()) {
  const check = process.argv.includes('--check')
  const text = readFileSync(grammarPath, 'utf8')
  const grammar = JSON.parse(text)
  const next = splice(text, generate(grammar))
  JSON.parse(next)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const mapping = manifest.contributes.grammars.find((g) => g.scopeName === 'text.carve').embeddedLanguages
  const missing = Object.entries(embeddedLanguages()).filter(([scope, id]) => mapping[scope] !== id)
  if (check) {
    const stale = next !== text
    if (stale) console.error('syntaxes/carve.tmLanguage.json: generated fence rules are stale; run node tools/generate-fence-languages.mjs')
    missing.forEach(([scope, id]) => console.error(`package.json: embeddedLanguages lacks "${scope}": "${id}"`))
    process.exit(stale || missing.length ? 1 : 0)
  }
  writeFileSync(grammarPath, next)
  missing.forEach(([scope, id]) => console.error(`package.json: add "${scope}": "${id}" to embeddedLanguages`))
}
