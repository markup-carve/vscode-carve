#!/usr/bin/env bash
# The vendored fence-language table is a copy. Prove it still is.
#
# tools/fence-languages.json is carve-grammars' table, vendored so this grammar
# embeds the same languages, under the same fence words, as every other Carve
# grammar that embeds by a list. A stale copy here would keep generating rules
# for a list the other editors had moved on from.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(dirname "$here")"
local_file="$root/tools/fence-languages.json"
upstream="${CARVE_GRAMMARS_DIR:-}"

if [[ -z "$upstream" ]]; then
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  git clone --quiet --depth 1 https://github.com/markup-carve/carve-grammars "$work/cg"
  upstream="$work/cg"
fi

remote_file="$upstream/fence-languages/fence-languages.json"
if [[ ! -f "$remote_file" ]]; then
  echo "No fence-languages/fence-languages.json in $upstream" >&2
  exit 1
fi

if ! diff -q "$local_file" "$remote_file" >/dev/null; then
  echo "The vendored fence-language table has drifted from carve-grammars:"
  # `diff` exits 1 when there IS a difference, which under `pipefail` would
  # abort the script here and swallow the remediation line below.
  diff "$local_file" "$remote_file" | head -40 || true
  echo
  echo "Re-copy tools/fence-languages.json, then run node tools/generate-fence-languages.mjs."
  exit 1
fi
for format in csv tsv; do
  local_grammar="$root/syntaxes/$format.tmLanguage.json"
  remote_grammar="$upstream/textmate/$format.tmLanguage.json"
  if [[ ! -f "$remote_grammar" ]]; then
    echo "No textmate/$format.tmLanguage.json in $upstream" >&2
    exit 1
  fi
  if ! diff -q "$local_grammar" "$remote_grammar" >/dev/null; then
    echo "The vendored $format TextMate grammar has drifted from carve-grammars:"
    diff "$local_grammar" "$remote_grammar" | head -40 || true
    echo
    echo "Re-copy textmate/$format.tmLanguage.json to syntaxes/$format.tmLanguage.json."
    exit 1
  fi
done
printf 'check-fence-languages-drift: %s row(s) match carve-grammars.\n' \
  "$(python3 -c "import json,sys; print(len(json.load(open(sys.argv[1]))['languages']))" "$local_file")"
