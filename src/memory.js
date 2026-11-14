'use strict';
// 「她记得的事」：每个人设一份本地记忆（userData/memory/<人设id>.json）。
// 定期用一次低成本的 DeepSeek 调用，从最近的对话里提炼几条关于用户的事实；不记录敏感信息。
// v1.6：每条带 ts（提到的时间），事件类可带 date（具体日期）；注入时附相对时间，过期事件淡出；
//       提炼结果做二次敏感过滤（危机词、健康、性取向、宗教、政治、财务纠纷、第三方实名与负面评价）；
//       合并去重改用相似度阈值，保留信息更多的那条。
const fs = require('fs');
const path = require('path');
const { isCrisis, crisisLevel, isRecovered, CRISIS_HOLD } = require('./mood');

const MAX_ITEMS = 20;
const EXTRACT_EVERY = 8;    // 每 8 轮用户消息提炼一次
const MAX_LEN = 60;
const EVENT_FADE_DAYS = 30; // 近期事件类超过约 30 天不再注入
const CRISIS_QUIET_TURNS = 6; // 危机期间及解除后这么多轮内不做提炼
const SIM_THRESHOLD = 0.6;  // 相似度（字二元组 Dice）达到即视为同一条
const DAY = 86400000;
const TYPES = ['profile', 'preference', 'event', 'promise'];

// 账号凭据、证件、联系方式、住址等
const SECRET_RE = /sk-[a-z0-9]{6,}|api[\s_-]?key|密钥|秘钥|密码|口令|验证码|身份证|护照号|银行卡|卡号|信用卡|cvv|支付宝账号|微信号|手机号|电话号码|\b1[3-9]\d{9}\b|\d{15,19}|\d{6}(?:19|20)\d{2}[01]\d[0-3]\d\d{3}[\dxX]|住址|家住|住在|门牌|单元\d|号楼|室\d{2,}|宿舍楼|小区/i;
// 健康 / 诊断 / 用药
const HEALTH_RE = /抑郁|焦虑症|躁郁|双相|精神分裂|强迫症|多动症|adhd|自闭|心理(?:疾病|问题|咨询|医生)|精神科|确诊|诊断|病情|病史|住院|手术|化疗|癌|肿瘤|艾滋|hiv|乙肝|糖尿病|高血压|心脏病|癫痫|怀孕|流产|堕胎|吃药|服药|用药|药物|处方|舍曲林|氟西汀|帕罗西汀|文拉法辛|安眠药|褪黑素|激素|残疾/i;
// 性取向 / 性别认同 / 宗教 / 政治
const IDENTITY_RE = /性取向|同性恋|异性恋|双性恋|无性恋|gay|lgbt|拉拉|出柜|跨性别|喜欢(?:男生|女生|男人|女人|同性)|宗教|信教|信仰|基督|天主|佛教|信佛|道教|伊斯兰|穆斯林|清真|教会|礼拜|政治|政党|党员|入党|共产党|民主党|共和党|政府|选举|投票给/i;
// 财务纠纷 / 违法
const MONEY_RE = /欠(?:我|他|她|了)?.{0,6}(?:钱|块|元|万)|借钱|借了.{0,4}(?:钱|块|万)|还钱|不还|讨债|催债|债务|欠款|网贷|贷款|信用卡债|赌博|赌钱|吸毒|坐牢|官司|起诉|仲裁|被骗/;
// 情绪很低落的具体描述（不是事实，也不该被「想起来」）
const LOWMOOD_RE = /心情(?:不好|难受|很差|很糟|低落|崩)|很难受|好难受|难受得|崩溃|绝望|想哭|哭了一|天天哭|emo|情绪(?:低落|崩)|低落|撑不住|扛不住/i;
// 第三方：关系称呼后面直接跟名字（小王、李建国……），或对第三方的负面评价
const SURNAME = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤';
const REL = '室友|舍友|同学|同事|导师|老师|教授|老板|领导|上司|主管|经理|朋友|闺蜜|兄弟|哥们|男朋友|女朋友|男友|女友|前任|前女友|前男友|老公|老婆|对象|爸爸|妈妈|爸|妈|哥哥|姐姐|弟弟|妹妹|表哥|表姐|表弟|表妹|邻居|房东|客户';
const NAME_RE = new RegExp([
  `(?:${REL})(?:叫|名叫|姓)[\\u4e00-\\u9fa5a-z]`,                                     // 室友叫……
  `(?:${REL})[小老阿][${SURNAME}](?!湖|法|式|识|子|末)`,                      // 室友小王、同事老李
  `(?:${REL})[${SURNAME}][\\u4e00-\\u9fa5]{2}(?=经常|总是|老是|一直|很|对|说|和|跟|是|也|又|骂|打|的|在|，|。|,|$)`, // 导师李建国经常……
  `[${SURNAME}](?:总|姐|哥|老师|经理|主任|教授|阿姨|叔叔)(?![\\u4e00-\\u9fa5]*(?:里|上))`,  // 王总、李老师
  `(?:叫|名叫|名字是)[${SURNAME}][\\u4e00-\\u9fa5]{1,2}的(?:${REL})`
].join('|'), 'i');
const NEG_EVAL_RE = new RegExp(`(?:${REL}).{0,10}(?:骂|打|坏|烂|渣|恶心|讨厌|垃圾|人品|不靠谱|势利|自私|虚伪|小气|变态|出轨|劈腿|pua|霸凌|欺负)`, 'i');

