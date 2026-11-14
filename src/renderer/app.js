'use strict';
/* global zhijian */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const state = {
  personas: [],
  current: null,      // 当前人设 id
  settings: null,
  streaming: {},      // personaId -> { el, text }
  bgFront: 'A'
};

// ---------- 工具 ----------
function toast(msg, ms = 2600, action) {
  const t = $('#toast');
  t.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.className = 'link toast-act';
    b.textContent = action.label;
    b.addEventListener('click', () => { t.classList.remove('show'); action.fn(); }, { once: true });
    t.appendChild(b);
  }
  t.classList.toggle('has-act', !!action);
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
// 把（动作描写）显示成淡色斜体
function renderText(s) { return escapeHtml(s.replace(/\n{2,}/g, '\n').trim()).replace(/（[^（）\n]{1,60}）/g, (m) => `<span class="act">${m}</span>`); }
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
function splitBubbles(text) {
  const parts = String(text || '').split(/\s*\|\|\|\s*/).map((x) => x.trim()).filter(Boolean);
  if (parts.length <= 1) return parts.length ? parts : [String(text || '').trim()].filter(Boolean);
  if (parts.length > 4) return [...parts.slice(0, 3), parts.slice(3).join('\n')];
  return parts;
}
function visibleStreaming(text) {
  let s = String(text || '');
  s = s.replace(/[｜|]{1,3}$/, (m) => (m.length < 3 ? '' : m));
  const i = s.indexOf('|||');
  return (i === -1 ? s : s.slice(0, i)).trimEnd();
}
function bubbleHtml(text, extra = '') { return `<div class="bubble${extra ? ' ' + extra : ''}">${renderText(text)}</div>`; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
const persona = (id = state.current) => state.personas.find((p) => p.id === id);

// ---------- 主题与过渡 ----------
const THEME_KEYS = ['bg', 'bg2', 'glow', 'accent', 'text'];
function applyTheme(theme, instant = false) {
  const root = document.documentElement;
  if (instant) root.style.setProperty('--dur', '1ms');
  for (const k of THEME_KEYS) root.style.setProperty(`--${k}`, theme[k]);
  // 背景：把新配色画到隐藏的那一层，再交叉淡入
  const back = state.bgFront === 'A' ? $('#bgB') : $('#bgA');
  const front = state.bgFront === 'A' ? $('#bgA') : $('#bgB');
  for (const k of THEME_KEYS) back.style.setProperty(`--l-${k}`, theme[k]);
  if (instant) { back.style.transition = front.style.transition = 'none'; }
  back.classList.add('on');
  front.classList.remove('on');
  state.bgFront = state.bgFront === 'A' ? 'B' : 'A';
  if (instant) requestAnimationFrame(() => requestAnimationFrame(() => {
    root.style.removeProperty('--dur'); back.style.transition = front.style.transition = '';
  }));
}

// ---------- 视图切换 ----------
function showView(name) {
  if (name === 'chat' && !state.current) name = 'picker';
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'settings') loadSettingsForm();
  if (name === 'chat') setTimeout(() => $('#input').focus(), 200);
  if (name === 'picker') renderCards();
}

// ---------- 人设卡片 ----------
function renderCards() {
  const box = $('#cards');
  box.innerHTML = '';
  for (const p of state.personas) {
    const c = document.createElement('button');
    c.className = 'card' + (p.id === state.current ? ' current' : '');
    for (const k of THEME_KEYS) c.style.setProperty(`--c-${k}`, p.theme[k]);
    const ex = (p.examples || []).slice(0, 2);
    c.innerHTML = `
      <div class="card-mood" data-persona="${escapeHtml(p.id)}"><div class="card-mood-pop" aria-hidden="true"></div></div>
      <div class="type">${escapeHtml(p.displayType || p.type)}</div>
      <div class="name">${escapeHtml(p.name)}<small>${p.age} 岁</small></div>
      <div class="intro">${escapeHtml(p.intro)}</div>
      <div class="tags">${(p.keywords || []).slice(0, 4).map((k) => `<span>${escapeHtml(k)}</span>`).join('')}</div>
      <div class="swatch">${['bg2', 'glow', 'accent'].map((k) => `<i style="background:${p.theme[k]}"></i>`).join('')}</div>
      ${ex.length ? `<div class="card-preview" aria-hidden="true"><div class="pv-title">她平时这样说话</div>${ex.map((e) => `<div class="pv-u">${escapeHtml(e.user)}</div><div class="pv-a">${splitBubbles(e.reply).map((x) => `<span>${renderText(x)}</span>`).join('')}</div>`).join('')}<div class="pv-go">点一下开始聊</div></div>` : ''}`;
    c.title = `${p.name}：悬停预览，点击开始聊天`;
    c.addEventListener('click', () => selectPersona(p.id));
    box.appendChild(c);
    moodSvg(p.id, 'calm').then((svg) => {
      const slot = c.querySelector('.card-mood');
      if (!slot) return;
      const pop = slot.querySelector('.card-mood-pop');
      mountSvg(slot, svg, 36);
      if (pop) { slot.appendChild(pop); mountSvg(pop, svg, 72); }
    });
  }
}

