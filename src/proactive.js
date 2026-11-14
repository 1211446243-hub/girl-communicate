'use strict';
// v1.7「她主动找你」：纯逻辑（不依赖 Electron），主进程负责定时与发送，单元测试直接测这里。
// 1) 话题延伸追发（followUp）：她回复后，用户一段时间没说话，有一定概率顺着用户最近说的某个东西再补一条。
//    每轮最多一次；用户一说话 / 开始打字就取消；危机期间及之后几轮不发。
// 2) 不定时主动找你（proactive）：软件开着（含托盘）时，最近聊过的人设在用户长时间没聊后主动发起一条。
//    只在 8:30–23:30；每个人设每天有上限；未回复的主动消息最多 1 条；不刷屏。
// 关键词 / 话题不单独调用模型提取：把用户最近几句实质性的话交给生成调用，让她自己挑一个顺着说（零额外调用）；
// 本地规则只负责判断「有没有值得延伸的内容」（全是嗯/好的/晚安、或刚说去忙/去睡，就不追）。
const { inCrisisQuiet } = require('./memory');
const mood = require('./mood');
const { buildMessages, recentRepeats } = require('./prompt');

const MODES = ['off', 'rare', 'normal'];
const FOLLOW = {
  rare: { prob: 1 / 3, minMs: 40000, maxMs: 180000 },
  normal: { prob: 0.5, minMs: 40000, maxMs: 150000 }
};
const PROACTIVE = {
  rare: { minGapH: 4, maxGapH: 8, dailyCap: 2, personas: 1, recentDays: 7 },
  normal: { minGapH: 2.5, maxGapH: 5, dailyCap: 3, personas: 2, recentDays: 14 }
};
const WINDOW = { start: 8 * 60 + 30, end: 23 * 60 + 30 }; // 本地时间 8:30–23:30
const GLOBAL_SPACING_MS = 90 * 60000; // 不同人设之间的主动消息至少隔 90 分钟
const CARE_DAILY_CAP = 1;            // 危机后安静期：每天最多 1 条温和关心

const mode = (v) => (MODES.includes(v) ? v : 'rare');

const TRIVIAL_RE = /^(?:[嗯恩哦噢喔啊呀哈嘿诶欸好对行是]+|好的|好滴|好哒|好嘞|收到|ok|okk|okay|知道了|知道啦|可以|没事|随便|还行|一般|在|在的|在呢|谢谢|谢啦|拜拜|晚安|早安|早)[~～。！!？?.…呀啊哦呢么嘛]*$/i;
const BYE_RE = /晚安|睡了|睡啦|去睡|睡觉了|先睡|要睡|拜拜|再见|明天见|回头聊|晚点聊|晚点再聊|等会聊|待会聊|一会聊|先忙|去忙|在忙|要忙|先走|先撤|去上班|去上课|去开会|去学习|去自习|去洗澡|下线|别回了|不聊了/;

const lastUserIdx = (h) => { for (let i = h.length - 1; i >= 0; i--) if (h[i].role === 'user') return i; return -1; };
function tail(history) {
  const h = history || [];
  const i = lastUserIdx(h);
  return { i, after: i < 0 ? h.slice() : h.slice(i + 1) };
}
// 用户最后一句之后，她已经主动发过的条数
function unansweredProactive(history) { return tail(history).after.filter((m) => m.role === 'assistant' && m.proactive).length; }

// 用户最近几句「有内容」的话（给生成调用挑话题用）
function topicCandidates(history, n = 3) {
  const out = [];
  for (let i = (history || []).length - 1; i >= 0 && out.length < n; i--) {
    const m = history[i];
    if (m.role !== 'user') continue;
    const s = String(m.content || '').replace(/\s+/g, ' ').trim();
    const core = s.replace(/[\p{P}\p{S}\s]/gu, '');
    if (core.length < 3 || TRIVIAL_RE.test(s)) continue;
    out.push(s.length > 60 ? s.slice(0, 59) + '…' : s);
  }
  return out;
}

function isNegMood(st) { return !!st && ['angry', 'sulky', 'hurt', 'jealous', 'down'].includes(st.emotion); }
function crisisActive(st) { return !!st && ((st.crisisLeft || 0) > 0 || !!st.lastCrisis); }

// 稳定的伪随机：同一个空闲期内每次检查结果一致（不会因为每分钟重抽而「迟早抽中」）
function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