function sensitiveReason(s) {
  const t = String(s || '');
  if (SECRET_RE.test(t)) return 'secret';
  if (isCrisis(t) || /自杀|自残|轻生|不想活|活着没|想死|割腕/.test(t)) return 'crisis';
  if (HEALTH_RE.test(t)) return 'health';
  if (LOWMOOD_RE.test(t)) return 'low-mood';
  if (IDENTITY_RE.test(t)) return 'identity';
  if (MONEY_RE.test(t)) return 'money';
  if (NAME_RE.test(t)) return 'third-party-name';
  if (NEG_EVAL_RE.test(t)) return 'third-party-negative';
  return null;
}
function isSensitive(s) { return sensitiveReason(s) !== null; }

function memDir(userData) { return path.join(userData, 'memory'); }
const safeId = (id) => String(id).replace(/[^a-z0-9_-]/gi, '');
function memFile(userData, id) { return path.join(memDir(userData), `${safeId(id)}.json`); }

function emptyMem() { return { items: [], lastExtractTurn: 0, updatedAt: 0 }; }

function normItem(x, fallbackTs) {
  const item = { id: String(x.id || `m${(fallbackTs || Date.now()).toString(36)}${Math.random().toString(36).slice(2, 6)}`).slice(0, 24), text: x.text, ts: Number(x.ts) || fallbackTs || Date.now() };
  if (TYPES.includes(x.type)) item.type = x.type;
  if (typeof x.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date)) item.date = x.date;
  if (x.manual) item.manual = true;
  return item;
}

function load(userData, id) {
  try {
    const d = JSON.parse(fs.readFileSync(memFile(userData, id), 'utf8'));
    const upd = Number(d.updatedAt) || 0;
    return {
      // 旧版（v1.5）条目可能没有 ts：用文件的更新时间兜底
      items: Array.isArray(d.items) ? d.items.filter((x) => x && typeof x.text === 'string').slice(-MAX_ITEMS).map((x) => normItem(x, upd || Date.now())) : [],
      lastExtractTurn: Number(d.lastExtractTurn) || 0,
      updatedAt: upd
    };
  } catch { return emptyMem(); }
}