async function selectPersona(id, { instant = false, view = 'chat', skipNotice = false } = {}) {
  const p = persona(id);
  if (!p) return;
  if (p.notice && !skipNotice && view === 'chat' && !(state.settings.ackNotices || []).includes(p.id)) {
    const ok = await askNotice(p);
    if (!ok) return;
    state.settings = await zhijian.settings.save({ ackNotices: [...(state.settings.ackNotices || []), p.id] });
  }
  const changed = state.current !== id;
  if (changed && state.current) zhijian.memory.flush(state.current); // 换人前把上一段对话里的小事记下来
  closeSearch();
  state.current = id;
  applyTheme(p.theme, instant);
  if (changed) {
    const box = $('#messages');
    box.classList.add('fading');
    await new Promise((r) => setTimeout(r, instant ? 0 : 420));
    await renderChat();
    box.classList.remove('fading');
    state.settings = await zhijian.settings.save({ lastPersona: id });
  }
  showView(view);
}

// ---------- 聊天 ----------
function msgEl(role, content, ts, extra = '') {
  const m = document.createElement('div');
  m.className = `msg ${role === 'user' ? 'me' : 'ai'} ${extra}`;
  const parts = role === 'user' ? [content] : splitBubbles(content);
  const body = (parts.length ? parts : [content || '']).map((p) => bubbleHtml(p)).join('');
  m.innerHTML = `${body}${ts ? `<div class="meta">${fmtTime(ts)}</div>` : ''}`;
  if (!/greeting|err/.test(extra)) attachActions(m, content);
  return m;
}
// 悬停气泡出现「复制」；她的最后一条另有「重新生成」
function attachActions(m, content) {
  m.dataset.raw = String(content || '').replace(/\s*\|\|\|\s*/g, '\n');
  if (m.querySelector('.msg-actions')) return;
  const bar = document.createElement('div');
  bar.className = 'msg-actions';
  bar.innerHTML = `<button type="button" data-act="copy">复制</button>${m.classList.contains('ai') ? '<button type="button" data-act="regen">重新生成</button>' : ''}`;
  bar.querySelector('[data-act="copy"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    await zhijian.copyText(m.dataset.raw || '');
    toast('已复制');
  });
  const rg = bar.querySelector('[data-act="regen"]');
  if (rg) rg.addEventListener('click', (e) => { e.stopPropagation(); regenerate(); });
  m.appendChild(bar);
}
function markLastAi() {
  const all = $$('#messages .msg.ai:not(.greeting):not(.err)');
  all.forEach((x) => x.classList.remove('last-ai'));
  const last = all[all.length - 1];
  const lastMsg = $$('#messages .msg:not(.err)').pop();
  if (last && last === lastMsg && !state.streaming[state.current]) last.classList.add('last-ai');
}
function scrollBottom() { const b = $('#messages'); b.scrollTop = b.scrollHeight; }

async function renderChat() {
  const p = persona();
  $('#chatAvatar').textContent = p.name.slice(-1);
  $('#chatName').textContent = p.name;
  $('#chatType').textContent = p.displayType || p.type;
  const box = $('#messages');
  box.innerHTML = '';
  const history = await zhijian.chat.history(p.id);
  if (p.greeting) box.appendChild(msgEl('assistant', p.greeting, null, 'greeting'));
  let lastDay = '';
  for (const m of history) {
    const day = new Date(m.ts).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
    if (day !== lastDay) { const d = document.createElement('div'); d.className = 'day-sep'; d.textContent = `— ${day} —`; box.appendChild(d); lastDay = day; }
    box.appendChild(msgEl(m.role, m.content, m.ts));
  }
  const s = state.streaming[p.id];
  if (s) { box.appendChild(s.el); }
  markLastAi();
  updateComposer();
  refreshMood(p.id);
  scrollBottom();
}

