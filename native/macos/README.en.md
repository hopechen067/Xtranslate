# Xtranslate · Community native macOS port

[中文](README.md) · [Upstream project](https://github.com/hopechen067/Xtranslate) · [Community download](https://github.com/xyxxxx06221/Xtranslate/releases/tag/macos-native-v1.1.1)

This is an **unofficial community macOS port** of [hopechen067/Xtranslate](https://github.com/hopechen067/Xtranslate). It is not an official upstream macOS release, and this contribution must not be taken as already accepted by upstream. It carries forward and adapts the original interaction design, translation prompts, and provider presets. The UI, networking, shortcuts, and paste integration are reimplemented in Swift, AppKit, and macOS system frameworks, without bundling Electron, a browser engine, or local model weights.

Requires an **Apple Silicon Mac running macOS 13 or later**. The current build scripts produce an arm64 application; they do not include an Intel build.

## Install and use

1. Download the DMG from the **community download** above and drag `Xtranslate.app` into Applications. Quit the previous version before replacing it.
2. Open the app and allow the current Xtranslate build under System Settings → Privacy & Security → Accessibility.
3. Click the destination text field, then press **Option+Q** to open the translator. Enter text and press Return to translate and paste.

Drag the popup's edges to resize it; its size is remembered. A transparency mask clips its rounded background. Use `Shift+Return` for a new line, `Tab` to change translation direction, `Command+E` to switch engines, and `Esc` to close. The shortcut is configurable in Settings.

Free translation requires no API key. For an LLM provider, enter its address and API key, then choose or type a model name. Model discovery runs when opening LLM settings, switching providers, or finishing an address/key edit. You can also click the refresh button. Loading a list preserves the model name you already entered; manual entry remains available when the endpoint cannot list models. The provider's catalog may include models that are unsuitable for text translation.

## Automatic paste and permissions

Before showing the popup, the app captures the destination application and any accessible window/input element. Before pasting, it reactivates and checks that target, waits for shortcut keys to be released, and posts paste events to the destination application. Some apps do not expose complete accessibility information. Secure keyboard input, missing permissions, or focus changes can prevent automatic paste.

Failures show a reason and retain the translation for manual `Command+V` where possible. When clipboard restoration is enabled, the original clipboard is restored after a delay. If another app changes the clipboard in the meantime, the newer contents are left intact.

The community package has an **ad-hoc signature and is not notarized by Apple**. If macOS blocks it, verify its source before allowing it in Privacy & Security. Replacing the build changes its signature and may require removing the old Accessibility entry, adding the new copy from Applications, and quitting/reopening the app. Settings displays the running application's path and permission state to help identify an old copy still in use.

## Data and services

- Saved API keys are held in the local system Keychain, scoped to the provider and base URL. Model discovery and translation send authentication to the configured service.
- **Source text is sent to the translation provider you select.** LLM translation is not inherently offline; processing stays on the computer only when you configure a local service.
- Model discovery supports compatible `/models` endpoints, Claude pagination, and local Ollama. OpenRouter's public catalog needs no key. Providers without a listing endpoint can be configured manually.
- Free translation relies on unofficial web endpoints that may break after service changes, rate limits, or regional connectivity changes. Model availability, charges, data handling, and terms are determined by each provider.

## Build from source

Use an Apple Silicon Mac with Xcode Command Line Tools. Python 3 is required for the local test fixtures. Install the command-line tools first:

```sh
xcode-select --install
```

From a repository checkout containing this contribution:

```sh
cd native/macos
./scripts/build.sh
./scripts/package.sh
```

The application is written to `build/Xtranslate.app`; the installer is written to `build/Xtranslate-Native-1.1.1-arm64.dmg`. Packaging rebuilds the app and checks its ad-hoc signature and disk image. npm and third-party runtime dependencies are not required. These scripts let you rebuild from source; byte-for-byte identical output across machines is not guaranteed.

## Validation

The default tests use fixtures and loopback HTTP servers. They do not read real API keys or contact external translation APIs:

```sh
./scripts/test-translation.sh     # 45 translation parser/request checks
./scripts/test-model-catalog.sh   # 52 model catalog checks
```

Coverage includes parsing, cancellation, errors, model pagination, authentication headers, and cross-origin redirect protection. Passing these checks does not mean every provider has been tested with a real account.

Optional macOS UI and system integration checks:

```sh
./scripts/test-ui.sh
./scripts/test-system.sh
./scripts/test-system-live.sh
```

These checks require a graphical desktop session. System tests temporarily change the clipboard and restore it on normal completion; avoid copying important content while they run. `test-system-live.sh` drives dedicated test windows and sends key events, so the relevant test process needs Accessibility/event-posting permission. “Live” here means real system interaction, not a paid model call.

Separately, `test-translation.sh --live` contacts a free translation endpoint, and `test-model-catalog.sh --live` reads OpenRouter's public catalog. These optional network checks need no real API key and do not invoke paid model inference.

## Contribution and license

This community port was written and checked with AI assistance, with local automated tests run before submission. AI assistance and test results do not replace maintainer review or imply endorsement by the upstream author. Compatibility reports and future integration should follow the upstream project's contribution process.

The port follows the upstream [MIT License](../../LICENSE) and preserves the original notice:

```text
Copyright (c) 2026 hopechen067
```

Keep the MIT license and copyright notice when redistributing source or application packages.
