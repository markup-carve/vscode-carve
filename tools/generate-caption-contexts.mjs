#!/usr/bin/env node
// Generate caption slots from the existing image and fence recognizers.
// Run with --check to verify the committed grammar without rewriting it.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const path = fileURLToPath(new URL('../syntaxes/carve.tmLanguage.json', import.meta.url))
const source = readFileSync(path, 'utf8')
const grammar = JSON.parse(source)
const repository = grammar.repository
const include = (...names) => names.map(name => ({ include: '#' + name }))
const captures = { '0': { patterns: include('caption-quote-prefix', 'caption') } }
const marker = String.raw`(\^)( +)(?![ \t]*$)([^ ].*)$`
const blank = String.raw`^(?:> ?)*[ \t]*\n`

// Separate host parsing from the optional gap so a new block after the gap
// returns to its enclosing container instead of continuing the previous host.
function frame(begin, children, prefix = '', quoted = false) {
  const caption = '^' + prefix + marker
  const validBlank = quoted ? '^' + prefix.replace(/ $/, '') + String.raw` ?[ \t]*\n` : String.raw`^[ \t]*\n`
  const finished = String.raw`(?<=^(?:> ?)*[ \t]*\n)$`
  const phase = {
    begin: children.some(rule => ['#code-blocks', '#caption-colon-host-in-container'].includes(rule.include))
      ? String.raw`\G(?=[ \t]*\S)` : String.raw`\G[ \t]*(?=\S)`,
    end: String.raw`(?=^(?:> ?)*[ \t]*(?:\^ +|$))|(?=^(?!\G))|` + finished,
    applyEndPatternLast: true,
    patterns: children,
  }
  const gap = {
    begin: quoted ? String.raw`^((?:> )*>)[ ]?[ \t]*\n` : String.raw`^[ \t]*\n`,
    end: '^' + (quoted ? String.raw`\1 ` : prefix) + marker + '|' + blank + '|(?=^)',
    endCaptures: captures,
  }
  if (quoted) gap.beginCaptures = { '1': { patterns: include('caption-quote-prefix') } }
  return {
    begin,
    end: caption + '|(?=^(?!\\G)(?!' + validBlank.slice(1) + '))|(?<=^' + prefix + String.raw`\^ +[^\n]*)$|` + finished,
    endCaptures: captures,
    patterns: [phase, gap],
  }
}
if (repository.images.patterns.some(rule => typeof rule.match !== 'string')) {
  throw new Error('Image recognizers must remain match rules')
}
const attributeMatch = repository.attributes.patterns[1]?.match
const payloadStart = attributeMatch?.indexOf(String.raw`\{\s*(?:`) ?? -1
if (payloadStart < 0) throw new Error('Strict attribute payload changed')
const attribute = attributeMatch.slice(payloadStart)
const blockAttributes = String.raw`(?:` + attribute + String.raw`)(?:[ \t]*` + attribute + String.raw`)*[ \t]*$`
const interrupt = '(?:%%|' + blockAttributes + '|' + String.raw`(?:(?:-{3,}|\*{3,}|_{3,})[ \t]*$|#{1,6} +(?![ \t]*$)|%{3,}(?: |$)|` + '`{3,}' + String.raw`|~{3,}|:{3,}(?: |$)|>(?: |$)|\|[^\n]*\|[ \t]*$|\+[ \t]*$|\*\[[^\]\n]+\]: |\[[^\]\n]+\]: ))`
const containerInterrupt = '(?:' + interrupt + String.raw`|(?:[-*]|[0-9]+[.)]|[A-Za-z][.)]|[ivxlcdmIVXLCDM]+[.)]|\.) +|:: +|: +)`
const image = '(?:' + repository.images.patterns.map(rule => rule.match).join('|') + ')' + String.raw`(?:[ \t]*` + attribute + String.raw`)*[ \t]*$`
const fence = repository['code-blocks'].patterns.find(rule => rule.begin)?.begin.slice(1)
if (!fence || !fence.includes(String.raw`\2`)) throw new Error('Generic fence capture layout changed')
const partialImage = String.raw`!\[[^\]\n]*$`
const math = repository.math.patterns[0].match + String.raw`(?:[ \t]*` + attribute + String.raw`)*[ \t]*$`
const hosts = [
  ['multiline-image', partialImage, include('caption-multiline-image', 'caption-prose-continuation')],
  ['image', image, include('caption-image-on-host-line', 'caption-prose-continuation')],
  ['table', String.raw`\|[^\n]*\|[ \t]*$`, include('table-row-behind-a-container-prefix', 'tables')],
  ['fence', fence, include('code-blocks', 'code-block-behind-a-container-prefix', 'code-fence-on-quote-marker-line')],
  ['math', math, include('caption-math-on-host-line', 'caption-prose-continuation')],
  ['colon', String.raw`:{3,} +(?:figure|>)[ \t]*$`, include('caption-colon-host')],
]
function containerChildren(children) {
  return children.map(rule => rule.include === '#caption-prose-continuation' ? { include: '#caption-prose-continuation-in-container' } : rule.include === '#caption-colon-host' ? { include: '#caption-colon-host-in-container' } : rule)
}
const patterns = [
  {
    begin: String.raw`^(?=(?:[-*]|[0-9]+[.)]) +(?:(?:\[[ xX]\]) +)?(:{3,}) +(?:figure|>)[ \t]*$)`,
    end: '(?=^)',
    applyEndPatternLast: true,
    patterns: include('lists'),
  },
  frame('^(?=> |>$)', include('block-quotes'), String.raw`[ \t]*`),
]
for (const [kind, host, children] of hosts) {
  const quotedHost = (kind === 'fence' || kind === 'math') ? host.replaceAll(String.raw`\2`, String.raw`\3`) : host
  const quotedChildren = kind === 'fence'
    ? include('code-fence-on-quote-marker-line', 'code-blocks', 'code-block-behind-a-container-prefix')
    : kind === 'colon' ? include('caption-colon-host-quoted')
      : kind === 'multiline-image' ? include('caption-multiline-image-quoted', 'caption-prose-continuation-quoted')
        : ['image', 'math'].includes(kind) ? children.map(rule => rule.include === '#caption-prose-continuation' ? { include: '#caption-prose-continuation-quoted' } : rule) : children
  patterns.push(frame(String.raw`(?<=^((?:> )*>) )\G(?=` + quotedHost + ')', quotedChildren, String.raw`\1 `, true))
}
for (const [, host, children] of hosts) {
  patterns.push(frame('^(?=' + host + ')', children, String.raw`[ \t]*`))
  patterns.push(frame(String.raw`\G(?<=[ \t])(?=` + host + ')', containerChildren(children), String.raw`[ \t]{2,}`))
}
const generated = {
  patterns,
  comment: 'Generated by tools/generate-caption-contexts.mjs. Caption slots permit at most one blank line (PART 9 §4; caption_slot).',
}
// Replace only the generated entry, preserving the rest of the file's layout.
const start = source.indexOf('    "captionable-blocks": ')
const end = source.indexOf('\n    "caption-colon-host": ', start)
if (start < 0 || end < 0) throw new Error('Caption entry boundaries changed')
const entry = '    "captionable-blocks": ' + JSON.stringify(generated, null, 2).replaceAll('\n', '\n    ') + ','
let updated = source.slice(0, start) + entry + source.slice(end)
// Inline rules and colon captures share their existing lexical recognizers.
function replaceEntry(text, key, value) {
  const marker = '    "' + key + '": '
  const start = text.indexOf(marker) + marker.length
  if (start < marker.length) throw new Error('Missing generated entry: ' + key)
  let depth = 0, quoted = false, escaped = false, end = start
  for (; end < text.length; end++) {
    const char = text[end]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === '{' || char === '[') depth++
    else if (char === '}' || char === ']') {
      if (--depth === 0) { end++; break }
    }
  }
  return text.slice(0, start) + JSON.stringify(value, null, 2).replaceAll('\n', '\n    ') + text.slice(end)
}
for (const [key, host, rules] of [
  ['caption-image-on-host-line', image, ['images', 'attributes']],
  ['caption-math-on-host-line', math, ['math', 'attributes']],
]) {
  updated = replaceEntry(updated, key, {
    match: String.raw`\G` + host,
    captures: { '0': { patterns: include(...rules) } },
  })
}
// A prose host remains eligible only if its next non-blank line is a caption.
// Continuation text invalidates it, and consumes its final blank before the
// pending host can reuse that blank as a caption gap.
const captionStart = String.raw`\^ +(?![ \t]*$)[^ ].*$`
updated = replaceEntry(updated, 'caption-prose-continuation', {
  begin: String.raw`^(?![ \t]*(?:` + captionStart + String.raw`|$)|[ \t]*` + interrupt + String.raw`)(?=[ \t]*\S)[ \t]*`,
  end: String.raw`^[ \t]*\n|^(?=[ \t]*` + interrupt + ')',
  patterns: include('caption-paragraph-inline'),
})
updated = replaceEntry(updated, 'caption-prose-continuation-in-container', {
  begin: String.raw`^([ \t]+)(?!` + captionStart + '|$|' + containerInterrupt + String.raw`)(?=\S)`,
  end: String.raw`^[ \t]*\n|^(?=\S)|^(?=[ \t]+` + containerInterrupt + ')',
  patterns: include('caption-paragraph-inline'),
})
updated = replaceEntry(updated, 'caption-prose-continuation-quoted', {
  begin: String.raw`^((?:> )+)(?!` + captionStart + String.raw`|[ \t]*$|` + interrupt + String.raw`)(?=[ \t]*\S)`,
  end: blank + String.raw`|^(?!\1)|^\1(?=` + interrupt + ')',
  beginCaptures: { '1': { patterns: include('caption-quote-prefix') } },
  patterns: [
    { match: '^(?:> )+', captures: { '0': { patterns: include('caption-quote-prefix') } } },
    ...include('caption-quote-paragraph-inline'),
  ],
})
const closingImage = '(?:' + repository.images.patterns.map(rule => {
  const marker = rule.match.includes(String.raw`(\]\()`) ? String.raw`(\]\()` : String.raw`(\])`
  const start = rule.match.indexOf(marker)
  if (start < 0) throw new Error('Image closing syntax changed')
  return rule.match.slice(start)
}).join('|') + ')' + String.raw`(?:[ \t]*` + attribute + String.raw`)*[ \t]*$`
const imageClose = String.raw`[^\]\n]*` + closingImage
const otherBlock = '(?=' + interrupt + ')'
updated = replaceEntry(updated, 'caption-multiline-image', {
  begin: String.raw`\G` + partialImage,
  end: '^' + imageClose + '|' + blank + '|^' + otherBlock,
})
updated = replaceEntry(updated, 'caption-multiline-image-quoted', {
  begin: String.raw`(?<=^((?:> )+))\G` + partialImage,
  end: String.raw`^\1` + imageClose + '|' + blank + String.raw`|^(?!\1)|^\1` + otherBlock,
  endCaptures: { '0': { patterns: include('caption-quote-prefix') } },
  patterns: [{ match: '^(?:> )+', captures: { '0': { patterns: include('caption-quote-prefix') } } }],
})
const containerHosts = [
  frame(String.raw`\G(?<=[ \t])(?=> |>$)`, include('block-quote-on-marker-line', 'block-quotes'), String.raw`[ \t]+`),
  frame(String.raw`^(?=([ \t]+)(?:> |>$))`, include('block-quote-on-marker-line', 'block-quotes'), String.raw`\1`),
  ...hosts.map(([kind, host, children]) => frame(
    String.raw`^(?=([ \t]+)(?:` + ((kind === 'fence' || kind === 'math') ? host.replaceAll(String.raw`\2`, String.raw`\3`) : host) + '))',
    containerChildren(children), String.raw`\1`,
  )),
]
updated = replaceEntry(updated, 'captionable-blocks-in-container', {
  patterns: [
    ...include('captionable-blocks'),
    ...containerHosts,
  ],
})
// Div validation comes from the lexical rules, with captures removed so the
// structural regions retain only their own fence and quote-path captures.
function withoutCaptures(regex) {
  if (/\\[1-9]/.test(regex)) throw new Error('Div recognizer gained a backreference')
  let result = '', escaped = false, characterClass = false
  for (let index = 0; index < regex.length; index++) {
    const char = regex[index]
    if (escaped) { result += char; escaped = false; continue }
    if (char === '\\') { result += char; escaped = true; continue }
    if (char === '[') characterClass = true
    if (char === ']') characterClass = false
    result += char === '(' && !characterClass && regex[index + 1] !== '?' ? '(?:' : char
  }
  return result
}
const div = '(?:' + repository.divs.patterns.map(rule => withoutCaptures(rule.match.slice(1))).join('|') + ')'
const colonCaptures = { '0': { patterns: include('caption-colon-tokenizer') } }
const quotePrefix = { match: '^(?:> )+', captures: { '0': { patterns: include('caption-quote-prefix') } } }
const colonBody = repository['container-body'].patterns.map(rule =>
  rule.include === '#captionable-blocks-in-container' ? { include: '#captionable-blocks' }
    : rule.include === '#caption-paragraph-in-container' ? { include: '#caption-paragraph' } : rule)