function updateComposer() {
  const busy = !!state.streaming[state.current];
  $('#btnSend').classList.toggle('hidden', busy);
  $('#btnStop').classList.toggle('hidden', !busy);
  const st = $('#chatStatus');
  const moodEl = $('#chatMood');
  const label = busy ? '正在输入…' : '在线';
  // 保留情绪小字节点
  st.classList.toggle('typing', busy);
  // first text node
  if (st.childNodes[0] && st.childNodes[0].nodeType === 3) st.childNodes[0].textContent = label;
  else st.insertBefore(document.createTextNode(label), moodEl || null);
}

const moodIconCache = new Map();
let lastBadgeEmotion = null;
function emotionMode() {
  const s = state.settings || {};
  const m = s.emotionDisplay;
  if (m === 'icon' || m === 'text' || m === 'both' || m === 'off') return m;
  return s.showEmotion === false ? 'off' : 'icon';
}
async function moodSvg(personaId, emotion) {
  const key = `${personaId || ''}:${emotion || 'calm'}`;
  if (moodIconCache.has(key)) return moodIconCache.get(key);
  let svg = '';
  try { svg = await zhijian.chat.moodIcon(personaId, emotion || 'calm'); } catch { svg = ''; }
  moodIconCache.set(key, svg || '');
  return svg || '';
}
function mountSvg(el, svg, size) {
  if (!el) return;
  el.innerHTML = svg || '';
  const node = el.querySelector('svg');
  if (node) {
    node.removeAttribute('width');
    node.removeAttribute('height');
    node.setAttribute('aria-hidden', 'true');
    if (size) { node.style.width = `${size}px`; node.style.height = `${size}px`; }
  }
}

async function applyMoodView(view) {
  const st = $('#chatStatus');
  const el = $('#chatMood');
  const badge = $('#moodBadge');
  const pop = $('#moodPopout');
  if (!st || !el) return;
  const mode = emotionMode();
  const crisis = !!(view && view.crisis);
  const emotion = (view && view.emotion) || 'calm';
  const name = (view && (view.name || view.label)) || '';
  const showText = !crisis && (mode === 'text' || mode === 'both') && view && view.label;
  const showIcon = !crisis && (mode === 'icon' || mode === 'both') && view && view.emotion;
  el.textContent = showText ? view.label : '';
  el.classList.toggle('hidden', !showText);
  st.dataset.mood = showText || showIcon ? emotion : '';
  if (badge) {
    if (!showIcon) {
      badge.classList.add('hidden');
      badge.innerHTML = '';
      lastBadgeEmotion = null;
      if (pop) { pop.classList.remove('is-on'); pop.innerHTML = ''; }
    } else {
      const svg = await moodSvg(state.current, emotion);
      const changed = lastBadgeEmotion && lastBadgeEmotion !== emotion;
      mountSvg(badge, svg, 28);
      badge.classList.remove('hidden');
      badge.setAttribute('aria-label', name ? `心情：${name}` : '当前心情');
      if (pop) { mountSvg(pop, svg, 72); pop.classList.add('is-on'); }
      if (changed) {
        badge.classList.remove('pop');
        void badge.offsetWidth;
        badge.classList.add('pop');
        badge.addEventListener('animationend', () => badge.classList.remove('pop'), { once: true });
      }
      lastBadgeEmotion = emotion;
    }
  }
}

async function refreshMood(id = state.current) {
  if (!id) return applyMoodView(null);
  try {
    const view = await zhijian.chat.mood(id);
    if (id === state.current) applyMoodView(view);
  } catch { applyMoodView(null); }
}

function autoGrow() { const t = $('#input'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 160) + 'px'; }

