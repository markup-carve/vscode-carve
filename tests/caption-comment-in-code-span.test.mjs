// A `%%` between backticks on a caption line is code content, and a real
// trailing `%%` on a caption is still a comment. carve-js at pin 9f81a0a7 and
// carve-php 685e94fa3 agree byte for byte on both (markup-carve/carve#2682).
// Caption pairing follows PART 9 §4 and the caption_slot production.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vsctm from 'vscode-textmate'
import oniguruma from 'vscode-oniguruma'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
await oniguruma.loadWASM(readFileSync(resolve(root, 'node_modules/vscode-oniguruma/release/onig.wasm')).buffer)

const registry = new vsctm.Registry({
  onigLib: Promise.resolve({
    createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
    createOnigString: (source) => new oniguruma.OnigString(source),
  }),
  loadGrammar: async () => vsctm.parseRawGrammar(
    readFileSync(resolve(root, 'syntaxes/carve.tmLanguage.json'), 'utf8'),
    'carve.tmLanguage.json',
  ),
})
const grammar = await registry.loadGrammar('text.carve')

function covered(source, scope) {
  const lines = source.split('\n')
  let state = vsctm.INITIAL
  return lines.map((line) => {
    const result = grammar.tokenizeLine(line, state)
    state = result.ruleStack
    return result.tokens
      .filter((token) => token.scopes.some((s) => s.startsWith(scope)))
      .map((token) => line.slice(token.startIndex, token.endIndex))
      .join('')
  }).join('\n')
}

const flush = '![a](i.png)\n^ cap `x %% b` c'
const prefixed = '> ![a](i.png)\n> ^ cap `x %% b` c'

test('a percent run inside a code span on a caption line is code content', () => {
  assert.equal(covered(flush, 'markup.raw.inline.content'), '\nx %% b')
  assert.equal(covered(flush, 'comment.line.percent'), '\n')
  assert.equal(covered(prefixed, 'markup.raw.inline.content'), '\nx %% b')
  assert.equal(covered(prefixed, 'comment.line.percent'), '\n')
  assert.equal(covered('![a](i.png)\n^ cap `x` b %% hidden', 'markup.raw.inline.content'), '\nx')
})

test('a real trailing comment on a caption is still a comment', () => {
  assert.equal(covered('![a](i.png)\n^ cap %% hidden', 'comment.line.percent'), '\n%% hidden')
  assert.equal(covered('> ![a](i.png)\n> ^ cap %% hidden', 'comment.line.percent'), '\n%% hidden')
  assert.equal(covered('![a](i.png)\n^ cap `x` b %% hidden', 'comment.line.percent'), '\n%% hidden')
})

test('a percent run inside a code span off a caption line is code content', () => {
  assert.equal(covered('p a `x %% b` c', 'markup.raw.inline.content'), 'x %% b')
  assert.equal(covered('p a `x %% b` c', 'comment.line.percent'), '')
})

test('a bare caption marker stays paragraph text and preserves inline scopes', () => {
  const bare = '^ cap `x %% b` c'
  for (const scope of ['markup.table.caption', 'string.unquoted.caption']) {
    assert.equal(covered(bare, scope), '', scope)
    assert.equal(covered('> ' + bare, scope), '', scope)
  }
  assert.equal(covered(bare, 'markup.raw.inline.content'), 'x %% b')
  assert.equal(covered(bare, 'comment.line.percent'), '')
  assert.equal(covered('^ cap `x` c %% hidden', 'comment.line.percent'), '%% hidden')
})

