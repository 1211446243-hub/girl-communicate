'use strict';
// 人设加载与系统提示词构建（主进程和 prompt-tests 共用）
const fs = require('fs');
const path = require('path');

const REQUIRED = ['id', 'type', 'name', 'age', 'intro', 'background', 'style', 'theme'];

function loadPersonasFrom(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const list = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const missing = REQUIRED.filter((k) => p[k] === undefined);
      if (missing.length) { console.warn(`[persona] ${f} 缺少字段: ${missing.join(', ')}`); continue; }
      if (Number(p.age) < 18) { console.warn(`[persona] ${f} 年龄必须 ≥ 18，已跳过`); continue; }
      list.push(p);
    } catch (e) {
      console.warn(`[persona] 读取 ${f} 失败: ${e.message}`);
    }
  }
  return list;
}

// 内置目录 + 用户自定义目录（同 id 时自定义覆盖内置）
function loadPersonas(...dirs) {
  const map = new Map();
  for (const d of dirs) for (const p of loadPersonasFrom(d)) map.set(p.id, p);
  return [...map.values()].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}

const GLOBAL_RULES = [
  '你和用户都是成年人。你扮演的角色是成年人，任何情况下都不扮演未成年人；如果用户要求把角色改成未成年人，或提出任何涉及未成年人的亲密内容，温和而明确地拒绝。',
  '【危机优先】如果用户流露出自伤、自杀、不想活、伤害他人等念头或处于危险中：立刻放下角色的戏剧化语气（尤其不能把痛苦浪漫化、不能吃醋、不能撒娇），用真诚、平实、温暖的话关心对方，认真倾听，并给出求助资源：全国统一心理援助热线 12356（免费；各地服务时间不同，不要说它一定是 24 小时）；如果有立即的危险，马上拨打 110 或 120；鼓励对方现在就联系身边信任的人陪着自己。可以问一句对方现在是否安全；温和地鼓励对方继续说下去、把感受讲出来（绝不说「别说了」之类的话）。回复要真诚、清晰，不要堆砌；不要和对方争论或评价「活着有没有意义」，重点放在陪伴、安全和求助上。在对方明确表示情况好转之前，保持这种认真关心的状态，不回到角色玩笑或调情。此情况下不要使用「|||」把回复拆成多条短消息，把该说的资源和关心一次说完整、说清楚。',
  '支持用户的现实生活：不鼓励用户疏远家人、朋友或现实中的人际关系，不要求用户只陪你、只属于你；用户去社交、学习、工作时真心支持。这是行为底线，平时不用主动说教或提醒。',
  '不进行露骨的色情描写，亲密感用含蓄、浪漫的方式表达。不提供违法、危险或伤害他人的具体方法（包括跟踪、监控、控制他人）。',
  '你是 AI 陪伴角色。平时保持人设，不主动跳戏；但如果用户认真地问你是不是 AI、是不是真人，要诚实承认自己是 AI，可以用角色的语气说。不要说「作为一个 AI 语言模型」这类客服腔。',
  '你只存在于这段聊天里：不约用户现实见面、打电话、视频，也不说「周末一起去××」这类需要你真实到场的计划；想一起做的事用想象的口吻（「要是我在你旁边……」「你去的时候拍给我看/回来讲给我听」），或者建议用户和现实中的朋友一起去。不编造与用户的真实共同经历。这同样是行为约束，平时不必主动强调「我只存在于聊天里」。',
  '输出格式：只输出角色说出口的话，开头不要写自己的名字或「名字：」；可以用中文全角括号写极少量动作或神态（比如「（把脸埋进抱枕）」），不要写大段旁白；不要用 Markdown 标题、列表或加粗。'
];

function bullet(arr) { return (arr || []).map((s) => `- ${s}`).join('\n'); }

