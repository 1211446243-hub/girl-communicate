'use strict';
// 本地存储：设置、加密的 API Key、每个人设的聊天记录（都在 app userData 目录）
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const DEFAULT_SETTINGS = {
  model: 'deepseek-flash',
  baseUrl: 'https://api.deepseek.com',
  contextRounds: 12,
  temperature: 1.1,
  thinking: false,
  nickname: '',
  lastPersona: null,
  showEmotion: true,
  emotionDisplay: 'icon',
  onboarded: false,     // 是否走完 / 跳过首次引导
  closeToTray: true,    // 关闭窗口时最小化到托盘
  notify: true,         // 窗口不在前台时，回复完成发系统通知
  memoryEnabled: true,  // 「她记得的事」
  followUp: 'rare',     // v1.7 话题延伸追发：off / rare（偶尔）/ normal（正常）
  proactive: 'rare',    // v1.7 不定时主动找你：off / rare / normal
  ackNotices: []        // 已确认过首次说明的人设 id
};

const dir = () => app.getPath('userData');
const histDir = () => path.join(dir(), 'history');
const settingsFile = () => path.join(dir(), 'settings.json');
const keyFile = () => path.join(dir(), 'apikey.enc');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

const LEGACY_MODELS = ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash']; // 已停用/改名的旧模型名
function getSettings() {
  const s = { ...DEFAULT_SETTINGS, ...readJson(settingsFile(), {}) };
  if (LEGACY_MODELS.includes(s.model)) s.model = DEFAULT_SETTINGS.model;
  const allowedDisplay = new Set(['icon', 'text', 'both', 'off']);
  if (!allowedDisplay.has(s.emotionDisplay)) {
    s.emotionDisplay = s.showEmotion === false ? 'off' : 'icon';
  }
  s.showEmotion = s.emotionDisplay !== 'off';
  return s;
}
function saveSettings(patch) {
  const allowed = Object.keys(DEFAULT_SETTINGS);
  const next = getSettings();
  for (const k of allowed) if (patch[k] !== undefined) next[k] = patch[k];
  next.contextRounds = Math.min(50, Math.max(1, parseInt(next.contextRounds, 10) || DEFAULT_SETTINGS.contextRounds));
  next.temperature = Math.min(2, Math.max(0, Number(next.temperature) || DEFAULT_SETTINGS.temperature));
  next.model = String(next.model || DEFAULT_SETTINGS.model).trim();
  next.nickname = String(next.nickname || '').slice(0, 20);
  next.thinking = !!next.thinking;
  for (const k of ['onboarded', 'closeToTray', 'notify', 'memoryEnabled']) next[k] = !!next[k];
  for (const k of ['followUp', 'proactive']) if (!['off', 'rare', 'normal'].includes(next[k])) next[k] = DEFAULT_SETTINGS[k];
  next.ackNotices = Array.isArray(next.ackNotices) ? [...new Set(next.ackNotices.map((x) => String(x).replace(/[^a-z0-9_-]/gi, '')).filter(Boolean))].slice(0, 50) : [];
  const allowedDisplay = new Set(['icon', 'text', 'both', 'off']);
  if (!allowedDisplay.has(next.emotionDisplay)) {
    next.emotionDisplay = next.showEmotion === false ? 'off' : 'icon';
  }
  next.showEmotion = next.emotionDisplay !== 'off';
  writeJson(settingsFile(), next);
  return next;
}

// ---- API Key：只用 safeStorage（Windows 上是 DPAPI）加密保存，绝不明文落盘 ----
let sessionKey = null; // 系统加密不可用时，仅保存在内存
function canEncrypt() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    // Linux 下没有钥匙串时 backend 为 basic_text（等同明文），视为不可用
    if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
      return safeStorage.getSelectedStorageBackend() !== 'basic_text';
    }
    return true;
  } catch { return false; }
}
function setApiKey(key) {
  key = String(key || '').trim();
  if (!key) { clearApiKey(); return { saved: false, persisted: false }; }
  if (canEncrypt()) {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(keyFile(), safeStorage.encryptString(key));
    sessionKey = null;
    return { saved: true, persisted: true };
  }
  sessionKey = key;
  return { saved: true, persisted: false };
}
function getApiKey() {
  if (process.env.ZHIJIAN_USE_ENV_KEY === '1' && process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY; // 仅开发测试
  if (sessionKey) return sessionKey;
  try {
    if (fs.existsSync(keyFile()) && safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(fs.readFileSync(keyFile()));
  } catch { /* 解密失败（例如换了电脑/用户），视为未设置 */ }
  return null;
}
function clearApiKey() {
  sessionKey = null;
  try { fs.unlinkSync(keyFile()); } catch { /* ignore */ }
}
function keyStatus() {
  const k = getApiKey();
  return { hasKey: !!k, masked: k ? `${k.slice(0, 3)}••••${k.slice(-4)}` : '', secureStorage: canEncrypt() };
}

// ---- 聊天记录 ----
const safeId = (id) => String(id).replace(/[^a-z0-9_-]/gi, '');
const histFile = (id) => path.join(histDir(), `${safeId(id)}.json`);
function getHistory(id) { return readJson(histFile(id), []); }
function saveHistory(id, list) { writeJson(histFile(id), list.slice(-2000)); }
function clearHistory(id) { try { fs.unlinkSync(histFile(id)); } catch { /* ignore */ } }

// ---- 心情状态（不含任何密钥，仅语气惯性） ----
const moodFile = () => path.join(dir(), 'moods.json');
function getMood(id) {
  const all = readJson(moodFile(), {});
  return all[safeId(id)] || null;
}
function saveMood(id, state) {
  const all = readJson(moodFile(), {});
  all[safeId(id)] = state;
  writeJson(moodFile(), all);
}
function clearMood(id) {
  const all = readJson(moodFile(), {});
  delete all[safeId(id)];
  writeJson(moodFile(), all);
}

// ---- 清空前自动备份（backups\<人设id>-<时间>.json，每个人设最多留 10 份） ----
const backupDir = () => path.join(dir(), 'backups');
const stampOf = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
function backupChat(id, persona, extra = {}) {
  const messages = getHistory(id);
  if (!messages.length) return null;
  const file = path.join(backupDir(), `${safeId(id)}-${stampOf()}.json`);
  writeJson(file, { app: '之间', kind: 'backup', persona: persona ? { id: persona.id, type: persona.type, name: persona.name } : { id: safeId(id) }, exportedAt: new Date().toISOString(), messages, mood: getMood(id), ...extra });
  const mine = listBackups(id);
  for (const old of mine.slice(10)) { try { fs.unlinkSync(old.file); } catch { /* ignore */ } }
  return file;
}
function listBackups(id) {
  const prefix = `${safeId(id)}-`;
  let names = [];
  try { names = fs.readdirSync(backupDir()); } catch { return []; }
  return names.filter((n) => n.startsWith(prefix) && n.endsWith('.json'))
    .map((n) => ({ name: n, file: path.join(backupDir(), n) }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

// ---- v1.7 主动消息计数（每个人设每天几条、最近一次时间） ----
const proactiveFile = () => path.join(dir(), 'proactive.json');
function getProactiveState() { return readJson(proactiveFile(), { lastAny: 0, personas: {} }); }
function saveProactiveState(s) { writeJson(proactiveFile(), s); }

const { parseChatFile } = require('./chatfile');

module.exports = { backupChat, listBackups, parseChatFile, backupDir, getSettings, saveSettings, setApiKey, getApiKey, clearApiKey, keyStatus, getHistory, saveHistory, clearHistory, getMood, saveMood, clearMood, getProactiveState, saveProactiveState };