const hosts = [
  '![a](i.png)',
  '[r]: /img\n\n![a][r]',
  '| a |\n|---|\n| b |',
  '```js\nx\n```',
  '$$`x`',
  '> quote',
  '::: figure\n![a](i.png)\n:::',
  '::: >\nquote\n:::',
]
for (const host of hosts) {
  for (const gap of ['', '\n']) {
    test(`a caption attaches to ${JSON.stringify(host)} with gap ${JSON.stringify(gap)}`, () => {
      const source = host + '\n' + gap + '^ cap `x %% b` c'
      assert.ok(covered(source, 'markup.table.caption').endsWith('^ cap `x %% b` c'))
      assert.ok(covered(source, 'markup.raw.inline.content').endsWith('x %% b'))
    })
  }
  test(`two blank lines end the caption slot after ${JSON.stringify(host)}`, () => {
    assert.ok(!covered(host + '\n\n\n^ cap', 'markup.table.caption').includes('^ cap'))
  })
}
for (const source of [
  'prose\n^ cap',
  'text ![a](i.png)\n^ cap',
  '![a](i.png) more\n^ cap',
  '![a](i.png)\ntext\n^ cap',
  '::: note\ntext\n:::\n^ cap',
  '![a](i.png)\n^ first\n^ second',
  '![a](i.png)\n\n^ first\n^ second',
]) {
  test(`unpaired marker stays prose in ${JSON.stringify(source)}`, () => {
    assert.ok(!covered(source, 'markup.table.caption').includes('^ cap'))
    assert.ok(!covered(source, 'markup.table.caption').includes('^ second'))
    if (source.includes('^ first')) assert.ok(covered(source, 'markup.table.caption').includes('^ first'))
  })
}
for (const prefix of ['> ', '> > ']) {
  for (const gap of ['', prefix + '\n']) {
    test(`quoted image keeps the caption in ${JSON.stringify(prefix)} with gap ${JSON.stringify(gap)}`, () => {
      const source = prefix + '![a](i.png)\n' + gap + prefix + '^ cap'
      assert.ok(covered(source, 'markup.table.caption').includes('^ cap'))
    })
  }
}
for (const source of [
  '> ![a](i.png)\n^ cap',
  '> ![a](i.png)\n> ^ inner\n^ cap',
  '> quote\n> more\n^ cap',
]) {
  test(`the enclosing quote can take its own caption in ${JSON.stringify(source)}`, () => {
    assert.ok(covered(source, 'markup.table.caption').includes('^ cap'))
  })
}
for (const source of [
  'prose\n![a](i.png)\n^ cap',
  '> prose\n> ![a](i.png)\n> ^ cap',
  '![a](i.png) %% note\n^ cap',
]) {
  test(`an image inside prose is not a caption host in ${JSON.stringify(source)}`, () => {
    assert.ok(!covered(source, 'markup.table.caption').includes('^ cap'))
  })
}
for (const prefix of ['> ', '- ']) {
  const continuation = prefix === '- ' ? '  ' : prefix
  for (const kind of ['figure', '>']) {
    test(`a ${kind} fence closes inside ${JSON.stringify(prefix)}`, () => {
      const source = prefix + '::: ' + kind + '\n' + continuation + 'body\n' + continuation + ':::\n' + continuation + '^ cap\n\nafter'
      assert.ok(covered(source, 'markup.table.caption').includes('^ cap'))
      assert.ok(!covered(source, 'markup.table.caption').includes('after'))
    })
  }
}


// A colon run in prose does not create a nested fence.
test('a prose colon run leaves the figure closer reachable', () => {
  const source = '::: figure\nsee ::: x\n:::\n^ cap'
  assert.ok(covered(source, 'markup.table.caption').includes('^ cap'))
})

test('quote markers retain punctuation scopes through the caption gap', () => {
  const source = '> ![a](i.png)\n>\n> ^ cap'
  assert.equal(covered(source, 'punctuation.definition.quote'), '>\n>\n>')
  assert.ok(covered(source, 'markup.table.caption').endsWith('^ cap'))
})

for (const opening of ['[x](u) text', '`code` text', '_em_ text', '\\* text']) {
  for (const prefix of ['', '> ']) {
    test(`inline-starting prose keeps its image inside the paragraph: ${JSON.stringify(prefix + opening)}`, () => {
      const source = prefix + opening + '\n' + prefix + '![a](i.png)\n' + prefix + '^ cap'
      assert.ok(!covered(source, 'markup.table.caption').includes('^ cap'))
    })
  }
}
test('a document-level caption may be indented', () => {
  assert.ok(covered('![a](i.png)\n  ^ cap', 'markup.table.caption').includes('^ cap'))
})

for (const prefix of ['', '> ']) {
  test(`indented prose keeps the following image in its paragraph: ${JSON.stringify(prefix)}`, () => {
    const source = prefix + '  prose\n' + prefix + '![a](i.png)\n' + prefix + '^ cap'
    assert.ok(!covered(source, 'markup.table.caption').includes('^ cap'))
  })
}

test('a leading block attribute preserves image caption pairing', () => {
  assert.ok(covered('{#fig}\n![a](i.png)\n^ cap', 'markup.table.caption').includes('^ cap'))
})
test('invalid attributes stay inside prose before an image', () => {
  assert.ok(!covered('{2=v}\n![a](i.png)\n^ cap', 'markup.table.caption').includes('^ cap'))
})

