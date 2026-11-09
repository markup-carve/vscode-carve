#!/usr/bin/env node
// Refuse a runtime dependency that does not resolve from the npm registry.
//
//   node scripts/no-git-dependencies.mjs [package.json]
//
// Runs at PUBLISH time only (release.yml, republish.yml). main and pull requests
// may pin a merged upstream commit (`github:owner/repo#sha`) while an engine
// release is pending; a marketplace build must not ship one. A git
// `devDependency` never reaches the vsix and is left alone.
//
// Lifted unchanged in logic from markup-carve/carve-grammars
// scripts/no-git-dependencies.mjs, which documents every rule below in full:
// detection is by what a registry spec is NOT, so a new git spelling is caught
// without being listed.

import { readFileSync } from 'node:fs';

const manifestPath = process.argv[2] ?? 'package.json';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const NON_REGISTRY_PROTOCOL =
    /^(github|gitlab|bitbucket|gist|git|git\+[a-z.+-]+|ssh|https?|file|link|portal|workspace):/i;

const FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'];

// user@host:path, npm's SCP-style git URL. It carries no protocol, and when the
// repository sits at the root of its host it carries no slash either
// (`git@example.com:repo.git`), so neither test below sees it. `npm-package-arg`
// classifies that value as `git`. Named separately from the catch-all only so
// the report says what it actually is.
const SCP_STYLE = /^[^\s@/:]+@[^\s@/:]+:/;

// A registry range is semver plus at most a dist-tag. None of these characters
// appears in one, so anything carrying them is something else.
const NEVER_IN_A_RANGE = ['/', ':', '@'];

// CASE-INSENSITIVE, like the protocol pattern above. npm reads `NPM:foo` as
// the same alias as `npm:foo`, and a case-sensitive prefix test sent it down
// to the catch-all, where the `:` got it rejected - an over-rejection that
// predates the alias work and shows up only once there is something on the
// other side of the prefix worth reaching.
const ALIAS_PREFIX = /^npm:/i;

