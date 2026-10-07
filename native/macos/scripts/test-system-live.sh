#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_BUILD="$(mktemp -d "${TMPDIR:-/tmp}/xtranslate-live.XXXXXX")"
trap 'rm -rf "$TEST_BUILD"' EXIT
SDK="$(xcrun --sdk macosx --show-sdk-path)"
xcrun clang -fobjc-arc -O2 -target arm64-apple-macos13.0 -isysroot "$SDK" \
  -fmodules-cache-path="$TEST_BUILD/cache" -c "$ROOT/Sources/MacBridge.m" -o "$TEST_BUILD/MacBridge.o"
xcrun clang -fobjc-arc -O2 -target arm64-apple-macos13.0 -isysroot "$SDK" \
  -fmodules-cache-path="$TEST_BUILD/cache" "$ROOT/Tests/system-target.m" -framework AppKit -o "$TEST_BUILD/system-target"
xcrun swiftc -swift-version 5 -O -target arm64-apple-macos13.0 -sdk "$SDK" \
  -module-cache-path "$TEST_BUILD/cache" -import-objc-header "$ROOT/Sources/MacBridge.h" \
  "$ROOT/Sources/SystemIntegration.swift" "$ROOT/Tests/system-live.swift" "$TEST_BUILD/MacBridge.o" \
  -framework AppKit -framework ApplicationServices -framework Carbon -o "$TEST_BUILD/system-live"
"$TEST_BUILD/system-live" "$TEST_BUILD/system-target" "$TEST_BUILD/result.txt"