// ---------- 1. 话题延伸追发 ----------
// 在她回复完成后调用；返回 null（不追）或 { delayMs, topics }
function planFollowUp({ settings = {}, history = [], moodState = null, rng = Math.random } = {}) {
  const m = mode(settings.followUp);
  if (m === 'off') return null;
  const cfg = FOLLOW[m];
  const h = history || [];
  const last = h[h.length - 1];
  if (!last || last.role !== 'assistant' || last.proactive || last.partial) return null;
  const { i, after } = tail(h);
  if (i < 0) return null;
  if (after.some((x) => x.proactive)) return null;              // 这一轮已经追过
  if (inCrisisQuiet(moodState) || crisisActive(moodState)) return null; // 危机期间及之后几轮不追
  if (BYE_RE.test(String(h[i].content || ''))) return null;     // 对方说去忙 / 去睡了
  const topics = topicCandidates(h);
  if (!topics.length) return null;
  let prob = cfg.prob;
  if (isNegMood(moodState) && (moodState.intensity || 1) >= 2) prob *= 0.4; // 生闷气时少追
  if (rng() >= prob) return null;
  const delayMs = Math.round(cfg.minMs + rng() * (cfg.maxMs - cfg.minMs));
  return { delayMs, topics };
}

// ---------- 2. 不定时主动找你 ----------
function minutesOf(d) { return d.getHours() * 60 + d.getMinutes(); }
function inWindow(now) { const x = minutesOf(now); return x >= WINDOW.start && x < WINDOW.end; }
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function countToday(pstate, id, now) {
  const e = pstate && pstate.personas && pstate.personas[id];
  return e && e.day === dayKey(now) ? { count: e.count || 0, care: e.care || 0 } : { count: 0, care: 0 };
}
function lastUserTs(history) { const i = lastUserIdx(history || []); return i < 0 ? 0 : Number(history[i].ts) || 0; }

// 最近聊过的人设（按用户最后一条消息时间），最多 n 个
function recentPersonas(histories, n, now, recentDays) {
  const lim = now.getTime() - recentDays * 86400000;
  return Object.entries(histories || {})
    .map(([id, h]) => ({ id, ts: lastUserTs(h) }))
    .filter((x) => x.ts && x.ts >= lim)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, n)
    .map((x) => x.id);
}

function slotOf(now) {
  const x = minutesOf(now);
  if (x < 10 * 60 + 30) return { id: 'morning', text: '早上' };
  if (x < 11 * 60 + 15) return { id: 'forenoon', text: '上午' };
  if (x < 13 * 60 + 30) return { id: 'lunch', text: '中午饭点' };
  if (x < 17 * 60) return { id: 'afternoon', text: '下午' };
  if (x < 19 * 60 + 30) return { id: 'dinner', text: '傍晚饭点' };
  if (x < 22 * 60 + 30) return { id: 'evening', text: '晚上' };
  return { id: 'late', text: '有点晚了，快到睡觉的时候' };
}

// 判断某个人设现在要不要主动发；返回 null 或 { kind: 'chat' | 'care', reason }
function planProactive({ settings = {}, id, history = [], moodState = null, pstate = {}, histories = null, now = new Date() } = {}) {
  const m = mode(settings.proactive);
  if (m === 'off') return null;
  const cfg = PROACTIVE[m];
  if (!inWindow(now)) return null;
  const h = history || [];
  if (!h.length || lastUserIdx(h) < 0) return null;
  if (unansweredProactive(h) >= 1) return null;                    // 她发了你没回：不再继续发
  const recent = recentPersonas(histories || { [id]: h }, cfg.personas, now, cfg.recentDays);
  if (!recent.includes(id)) return null;                           // 只找最近聊过的人设
  const lastAt = Number(h[h.length - 1].ts) || 0;
  const t = now.getTime();
  if (pstate && pstate.lastAny && t - pstate.lastAny < GLOBAL_SPACING_MS) return null;
  const today = countToday(pstate, id, now);
  const care = inCrisisQuiet(moodState) || crisisActive(moodState);
  if (care ? today.care >= CARE_DAILY_CAP : today.count >= cfg.dailyCap) return null;
  // 每个空闲期随机一个间隔（几小时量级），用最后一条消息的时间做种子，保证多次检查结果一致
  const r = hash01(`${id}:${lastAt}`);
  const gapMs = (cfg.minGapH + r * (cfg.maxGapH - cfg.minGapH)) * 3600000;
  if (t - lastAt < gapMs) return null;
  // 生闷气时少发：这个空闲期有一半概率干脆不发
  if (!care && isNegMood(moodState) && (moodState.intensity || 1) >= 2 && hash01(`${id}:${lastAt}:neg`) < 0.5) return null;
  return { kind: care ? 'care' : 'chat', slot: slotOf(now), idleHours: (t - lastAt) / 3600000 };
}