async function sendMessage() {
  const input = $('#input');
  const text = input.value.trim();
  const id = state.current;
  if (!text || !id || state.streaming[id]) return;
  const ks = await zhijian.key.status();
  if (!ks.hasKey) { $('#keyBanner').classList.remove('hidden'); toast('请先在「设置」里填写 DeepSeek API Key'); return; }
  input.value = ''; autoGrow();
  closeSearch();
  const box = $('#messages');
  $$('#messages .msg.err').forEach((x) => x.remove());
  const mine = msgEl('user', text, Date.now());
  box.appendChild(mine);
  startPlaceholder(id);
  const res = await zhijian.chat.send(id, text);
  if (!res.ok && res.early) {
    // 请求还没开始就失败了：原文没有存进记录，放回输入框，不用重新敲
    const s = state.streaming[id];
    if (s) { s.el.remove(); delete state.streaming[id]; }
    mine.remove();
    if (id === state.current) { if (!input.value) { input.value = text; autoGrow(); } input.focus(); updateComposer(); markLastAi(); }
    toast(res.message);
    if (res.needKey) $('#keyBanner').classList.remove('hidden');
  }
}
function startPlaceholder(id) {
  const el = document.createElement('div');
  el.className = 'msg ai';
  el.innerHTML = '<div class="bubble"><span class="typing-dots"><i></i><i></i><i></i></span></div>';
  $('#messages').appendChild(el);
  state.streaming[id] = { el, text: '' };
  markLastAi();
  updateComposer(); scrollBottom();
  return el;
}
// 重试失败的那条 / 重新生成她的最后一条：主进程去掉末尾她的回复，用同一句话、同一轮情绪再生成
async function regenerate() {
  const id = state.current;
  if (!id || state.streaming[id]) return;
  const box = $('#messages');
  const removed = [];
  for (let n = box.lastElementChild; n && !n.classList.contains('me'); n = box.lastElementChild) {
    if (n.classList.contains('greeting') || n.classList.contains('day-sep')) break;
    removed.push(n); n.remove();
  }
  startPlaceholder(id);
  const res = await zhijian.chat.regenerate(id);
  if (!res.ok && res.early) {
    const s = state.streaming[id];
    if (s) { s.el.remove(); delete state.streaming[id]; }
    for (const n of removed.reverse()) box.appendChild(n);
    updateComposer(); markLastAi();
    toast(res.message);
  }
}

async function revealBubbles(id, s, parts) {
  const el = s.el;
  const first = el.querySelector('.bubble');
  if (first) {
    first.classList.remove('caret');
    first.innerHTML = renderText(parts[0] || '');
  }
  if (parts.length <= 1) {
    if (!el.querySelector('.meta')) el.insertAdjacentHTML('beforeend', `<div class="meta">${fmtTime(Date.now())}</div>`);
    attachActions(el, parts.join('|||'));
    delete state.streaming[id];
    if (id === state.current) { updateComposer(); markLastAi(); scrollBottom(); }
    return;
  }
  for (let i = 1; i < parts.length; i++) {
    const typ = document.createElement('div');
    typ.className = 'bubble typing-hold';
    typ.innerHTML = '<span class="typing-dots"><i></i><i></i><i></i></span>';
    const meta = el.querySelector('.meta');
    if (meta) el.insertBefore(typ, meta);
    else el.appendChild(typ);
    if (id === state.current) scrollBottom();
    await sleep(380 + Math.min(800, (parts[i].length || 4) * 26));
    if (state.streaming[id] !== s) { typ.remove(); return; }
    typ.classList.remove('typing-hold');
    typ.classList.add('late');
    typ.innerHTML = renderText(parts[i]);
    if (id === state.current) scrollBottom();
  }
  if (!el.querySelector('.meta')) el.insertAdjacentHTML('beforeend', `<div class="meta">${fmtTime(Date.now())}</div>`);
  attachActions(el, parts.join('|||'));
  delete state.streaming[id];
  if (id === state.current) { updateComposer(); markLastAi(); scrollBottom(); }
}

function finishStream(id, content, error, canRetry = true) {
  const s = state.streaming[id];
  if (!s) return;
  if (error) {
    const shown = visibleStreaming(s.text);
    if (shown) {
      const parts = splitBubbles(cleanSep(s.text));
      s.el.querySelectorAll('.bubble').forEach((b, i) => { if (i > 0) b.remove(); });
      const b = s.el.querySelector('.bubble');
      if (b) { b.classList.remove('caret'); b.innerHTML = renderText(parts[0] || shown); }
      for (const part of parts.slice(1)) s.el.insertAdjacentHTML('beforeend', bubbleHtml(part, 'late'));
      if (!s.el.querySelector('.meta')) s.el.insertAdjacentHTML('beforeend', `<div class="meta">${fmtTime(Date.now())}</div>`);
      attachActions(s.el, parts.join('|||'));
    } else s.el.remove();
    delete state.streaming[id];
    if (error !== '已停止' || !shown) {
      const e = msgEl('assistant', error === '已停止' ? '已停止' : `发送失败：${error}`, null, 'err');
      if (canRetry || error === '已停止') {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'retry';
        b.textContent = error === '已停止' ? '重新生成' : '重试';
        b.title = '用刚才那句话重新请求，不用重新输入';
        b.addEventListener('click', () => regenerate());
        e.appendChild(b);
      }
      if (id === state.current) $('#messages').appendChild(e);
    }
    if (id === state.current) { updateComposer(); markLastAi(); scrollBottom(); }
    return;
  }
  revealBubbles(id, s, splitBubbles(content));
}
function cleanSep(text) { return String(text || '').replace(/[｜|]{3}/g, '|||'); }