updated = replaceEntry(updated, 'caption-colon-body', { patterns: colonBody })
for (const [suffix, anchor, endPrefix, quoted, body] of [
  ['', '^', '', false, 'caption-colon-body'],
  ['-in-container', String.raw`(?:\G(?<=[ \t])|^[ \t]+)`, String.raw`[ \t]+`, false, 'container-body'],
  ['-quoted', String.raw`(?<=^((?:> )*>) )\G`, String.raw`\1 `, true, 'caption-colon-body'],
]) {
  const fence = quoted ? String.raw`\2` : String.raw`\1`
  const end = '^' + endPrefix + '(' + fence + String.raw`)[ \t]*$` + (quoted ? String.raw`|^(?!\1(?: |$))` : '')
  for (const [kind, guard] of [['host', String.raw`:{3,} +(?:figure|>)[ \t]*$`], ['nested-div', div]]) {
    const key = kind === 'host' ? 'caption-colon-host' + suffix : 'caption-nested-div' + suffix
    updated = replaceEntry(updated, key, {
      begin: anchor + '(?=' + guard + ')' + String.raw`(:{3,})[^\n]*$`,
      end,
      beginCaptures: colonCaptures,
      endCaptures: quoted ? { '0': { patterns: include('caption-quote-prefix', 'caption-colon-tokenizer') } } : colonCaptures,
      patterns: [...(quoted ? [{ ...quotePrefix, match: '^(?:> ?)+' }] : []), ...include('caption-nested-div' + suffix, body)],
    })
  }
}
const captionStartForLazyQuote = String.raw`\^ +(?![ \t]*$)[^ ].*$`
updated = replaceEntry(updated, 'caption-quote-lazy-line', {
  begin: String.raw`^(?![ \t]*(?:` + captionStartForLazyQuote + String.raw`|$)|[ \t]*` + interrupt + String.raw`)(?=[ \t]*\S)[ \t]*`,
  end: String.raw`^(?=[ \t]*(?:` + captionStartForLazyQuote + '|$|' + interrupt + '))',
  patterns: include('caption-paragraph-inline'),
})
function listVariants(value) {
  if (Array.isArray(value)) return value.map(listVariants)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
    [key, key === 'include' && ['#caption-prose-continuation', '#caption-prose-continuation-in-container'].includes(entry)
      ? '#caption-prose-continuation-in-list' : listVariants(entry)]))
  return value
}
updated = replaceEntry(updated, 'captionable-blocks-in-list', { patterns: listVariants([...patterns, ...containerHosts]) })
updated = replaceEntry(updated, 'caption-list-body', {
  patterns: repository['container-body'].patterns.map(rule =>
    rule.include === '#captionable-blocks-in-container' ? { include: '#captionable-blocks-in-list' }
      : rule.include === '#caption-paragraph-in-container' ? { include: '#caption-paragraph-in-list' } : rule),
})
updated = replaceEntry(updated, 'caption-prose-continuation-in-list', {
  begin: String.raw`^(?![ \t]*(?:` + captionStartForLazyQuote + String.raw`|$)|[ \t]*` + containerInterrupt + String.raw`)(?=[ \t]*\S)[ \t]*`,
  end: String.raw`^[ \t]*\n|^(?=[ \t]*` + containerInterrupt + ')',
  patterns: include('caption-paragraph-inline'),
})
const attributeGuard = String.raw`(?![ \t]*` + attribute + String.raw`(?:[ \t]*` + attribute + String.raw`)*[ \t]*$)`
const content = attributeGuard + String.raw`(?=[ \t]*\S)`