function recordSent(pstate, id, now, kind) {
  const s = { lastAny: 0, personas: {}, ...(pstate || {}) };
  s.personas = { ...(s.personas || {}) };
  const day = dayKey(now);
  const e = s.personas[id] && s.personas[id].day === day ? { ...s.personas[id] } : { day, count: 0, care: 0 };
  if (kind === 'care') e.care = (e.care || 0) + 1; else e.count = (e.count || 0) + 1;
  s.personas[id] = e;
  s.lastAny = now.getTime();
  return s;
}

// ---------- 提示词 ----------
const COMMON = '只输出要发出去的话。像真人在微信上随手发的，短，一到两条短消息（多条用「|||」分开）。不要解释你为什么发这条，不要提「关键词」「话题」「系统」「提醒」这类字眼。不约现实见面，不承诺你做不到的事（比如真的去买、真的到场、打电话）。平时聊天若要求通常 2～4 句，这一条不适用：仍然只发一到两条短消息，不要长篇，不要连着刷。';
const NO_PRESSURE = '对方没回消息很正常：绝对不要催对方回复，不要问「怎么不理我」「在干嘛不回」，不要埋怨、指责、卖惨、讨好或道德绑架，不要让对方有负担。';

function followUpInstruction({ topics = [], moodState = null, persona = null } = {}) {
  const list = topics.map((x) => `「${x}」`).join('、');
  const neg = isNegMood(moodState) ? '你现在还有点小情绪：按【此刻状态】的语气来，可以只别别扭扭地补一句很短的，但不要因为对方没回而更生气。' : '';
  const chimi = persona && persona.id === 'chimi' ? '就算你的人设很黏、很在意对方，这一条也只是轻轻补一句，不纠缠、不追问对方在哪、在跟谁，不说自己去了对方去过的地方或在对方附近徘徊（不能有跟踪的意味）。' : '';
  return `【这一条是你主动补发的】你回完上一条之后，对方有一会儿没说话。你脑子里还转着对方最近说的事：${list}。从里面挑一个具体的东西（一样吃的、一件事、一个地方、一个人或一个说法都行），顺着它自然地再发一条——可以是你由它联想到的自己的小事、一个突然冒出来的念头、或一个轻松的小问题，让人感觉你是真的在想对方说的话。这一条必须和你挑的那个东西有看得出的关联（不能换成和它无关的自己的事），但不用点名说是从哪句话来的。
要求：不要每次都用「你刚才说」「你刚提到」开头，换着来，可以直接说你联想到的东西；不要重复你上一条已经说过的意思；不要总结对方的话。${NO_PRESSURE}${neg}${chimi}${COMMON}
如果实在没有自然可接的，只输出 PASS。`;
}

function proactiveInstruction({ plan, persona = null, moodState = null, lastAt, now = new Date(), memories = [] } = {}) {
  const rel = relGap(now.getTime() - (Number(lastAt) || now.getTime()));
  if (plan && plan.kind === 'care') {
    return `【这一条是你主动发起的，温和关心】你们上次聊是${rel}，对方之前情绪很低落、说过很难受的话。现在你主动发一条温和、平实的关心：问问对方现在怎么样了、有没有好一点，告诉对方想说的时候随时可以跟你说；如果对方还很难受，也可以找身边信任的人，或者打 12356（不要说它一定是 24 小时），有危险就打 110 或 120。不开玩笑、不撒娇、不吃醋、不闹情绪，不拆成多条。${NO_PRESSURE}不约见面。不要按平时聊天那种 2～4 句的闲聊篇幅来写，把关心和求助说清楚就停。只输出要发的话。`;
  }
  const slot = (plan && plan.slot) || slotOf(now);
  const mem = (memories || []).length ? '你记得的关于对方的事里，如果有约定、或者最近要发生 / 刚发生的事（比如考试、面试、出门、生病好没好），可以挑一件自然地问一句；没有合适的就别硬提。' : '';
  const neg = isNegMood(moodState) ? '你现在还有点小情绪（见【此刻状态】）：这条可以发得别扭、很短，像嘴硬地找个借口来说话，但不要提对方没来找你，不要翻旧账，也不要因此更生气。' : '';
  const chimi = persona && persona.id === 'chimi' ? '你的人设很在意对方，但这一条只是一句平常的问候或分享：不纠缠、不查岗、不问对方和谁在一起、不说离不开对方、不暗示自己在对方附近，发完就安心等。' : '';
  return `【这一条是你主动发起的】你们上次聊天是${rel}，之后对方一直没说话（可能在忙，很正常）。现在是${slot.text}。你想主动找对方说点什么，任选一种、自然就好：分享你自己刚遇到的一件小事或一个念头；跟此刻时间段有关的一句（早安、问问吃饭没、晚上问问今天怎么样，但别像客服问候）；或者接着你们上次聊过的东西。${mem}
不要用「好久不见」「你怎么都不找我」这类开场；不要一口气问好几个问题。${NO_PRESSURE}${neg}${chimi}${COMMON}`;
}