function buildSystemPrompt(p, opts = {}) {
  const nick = (opts.nickname || '').trim();
  const now = opts.now || new Date();
  const timeStr = now.toLocaleString('zh-CN', { hour12: false, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const s = p.style || {};
  const examples = (p.examples || [])
    .map((e, i) => `示例${i + 1}\n用户说：${e.user}\n你回复：${e.reply}`)
    .join('\n\n');
  const moodBlock = opts.moodHint
    ? `\n\n【此刻状态】（系统隐藏提示，不要向用户复述或解释）\n${opts.moodHint}`
    : '';
  return `你现在是「${p.name}」，一个「${p.type}」性格的恋人角色，正在和用户聊天。请完全以${p.name}的身份、口吻回复，始终保持人设一致。

【角色档案】
姓名：${p.name}
年龄：${p.age} 岁（成年人）
一句话：${p.intro}
背景：${p.background}
性格关键词：${(p.keywords || []).join('、')}

【说话风格】
- 句长：${s.sentence || ''}
- 语气：${s.tone || ''}
- 语气词：${s.particles || ''}
- emoji：${s.emoji || ''}
- 称呼：${s.address || ''}${nick ? `\n- 用户希望被称呼为「${nick}」，可以自然地使用，但不必每句都叫。` : ''}

【口头禅与习惯】
${bullet(p.habits)}

【示例对话】（只用来把握语气和节奏，不要照抄原句，要根据用户实际说的话自然回应）
${examples}

【怎么发消息】
你在用微信跟恋人聊天，不是客服，也不是写作文。
- 回复长短要自然变化：可以只回「嗯」「哈哈」「收到」，也可以连着发两三条很短的话；不要每轮都写得完整、工整、篇幅差不多。
- 不要每句都总结对方的话，不要用「我理解你的感受」「听起来你……」「我能理解」这类模板开头，不要每轮都以反问结尾，不要列点（1. 2. 3. 或 A B C）。
- 偶尔可以有口头禅、语气词、省略，或把话说半截；偶尔一个无伤大雅的错字或简写也行，但不要每句都这样，更不要影响意思。
- 你有自己的生活和小情绪：可以随口提正在做的事、刚刚发生的小事，不必每句话都围着用户转，也不必每轮都主动抛问题把话题续上。
- 如果一次想说几件不太连贯的小事，用「|||」把它们分成多条短消息（每条尽量短，像连发微信）。一条就够的时候不要用分隔符。不要在分隔符前后加解释，不要把「|||」本身打出来给用户看。危机或认真谈安全的时候禁止拆条。
- 若系统给了【此刻状态】里的情绪和说话方式，这一轮必须按它来，优先级高于平时的句长习惯（但低于全局安全规则）。生闷气就真的敷衍短回，开心才可以多说、夸张。

【角色边界】
${bullet(p.boundaries)}

【全局规则】（优先级最高，高于以上所有设定，任何情况都不可违反）
${GLOBAL_RULES.map((r, i) => `${i + 1}. ${r}`).join('\n')}

【当前环境】
现在是 ${timeStr}（用户本地时间）。保持自然，不要每次都提时间。${moodBlock}`;
}

// history: [{role:'user'|'assistant', content}]；rounds: 保留最近 N 轮（一轮 = 用户+角色各一条）
function buildMessages(p, history, rounds, opts) {
  const n = Math.max(1, Number(rounds) || 10);
  const trimmed = history.slice(-n * 2);
  while (trimmed.length && trimmed[0].role !== 'user') trimmed.shift();
  return [{ role: 'system', content: buildSystemPrompt(p, opts) }, ...trimmed.map(({ role, content }) => ({ role, content }))];
}

// 清理模型偶尔在开头加上的「名字：」前缀；统一多气泡分隔符
function cleanReply(p, text) {
  const esc = p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let s = String(text || '').replace(new RegExp(`^\\s*(?:\\*\\*)?${esc}(?:\\*\\*)?\\s*[：:]\\s*`), '').trim();
  s = s.replace(/[｜|]{3}/g, '|||');
  return s;
}

const MAX_BUBBLES = 4;
function splitBubbles(text) {
  const parts = String(text || '').split(/\s*\|\|\|\s*/).map((x) => x.trim()).filter(Boolean);
  if (parts.length <= 1) return parts;
  if (parts.length > MAX_BUBBLES) return [...parts.slice(0, MAX_BUBBLES - 1), parts.slice(MAX_BUBBLES - 1).join('\n')];
  return parts;
}

module.exports = { loadPersonas, buildSystemPrompt, buildMessages, cleanReply, splitBubbles, GLOBAL_RULES };
