#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/build.sh
version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' Resources/Info.plist)
package="Xtranslate-Native-${version}-arm64.dmg"
staging=$(mktemp -d "$PWD/build/dmg.XXXXXX")
trap 'rm -rf "$staging"' EXIT
/usr/bin/ditto build/Xtranslate.app "$staging/Xtranslate.app"
ln -s /Applications "$staging/Applications"
hdiutil create -volname "Xtranslate Native ${version}" -srcfolder "$staging" -ov -format UDZO "build/$package"
hdiutil verify "build/$package"
(cd build && shasum -a 256 "$package" > SHA256SUMS.txt)
