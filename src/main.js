'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, Notification, nativeImage, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');

if (process.env.ZHIJIAN_USER_DATA) app.setPath('userData', process.env.ZHIJIAN_USER_DATA);

const store = require('./store');
const { loadPersonas, buildMessages, cleanReply, recentRepeats } = require('./prompt');
const mood = require('./mood');
const memory = require('./memory');
const { safeFileName } = require('./chatfile');
const { streamChat, complete } = require('./deepseek');
const proactive = require('./proactive');

const BUILTIN_PERSONAS = path.join(__dirname, '..', 'personas');
const ICON = path.join(__dirname, '..', 'assets', 'icon.png');
const userPersonaDir = () => path.join(app.getPath('userData'), 'personas');
const userData = () => app.getPath('userData');
let personas = [];
const reloadPersonas = () => (personas = loadPersonas(BUILTIN_PERSONAS, userPersonaDir()));
const findPersona = (id) => personas.find((p) => p.id === id) || (reloadPersonas(), personas.find((p) => p.id === id));

let win;
let tray = null;
let quitting = false;
let trayTipShown = false;
const active = new Map();    // personaId -> AbortController
const extracting = new Set(); // 正在提炼记忆的人设
const followTimers = proactive.createTimers(); // personaId -> 待发的「话题延伸追发」
const pending = new Map();      // personaId -> 正在生成的主动消息（AbortController）

// 只允许一个实例：再次双击 exe 时把已有窗口叫出来
if (!process.env.ZHIJIAN_SHOTS && !app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => showWindow());

function showWindow() {
  if (!win || win.isDestroyed()) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 880,
    minHeight: 600,
    backgroundColor: '#0c0e12',
    title: '之间',
    icon: ICON,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  // 外部链接用系统浏览器打开，禁止应用内跳转
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // 关闭窗口：设置里开了「最小化到托盘」就藏到托盘，否则正常退出
  win.on('close', (e) => {
    if (quitting || !tray || !store.getSettings().closeToTray) return;
    e.preventDefault();
    win.hide();
    if (!trayTipShown) {
      trayTipShown = true;
      notify('之间还在托盘里', '想彻底退出，可以右键托盘图标选「退出」；也能在设置里关掉「关闭时最小化到托盘」。');
    }
  });
  if (process.env.ZHIJIAN_SHOTS) require('./dev-shots')(win, process.env.ZHIJIAN_SHOTS);
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 });
    tray = new Tray(img);
    tray.setToolTip('之间');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开之间', click: () => showWindow() },
      { type: 'separator' },
      { label: '退出', click: () => { quitting = true; app.quit(); } }
    ]));
    tray.on('click', () => showWindow());
  } catch (e) {
    tray = null; // 某些系统没有托盘区，退回普通关闭行为
  }
}

function notify(title, body) {
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, icon: ICON, silent: false });
    n.on('click', () => showWindow());
    n.show();
  } catch { /* ignore */ }
}

function send(data) { if (win && !win.isDestroyed()) win.webContents.send('chat:event', data); }

ipcMain.handle('personas:list', () => reloadPersonas().map(({ id, type, displayType, name, age, intro, keywords, theme, greeting, examples, notice }) => ({
  id, type, displayType: displayType || type, name, age, intro, keywords, theme, greeting, notice: notice || '',
  examples: (examples || []).slice(0, 3).map((e) => ({ user: String(e.user || ''), reply: String(e.reply || '') }))
})));
ipcMain.handle('settings:get', () => store.getSettings());
ipcMain.handle('settings:save', (_e, patch) => store.saveSettings(patch || {}));
ipcMain.handle('key:status', () => store.keyStatus());
ipcMain.handle('key:set', (_e, key) => store.setApiKey(key));
ipcMain.handle('key:clear', () => { store.clearApiKey(); return store.keyStatus(); });
ipcMain.handle('app:info', () => ({ version: app.getVersion(), userData: userData(), tray: !!tray }));
ipcMain.handle('open:external', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
ipcMain.handle('open:personaDir', () => { fs.mkdirSync(userPersonaDir(), { recursive: true }); return shell.openPath(userPersonaDir()); });
ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text || '').slice(0, 20000)); return true; });

