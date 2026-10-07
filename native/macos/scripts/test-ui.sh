#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/ui-tests/module-cache build/popup-tests
xcrun clang -fobjc-arc -O2 -c Sources/MacBridge.m -o build/ui-tests/MacBridge.o
xcrun swiftc -swift-version 5 -parse-as-library -module-cache-path build/ui-tests/module-cache \
  Sources/PopupController.swift Tests/PopupTests.swift -framework AppKit -o build/ui-tests/popup-tests
xcrun swiftc -swift-version 5 -parse-as-library -O -module-cache-path build/ui-tests/module-cache \
  -import-objc-header Sources/MacBridge.h Sources/Models.swift Sources/TranslationService.swift \
  Sources/SystemIntegration.swift Sources/SettingsController.swift Tests/ModelCatalogUITests.swift \
  build/ui-tests/MacBridge.o -framework AppKit -framework ApplicationServices -framework Carbon \
  -framework Security -o build/ui-tests/model-ui-tests
./build/ui-tests/popup-tests
./build/ui-tests/model-ui-tests build/ui-tests/model-settings.png