updated = replaceEntry(updated, 'caption-paragraph-in-quote', {
  patterns: [{
    begin: String.raw`(?<=((?:> )+))\G` + content,
    end: String.raw`^(?=[ \t]*\1[ \t]*(?:[ \t]*$|` + interrupt + String.raw`))|^(?![ \t]*\1)(?=[ \t]*(?:[ \t]*$|` + interrupt + '|' + captionStart + '))',
    patterns: [
      { match: String.raw`^[ \t]*(?:> )+`, captures: { '0': { patterns: include('caption-quote-prefix') } } },
      ...include('caption-quote-paragraph-inline'),
    ],
  }],
})
updated = replaceEntry(updated, 'caption-paragraph', {
  patterns: [
    {
      begin: String.raw`(?<=^((?:> )+))\G` + content,
      end: String.raw`^(?!\1)|^(?=\1[ \t]*(?:[ \t]*$|` + interrupt + '))',
      patterns: [
        { match: '^(?:> )+', captures: { '0': { patterns: include('caption-quote-prefix') } } },
        ...include('caption-quote-paragraph-inline'),
      ],
    },
    {
      begin: '^' + content + String.raw`[ \t]*`,
      end: String.raw`^(?=[ \t]*(?:[ \t]*$|` + interrupt + '))',
      patterns: include('caption-paragraph-inline'),
    },
    {
      begin: String.raw`\G(?<=[ \t])` + content,
      end: String.raw`^(?=[ \t]*$|\S)|^(?=[ \t]+(?:[ \t]*$|` + interrupt + '))',
      patterns: include('caption-paragraph-inline'),
    },
  ],
})
updated = replaceEntry(updated, 'caption-paragraph-in-container', {
  comment: 'Nested item markers start a new block inside an item; document-level list markers fold into an open paragraph.',
  patterns: [
    {
      begin: String.raw`^([ \t]+)` + content,
      end: String.raw`^(?=[ \t]*$|\S)|^(?=[ \t]+` + containerInterrupt + ')',
      patterns: include('caption-paragraph-inline'),
    },
    {
      begin: String.raw`\G(?<=[ \t])` + content,
      end: String.raw`^(?=[ \t]*$|\S)|^(?=[ \t]+` + containerInterrupt + ')',
      patterns: include('caption-paragraph-inline'),
    },
  ],
})
updated = replaceEntry(updated, 'caption-paragraph-in-list', {
  patterns: [
    {
      begin: String.raw`^([ \t]+)` + content,
      end: String.raw`^(?=[ \t]*$)|^(?=[ \t]*` + containerInterrupt + ')',
      patterns: include('caption-paragraph-inline'),
    },
    {
      begin: String.raw`\G(?<=[ \t])` + content,
      end: String.raw`^(?=[ \t]*$)|^(?=[ \t]*` + containerInterrupt + ')',
      patterns: include('caption-paragraph-inline'),
    },
  ],
})
const paragraphIndex = grammar.patterns.findIndex(rule => rule.include === '#caption-paragraph')
if (paragraphIndex < 0) throw new Error('Missing paragraph entry')
updated = replaceEntry(updated, 'caption-paragraph-inline', { patterns: [...include('comments', 'thematic-break'), ...grammar.patterns.slice(paragraphIndex + 1)] })
updated = replaceEntry(updated, 'caption-colon-tokenizer', {
  patterns: repository.divs.patterns.map(({ comment, ...rule }) => {
    if (typeof rule.match !== 'string' || !rule.match.startsWith('^')) throw new Error('Colon recognizers must remain anchored match rules')
    return { ...rule, match: rule.match.slice(1) }
  }),
})
if (process.argv.includes('--check')) {
  if (updated !== source) {
    console.error('Caption contexts are stale. Run node tools/generate-caption-contexts.mjs')
    process.exitCode = 1
  }
} else writeFileSync(path, updated)