for (const marker of ['-', 'a.', 'iv.', '.']) {
  test(`a list marker folded into prose cannot introduce a caption host: ${marker}`, () => {
    assert.ok(!covered('prose\n' + marker + ' ![a](i.png)\n  ^ cap', 'markup.table.caption').includes('^ cap'))
  })
}
test('indented prose keeps its inline footnote scope', () => {
  assert.ok(covered('- - a\n [^f]: x', 'constant.other.reference.footnote').includes('[^f]'))
})

for (const gap of ['', '\n', '  \n']) {
  test(`a list image permits one blank caption gap: ${JSON.stringify(gap)}`, () => {
    assert.ok(covered('- ![a](i.png)\n' + gap + '  ^ cap', 'markup.table.caption').includes('^ cap'))
  })
}
for (const host of ['![a](i.png)', '| a |', '```js\n  code\n  ```']) {
  test(`a later list block can take a caption: ${JSON.stringify(host)}`, () => {
    assert.ok(covered('- intro\n\n  ' + host + '\n  ^ cap', 'markup.table.caption').includes('^ cap'))
  })
}
test('an image in a footnote body can take a caption', () => {
  assert.ok(covered('[^n]: intro\n\n    ![a](i.png)\n    ^ cap', 'markup.table.caption').includes('^ cap'))
})
test('an indented image at document level stays prose', () => {
  assert.ok(!covered('  ![a](i.png)\n  ^ cap', 'markup.table.caption').includes('^ cap'))
})
test('a list paragraph keeps a following image inside prose', () => {
  assert.ok(!covered('- prose\n  ![a](i.png)\n  ^ cap', 'markup.table.caption').includes('^ cap'))
})

for (const prefix of ['', '> ']) {
  test(`a multiline image can take a caption: ${JSON.stringify(prefix)}`, () => {
    const source = prefix + '![a\n' + prefix + 'b](/i)\n' + prefix + '^ cap'
    assert.ok(covered(source, 'markup.table.caption').includes('^ cap'))
  })
}
test('a multiline image can take a caption inside a list', () => {
  assert.ok(covered('- ![a\n  b](/i)\n  ^ cap', 'markup.table.caption').includes('^ cap'))
})
test('an unclosed image does not make its caret line a caption', () => {
  assert.ok(!covered('![a\n^ cap', 'markup.table.caption').includes('^ cap'))
})
test('an empty line ends an unclosed image without claiming a caption', () => {
  assert.ok(!covered('![a\n\n^ cap', 'markup.table.caption').includes('^ cap'))
})

test('invalid trailing image attributes keep the caret in prose', () => {
  assert.ok(!covered('![a](i.png){2=v}\n^ cap', 'markup.table.caption').includes('^ cap'))
})
test('multiple valid image attributes preserve caption pairing', () => {
  assert.ok(covered('![a](i.png){.one}{#fig}\n^ cap', 'markup.table.caption').includes('^ cap'))
})

for (const source of [
  '![a](i.png)\n![b](j.png)\n^ cap',
  '![a](i.png)\n![b](j.png) more\n^ cap',
  '![a](i.png)\n![b](j.png)\n\n^ cap',
  '$$`x` and more\n^ cap',
  '$$`x`\n$$`y`\n^ cap',
]) {
  for (const prefix of ['', '> ']) {
    test(`a prose host continuation does not take a caption: ${JSON.stringify(prefix + source)}`, () => {
      const quoted = source.split('\n').map(line => prefix + line).join('\n')
      assert.ok(!covered(quoted, 'markup.table.caption').includes('^ cap'))
    })
  }
}

