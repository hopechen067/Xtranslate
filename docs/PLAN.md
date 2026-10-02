# Xtranslate 规划

## 产品
一个只做一件事的翻译输入法：在任意软件里按热键（默认 `Alt+Q`）弹出小输入框，
打中文出英文、打英文出中文，回车把译文粘贴回原来的光标位置。
唯一的质量要求：译文要像日常口头说话，而不是书面翻译腔。

## 形态与交互
- 托盘常驻，无主窗口。托盘菜单：设置 / 开机启动 / 退出。
- 热键呼出浮窗（无边框、置顶、出现在当前鼠标所在屏幕的中上方）。
- 打字停顿 `previewDelayMs` 后自动预览译文（LLM 流式显示）。
- `Enter`：粘贴译文（若译文还没出来则等它出来再粘贴）。
- `Shift+Enter` 换行；`Tab` 切换方向（自动 → 中→英 → 英→中）；
  `Ctrl+E` 切换引擎（免费 ↔ 大模型）；`Esc` 关闭。
- 粘贴方式：呼出前记住前台窗口 → 隐藏浮窗 → 切回该窗口 → 写剪贴板 → 模拟 Ctrl+V → 稍后恢复原剪贴板。

## 技术栈
- Electron（项目机器只有 Node，没有 .NET / Rust / Python）。
- 纯 HTML/CSS/JS，无构建步骤。CommonJS。
- Win32 调用（前台窗口、SendInput）用 `koffi`（自带预编译，无需编译工具链）。
- 打包：electron-builder，NSIS 安装包 + portable。
- 测试：`node --test`。

## 引擎
### 免费（无需 Key）
- `microsoft`（默认，国内可直连）：Edge 浏览器内置翻译用的接口。
  `GET https://edge.microsoft.com/translate/auth` 拿 token（约 10 分钟有效，缓存），
  `POST https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&from=&to=en` 。
- `google`：`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=...`（国内需代理）。
- 都不是官方开放接口，可能失效；失败时给出清晰错误，并提示切换到另一个或大模型。

### 大模型（用户自选）
预设见 `src/main/providers.js`；两种协议：
- `openai`：`POST {baseUrl}/chat/completions`，`stream: true`，SSE。
- `anthropic`：`POST {baseUrl}/v1/messages`，头 `x-api-key`、`anthropic-version: 2023-06-01`，`stream: true`，SSE。
提示词在 `src/main/prompt.js`（质量核心，改动需谨慎）。

## 配置（`userData/config.json`）
```json
{
  "hotkey": "Alt+Q",
  "engine": "free",              // "free" | "llm"
  "free": { "provider": "microsoft" },   // "microsoft" | "google"
  "llm": { "provider": "zhipu", "baseUrl": "https://open.bigmodel.cn/api/paas/v4", "model": "glm-4-flash-250414", "apiKey": "<加密存储>" },
  "livePreview": true,
  "previewDelayMs": 500,
  "restoreClipboard": true,
  "launchAtLogin": false
}
```
API Key 用 Electron `safeStorage` 加密后存盘；永远不把明文 Key 发给渲染进程（只发 `apiKeySet: boolean`）。

## IPC 约定（preload 暴露 `window.xt`）
| 方法 | 说明 |
|---|---|
| `translate({id, text, direction?, engine?})` → `Promise<{id, text, engine, direction, ms}>` | `direction`: `auto`/`zh2en`/`en2zh`；`engine`: `free`/`llm`，省略则用配置 |
| `onPartial(cb)` | `cb({id, text})`，text 为累计的流式译文 |
| `cancel(id)` | 取消进行中的请求（AbortController） |
| `commit(text)` → `Promise<void>` | 隐藏浮窗、切回原窗口、粘贴 text |
| `hide()` | 隐藏浮窗，不粘贴 |
| `resize(height)` | 浮窗按内容调整高度 |
| `onShow(cb)` | 浮窗被热键呼出时：`cb({engine, direction})` |
| `getConfig()` → `Promise<config>` | apiKey 被替换为 `apiKeySet: boolean` |
| `setConfig(partial)` → `Promise<config>` | 深合并；`llm.apiKey` 为空字符串/缺省表示不改；热键变更立即重新注册，失败则 reject 并保持旧热键 |
| `getProviders()` → `Promise<Provider[]>` | 大模型预设列表；`models[]` 带 `free`（free / quota）和 `note`，请求参数 `extra` 只留在主进程 |
| `listModels(providerId)` → `Promise<Model[]>` | 设置页模型下拉框：预设精选 + OpenRouter 实时免费模型（`live: true`），拉取失败只返回预设 |
| `testEngine(partialConfig?)` → `Promise<{ok, sample, ms, error?}>` | 用当前或传入（未保存）配置翻译一句测试文本 |
| `openSettings()` | 打开设置窗口 |
| `onConfigChanged(cb)` | 配置变更广播给所有窗口 |

错误：reject 的 Error.message 必须是给用户看的中文短句（如"API Key 无效""网络连不上 Google，换微软或大模型试试"）。

## 分工
- 后端（Grok，分支 `feat/backend`）：`src/main/**`（除 prompt.js / providers.js 的内容设计）、`src/preload.js`、测试、打包配置。
- 前端（Claude，分支 `feat/ui`）：`src/renderer/**`。
