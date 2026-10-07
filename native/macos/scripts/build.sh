#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/module-cache
staging=$(mktemp -d "$PWD/build/app.XXXXXX")
trap 'rm -rf "$staging"' EXIT
app="$staging/Xtranslate.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
xcrun clang -fobjc-arc -O2 -arch arm64 -mmacosx-version-min=13.0 -c Sources/MacBridge.m -o build/MacBridge.o
xcrun swiftc -swift-version 5 -parse-as-library -O -whole-module-optimization \
  -target arm64-apple-macosx13.0 -module-cache-path build/module-cache \
  -import-objc-header Sources/MacBridge.h Sources/*.swift build/MacBridge.o \
  -framework AppKit -framework ApplicationServices -framework Carbon -framework ServiceManagement \
  -framework Security -o "$app/Contents/MacOS/Xtranslate"
cp Resources/providers.json Resources/prompts.json "$app/Contents/Resources/"
cp Resources/AppIcon.icns "$app/Contents/Resources/"
cp Resources/Info.plist "$app/Contents/"
cp LICENSE "$app/Contents/Resources/LICENSE"
# Remove extended file metadata from the generated app before signing it.
xattr -cr "$app"
codesign --force --sign - --identifier com.xtranslate.native "$app"
codesign --verify --deep --strict "$app"
# Replace only this script's generated application, never merge stale bundle files.
rm -rf build/Xtranslate.app
mv "$app" build/Xtranslate.app