// THE PUNCTUATION npm ITSELF REFUSES, and the reason it is two rules and not
// one. npm rejects a package name or a dist-tag that carries "any characters
// that encodeURIComponent encodes" - its own words, quoted out of the error -
// so a name or a tag is limited to the URI-unreserved set. A semver RANGE is
// not: `^1.0.0`, `>=1 <2` and `1.0.0 || 2.0.0` all carry characters
// encodeURIComponent encodes, and they are the most common specs in any
// manifest. Applying the tag rule to a range would therefore reject `^1.0.0`,
// which is the over-rejection this whole guard is written to avoid.
//
// So the range set is the URI-unreserved set plus semver's own operators. A
// spec outside it is neither a range nor a tag, and npm-package-arg refuses
// every one of them (`#bad`, `%bad`, `a,b`, `{x}`, `a&b`) while accepting the
// odd-looking tags that ARE valid (`my!tag`, `a(b)`, `tag~1`). Found by
// `codex review` on #302, one layer under the alias hole it was reviewing.
const NOT_IN_A_NAME_OR_TAG = /[^\w.!~*'()-]/;
// WHITESPACE IS \s AND NOT A SPACE, and that costs one deliberate leniency.
// `>=1 <2` may be written with a tab or a newline inside the JSON string and
// npm still reads it as a range, so a class permitting only U+0020 rejects a
// manifest that installs - the over-rejection this file keeps warning about.
// Telling that apart from a dist-tag carrying a space needs a semver parser,
// which is the dependency this guard exists without. So whitespace is allowed
// and `foo bar` is accepted where npm would refuse it: the ONE spelling this
// script is knowingly more permissive on. It is a garbage tag, which fails
// loudly at install; it is not a git spec, which clones silently. Erring the
// other way would trade a loud failure for a guard someone switches off.
const NOT_IN_A_RANGE_OR_TAG = /[^\w.!~*'()^<>=|+\s-]/;

// An alias is `npm:<name>` or `npm:<name>@<target>`. This is the NAME half, and
// it is COUNTED rather than pattern-matched, because every pattern for it grew
// a fallback branch that let something through: a package name is `pkg` or
// `@scope/pkg`, so a scoped name has exactly two `/`-separated pieces and an
// unscoped one exactly one. `npm:@foo` is a scope with no package and npm
// refuses it; a regex with an optional scope group matched it on the branch
// meant for unscoped names.
//
// Counting also does the rest of the work for free. Three of the spellings this
// guard used to accept (`npm:git+https://x/y`, `npm:github:owner/repo`,
// `npm:git+https:x`) carry no separating `@` at all, so there is no target to
// inspect - the whole remainder is the name, and a name with two slashes or a
// colon in it is not one.

/** Whether one `/`-separated piece of an alias's name is a package name. */
function isNameSegment(segment) {
    return segment !== '' && !NOT_IN_A_NAME_OR_TAG.test(segment);
}

/**
 * Whether `name` is `pkg` or `@scope/pkg`, and nothing else.
 *
 * The leading `.`/`_` rule is npm's, and it is on the WHOLE name rather than on
 * each piece - which matters, because a scoped name begins with the `@` and so
 * the rule never reaches its scope: `@_scope/pkg` and `@scope/_pkg` both
 * resolve, while `_pkg` does not. Applying it per segment rejected all three,
 * and rejecting a manifest that installs is the failure this file keeps warning
 * about. The one place it does reach into a scoped name is a package half
 * starting with a dot (`@scope/.pkg`), which npm refuses.
 */
function isPackageName(name) {
    const scoped = name.startsWith('@');
    const segments = (scoped ? name.slice(1) : name).split('/');
    if (segments.length !== (scoped ? 2 : 1)) return false;
    if (!segments.every(isNameSegment)) return false;
    return scoped ? !segments[1].startsWith('.') : !/^[._]/.test(name);
}

/**
 * Why npm could not resolve `npm:<rest>` from the registry, or null.
 *
 * The split is at the `@` separating name from target, which is NOT the first
 * one when the name is scoped (`npm:@scope/pkg@^1.0.0` aliases `@scope/pkg`).
 * An alias with no target (`npm:foo`) is a registry alias and stays accepted -
 * that row is the near miss this whole check has to keep passing, because a
 * guard that over-rejects a legitimate manifest is one the next person
 * switches off, which is worse than the hole.
 */
function aliasReason(rest) {
    const at = rest.indexOf('@', rest.startsWith('@') ? 1 : 0);
    const name = at === -1 ? rest : rest.slice(0, at);
    // TRIMMED, because every test below it is on the trimmed value:
    // `offendingReason` trims before it looks, so an untrimmed target let
    // `npm:foo@ npm:bar` past the nested-alias test and then read as a
    // perfectly good alias one frame down.
    const target = at === -1 ? null : rest.slice(at + 1).trim();
    if (name === '') return 'is an npm: alias with no package name';
    if (!isPackageName(name)) {
        return `aliases ${JSON.stringify(name)}, which is not a package name`;
    }
    // An empty target is npm's `*`, so `npm:foo@` is the same alias as `npm:foo`.
    if (target === null || target === '') return null;
    if (ALIAS_PREFIX.test(target)) return 'nests an alias inside an alias, which npm does not support';
    const reason = offendingReason(target);
    return reason ? `aliases a target that ${reason}` : null;
}

/** Why a consumer's npm could not satisfy this spec from the registry, or null. */
function offendingReason(spec) {
    if (typeof spec !== 'string') return 'is not a string';
    const value = spec.trim();
    // `npm:` is the one alias form that still resolves from the registry, and
    // the only legitimate reason a spec carries a protocol, a slash or an `@` -
    // but only when what it aliases resolves from the registry too, which is
    // what this used to return early WITHOUT asking (#302).
    if (ALIAS_PREFIX.test(value)) return aliasReason(value.slice('npm:'.length));
    const protocol = value.match(NON_REGISTRY_PROTOCOL);
    if (protocol) return `resolves over ${protocol[1].toLowerCase()}, not the registry`;
    if (SCP_STYLE.test(value)) return 'is an scp-style git URL (user@host:path), not a registry range';
    // A LEADING DOT IS A PATH, whatever follows it. npm reads `.`, `..`,
    // `./x` and even `.x` as a local directory - it never reaches the
    // registry - and neither a semver range nor a dist-tag npm will accept
    // can begin with one, so this rejects without any risk of rejecting a
    // manifest that installs. `./x` would have been caught by the slash
    // below; `.` and `.x` carry nothing any other test looks for.
    if (value.startsWith('.')) return 'is a local path, not a registry range';
    if (value.includes('/')) return 'is a git shorthand (owner/repo), not a registry range';
    // The catch-all, and the reason this is an inversion rather than a longer
    // list: whatever spelling comes next, it is not a semver range, and it does
    // not have to be anticipated to be caught.
    const stray = NEVER_IN_A_RANGE.find((c) => value.includes(c));
    if (stray) return `contains ${JSON.stringify(stray)}, which no registry range does`;
    // LAST, so the tests above keep naming what they actually found. A spec
    // that is past all of them is a range or a dist-tag or nothing, and npm
    // refuses the punctuation that is in neither.
    const punctuation = value.match(NOT_IN_A_RANGE_OR_TAG);
    if (punctuation) {
        return `contains ${JSON.stringify(punctuation[0])}, which appears in no semver range and `
            + 'no dist-tag npm will accept';
    }
    return null;
}

const offenders = [];
for (const field of FIELDS) {
    for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
        const reason = offendingReason(spec);
        if (reason) offenders.push({ field, name, spec, reason });
    }
}

if (offenders.length > 0) {
    console.error(
        `::error::${offenders.length} dependency spec(s) would not resolve from the registry `
        + 'for a consumer of this package:',
    );
    for (const { field, name, spec, reason } of offenders) {
        console.error(`  ${field}.${name} -> ${spec}`);
        console.error(`    ${reason}`);
    }
    console.error(
        'A consumer would need git at install time and gets no registry integrity check. '
        + 'Declare a published version instead.',
    );
    process.exit(1);
}

const counted = FIELDS.reduce((n, field) => n + Object.keys(manifest[field] ?? {}).length, 0);
console.log(`all ${counted} runtime, optional and peer dependencies resolve from the registry`);