// 测试连接：用 /models 接口校验 Key（不消耗 token），并检查模型名是否存在
ipcMain.handle('key:test', async (_e, maybeKey) => {
  const key = (maybeKey && String(maybeKey).trim()) || store.getApiKey();
  if (!key) return { ok: false, message: '还没有填写 API Key' };
  const { baseUrl, model } = store.getSettings();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: ctrl.signal });
    clearTimeout(t);
    if (res.status === 401) return { ok: false, message: 'API Key 无效（401）' };
    if (!res.ok) return { ok: false, message: `连接失败（HTTP ${res.status}）` };
    const ids = ((await res.json()).data || []).map((m) => m.id);
    if (ids.length && !ids.includes(model)) return { ok: true, message: `连接成功，但模型「${model}」不在可用列表中：${ids.join('、')}` };
    return { ok: true, message: `连接成功，模型「${model}」可用` };
  } catch (e) {
    return { ok: false, message: e.name === 'AbortError' ? '连接超时，请检查网络' : `网络错误：${e.message}` };
  }
});

ipcMain.handle('chat:history', (_e, id) => store.getHistory(id));
ipcMain.handle('mood:get', (_e, id) => mood.publicView(store.getMood(id)));
ipcMain.handle('mood:icon', (_e, personaId, emotion) => {
  const pid = String(personaId || '').replace(/[^a-z0-9_-]/gi, '');
  const allowed = new Set(['calm', 'happy', 'excited', 'angry', 'sulky', 'hurt', 'jealous', 'sleepy', 'down']);
  const mid = allowed.has(emotion) ? emotion : 'calm';
  const dir = path.join(__dirname, '..', 'assets', 'mood-icons');
  let file = path.join(dir, pid, `${mid}-anim.svg`);
  if (!fs.existsSync(file)) file = path.join(dir, 'gaoleng', `${mid}-anim.svg`);
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
});
ipcMain.handle('chat:stop', (_e, id) => { active.get(id)?.abort(); return true; });

// ---- 清空（先自动备份）/ 撤销 / 从备份恢复 / 导入 ----
// opts.clearMemory：一并清空该人设的「她记得的事」（记忆也写进这份备份，撤销时一起恢复）
ipcMain.handle('chat:clear', (_e, id, opts = {}) => {
  cancelProactive(id);
  if (active.has(id)) return { ok: false, message: '她还在回复，稍等一下' };
  const clearMemory = !!(opts && opts.clearMemory);
  const mem = memory.load(userData(), id);
  const file = store.backupChat(id, findPersona(id), clearMemory && mem.items.length ? { memory: { items: mem.items } } : {});
  store.clearHistory(id); store.clearMood(id);
  if (clearMemory) memory.clear(userData(), id);
  return { ok: true, backup: file ? path.basename(file) : null, clearedMemory: clearMemory };
});
function restoreFrom(id, file, { withMood = false } = {}) {
  cancelProactive(id);
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return { ok: false, message: '读取文件失败' }; }
  const r = store.parseChatFile(raw);
  if (!r.ok) return r;
  if (store.getHistory(id).length) store.backupChat(id, findPersona(id)); // 覆盖前先备份当前记录
  store.saveHistory(id, r.messages);
  if (withMood && r.mood) store.saveMood(id, r.mood);
  if (withMood && r.memory && !memory.load(userData(), id).items.length) {
    const mem = memory.load(userData(), id);
    mem.items = memory.sanitizeList(r.memory.items);
    mem.lastExtractTurn = r.messages.filter((m) => m.role === 'user').length;
    memory.save(userData(), id, mem);
  }
  const from = r.persona && r.persona.id && r.persona.id !== id ? `（原记录来自「${r.persona.name || r.persona.id}」）` : '';
  return { ok: true, count: r.messages.length, message: `已恢复 ${r.messages.length} 条记录${from}` };
}
ipcMain.handle('chat:undoClear', (_e, id) => {
  const latest = store.listBackups(id)[0];
  if (!latest) return { ok: false, message: '没有找到备份' };
  if (store.getHistory(id).length) return { ok: false, message: '已经有新的聊天了，请用「从备份恢复」' };
  return restoreFrom(id, latest.file, { withMood: true });
});
ipcMain.handle('chat:restoreBackup', async (_e, id) => {
  if (active.has(id)) return { ok: false, message: '她还在回复，稍等一下' };
  fs.mkdirSync(store.backupDir(), { recursive: true });
  const latest = store.listBackups(id)[0];
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '从备份恢复聊天记录（会替换当前记录，当前记录会先自动备份）',
    defaultPath: latest ? latest.file : store.backupDir(),
    filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile']
  });
  if (canceled || !filePaths || !filePaths[0]) return { ok: false, message: '已取消' };
  return restoreFrom(id, filePaths[0], { withMood: true });
});
ipcMain.handle('chat:import', async (_e, id) => {
  if (active.has(id)) return { ok: false, message: '她还在回复，稍等一下' };
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '导入聊天记录（「导出为 JSON」得到的文件；会替换当前记录，当前记录会先自动备份）',
    defaultPath: app.getPath('documents'),
    filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile']
  });
  if (canceled || !filePaths || !filePaths[0]) return { ok: false, message: '已取消' };
  const r = restoreFrom(id, filePaths[0]);
  if (r.ok) r.message = r.message.replace('已恢复', '已导入');
  return r;
});