zhijian.chat.onEvent((ev) => {
  if (ev.type === 'memory') {
    if (ev.added > 0 && ev.personaId === state.current && !$('#memoryModal').classList.contains('hidden')) openMemory();
    return;
  }
  if (ev.mood && ev.personaId === state.current) applyMoodView(ev.mood);
  const s = state.streaming[ev.personaId];
  if (!s) return;
  if (ev.type === 'delta') {
    s.text += ev.delta;
    const b = s.el.querySelector('.bubble');
    b.innerHTML = renderText(visibleStreaming(cleanSep(s.text)) || ' ');
    b.classList.add('caret');
    if (ev.personaId === state.current) scrollBottom();
  } else if (ev.type === 'done') {
    const b = s.el.querySelector('.bubble');
    if (b) b.classList.remove('caret');
    finishStream(ev.personaId, ev.content);
  } else if (ev.type === 'error' || ev.type === 'stopped') {
    const b = s.el.querySelector('.bubble');
    if (b) b.classList.remove('caret');
    finishStream(ev.personaId, null, ev.message, ev.canRetry !== false);
  }
});

// ---------- 设置 ----------
async function loadSettingsForm() {
  const s = (state.settings = await zhijian.settings.get());
  $('#modelInput').value = s.model;
  $('#roundsInput').value = s.contextRounds; $('#roundsVal').textContent = s.contextRounds;
  $('#tempInput').value = s.temperature; $('#tempVal').textContent = Number(s.temperature).toFixed(1);
  $('#nickInput').value = s.nickname || '';
  $('#thinkInput').checked = !!s.thinking;
  const ed = $('#emotionDisplayInput');
  if (ed) ed.value = emotionMode();
  $('#memoryInput').checked = s.memoryEnabled !== false;
  $('#trayInput').checked = s.closeToTray !== false;
  $('#notifyInput').checked = s.notify !== false;
  const info = await zhijian.appInfo();
  $('#userDataPath').textContent = info.userData;
  $('#ver').textContent = `v${info.version}`;
  $('#trayInput').disabled = !info.tray;
  if (!info.tray) $('#trayInput').closest('label').title = '这个系统没有托盘区';
  await refreshKeyStatus();
}
async function refreshKeyStatus(extra) {
  const k = await zhijian.key.status();
  const st = $('#keyStatus');
  st.className = 'status' + (extra ? (extra.ok ? ' ok' : ' bad') : '');
  const base = k.hasKey ? `已保存：${k.masked}${k.secureStorage ? '（系统加密存储）' : '（本系统不支持加密，仅保存在本次运行的内存中）'}` : '尚未设置 API Key';
  st.textContent = extra ? `${extra.message}　·　${base}` : base;
  $('#keyBanner').classList.toggle('hidden', k.hasKey);
}

function bindSettings() {
  $('#btnEye').addEventListener('click', () => {
    const i = $('#keyInput'); const show = i.type === 'password';
    i.type = show ? 'text' : 'password'; $('#btnEye').textContent = show ? '隐藏' : '显示';
  });
  $('#btnSaveKey').addEventListener('click', async () => {
    const v = $('#keyInput').value.trim();
    if (!v) return toast('请先粘贴 API Key');
    const r = await zhijian.key.set(v);
    $('#keyInput').value = '';
    await refreshKeyStatus({ ok: true, message: r.persisted ? '已加密保存' : '已保存（仅本次运行有效）' });
  });
  $('#btnTestKey').addEventListener('click', async () => {
    const st = $('#keyStatus'); st.className = 'status'; st.textContent = '正在连接 DeepSeek…';
    await zhijian.settings.save({ model: $('#modelInput').value.trim() || 'deepseek-flash' });
    const r = await zhijian.key.test($('#keyInput').value.trim());
    await refreshKeyStatus(r);
  });
  $('#btnClearKey').addEventListener('click', async () => {
    if (!confirm('确定清除已保存的 API Key 吗？')) return;
    await zhijian.key.clear(); await refreshKeyStatus({ ok: true, message: '已清除' });
  });
  $('#roundsInput').addEventListener('input', (e) => { $('#roundsVal').textContent = e.target.value; });
  $('#tempInput').addEventListener('input', (e) => { $('#tempVal').textContent = Number(e.target.value).toFixed(1); });
  $('#btnSaveSettings').addEventListener('click', async () => {
    state.settings = await zhijian.settings.save({
      model: $('#modelInput').value.trim() || 'deepseek-flash',
      contextRounds: Number($('#roundsInput').value),
      temperature: Number($('#tempInput').value),
      nickname: $('#nickInput').value.trim(),
      thinking: $('#thinkInput').checked,
      emotionDisplay: $('#emotionDisplayInput') ? $('#emotionDisplayInput').value : 'icon',
      memoryEnabled: $('#memoryInput').checked
    });
    toast('设置已保存');
    if (state.current) refreshMood(state.current);
  });
  $('#btnPersonaDir').addEventListener('click', () => zhijian.openPersonaDir());
  $('#btnSaveWindow').addEventListener('click', async () => {
    state.settings = await zhijian.settings.save({ closeToTray: $('#trayInput').checked, notify: $('#notifyInput').checked });
    toast('已保存');
  });
  $('#btnReplayGuide').addEventListener('click', () => openOnboard(1));
  $('#btnOpenMemory').addEventListener('click', () => { if (!state.current) return toast('先选一个人设'); openMemory(); });
  $$('[data-href]').forEach((b) => b.addEventListener('click', () => zhijian.openExternal(b.dataset.href)));
}

