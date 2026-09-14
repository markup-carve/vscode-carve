import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const grammar = JSON.parse(readFileSync(new URL('../syntaxes/carve.tmLanguage.json', import.meta.url)));
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));

test('known frontmatter formats delegate before their standalone fallback', () => {
  const rules = grammar.repository.frontmatter.patterns;
  for (const name of ['json', 'toml', 'yaml']) {
    const matching = rules.filter(rule => rule.name === `meta.frontmatter.${name}.carve`);
    assert.ok(matching.length >= 2, `${name} needs delegated and fallback rules`);
    assert.equal(matching[0].patterns[0].include, `source.${name}`);
    assert.ok(matching.slice(1).some(rule => rule.patterns.length > 2));
  }
});

test('VS Code maps every delegated payload scope to its language', () => {
  const mapping = manifest.contributes.grammars[0].embeddedLanguages;
  for (const name of ['json', 'toml', 'yaml']) {
    assert.equal(mapping[`meta.embedded.block.${name}`], name);
  }
});