// ---- 「她记得的事」 ----
ipcMain.handle('memory:get', (_e, id) => ({ enabled: store.getSettings().memoryEnabled, items: memory.load(userData(), id).items }));
ipcMain.handle('memory:save', (_e, id, items) => {
  const mem = memory.load(userData(), id);
  mem.items = memory.sanitizeList(items);
  memory.save(userData(), id, mem);
  return mem.items;
});
ipcMain.handle('memory:clear', (_e, id) => { memory.clear(userData(), id); return []; });
ipcMain.handle('memory:flush', (_e, id) => { maybeExtract(id, { force: true }); return true; });

function maybeExtract(id, { force = false } = {}) {
  const settings = store.getSettings();
  if (!settings.memoryEnabled || extracting.has(id) || active.has(id)) return;
  const p = findPersona(id);
  const key = store.getApiKey();
  if (!p || !key) return;
  const history = store.getHistory(id);
  const mem = memory.load(userData(), id);
  // 危机期间及解除后若干轮不提炼
  if (!memory.shouldExtract(mem, history, { force, moodState: store.getMood(id) })) return;
  extracting.add(id);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  memory.extract({ userData: userData(), persona: p, history, complete, apiKey: key, baseUrl: settings.baseUrl, model: settings.model, signal: ctrl.signal })
    .then((r) => send({ type: 'memory', personaId: id, added: r.added, count: r.items.length }))
    .catch(() => { /* 记忆提炼失败不影响聊天，下次再试 */ })
    .finally(() => { clearTimeout(timer); extracting.delete(id); });
}

// ---- 聊天 ----
async function generate({ id, p, history, hint, moodView, crisis, regen = false }) {
  const key = store.getApiKey();
  const settings = store.getSettings();
  const now = new Date();
  const memories = settings.memoryEnabled ? memory.forPrompt(memory.load(userData(), id).items, now) : [];
  const avoidPhrases = crisis ? [] : recentRepeats(p, history);
  const ctrl = new AbortController();
  active.set(id, ctrl);
  const reqId = `${id}-${now.getTime()}`;
  send({ type: 'start', personaId: id, reqId, mood: moodView, regen });
  let out = '';
  try {
    for await (const delta of streamChat({
      apiKey: key, baseUrl: settings.baseUrl, model: settings.model, temperature: settings.temperature, thinking: settings.thinking,
      messages: buildMessages(p, history, settings.contextRounds, { nickname: settings.nickname, now, moodHint: hint, memories, avoidPhrases }), signal: ctrl.signal
    })) {
      out += delta;
      send({ type: 'delta', personaId: id, reqId, delta });
    }
    out = cleanReply(p, out);
    if (!out) throw new Error('模型返回了空内容');
    history.push({ role: 'assistant', content: out, ts: Date.now() });
    store.saveHistory(id, history);
    send({ type: 'done', personaId: id, reqId, content: out, mood: moodView });
    scheduleFollowUp(id);
    if (settings.notify && win && !win.isDestroyed() && (!win.isVisible() || !win.isFocused())) {
      const first = String(out).split(/\s*\|\|\|\s*/)[0].replace(/\s+/g, ' ');
      notify(p.name, crisis ? `${p.name} 回复了你` : (first.length > 60 ? first.slice(0, 59) + '…' : first));
    }
    return { ok: true };
  } catch (e) {
    const aborted = e.name === 'AbortError';
    if (out.trim()) { history.push({ role: 'assistant', content: out, ts: Date.now(), partial: true }); store.saveHistory(id, history); }
    const message = aborted ? '已停止' : (e.message || '未知错误');
    send({ type: aborted ? 'stopped' : 'error', personaId: id, reqId, message, content: out, canRetry: !aborted });
    return { ok: false, message };
  } finally {
    active.delete(id);
    setTimeout(() => maybeExtract(id), 300);
  }
}