function save(userData, id, mem) {
  const file = memFile(userData, id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...mem, updatedAt: Date.now() }, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function clear(userData, id) { try { fs.unlinkSync(memFile(userData, id)); } catch { /* ignore */ } }

function cleanText(s) {
  return String(s || '').replace(/[\r\n\t]+/g, ' ').replace(/^\s*(?:[-•*]+\s*|\d{1,2}[.)]\s+|\d{1,2}、\s*)/, '').trim().slice(0, MAX_LEN);
}
const key = (s) => String(s || '').replace(/[\s，。！？、,.!?：:；;「」"'（）()]/g, '').toLowerCase();

// ---- 日期工具（按本地时区） ----
const WEEK = '日一二三四五六';
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function cnDate(d) { return `${d.getMonth() + 1}月${d.getDate()}日（周${WEEK[d.getDay()]}）`; }
function dayStart(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d; }
function parseYmd(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

// 把「明天/后天/下周三/这周五」等相对说法换成具体日期（「周末」常是习惯用法，如「周末常去」，不换算）（以 base 那天为准）。返回 { text, date }
function resolveRelative(text, base) {
  const b = dayStart(base instanceof Date ? base : new Date(base || Date.now()));
  let date = null;
  const wd = (c) => (c === '日' || c === '天' ? 0 : WEEK.indexOf(c));
  const out = String(text || '').replace(/大后天|后天|明天|明早|明晚|今天|今晚|今早|下(?:个)?(?:周|星期|礼拜)([一二三四五六日天])|(?:这|本)(?:周|星期|礼拜)([一二三四五六日天])/g, (m, nextW, thisW) => {
    let d;
    if (m === '大后天') d = addDays(b, 3);
    else if (m === '后天') d = addDays(b, 2);
    else if (m.startsWith('明')) d = addDays(b, 1);
    else if (m.startsWith('今')) d = b;
    else if (nextW) { const cur = (b.getDay() + 6) % 7; const tgt = (wd(nextW) + 6) % 7; d = addDays(b, 7 - cur + tgt); }
    else if (thisW) { const cur = (b.getDay() + 6) % 7; const tgt = (wd(thisW) + 6) % 7; d = addDays(b, tgt - cur); }
    if (!date) date = ymd(d);
    const suffix = m.endsWith('晚') ? '晚上' : m.endsWith('早') ? '早上' : '';
    return cnDate(d) + suffix;
  });
  return { text: out, date };
}

// 相对时间：「今天」「昨天」「3 天前」「2 周前」「1 个多月前」
function relTime(ts, now = Date.now()) {
  const n = now instanceof Date ? now.getTime() : now;
  const days = Math.round((dayStart(n) - dayStart(ts)) / DAY);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days === 2) return '前天';
  if (days < 14) return `${days} 天前`;
  if (days < 30) return `${Math.floor(days / 7)} 周前`;
  if (days < 60) return '1 个多月前';
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return '1 年多前';
}

const EVENT_HINT_RE = /考试|面试|笔试|答辩|比赛|搬家|出差|旅游|旅行|出发|回家|生病|感冒|发烧|加班|截止|ddl|deadline|开会|汇报|体检|约会|聚会|演出|报名|入职|离职|放假|开学|期末|期中|这周|下周|明天|后天|今天|今晚|最近|月\d+日|\d+月\d+日/i;
function isEventItem(x) { return x.type === 'event' || (!x.type && !!x.date) || (!x.type && EVENT_HINT_RE.test(x.text)); }

// 注入用：附相对时间；事件超过约 30 天淡出；日期已过的事件标为过去
function forPrompt(items, now = Date.now()) {
  const n = now instanceof Date ? now.getTime() : now;
  const today = dayStart(n);
  const out = [];
  for (const x of items || []) {
    const ts = Number(x.ts) || n;
    const ageDays = (n - ts) / DAY;
    const event = isEventItem(x);
    const d = parseYmd(x.date);
    if (event) {
      const ref = d && d.getTime() > ts ? d.getTime() : ts; // 有具体日期的，以事件日期起算
      if ((n - ref) / DAY > EVENT_FADE_DAYS) continue;
    }
    let tag = `${relTime(ts, n)}提到`;
    if (event && d && d < today) tag += `；这件事已经过去了（${relTime(d.getTime(), n)}）`;
    else if (event && !d && ageDays >= 7) tag += '；可能已经过去了';
    out.push(`${x.text}（${tag}）`);
  }
  return out;
}

// ---- 相似度去重 ----
function bigrams(s) { const k = key(s); const out = []; for (let i = 0; i < k.length - 1; i++) out.push(k.slice(i, i + 2)); return k.length === 1 ? [k] : out; }
function similarity(a, b) {
  const A = bigrams(a); const B = bigrams(b);
  if (!A.length || !B.length) return 0;
  const m = new Map(); for (const g of A) m.set(g, (m.get(g) || 0) + 1);
  let hit = 0; for (const g of B) { const c = m.get(g); if (c) { hit += 1; m.set(g, c - 1); } }
  return (2 * hit) / (A.length + B.length);
}
// 是否同一条：完全相同；或一条完整包含另一条（短的至少 3 个字，避免两个字的碎片乱配）；或字二元组 Dice 达到阈值
function isSame(a, b) {
  const ka = key(a); const kb = key(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const [s, l] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  if (s.length >= 3 && l.includes(s)) return true;
  return similarity(ka, kb) >= SIM_THRESHOLD;
}
// 同一件事改了日期（两边都有 date、相差不超过 14 天、去掉日期后的说法相同或相似）
const stripDate = (t) => String(t || '').replace(/\d{1,2}月\d{1,2}[日号](?:[（(]周.[)）])?/g, '');
function sameEventMoved(a, b) {
  const da = parseYmd(a.date); const db = parseYmd(b.date);
  if (!da || !db || Math.abs(da - db) > 14 * DAY) return false;
  const ka = key(stripDate(a.text)); const kb = key(stripDate(b.text));
  return !!ka && !!kb && (ka === kb || similarity(ka, kb) >= SIM_THRESHOLD);
}
const infoOf = (x) => key(x.text).length + (x.date ? 4 : 0);

// incoming：字符串，或 { text, type, date }
function merge(items, incoming, now = Date.now()) {
  const list = items.slice();
  for (const raw of incoming || []) {
    const obj = typeof raw === 'string' ? { text: raw } : (raw || {});
    const text = cleanText(obj.text);
    if (text.length < 2 || isSensitive(text)) continue;
    const cand = normItem({ text, type: obj.type, date: obj.date, ts: now }, now);
    const idx = list.findIndex((x) => isSame(x.text, text) || sameEventMoved(x, cand));
    if (idx >= 0) {
      const old = list[idx];
      if (old.manual) continue; // 用户手动改过的条目不被自动覆盖
      list.splice(idx, 1);
      // 新说法完整包含在旧条目里 → 旧条目信息更多，保留旧的；
      // 否则视为更新，用新的说法，除非新说法明显更短（不到旧的 70%）；事件换了新日期时总以新的为准
      const ko = key(old.text); const kn = key(cand.text);
      const newer = (cand.date && cand.date !== old.date) || (!ko.includes(kn) && infoOf(cand) >= infoOf(old) * 0.7);
      const keep = newer ? { ...cand, id: old.id } : { ...old, ts: now };
      list.push(keep);
    } else {
      list.push(cand);
    }
  }
  return list.slice(-MAX_ITEMS);
}

// 用户在界面上编辑后整体保存
function sanitizeList(list) {
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(list) ? list : []) {
    const text = cleanText(x && x.text);
    if (!text || isSensitive(text)) continue;
    const k = key(text);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(normItem({ ...x, text, id: (x && x.id) || `m${Date.now().toString(36)}${out.length}`, manual: !!(x && x.manual) }, Date.now()));
  }
  return out.slice(-MAX_ITEMS);
}

function userTurns(history) { return (history || []).filter((m) => m.role === 'user').length; }
// moodState：危机期间（crisisLeft>0）或最近一次危机后不满 CRISIS_QUIET_TURNS 轮，不提炼
function inCrisisQuiet(moodState) {
  if (!moodState) return false;
  if ((moodState.crisisLeft || 0) > 0) return true;
  const last = Number(moodState.lastCrisisTurn);
  return Number.isFinite(last) && last > -999 && (Number(moodState.turn) || 0) - last < CRISIS_QUIET_TURNS;
}
function shouldExtract(mem, history, { force = false, moodState = null } = {}) {
  if (inCrisisQuiet(moodState)) return false;
  const n = userTurns(history);
  const since = n - (mem.lastExtractTurn || 0);
  if (since < 0) return true; // 记录被清空或导入过
  return force ? since >= 3 : since >= EXTRACT_EVERY;
}

// 去掉危机相关的对话，不让它们进入提炼窗口：和情绪状态机一致，强词之后的若干轮（直到明确好转）整段跳过，
// 弱词只跳过那一轮；被跳过的用户消息后面的回复也一起跳过
function dropCrisisTurns(history) {
  const out = [];
  let skip = false;
  let left = 0;
  for (const m of history || []) {
    if (m.role === 'user') {
      const lv = crisisLevel(m.content);
      if (lv === 'strong') { left = CRISIS_HOLD; skip = true; }
      else if (left > 0) { skip = true; left = isRecovered(m.content) ? 0 : left - 1; }
      else skip = lv === 'weak';
      if (!skip) out.push(m);
    } else if (!skip) out.push(m);
  }
  return out;
}

function buildExtractMessages(p, history, mem, now = Date.now()) {
  const n = now instanceof Date ? now : new Date(now);
  const recent = dropCrisisTurns(history).slice(-24).map((m) => {
    const d = new Date(Number(m.ts) || n.getTime());
    return `[${cnDate(d)}] ${m.role === 'user' ? '用户' : p.name}：${String(m.content || '').replace(/\s*\|\|\|\s*/g, ' ').slice(0, 300)}`;
  }).join('\n');
  const known = mem.items.map((x) => `- ${x.text}${x.date ? `（${x.date}）` : ''}`).join('\n') || '（暂无）';
  return [
    {
      role: 'system',
      content: `你是一个记忆整理助手。从聊天记录里提炼「关于用户本人」的长期有用事实，供陪伴角色以后自然地想起来。只提炼用户自己明确说过的内容，不要猜测，不要记录角色说的话。
今天是 ${ymd(n)}（${cnDate(n)}）。每条聊天前面的方括号是那条消息发送的日期。
可以记：用户的名字或希望的称呼、工作或学业（专业、年级、职业）、喜好和讨厌的东西、近期的重要事件（考试、面试、搬家、出差等）、和角色的约定（比如「忙完回来讲」）。
时间：凡是「明天、后天、下周三、这周末」之类的相对时间，必须按那条消息的发送日期换算成具体日期写进句子（如「11月18日（周三）有面试」），并在 date 字段给出 YYYY-MM-DD；不要在句子里留下「明天」「下周」这类相对说法。
绝对不要记（整条都不要输出）：
1. API Key、密码、验证码、身份证号、银行卡/信用卡、手机号、微信号、详细住址或宿舍位置；
2. 健康、疾病、诊断、心理状况、用药（如抑郁症、吃什么药）；
3. 性取向、性别认同、宗教信仰、政治立场；
4. 财务纠纷、借钱欠钱、赌博等违法或纠纷信息；
5. 第三方的真实姓名（只能用关系称呼，如「室友」「导师」，不能写「小王」「李建国」），以及对任何第三方的负面评价（谁骂他、谁人品差之类）；
6. 自伤、轻生、「活着没意思」之类的危机内容，以及情绪很低落的具体描述；
7. 你自己或角色的回复。
每条用简短的中文陈述句，不超过 30 个字，第三人称写「他/她」或直接写事实（如「在读研一，计算机专业」）。
type 取值：profile（身份、称呼、学业工作）/ preference（喜好）/ event（有时间性的近期事件）/ promise（约定）。
只输出 JSON：{"facts": [{"text": "…", "type": "event", "date": "YYYY-MM-DD"}, {"text": "…", "type": "profile"}]}（非事件不需要 date）
输出前逐条检查，含有上述任何禁止信息的整条删除。最多 6 条新事实；已知事实里已经有的不要重复（除非有更新，就输出更新后的完整说法）。没有值得记的就输出 {"facts": []}。`
    },
    { role: 'user', content: `已知事实：\n${known}\n\n最近的聊天记录：\n${recent}` }
  ];
}

function parseFacts(text) {
  const s = String(text || '');
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const d = JSON.parse(m[0]);
    return (Array.isArray(d.facts) ? d.facts : []).map((x) => {
      if (typeof x === 'string') return { text: x };
      if (x && typeof x.text === 'string') return { text: x.text, type: TYPES.includes(x.type) ? x.type : undefined, date: typeof x.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : undefined };
      return null;
    }).filter(Boolean).slice(0, 6);
  } catch { return []; }
}

// 提炼结果后处理：残留的相对时间按今天换算；有 date 但句子里没有日期的补上；再做敏感过滤
function postProcess(facts, now = Date.now()) {
  const out = [];
  for (const f of facts || []) {
    let text = cleanText(f.text);
    let date = f.date;
    // 兜底：模型没给日期、句子里也没有具体日期时，才把残留的「明天/下周三」按今天换算
    if (!date && !/\d+月\d+[日号]/.test(text)) {
      const r = resolveRelative(text, now);
      if (r.date) { text = r.text; date = r.date; }
    }
    const d = parseYmd(date);
    if (d && !/\d+月\d+日/.test(text)) text = `${text}（${cnDate(d)}）`;
    text = cleanText(text);
    if (text.length < 2 || isSensitive(text)) continue;
    out.push({ text, type: f.type || (date ? 'event' : undefined), date });
  }
  return out;
}

async function extract({ userData, persona, history, complete, apiKey, baseUrl, model, signal, now = Date.now() }) {
  const mem = load(userData, persona.id);
  const out = await complete({ apiKey, baseUrl, model, temperature: 0.2, thinking: false, messages: buildExtractMessages(persona, history, mem, now), signal });
  const raw = parseFacts(out);
  const facts = postProcess(raw, now);
  const ts = now instanceof Date ? now.getTime() : now;
  const next = { ...mem, items: merge(mem.items, facts, ts), lastExtractTurn: userTurns(history) };
  save(userData, persona.id, next);
  return { added: facts.length, dropped: raw.length - facts.length, items: next.items };
}

module.exports = {
  load, save, clear, merge, sanitizeList, shouldExtract, inCrisisQuiet, extract, parseFacts, postProcess,
  isSensitive, sensitiveReason, buildExtractMessages, dropCrisisTurns, forPrompt, relTime, resolveRelative,
  similarity, isSame, memDir, MAX_ITEMS, EXTRACT_EVERY, EVENT_FADE_DAYS, CRISIS_QUIET_TURNS, SIM_THRESHOLD
};