for (const separator of ['{#fig}', '%% c', '%%c']) {
  test(`a paragraph interrupter leaves a fresh image caption slot: ${separator}`, () => {
    assert.ok(covered('prose\n' + separator + '\n![a](i.png)\n^ cap', 'markup.table.caption').includes('^ cap'))
  })
}
for (const opening of ['Intro text', '[x](u) intro']) {
  test(`a figure body tracks paragraph continuation: ${opening}`, () => {
    const source = '::: figure\n' + opening + '\n![a](i.png)\n^ Panel\n:::'
    assert.ok(!covered(source, 'markup.table.caption').includes('^ Panel'))
  })
}
// `:::\tnote` replaced `::: note\t"T"` here when carve 1acc54c moved the corpus 255
// goldens: a readable name followed by unreadable metadata now OPENS a container, so that
// line is no longer body text and its closer belongs to the container it opened. The
// separator before the NAME is still a space run (corpus 254 is unchanged), which is what
// keeps the tab-glued form text and the invariant testable.
for (const body of [' :::', '> :::', ':::\tnote\ntext']) {
  test(`body text cannot consume a figure closer: ${JSON.stringify(body)}`, () => {
    assert.ok(covered('::: figure\n' + body + '\n:::\n^ group', 'markup.table.caption').includes('^ group'))
  })
}
test('a glued label opens a nested div with its own closer', () => {
  assert.ok(covered('::: figure\n:::[l]\nx\n:::\n:::\n^ group', 'markup.table.caption').includes('^ group'))
})
for (const lazy of ['continued', '- item']) {
  test(`a lazy quote line preserves its caption slot: ${lazy}`, () => {
    assert.ok(covered('> quoted\n' + lazy + '\n^ cap', 'markup.table.caption').includes('^ cap'))
  })
}
for (const first of ['item', '![a](i.png)']) {
  test(`a lazy image in a list stays paragraph content: ${first}`, () => {
    assert.ok(!covered('- ' + first + '\n![b](j.png)\n^ cap', 'markup.table.caption').includes('^ cap'))
  })
}
test('a document image after a footnote starts its own caption slot', () => {
  assert.ok(covered('[^n]: intro\n![a](i.png)\n^ cap', 'markup.table.caption').includes('^ cap'))
})
test('the first image in a footnote body can take a caption', () => {
  assert.ok(covered('[^n]: ![a](i.png)\n  ^ cap', 'markup.table.caption').includes('^ cap'))
})
test('an indented image in a root figure body stays paragraph content', () => {
  const source = '::: figure\n  ![a](i.png)\n  ^ inner\n:::\n^ group'
  assert.ok(!covered(source, 'markup.table.caption').includes('^ inner'))
  assert.ok(covered(source, 'markup.table.caption').includes('^ group'))
})
test('a bare quote marker inside a quoted figure is an empty body line', () => {
  assert.ok(covered('> ::: figure\n>\n> body\n> :::\n> ^ cap', 'markup.table.caption').includes('^ cap'))
})
test('a quote on a list marker line can take a caption', () => {
  assert.ok(covered('- > quoted\n  ^ cap', 'markup.table.caption').includes('^ cap'))
})

for (const source of [
  '> quoted\n>\ntext\n^ cap',
  '> ```\n> x\n> ```\ntext\n^ cap',
  '> > ![a](i.png)\n>\n> > ^ cap',
  '![a\n%% c\nb](/i)\n^ cap',
  '![a\n{#id}\nb](/i)\n^ cap',
  '![a\n---\nb](/i)\n^ cap',
  '- ![a](i.png)\n ^ cap',
  '[^n]: ![a](i.png)\n ^ cap',
  '- intro\n\n  ![a](i.png)\n   ^ cap',
]) {
  test('a closed or invalidated host cannot take a caption: ' + JSON.stringify(source), () => {
    assert.ok(!covered(source, 'markup.table.caption').includes('^ cap'))
  })
}
for (const source of [
  '![a](i.png)\n\n![b](j.png)\n^ cap',
  '> ![a](i.png)\n>\n> ![b](j.png)\n> ^ cap',
  '- ![a](i.png)\n\n  ![b](j.png)\n  ^ cap',
  '![a\n- x](/i)\n^ cap',
]) {
  test('a fresh eligible host can take a caption: ' + JSON.stringify(source), () => {
    assert.ok(covered(source, 'markup.table.caption').includes('^ cap'))
  })
}

for (const source of [
  '- intro\n\n  ![a](i.png)\n\n^ cap',
  '- ![a\n  %% c\n  b](/i)\n  ^ cap',
  '- ![a\n  - x](/i)\n  ^ cap',
]) {
  test('an image slot respects its container after a gap or interruption: ' + JSON.stringify(source), () => {
    assert.ok(!covered(source, 'markup.table.caption').includes('^ cap'))
  })
}
test('an indented document line can continue an image paragraph', () => {
  assert.ok(covered('![a\n  ---\nb](/i)\n^ cap', 'markup.table.caption').includes('^ cap'))
})
test('unfinished images preserve inline code and emphasis', () => {
  const source = '![Figure shows *x*\nand `code` here\n\nnext'
  assert.ok(covered(source, 'markup.bold').includes('x'))
  assert.ok(covered(source, 'markup.raw.inline.content').includes('code'))
})
test('a quote immediately after an image gap keeps its marker scope', () => {
  assert.equal(covered('![a](i.png)\n\n>\n> text', 'punctuation.definition.quote'), '\n\n>\n>')
})
