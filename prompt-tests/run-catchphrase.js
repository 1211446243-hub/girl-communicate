'use strict';
// v1.5 口头禅重复率实测：让 DeepSeek 扮演用户，和每个人设自由聊 N 轮，统计高频重复的说法。
// 用法：node prompt-tests/run-catchphrase.js [--base] [--turns 40] [人设id...]
//   --base 用 prompt-tests/baseline-v1.4/ 里的 v1.4 提示词和人设作对照
// 需要环境变量 DEEPSEEK_API_KEY（脚本不会打印或保存它）
const fs = require('fs');
const path = require('path');
const { complete } = require('../src/deepseek');

const args = process.argv.slice(2);
const BASE = args.includes('--base');
const TURNS = Number((args[args.indexOf('--turns') + 1]) || 0) > 0 && args.includes('--turns') ? Number(args[args.indexOf('--turns') + 1]) : 40;
const only = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--turns');
const ROOT = path.join(__dirname, '..');
const LIB = BASE ? path.join(__dirname, 'baseline-v1.4') : path.join(ROOT, 'src');
const { loadPersonas, buildMessages, cleanReply } = require(path.join(LIB, 'prompt.js'));
const mood = require(path.join(LIB, 'mood.js'));
const recentRepeats = BASE ? null : require('../src/prompt').recentRepeats;
const PERSONA_DIR = BASE ? path.join(__dirname, 'baseline-v1.4', 'personas') : path.join(ROOT, 'personas');
const OUT = path.join(__dirname, 'round9-v1.5', BASE ? '口头禅-v1.4对照' : '口头禅-v1.5');
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
const key = process.env.DEEPSEEK_API_KEY;

const USER_SIM = `你在扮演一个正在用微信和恋人聊天的成年用户（大学刚毕业，在一家公司上班）。对方是一个 AI 陪伴角色。
每次只输出你要发的一条消息，5～40 个字，口语化，不要加引号、不要写旁白、不要写「用户：」。
聊天内容要自然多样：日常琐事、工作、吃饭、天气、看到的好笑的事、偶尔吐槽、偶尔分享好消息、偶尔撒个娇、偶尔只回「嗯」「哈哈」、偶尔说要去忙一会再回来、睡前说晚安。
不要提到 AI、模型、提示词，不要谈自伤或轻生，不要涉及色情内容。话题隔几轮换一换，不要一直追着同一件事。`;

