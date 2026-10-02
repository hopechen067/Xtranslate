'use strict';

const $ = (id) => document.getElementById(id);
const api = window.xt; // 不能叫 xt：contextBridge 已把 xt 定义为不可重声明的全局
let providers = [];
let cfg = null;

const errMsg = (e) => (e && e.message ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function setResult(el, text, kind) {
  el.textContent = text || '';
  el.className = 'result' + (kind ? ' ' + kind : '');
}

async function save(partial) {
  try {
    cfg = await api.setConfig(partial);
    render();
    return true;
  } catch (e) {
    return Promise.reject(e);
  }
}

function render() {
  if (!cfg) return;
  for (const r of document.querySelectorAll('input[name=engine]')) r.checked = r.value === cfg.engine;
  $('free-box').classList.toggle('off', cfg.engine !== 'free');
  $('llm-box').classList.toggle('off', cfg.engine !== 'llm');
  $('free-provider').value = cfg.free?.provider || 'microsoft';

  const llm = cfg.llm || {};
  $('llm-provider').value = llm.provider || 'deepseek';
  if (document.activeElement !== $('llm-base')) $('llm-base').value = llm.baseUrl || '';
  if (document.activeElement !== $('llm-model')) $('llm-model').value = llm.model || '';
  const p = providers.find((x) => x.id === llm.provider) || {};
  $('llm-models').replaceChildren(...(p.models || []).map((m) => Object.assign(document.createElement('option'), { value: m })));
  $('llm-key').placeholder = llm.apiKeySet ? '已保存（留空则不修改）' : (p.keyOptional ? '本地模型可不填' : 'sk-…');

  const tip = $('key-tip');
  tip.replaceChildren();
  if (p.keyUrl) {
    const a = Object.assign(document.createElement('a'), { href: p.keyUrl, target: '_blank', textContent: `去 ${p.name} 申请 Key` });
    tip.append(a, '　Key 只加密保存在本机，只发给你选的服务商。');
  } else if (p.id === 'ollama') {
    tip.textContent = '需先在本机运行 Ollama 并拉取模型，例如 ollama pull qwen2.5:7b';
  }

  $('hotkey').textContent = cfg.hotkey || '未设置';
  $('hk-hint').textContent = cfg.hotkey || '热键';
  $('live').checked = cfg.livePreview !== false;
  $('delay').value = String(cfg.previewDelayMs || 300);
  $('delay').disabled = !$('live').checked;
  $('restore').checked = cfg.restoreClipboard !== false;
  $('login').checked = !!cfg.launchAtLogin;
}

// —— 引擎 ——
for (const r of document.querySelectorAll('input[name=engine]')) {
  r.addEventListener('change', () => save({ engine: r.value }));
}
$('free-provider').addEventListener('change', (e) => save({ free: { provider: e.target.value } }));

$('llm-provider').addEventListener('change', (e) => {
  const p = providers.find((x) => x.id === e.target.value);
  if (!p) return;
  const llm = { provider: p.id };
  if (p.id !== 'custom') Object.assign(llm, { baseUrl: p.baseUrl, model: p.model });
  setResult($('llm-result'), '');
  save({ llm });
});
$('llm-base').addEventListener('change', (e) => save({ llm: { baseUrl: e.target.value.trim() } }));
$('llm-model').addEventListener('change', (e) => save({ llm: { model: e.target.value.trim() } }));
$('llm-key').addEventListener('change', async (e) => {
  const key = e.target.value.trim();
  if (!key) return;
  await save({ llm: { apiKey: key } });
  e.target.value = '';
});

for (const btn of document.querySelectorAll('[data-test]')) {
  btn.addEventListener('click', async () => {
    const engine = btn.dataset.test;
    const out = $(engine + '-result');
    btn.disabled = true;
    setResult(out, '测试中…');
    try {
      if (engine === 'llm') {
        const partial = { llm: { baseUrl: $('llm-base').value.trim(), model: $('llm-model').value.trim() } };
        const key = $('llm-key').value.trim();
        if (key) partial.llm.apiKey = key;
        await save(partial);
        $('llm-key').value = '';
      }
      const r = await api.testEngine({ engine });
      if (r.ok) setResult(out, `✓ ${r.sample}（${r.ms} ms）`, 'ok');
      else setResult(out, r.error || '失败', 'err');
    } catch (e) {
      setResult(out, errMsg(e), 'err');
    } finally {
      btn.disabled = false;
    }
  });
}

// —— 常规 ——
$('live').addEventListener('change', (e) => save({ livePreview: e.target.checked }));
$('delay').addEventListener('change', (e) => save({ previewDelayMs: Number(e.target.value) }));
$('restore').addEventListener('change', (e) => save({ restoreClipboard: e.target.checked }));
$('login').addEventListener('change', (e) => save({ launchAtLogin: e.target.checked }));

// —— 热键录制 ——
const KEY_MAP = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Enter', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', '`': '`', '-': '-', '=': '=', '[': '[', ']': ']', ';': ';', "'": "'", ',': ',', '.': '.', '/': '/', '\\': '\\' };

function toAccelerator(e) {
  let key = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^F\d{1,2}$/.test(e.key)) key = e.key;
  else if (KEY_MAP[e.key]) key = KEY_MAP[e.key];
  if (!key) return null;
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  if (!mods.length && !/^F\d+$/.test(key)) return null; // 单个普通键会吃掉正常打字
  return [...mods, key].join('+');
}

const hk = $('hotkey');
let recording = false;
hk.addEventListener('click', () => {
  recording = true;
  hk.classList.add('rec');
  hk.textContent = '请按下组合键…';
  setResult($('hotkey-result'), 'Esc 取消', '');
});
hk.addEventListener('blur', stopRec);
function stopRec() {
  if (!recording) return;
  recording = false;
  hk.classList.remove('rec');
  render();
}
hk.addEventListener('keydown', async (e) => {
  if (!recording) return;
  e.preventDefault();
  if (e.key === 'Escape') { stopRec(); setResult($('hotkey-result'), ''); return; }
  const acc = toAccelerator(e);
  if (!acc) return; // 还在按修饰键
  recording = false;
  hk.classList.remove('rec');
  try {
    await save({ hotkey: acc });
    setResult($('hotkey-result'), '✓ 已生效', 'ok');
  } catch (err) {
    render();
    setResult($('hotkey-result'), errMsg(err) || '这个组合键被别的软件占用了', 'err');
  }
});

api.onConfigChanged((c) => { cfg = c; render(); });

(async () => {
  providers = await api.getProviders();
  $('llm-provider').replaceChildren(...providers.map((p) => Object.assign(document.createElement('option'), { value: p.id, textContent: p.name })));
  cfg = await api.getConfig();
  render();
})();
