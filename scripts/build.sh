#!/usr/bin/env bash
#
# Build the Carve VS Code extension into a .vsix package.
#
# Usage:
#   scripts/build.sh            # package using the current version in package.json
#   scripts/build.sh 1.2.3      # set package.json version to 1.2.3, then package
#
set -euo pipefail

# Resolve repo root regardless of where the script is called from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

REQUESTED_VERSION="${1:-}"

read_version() {
  node -p "require('./package.json').version"
}

if [[ -n "${REQUESTED_VERSION}" ]]; then
  if ! [[ "${REQUESTED_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+].+)?$ ]]; then
    echo "Error: '${REQUESTED_VERSION}' is not a valid semver version (expected MAJOR.MINOR.PATCH)." >&2
    exit 1
  fi
  echo "Setting version to ${REQUESTED_VERSION}..."
  # --no-git-tag-version: only update package.json/lock, no commit or tag.
  npm version "${REQUESTED_VERSION}" --no-git-tag-version --allow-same-version >/dev/null
fi

VERSION="$(read_version)"
echo "Building Carve extension v${VERSION}..."

# Compile TypeScript to ./dist (vsce package also runs this via the
# vscode:prepublish script if present, but build explicitly for clarity).
npm run build

OUTPUT="vscode-carve-${VERSION}.vsix"
echo "Packaging ${OUTPUT}..."
npx vsce package --out "${OUTPUT}"

echo "Done: ${ROOT_DIR}/${OUTPUT}"