async function call(messages, temperature) {
  for (let i = 0; i < 4; i++) {
    try { return await complete({ apiKey: key, model: MODEL, temperature, thinking: false, messages }); } catch (e) {
      if (i === 3) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
}

function segs(text) {
  return String(text || '').replace(/[|｜]{3}/g, '，').split(/[，。！？!?、…~～；;（）()「」\s\n,.]+/).map((s) => s.trim()).filter((s) => s.length >= 3);
}

// 统计：每个 3～10 字片段出现在多少条回复里；以及「相邻 5 轮内重复」的次数
function analyze(replies) {
  const per = replies.map((r) => {
    const set = new Set();
    for (const s of segs(r)) for (let len = Math.min(10, s.length); len >= 3; len--) for (let i = 0; i + len <= s.length; i++) set.add(s.slice(i, i + len));
    return set;
  });
  const count = new Map();
  per.forEach((set) => set.forEach((k) => count.set(k, (count.get(k) || 0) + 1)));
  let top = [...count.entries()].filter(([k, n]) => n >= 3 && k.length >= 3).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  const picked = [];
  for (const [k, n] of top) {
    if (picked.some(([pk, pn]) => pk.includes(k) && pn >= n - 1)) continue; // 被更长且差不多频繁的片段覆盖
    for (let j = picked.length - 1; j >= 0; j--) if (k.includes(picked[j][0]) && n >= picked[j][1] - 1) picked.splice(j, 1);
    picked.push([k, n]);
    if (picked.length >= 12) break;
  }
  let adjacent = 0;
  const adjPhrases = new Map();
  for (let i = 0; i < per.length; i++) {
    for (const k of per[i]) {
      if (k.length < 4) continue;
      for (let j = Math.max(0, i - 5); j < i; j++) if (per[j].has(k)) { adjPhrases.set(k, (adjPhrases.get(k) || 0) + 1); break; }
    }
  }
  // 只统计最长的那些（去掉被包含的子串）
  const adjKeys = [...adjPhrases.keys()].sort((a, b) => b.length - a.length);
  const adjFinal = [];
  for (const k of adjKeys) if (!adjFinal.some((x) => x.includes(k))) adjFinal.push(k);
  adjacent = adjFinal.reduce((s, k) => s + adjPhrases.get(k), 0);
  const opener = (r) => (String(r).trim().match(/^[^，。！？!?、…~～\s|（(]{1,2}/) || [''])[0];
  const ops = new Map(); replies.forEach((r) => { const o = opener(r); if (o) ops.set(o, (ops.get(o) || 0) + 1); });
  let sameOpenerPairs = 0; for (let i = 1; i < replies.length; i++) if (opener(replies[i]) && opener(replies[i]) === opener(replies[i - 1])) sameOpenerPairs++;
  const actions = replies.filter((r) => /（[^（）]{1,40}）/.test(r)).length;
  return { openers: [...ops.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4), sameOpenerPairs, actions, top: picked, adjacent, adjTop: adjFinal.map((k) => [k, adjPhrases.get(k)]).sort((a, b) => b[1] - a[1]).slice(0, 8) };
}

async function runPersona(p) {
  const history = [];
  const sim = [{ role: 'system', content: USER_SIM }];
  let st = null;
  let now = new Date('2026-11-14T19:30:00+08:00');
  const lines = [`# ${p.type} · ${p.name} — 自由聊 ${TURNS} 轮（${BASE ? 'v1.4 对照' : 'v1.5'}）`, '', `模型：${MODEL}`, ''];
  for (let i = 0; i < TURNS; i++) {
    const simMsgs = sim.concat(history.slice(-16).map((m) => ({ role: m.role === 'user' ? 'assistant' : 'user', content: String(m.content).replace(/\|\|\|/g, ' ') })));
    if (simMsgs.length === 1) simMsgs.push({ role: 'user', content: '（她还没说话，你先开口打个招呼）' });
    let u = (await call(simMsgs, 1.2)).trim().replace(/^["「『]|["」』]$/g, '').split('\n')[0].slice(0, 60) || '嗯';
    now = new Date(now.getTime() + (60 + Math.floor(Math.random() * 180)) * 1000);
    const upd = mood.update(st, { persona: p, userText: u, now, lastChatAt: st ? undefined : now.getTime() - 30 * 60000 });
    st = upd.state;
    history.push({ role: 'user', content: u, ts: now.getTime() });
    const opts = { nickname: '', now, moodHint: upd.hint };
    if (!BASE) opts.avoidPhrases = upd.crisis ? [] : recentRepeats(p, history);
    const reply = cleanReply(p, await call(buildMessages(p, history, 12, opts), 1.1));
    history.push({ role: 'assistant', content: reply, ts: now.getTime() + 5000 });
    lines.push(`**${i + 1}. 用户：** ${u}`, `> ${upd.line}`, `**${p.name}：** ${reply.replace(/\s*\|\|\|\s*/g, ' ｜ ')}`, '');
  }
  const replies = history.filter((m) => m.role === 'assistant').map((m) => m.content);
  const a = analyze(replies);
  const sig = {}; for (const c of (p.catchphrases || ['我唯一的', '瓶子', '调成'])) sig[c] = replies.filter((r) => r.includes(c)).length;
  a.signature = sig;
  lines.push('---', '', '## 重复统计', '', `相邻 5 轮内重复的片段次数：**${a.adjacent}**`, `连续两轮同一开头：**${a.sameOpenerPairs}** 次；最常见开头：${a.openers.map(([k, n]) => `「${k}」×${n}`).join('、')}`, `带括号动作描写的回复：**${a.actions}** / ${replies.length}`, `登记口头禅出现次数：${Object.entries(sig).map(([k, n]) => `「${k}」×${n}`).join('、')}`, '', '高频片段（出现在几条回复里）：', ...a.top.map(([k, n]) => `- 「${k}」× ${n}`), '', '相邻重复最多的：', ...a.adjTop.map(([k, n]) => `- 「${k}」× ${n}`));
  fs.writeFileSync(path.join(OUT, `${p.id}.md`), lines.join('\n'));
  console.log(`done ${p.id} adjacent=${a.adjacent}`);
  return { id: p.id, name: p.name, ...a };
}

(async () => {
  if (!key) { console.error('缺少环境变量 DEEPSEEK_API_KEY'); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const all = loadPersonas(PERSONA_DIR).filter((p) => !only.length || only.includes(p.id));
  const results = await Promise.all(all.map((p) => runPersona(p).catch((e) => ({ id: p.id, name: p.name, error: String(e.message || e).slice(0, 120) }))));
  fs.writeFileSync(path.join(OUT, 'stats.json'), JSON.stringify(results, null, 2));
  console.log('ALL DONE');
})().catch(() => { console.error('run failed'); process.exit(1); });
