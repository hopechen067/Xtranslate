#!/bin/bash
set -euo pipefail

case "${1:-}" in
  ""|--live) ;;
  -h|--help)
    echo "Usage: scripts/test-translation.sh [--live]"
    echo "Default: 45 pure and local HTTP/SSE fixture checks; no external requests."
    echo "--live: add 2 free Microsoft translation checks (47 total); no API key needed."
    exit 0
    ;;
  *) echo "Unknown option: $1" >&2; exit 2 ;;
esac
if [ "$#" -gt 1 ]; then
  echo "Usage: scripts/test-translation.sh [--live]" >&2
  exit 2
fi

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
test_build="$project_dir/build/translation-tests"
mkdir -p "$test_build/module-cache"

xcrun swiftc \
  -swift-version 5 \
  -target "$(uname -m)-apple-macosx13.0" \
  -O \
  -module-cache-path "$test_build/module-cache" \
  "$project_dir/Sources/Models.swift" \
  "$project_dir/Sources/TranslationService.swift" \
  "$project_dir/Tests/TranslationTests.swift" \
  -o "$test_build/translation-tests"

# The fixture binds only to loopback on an ephemeral port, starts the tests,
# and shuts down its server before returning the test executable's exit code.
exec python3 "$project_dir/Tests/translation_fixture.py" \
  "$test_build/translation-tests" "$@"
