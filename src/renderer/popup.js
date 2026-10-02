'use strict';

const $ = (id) => document.getElementById(id);
const src = $('src');
const out = $('out');
const card = $('card');
const dirBtn = $('dir');
const engineBtn = $('engine');

const DIRS = ['auto', 'zh2en', 'en2zh'];
const state = {
  dir: 'auto',
  engine: 'free',
  livePreview: true,
  delay: 300,
  seq: 0,
  cur: null,          // {id, text, dir, engine, done, result, error, promise}
  wantCommit: false,
  timer: 0,
};

// 和主进程 detectDirection 同一规则，只用于显示"自动"时的实际方向
function guessDir(text) {
  const cjk = (text.match(/[㐀-鿿豈-﫿]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  if (!cjk && !latin) return 'zh2en';
  return cjk * 5 >= latin ? 'zh2en' : 'en2zh';
}

function renderChips() {
  const arrow = { zh2en: '中 → 英', en2zh: '英 → 中' };
  dirBtn.textContent = state.dir === 'auto'
    ? (src.value.trim() ? `自动 · ${arrow[guessDir(src.value)]}` : '自动识别')
    : arrow[state.dir];
  engineBtn.textContent = state.engine === 'llm' ? '大模型 · 口语' : '免费引擎';
  engineBtn.classList.toggle('llm', state.engine === 'llm');
}

function renderOut(text, mode) {
  out.className = 'out' + (mode ? ' ' + mode : '') + (state.wantCommit ? ' waiting' : '');
  out.textContent = text || '';
  if (mode === 'error') {
    const a = document.createElement('a');
    a.textContent = '去设置';
    a.onclick = () => window.xt.openSettings();
    out.append(' ', a);
  }
  out.scrollTop = out.scrollHeight;
}

function matchesCurrent(c) {
  return c && c.text === src.value && c.dir === state.dir && c.engine === state.engine;
}

function cancelCurrent() {
  const c = state.cur;
  if (c && !c.done && !c.error) window.xt.cancel(c.id);
}

function translateNow() {
  clearTimeout(state.timer);
  const text = src.value;
  if (!text.trim()) {
    cancelCurrent();
    state.cur = null;
    state.wantCommit = false;
    renderOut('');
    return;
  }
  if (matchesCurrent(state.cur) && !state.cur.error) return;

  cancelCurrent();
  const id = ++state.seq;
  const prev = state.cur && state.cur.result;
  const c = { id, text, dir: state.dir, engine: state.engine, done: false, result: '', error: null };
  state.cur = c;
  // 新请求出结果前，淡显上一次的译文，避免闪烁
  renderOut(prev || '', 'pending');

  c.promise = window.xt.translate({ id, text, direction: state.dir, engine: state.engine })
    .then((r) => {
      if (state.cur !== c) return;
      c.done = true;
      c.result = r.text || '';
      if (state.wantCommit) return commit();
      renderOut(c.result);
    })
    .catch((e) => {
      if (state.cur !== c) return;
      c.error = (e && e.message ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      state.wantCommit = false;
      renderOut(c.error, 'error');
    });
}

function schedule() {
  renderChips();
  clearTimeout(state.timer);
  if (!src.value.trim()) return translateNow();
  if (state.livePreview) state.timer = setTimeout(translateNow, state.delay);
}

function commit() {
  const text = src.value;
  if (!text.trim()) return hide();
  const c = state.cur;
  if (matchesCurrent(c) && c.done) {
    if (!c.result) return;
    state.wantCommit = false;
    window.xt.commit(c.result);
    reset();
    return;
  }
  state.wantCommit = true;
  if (matchesCurrent(c) && !c.error) renderOut(c.result || out.textContent, 'pending');
  else translateNow();
}

function hide() {
  cancelCurrent();
  reset();
  window.xt.hide();
}

function reset() {
  clearTimeout(state.timer);
  state.cur = null;
  state.wantCommit = false;
  src.value = '';
  autoGrow();
  renderOut('');
  renderChips();
}

function cycleDir() {
  state.dir = DIRS[(DIRS.indexOf(state.dir) + 1) % DIRS.length];
  renderChips();
  if (src.value.trim()) translateNow();
}

async function toggleEngine() {
  state.engine = state.engine === 'llm' ? 'free' : 'llm';
  renderChips();
  if (src.value.trim()) translateNow();
  try { await window.xt.setConfig({ engine: state.engine }); } catch (_) { /* 只影响下次默认值 */ }
}

function autoGrow() {
  src.style.height = 'auto';
  src.style.height = Math.min(src.scrollHeight, 180) + 'px';
}

src.addEventListener('input', () => { autoGrow(); state.wantCommit = false; schedule(); });

src.addEventListener('keydown', (e) => {
  // 中文输入法选词时的回车/Esc 交给输入法
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
  else if (e.key === 'Escape') { e.preventDefault(); hide(); }
  else if (e.key === 'Tab') { e.preventDefault(); cycleDir(); }
  else if ((e.key === 'e' || e.key === 'E') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); toggleEngine(); }
});

dirBtn.onclick = () => { cycleDir(); src.focus(); };
engineBtn.onclick = () => { toggleEngine(); src.focus(); };
$('settings').onclick = () => window.xt.openSettings();

window.xt.onPartial(({ id, text }) => {
  const c = state.cur;
  if (c && c.id === id && !c.done) renderOut(text, 'pending');
});

window.xt.onShow(({ engine, direction } = {}) => {
  reset();
  if (engine) state.engine = engine;
  state.dir = direction && DIRS.includes(direction) ? direction : 'auto';
  renderChips();
  src.focus();
});

function applyConfig(cfg) {
  if (!cfg) return;
  state.engine = cfg.engine || state.engine;
  state.livePreview = cfg.livePreview !== false;
  state.delay = Number(cfg.previewDelayMs) || 300;
  renderChips();
}
window.xt.onConfigChanged(applyConfig);
window.xt.getConfig().then(applyConfig).catch(() => {});

// 窗口高度跟随内容（外层 body 有 10px 阴影留白）
new ResizeObserver(() => {
  window.xt.resize(Math.ceil(card.getBoundingClientRect().height) + 20);
}).observe(card);

renderChips();
src.focus();
