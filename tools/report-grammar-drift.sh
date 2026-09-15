#!/usr/bin/env bash
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
checker="${GRAMMAR_DRIFT_CHECKER:-$root/tools/check-grammar-drift.mjs}"
log="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/grammar-drift.log"

if "$checker" missing 2>&1 | tee "$log"; then
  exit 0
fi
status="${PIPESTATUS[0]}"
summary="$(grep '^ACTIONABLE:' "$log" | tail -1 || true)"
if [[ "$status" -eq 1 && -n "$summary" ]]; then
  echo "::warning::$summary"
  exit 0
fi
echo "::error::Grammar drift could not be checked; inspect the job log."
exit "$status"
