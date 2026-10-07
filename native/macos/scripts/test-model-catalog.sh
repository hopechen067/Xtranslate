#!/bin/bash
set -euo pipefail
case "${1:-}" in
  ""|--live) ;;
  -h|--help)
    echo "Usage: scripts/test-model-catalog.sh [--live]"
    echo "Default: pure and loopback model-list tests; no external requests or real credentials."
    echo "--live: also read the public OpenRouter catalog without a key; no model inference."
    exit 0 ;;
  *) echo "Unknown option: $1" >&2; exit 2 ;;
esac
if [ "$#" -gt 1 ]; then exit 2; fi
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
test_build="$project_dir/build/model-catalog-tests"
mkdir -p "$test_build/module-cache"
xcrun swiftc \
  -swift-version 5 \
  -target "$(uname -m)-apple-macosx13.0" \
  -O \
  -module-cache-path "$test_build/module-cache" \
  "$project_dir/Sources/Models.swift" \
  "$project_dir/Sources/ModelCatalogService.swift" \
  "$project_dir/Tests/ModelCatalogTests.swift" \
  -o "$test_build/model-catalog-tests"
exec python3 "$project_dir/Tests/model_catalog_fixture.py" "$test_build/model-catalog-tests" "$@"