ipcMain.handle('chat:send', async (_e, id, text) => {
  cancelProactive(id); // 用户一说话，待发的追发 / 主动消息全部作废
  const p = findPersona(id);
  text = String(text || '').trim();
  // 以下几种失败都发生在请求开始之前：原文没有存进记录，界面会把它放回输入框
  if (!p || !text) return { ok: false, early: true, message: '参数错误' };
  if (active.has(id)) return { ok: false, early: true, message: '上一条还在回复中' };
  if (!store.getApiKey()) return { ok: false, early: true, message: '请先在「设置」里填写 DeepSeek API Key', needKey: true };

  const history = store.getHistory(id);
  const now = new Date();
  const prevMood = store.getMood(id);
  const lastChatAt = (prevMood && prevMood.lastChatAt) || (history.length ? history[history.length - 1].ts : null);
  const returning = proactive.unansweredProactive(history) > 0; // 她主动发过、你隔了一阵才回
  const updated = mood.update(prevMood, { persona: p, userText: text, now, lastChatAt });
  if (returning && !updated.crisis) updated.hint += `\n${proactive.RETURN_NOTE}`;
  updated.state.lastHint = updated.hint; // 「重试 / 重新生成」沿用这一轮的情绪，不重复触发
  updated.state.lastCrisis = !!updated.crisis;
  store.saveMood(id, updated.state);
  const moodView = { emotion: updated.emotion, intensity: updated.intensity, label: updated.label, name: updated.name, crisis: !!updated.crisis };

  history.push({ role: 'user', content: text, ts: now.getTime() });
  store.saveHistory(id, history);
  return generate({ id, p, history, hint: updated.hint, moodView, crisis: !!updated.crisis });
});

// 重试（上一条失败）/ 重新生成（她的最后一条）：去掉末尾她的回复，用同一句用户消息和同一轮情绪再生成
ipcMain.handle('chat:regenerate', async (_e, id) => {
  cancelProactive(id);
  const p = findPersona(id);
  if (!p) return { ok: false, early: true, message: '参数错误' };
  if (active.has(id)) return { ok: false, early: true, message: '上一条还在回复中' };
  if (!store.getApiKey()) return { ok: false, early: true, message: '请先在「设置」里填写 DeepSeek API Key', needKey: true };
  const history = store.getHistory(id);
  while (history.length && history[history.length - 1].role === 'assistant') history.pop();
  if (!history.length) return { ok: false, early: true, message: '没有可以重新生成的消息' };
  store.saveHistory(id, history);
  const st = store.getMood(id);
  const crisis = !!(st && st.lastCrisis);
  const hint = (st && st.lastHint) || mood.hintFor(mood.normalize(st), mood.traitsOf(p), false, p);
  const view = mood.publicView(st);
  return generate({ id, p, history, hint, moodView: { ...view, crisis: crisis || !!view.crisis }, crisis, regen: true });
});

ipcMain.handle('chat:export', async (_e, id, format) => {
  const p = findPersona(id);
  const history = store.getHistory(id);
  if (!p || !history.length) return { ok: false, message: '还没有聊天记录' };
  const stamp = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: '导出聊天记录',
    defaultPath: path.join(app.getPath('documents'), `${safeFileName(`之间-${p.name}-${stamp}`)}.${format === 'json' ? 'json' : 'txt'}`),
    filters: format === 'json' ? [{ name: 'JSON', extensions: ['json'] }] : [{ name: '文本', extensions: ['txt'] }]
  });
  if (canceled || !filePath) return { ok: false, message: '已取消' };
  const fmt = (ts) => new Date(ts).toLocaleString('zh-CN', { hour12: false });
  const body = format === 'json'
    ? JSON.stringify({ app: '之间', persona: { id: p.id, type: p.type, name: p.name }, exportedAt: new Date().toISOString(), messages: history }, null, 2)
    : [`之间 · ${p.type} · ${p.name}`, `导出时间：${fmt(Date.now())}`, '', ...history.map((m) => `[${fmt(m.ts)}] ${m.role === 'user' ? '我' : p.name}：\n${String(m.content || '').replace(/\s*\|\|\|\s*/g, '\n')}\n`)].join('\n');
  fs.writeFileSync(filePath, (format === 'json' ? '' : '\ufeff') + body, 'utf8'); // TXT 带 BOM，方便记事本识别 UTF-8
  return { ok: true, message: `已导出到 ${filePath}` };
});