// ---------- 启动 ----------
async function init() {
  state.personas = await zhijian.personas();
  state.settings = await zhijian.settings.get();
  $$('.nav-btn').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.goto)));
  $('#btnSwitch').addEventListener('click', () => showView('picker'));
  $('#btnExport').addEventListener('click', (e) => { e.stopPropagation(); $('#exportMenu').classList.toggle('open'); });
  document.addEventListener('click', () => $('#exportMenu').classList.remove('open'));
  $$('#exportMenu button[data-format]').forEach((b) => b.addEventListener('click', async () => {
    const r = await zhijian.chat.exportAs(state.current, b.dataset.format);
    if (r.message !== '已取消') toast(r.message, 4000);
  }));
  $$('#exportMenu button[data-action]').forEach((b) => b.addEventListener('click', async () => {
    if (state.streaming[state.current]) return toast('她还在回复，稍等一下');
    const r = b.dataset.action === 'import' ? await zhijian.chat.importJson(state.current) : await zhijian.chat.restoreBackup(state.current);
    if (r.message !== '已取消') toast(r.message, 4000);
    if (r.ok) await renderChat();
  }));
  $('#btnClear').addEventListener('click', async () => {
    if (state.streaming[state.current]) return toast('她还在回复，稍等一下');
    const id = state.current;
    const choice = await askClear(id);
    if (!choice) return;
    const r = await zhijian.chat.clear(id, { clearMemory: choice.clearMemory });
    if (!r.ok) return toast(r.message);
    await renderChat();
    if (r.backup) {
      toast(r.clearedMemory ? '已清空聊天和她记得的事（已自动备份）' : '已清空（已自动备份）', 9000, { label: '撤销', fn: async () => { const u = await zhijian.chat.undoClear(id); toast(u.message); if (u.ok && id === state.current) await renderChat(); } });
    } else toast('已清空');
  });
  bindSearch();
  bindMemory();
  bindOnboard();
  $('#btnStop').addEventListener('click', () => zhijian.chat.stop(state.current));
  $('#composer').addEventListener('submit', (e) => { e.preventDefault(); sendMessage(); });
  $('#input').addEventListener('input', autoGrow);
  $('#input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); }
  });
  bindSettings();

  const first = persona(state.settings.lastPersona) ? state.settings.lastPersona : state.personas[0]?.id;
  if (first) {
    state.current = null;
    await selectPersona(first, { instant: true, view: state.settings.lastPersona ? 'chat' : 'picker', skipNotice: true });
  }
  await refreshKeyStatus();
  const ks = await zhijian.key.status();
  if (!state.settings.onboarded && !ks.hasKey) openOnboard(1);
}