function relGap(ms) {
  const h = ms / 3600000;
  if (h < 1) return '刚才';
  if (h < 24) return `${Math.max(1, Math.round(h))} 个小时前`;
  const d = Math.round(h / 24);
  return d <= 1 ? '昨天' : `${d} 天前`;
}

// 用户回来了，而她之前主动发过、用户没回：给这一轮加一条提示，避免她埋怨
const RETURN_NOTE = '你之前主动给对方发过消息，对方隔了一阵才回，这很正常：不要提对方回得晚或没回，不要埋怨、阴阳怪气或讨好，像平常一样接对方现在说的话。';

// 生成结果后处理：PASS / 空 → 不发
function acceptReply(text) {
  const s = String(text || '').replace(/<br\s*\/?>/gi, '|||').replace(/(?:\s*\|\|\|\s*){2,}/g, '|||').replace(/^\s*\|\|\|\s*|\s*\|\|\|\s*$/g, '').trim();
  if (!s || /^PASS[。.!！]?$/i.test(s) || s.length > 400) return null;
  return s.replace(/\s*PASS\s*$/i, '').trim() || null;
}

// 主动消息的请求：平时的系统提示词 + 聊天上下文，末尾再加一条「这一条是你主动发的」系统说明。
// 只读当前情绪（不调用 mood.update）：主动消息不推进情绪，也不会因为没人回而升级。
function buildRequest({ persona, history, settings = {}, kind, topics = [], plan = null, moodState = null, memories = [], now = new Date() }) {
  const care = kind === 'care';
  const hint = care ? '' : mood.hintFor(mood.normalize(moodState, now), mood.traitsOf(persona), false, persona);
  const mems = care ? [] : memories;
  const lastAt = history.length ? history[history.length - 1].ts : now.getTime();
  const instruction = kind === 'followup'
    ? followUpInstruction({ topics, moodState, persona })
    : proactiveInstruction({ plan: plan || { kind: care ? 'care' : 'chat' }, persona, moodState, lastAt, now, memories: mems });
  const messages = buildMessages(persona, history, settings.contextRounds || 12, { nickname: settings.nickname, now, moodHint: hint, memories: mems, avoidPhrases: care ? [] : recentRepeats(persona, history) });
  messages.push({ role: 'system', content: instruction });
  return messages;
}

// 待发追发的定时器：每个人设最多一个；schedule 会顶掉旧的，cancel 用于「用户一说话 / 打字就取消」
function createTimers({ set = setTimeout, clear = clearTimeout } = {}) {
  const map = new Map();
  return {
    schedule(id, delay, fn) { this.cancel(id); map.set(id, set(() => { map.delete(id); fn(); }, delay)); },
    cancel(id) { const t = map.get(id); if (t !== undefined) { clear(t); map.delete(id); return true; } return false; },
    has(id) { return map.has(id); },
    get size() { return map.size; }
  };
}

module.exports = {
  buildRequest, createTimers, MODES, FOLLOW, PROACTIVE, WINDOW, GLOBAL_SPACING_MS, CARE_DAILY_CAP,
  planFollowUp, planProactive, recordSent, recentPersonas, unansweredProactive, topicCandidates, inWindow, slotOf, dayKey,
  followUpInstruction, proactiveInstruction, RETURN_NOTE, acceptReply, hash01, mode, BYE_RE
};
