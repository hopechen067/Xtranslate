<p align="right"><a href="README.md">简体中文</a> | <b>English</b></p>

# Xtranslate

**A Chinese ⇄ English translation "input method" for Windows.** Press a hotkey in any app, type in a small popup, and press Enter — the translation is pasted right back at your cursor.

Translations aim to sound **conversational** — like something a person would actually say, not stiff textbook translation.

> Platform: Windows 10/11 · Stack: Electron + plain HTML/JS · License: MIT

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/popup-dark.png"><img src="docs/images/popup-light.png" alt="The translation popup" width="560"></picture></p>

## Features

- Lives in the system tray, no main window; summoned by a hotkey (default `Alt+Q`)
- Live preview after you pause typing; LLM output is streamed
- Enter pastes the translation back into the original window and restores your clipboard
- Auto-detects direction (zh→en / en→zh), or switch manually
- Two kinds of engines:
  - **Free (no key):** Microsoft (reachable from mainland China, default), Google (needs a proxy in China), Tencent
  - **LLM (bring your own key):** Zhipu GLM, SiliconFlow, Gemini, Groq, Cerebras, OpenRouter, Qwen, DeepSeek, Kimi, Claude, OpenAI, or any OpenAI-compatible endpoint
- API keys are encrypted with the OS `safeStorage` and never sent to the UI process

## Quick start

### Option 1: run from source

Requires [Node.js](https://nodejs.org/) 18+.

```bash
git clone https://github.com/hopechen067/Xtranslate.git
cd Xtranslate
npm install
npm start
```

### Option 2: build an installer

```bash
npm install
npm run dist
```

Output goes to `dist/`: an NSIS installer and a portable build.

After launch the app only appears in the **system tray** (bottom-right; it may be inside the `^` overflow).

## Usage guide

### 1. Translate a sentence

1. In any app (chat, browser, editor…), put the cursor where you want to type.
2. Press `Alt+Q`. A small input box appears near the top-center of your screen.
3. Type. After a short pause (~0.5 s) the translation shows up.
4. Press `Enter`. The translation is pasted at the cursor and the box disappears.

### 2. Shortcuts

| Key | Action |
|---|---|
| `Alt+Q` | Open the popup (changeable in settings) |
| `Enter` | Paste the translation and close (waits if it isn't ready yet) |
| `Shift+Enter` | New line in the input |
| `Tab` | Cycle direction: auto → zh→en → en→zh |
| `Ctrl+E` | Switch engine: free ↔ LLM |
| `Esc` | Close without pasting |

### 3. Open settings

Right-click the tray icon → **Settings**. You can change the hotkey, engine, preview delay, and launch-at-login.

### 4. Free engines (zero setup)

The default is the free **Microsoft** engine — works out of the box and is reachable from mainland China. If it fails, switch to Google (proxy needed), Tencent, or an LLM in settings.

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/settings-free-dark.png"><img src="docs/images/settings-free-light.png" alt="Settings: free engine" width="420"></picture></p>

> Free engines use unofficial browser-translation endpoints and may stop working at any time. Errors are shown with a short hint.

### 5. Set up an LLM (more natural wording)

1. Settings → choose the **LLM** engine and pick a provider (ones marked "free" cost nothing).
2. Open the provider's site (a link is shown in settings), sign up and create an API key.
3. Paste the key into settings and choose a model.
4. Click **Save & test**; a sample sentence is translated.

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/settings-llm-dark.png"><img src="docs/images/settings-llm-light.png" alt="Settings: LLM" width="420"></picture></p>

Suggested providers:

| Provider | Notes |
|---|---|
| Zhipu GLM (glm-4-flash) | Reachable from China, free long-term, natural wording — **recommended** |
| SiliconFlow | Reachable from China, free models require real-name verification |
| Gemini / Groq / Cerebras | Free and fast; proxy needed in China |
| DeepSeek / Qwen / Kimi | Pay-as-you-go, very cheap |
| Claude / OpenAI | Best quality, paid |

You can also pick **Custom** and enter any OpenAI-compatible `baseUrl`, model name and key.

### 6. Troubleshooting

- **Hotkey does nothing:** another app may own it — pick a different combination in settings.
- **Pasted into the wrong place:** Xtranslate remembers the foreground window when summoned; make sure the cursor is in the target input first.
- **Translation fails / times out:** check your network; Google, Gemini, Groq and Cerebras need a proxy in China; or switch engine.
- **Invalid API key:** re-paste it in settings and make sure there are no stray spaces.

## Development

```bash
npm test          # node --test unit tests
npm start         # run Electron
npm run dist      # package
```

```
src/main/           Main process: engines, config, hotkey, paste, Win32 calls
src/main/engines    Microsoft / Google / Tencent / LLM (OpenAI & Anthropic protocols, SSE streaming)
src/main/prompt.js  The conversational translation prompt (the quality core)
src/renderer/       Popup and settings UI
docs/PLAN.md        Design notes and IPC contract (Chinese)
```

## License

[MIT](LICENSE)