// ---------- 聊天记录搜索 ----------
const search = { hits: [], idx: -1 };
function clearMarks() {
  $$('#messages mark.hl').forEach((mk) => { const t = document.createTextNode(mk.textContent); mk.replaceWith(t); t.parentNode && t.parentNode.normalize(); });
  $$('#messages .msg.hit').forEach((x) => x.classList.remove('hit'));
}
function runSearch(q) {
  clearMarks();
  search.hits = []; search.idx = -1;
  q = String(q || '').trim();
  if (!q) { $('#searchCount').textContent = ''; return; }
  const lower = q.toLowerCase();
  for (const b of $$('#messages .msg:not(.err) .bubble')) {
    const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
    for (const n of nodes) {
      const text = n.nodeValue; const tl = text.toLowerCase();
      let i = tl.indexOf(lower);
      if (i < 0) continue;
      const frag = document.createDocumentFragment();
      let last = 0;
      while (i >= 0) {
        frag.appendChild(document.createTextNode(text.slice(last, i)));
        const mk = document.createElement('mark'); mk.className = 'hl'; mk.textContent = text.slice(i, i + q.length);
        frag.appendChild(mk); search.hits.push(mk);
        last = i + q.length; i = tl.indexOf(lower, last);
      }
      frag.appendChild(document.createTextNode(text.slice(last)));
      n.replaceWith(frag);
    }
  }
  $('#searchCount').textContent = search.hits.length ? '' : '没有找到';
  if (search.hits.length) gotoHit(search.hits.length - 1); // 从最近的一条开始
}
function gotoHit(i) {
  if (!search.hits.length) return;
  search.idx = (i + search.hits.length) % search.hits.length;
  search.hits.forEach((h) => h.classList.remove('cur'));
  $$('#messages .msg.hit').forEach((x) => x.classList.remove('hit'));
  const h = search.hits[search.idx];
  h.classList.add('cur');
  const m = h.closest('.msg'); if (m) m.classList.add('hit');
  h.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  $('#searchCount').textContent = `${search.idx + 1} / ${search.hits.length}`;
}
function openSearch() { $('#searchBar').classList.remove('hidden'); const i = $('#searchInput'); i.focus(); i.select(); if (i.value) runSearch(i.value); }
function closeSearch() { if (!$('#searchBar')) return; $('#searchBar').classList.add('hidden'); clearMarks(); search.hits = []; $('#searchCount').textContent = ''; }
function bindSearch() {
  let t;
  $('#btnSearch').addEventListener('click', () => ($('#searchBar').classList.contains('hidden') ? openSearch() : closeSearch()));
  $('#searchInput').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => runSearch(e.target.value), 220); });
  $('#searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (!search.hits.length) runSearch(e.target.value); else gotoHit(search.idx + (e.shiftKey ? 1 : -1)); }
    if (e.key === 'Escape') { closeSearch(); $('#input').focus(); }
  });
  $('#searchPrev').addEventListener('click', () => gotoHit(search.idx - 1));
  $('#searchNext').addEventListener('click', () => gotoHit(search.idx + 1));
  $('#searchClose').addEventListener('click', closeSearch);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && $('#view-chat').classList.contains('active')) { e.preventDefault(); openSearch(); }
  });
}