// ---- v1.7 她主动找你：话题延伸追发 + 不定时主动消息（逻辑在 proactive.js） ----
function cancelProactive(id) {
  followTimers.cancel(id);
  const c = pending.get(id);
  if (c) { c.abort(); pending.delete(id); }
}
ipcMain.on('chat:typing', (_e, id) => cancelProactive(String(id || '')));

function scheduleFollowUp(id) {
  cancelProactive(id);
  const plan = proactive.planFollowUp({ settings: store.getSettings(), history: store.getHistory(id), moodState: store.getMood(id) });
  if (!plan) return null;
  const delay = process.env.ZHIJIAN_FOLLOW_MS ? Number(process.env.ZHIJIAN_FOLLOW_MS) : plan.delayMs; // 仅测试用
  followTimers.schedule(id, delay, () => sendProactive(id, { kind: 'followup', topics: plan.topics }));
  return plan;
}

// 生成并发出一条主动消息；kind: 'followup'（追发）| 'proactive'（主动找你）| 'care'（危机后温和关心）
async function sendProactive(id, { kind, topics = [], plan = null } = {}) {
  const p = findPersona(id);
  const key = store.getApiKey();
  if (!p || !key || active.has(id) || pending.has(id)) return null;
  const settings = store.getSettings();
  const history = store.getHistory(id);
  if (!history.length) return null;
  const lastTs = history[history.length - 1].ts;
  const now = new Date();
  const st = store.getMood(id);
  const care = kind === 'care';
  const memories = settings.memoryEnabled && !care ? memory.forPrompt(memory.load(userData(), id).items, now) : [];
  const messages = proactive.buildRequest({ persona: p, history, settings, kind, topics, plan, moodState: st, memories, now });
  const ctrl = new AbortController();
  pending.set(id, ctrl);
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const out = proactive.acceptReply(cleanReply(p, await complete({ apiKey: key, baseUrl: settings.baseUrl, model: settings.model, temperature: settings.temperature, thinking: false, messages, signal: ctrl.signal })));
    if (!out || ctrl.signal.aborted) return null;
    const cur = store.getHistory(id);
    if (!cur.length || cur[cur.length - 1].ts !== lastTs || active.has(id)) return null; // 期间你说话了：作废
    const msg = { role: 'assistant', content: out, ts: Date.now(), proactive: true, kind };
    cur.push(msg);
    store.saveHistory(id, cur);
    if (kind !== 'followup') store.saveProactiveState(proactive.recordSent(store.getProactiveState(), id, new Date(msg.ts), kind));
    send({ type: 'proactive', personaId: id, content: out, ts: msg.ts, kind, mood: mood.publicView(st) });
    if (settings.notify && win && !win.isDestroyed() && (!win.isVisible() || !win.isFocused())) {
      const first = String(out).split(/\s*\|\|\|\s*/)[0].replace(/\s+/g, ' ');
      notify(p.name, care ? `${p.name} 给你发了消息` : (first.length > 60 ? first.slice(0, 59) + '…' : first));
    }
    return msg;
  } catch { return null; /* 主动消息失败就算了，不打扰 */ } finally {
    clearTimeout(timer);
    if (pending.get(id) === ctrl) pending.delete(id);
  }
}

// 每分钟看一次：最近聊过的人设里，有没有该主动找你的
function proactiveTick(now = new Date()) {
  const settings = store.getSettings();
  if (proactive.mode(settings.proactive) === 'off' || !store.getApiKey() || !proactive.inWindow(now)) return null;
  if (active.size || pending.size) return null;
  const histories = {};
  for (const p of personas) histories[p.id] = store.getHistory(p.id);
  const pstate = store.getProactiveState();
  for (const p of personas) {
    const plan = proactive.planProactive({ settings, id: p.id, history: histories[p.id], moodState: store.getMood(p.id), pstate, histories, now });
    if (plan) { sendProactive(p.id, { kind: plan.kind === 'care' ? 'care' : 'proactive', plan }); return p.id; }
  }
  return null;
}
if (process.env.ZHIJIAN_E2E === '1') global.__zhijianTest = { sendProactive, scheduleFollowUp, proactiveTick, followTimers, pending };

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  if (process.platform === 'win32') app.setAppUserModelId('com.solarsystem.zhijian'); // 系统通知需要
  reloadPersonas();
  createTray();
  createWindow();
  setTimeout(() => { proactiveTick(); setInterval(() => proactiveTick(), 60000); }, 90000);
});
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => app.quit());