// ---------- 她记得的事 ----------
let memDraft = [];
async function openMemory() {
  const id = state.current;
  if (!id) return;
  const r = await zhijian.memory.get(id);
  memDraft = (r.items || []).map((x) => ({ ...x }));
  $('#memTitle').textContent = `${persona(id).name} 记得的事`;
  $('#memHint').textContent = r.enabled
    ? '从你们的聊天里提炼出来、只保存在本机的几条小事，每次聊天都会悄悄带给她。可以改、删，也可以自己加。'
    : '记忆功能现在是关着的（设置 → 对话 → 让她记住关于你的事），下面这些不会带给她，也不会再新增。';
  renderMemList();
  $('#memoryModal').classList.remove('hidden');
}
function renderMemList() {
  const ul = $('#memList');
  ul.innerHTML = '';
  if (!memDraft.length) { ul.innerHTML = '<li class="empty">她还没有记下什么。多聊几句，或者自己加一条。</li>'; return; }
  memDraft.forEach((m, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<input value="${escapeHtml(m.text)}" maxlength="60" /><span class="mem-time" title="${m.ts ? new Date(m.ts).toLocaleString() : ''}">${memAgo(m.ts)}</span><button class="ghost danger" title="删除">删除</button>`;
    li.querySelector('input').addEventListener('input', (e) => { m.text = e.target.value; m.manual = true; });
    li.querySelector('button').addEventListener('click', () => { memDraft.splice(i, 1); renderMemList(); });
    ul.appendChild(li);
  });
}
function bindMemory() {
  $('#btnMemory').addEventListener('click', openMemory);
  $('#memClose').addEventListener('click', () => $('#memoryModal').classList.add('hidden'));
  $('#memAdd').addEventListener('click', () => {
    const v = $('#memNew').value.trim();
    if (!v) return;
    if (memDraft.length >= 20) return toast('最多 20 条，先删掉几条');
    memDraft.push({ text: v, manual: true, ts: Date.now() });
    $('#memNew').value = ''; renderMemList();
  });
  $('#memNew').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#memAdd').click(); } });
  $('#memSave').addEventListener('click', async () => {
    const before = memDraft.filter((x) => x.text.trim()).length;
    memDraft = await zhijian.memory.save(state.current, memDraft);
    renderMemList();
    toast(memDraft.length < before ? '已保存（含敏感信息或重复的条目没有保存）' : '已保存');
  });
  $('#memClear').addEventListener('click', async () => {
    if (!confirm('确定清空她记得的全部小事吗？')) return;
    memDraft = await zhijian.memory.clear(state.current); renderMemList(); toast('已清空');
  });
}

// ---------- 清空确认（可一并清空该人设的记忆，默认勾选） ----------
async function askClear(id) {
  const m = await zhijian.memory.get(id).catch(() => ({ items: [] }));
  const n = (m.items || []).length;
  $('#clearText').textContent = `确定清空和「${persona().name}」的全部聊天记录吗？`;
  $('#clearMemCount').textContent = String(n);
  $('#clearMemInput').checked = true;
  $('#clearMemInput').disabled = n === 0;
  $('#clearModal').classList.remove('hidden');
  return new Promise((resolve) => {
    const done = (v) => {
      $('#clearModal').classList.add('hidden');
      $('#clearOk').onclick = null; $('#clearCancel').onclick = null; $('#clearModal').onkeydown = null;
      resolve(v);
    };
    $('#clearOk').onclick = () => done({ clearMemory: n > 0 && $('#clearMemInput').checked });
    $('#clearCancel').onclick = () => done(null);
    $('#clearModal').onkeydown = (e) => { if (e.key === 'Escape') done(null); };
    $('#clearCancel').focus();
  });
}

function memAgo(ts) {
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(ts).setHours(0, 0, 0, 0)) / 86400000);
  if (!ts || days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  return `${Math.floor(days / 30)} 个月前`;
}

// ---------- 首次引导 ----------
function openOnboard(step = 1) {
  $('#onboard').classList.remove('hidden');
  obStep(step);
}
function obStep(n) {
  $$('#onboard .ob-step').forEach((x) => x.classList.toggle('on', Number(x.dataset.step) === n));
  $$('#onboard .ob-steps i').forEach((x) => x.classList.toggle('on', Number(x.dataset.step) <= n));
  if (n === 2) setTimeout(() => $('#obKey').focus(), 50);
}
async function finishOnboard(view = 'picker') {
  $('#onboard').classList.add('hidden');
  state.settings = await zhijian.settings.save({ onboarded: true });
  await refreshKeyStatus();
  showView(view);
}
function bindOnboard() {
  $('#onboard').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ob]');
    if (!b) return;
    const act = b.dataset.ob;
    if (act === 'next') obStep(2);
    else if (act === 'back') obStep(1);
    else if (act === 'skip') finishOnboard('picker');
    else if (act === 'done') finishOnboard('picker');
    else if (act === 'save') {
      const v = $('#obKey').value.trim();
      const st = $('#obStatus');
      if (!v) { st.className = 'status bad'; st.textContent = '先把 Key 粘贴进来'; return; }
      b.disabled = true;
      st.className = 'status'; st.textContent = '正在保存并连接 DeepSeek…';
      await zhijian.key.set(v);
      $('#obKey').value = '';
      const r = await zhijian.key.test();
      b.disabled = false;
      st.className = 'status ' + (r.ok ? 'ok' : 'bad');
      st.textContent = r.ok ? r.message : `${r.message}。可以检查一下 Key 是否复制完整、账户是否有余额，再试一次。`;
      if (r.ok) setTimeout(() => obStep(3), 700);
    }
  });
  $('#obKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#onboard [data-ob="save"]').click(); } });
}

// ---------- 人设首次说明 ----------
function askNotice(p) {
  return new Promise((resolve) => {
    $('#noticeTitle').textContent = `和${p.name}聊之前`;
    $('#noticeText').textContent = p.notice;
    $('#noticeModal').classList.remove('hidden');
    const done = (v) => { $('#noticeModal').classList.add('hidden'); $('#noticeOk').onclick = $('#noticeCancel').onclick = null; resolve(v); };
    $('#noticeOk').onclick = () => done(true);
    $('#noticeCancel').onclick = () => done(false);
  });
}
window.zhijianApp = { selectPersona, showView, state, applyMoodView, refreshMood, openOnboard, obStep, openMemory, openSearch, runSearch, finishStream, startPlaceholder }; // 便于调试与截图
init();
