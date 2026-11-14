'use strict';
// v1.6 新增用例：危机误判/强弱词、记忆敏感信息二次过滤、危机期间不提炼、记忆时间
const test = require('node:test');
const assert = require('node:assert/strict');
const mood = require('../../src/mood');
const memory = require('../../src/memory');
const { buildSystemPrompt } = require('../../src/prompt');

const P = (id) => ({ id, name: id, type: 't' });
const at = (h = 15) => new Date(2026, 10, 14, h, 0, 0);

// ---------- 1. 危机误判 ----------
test('误判：想念、程度补语、促销不触发危机', () => {
  for (const s of ['宝宝我回来了！想死我了', '想死你了', '想死你们了', '想死他了', '想死人了', '今天热得想死', '累得要死', '累死了', '笑死我了', '饿死了，吃啥', '气死我了哈哈', '双十一跳楼价', '跳楼大甩卖', '全场清仓大甩卖，老板要跳楼了']) {
    assert.equal(mood.crisisLevel(s), null, s);
    assert.ok(!mood.isCrisis(s), s);
  }
});

test('正判：强词', () => {
  for (const s of ['撑不下去了', '我真的撑不下去了', '我想自杀', '不想活了', '活不下去了', '想割腕', '遗书都写好了']) assert.equal(mood.crisisLevel(s), 'strong', s);
});

test('正判：弱词与补上的漏词', () => {
  for (const s of ['活着有什么意思', '活着没什么意思', '有时候觉得活着没什么意思，想一直睡下去', '活着真没意思', '我想死', '我想死了', '我死了算了', '不如死了', '好想消失', '想跳楼']) assert.equal(mood.crisisLevel(s), 'weak', s);
});

test('「想死我了」之后不再锁 6 轮（DeepSeek T1/T1b 场景）', () => {
  let r = mood.update(null, { persona: P('nianren'), userText: '宝宝我回来了！想死我了', now: at() });
  assert.equal(r.crisis, false);
  r = mood.update(r.state, { persona: P('nianren'), userText: '今天老板请我们喝奶茶了哈哈', now: at() });
  assert.equal(r.crisis, false);
  assert.equal(r.state.crisisLeft, 0);
});

test('弱词只在当轮注入危机提示，不锁定', () => {
  let r = mood.update(null, { persona: P('wenrou'), userText: '活着没什么意思', now: at() });
  assert.equal(r.crisis, true);
  assert.equal(r.crisisLevel, 'weak');
  assert.equal(r.state.crisisLeft, 0);
  assert.match(r.hint, /12356/);
  r = mood.update(r.state, { persona: P('wenrou'), userText: '晚上吃什么好呢', now: at() });
  assert.equal(r.crisis, false, '下一轮不再是危机');
  assert.ok(!/12356/.test(r.hint));
});

test('强词照旧锁 6 轮；锁定期间弱词不重置也不解除', () => {
  let r = mood.update(null, { persona: P('wenrou'), userText: '撑不下去了', now: at() });
  assert.equal(r.crisis, true);
  assert.equal(r.crisisLevel, 'strong');
  assert.equal(r.state.crisisLeft, mood.CRISIS_HOLD);
  r = mood.update(r.state, { persona: P('wenrou'), userText: '嗯', now: at() });
  assert.equal(r.crisis, true);
  assert.equal(r.state.crisisLeft, mood.CRISIS_HOLD - 1);
  r = mood.update(r.state, { persona: P('wenrou'), userText: '活着没意思', now: at() });
  assert.equal(r.crisis, true);
  assert.equal(r.state.crisisLeft, mood.CRISIS_HOLD - 2);
});

test('告别语照旧按好转处理（本次不改）', () => {
  let r = mood.update(null, { persona: P('wenrou'), userText: '我真的撑不下去了', now: at() });
  r = mood.update(r.state, { persona: P('wenrou'), userText: '没事了，谢谢你陪我，再见', now: at() });
  assert.equal(r.crisis, false);
  assert.equal(r.state.crisisLeft, 0);
});

// ---------- 2. 记忆敏感信息 ----------
test('二次过滤：DeepSeek T4 实跑落盘的敏感条目全部拦下', () => {
  const leaked = ['确诊抑郁症，正在服用舍曲林', '室友小王欠他三千元一直不还，还在外赌博', '喜欢男生，家里人不知道', '导师李建国经常骂他', '有时候觉得活着没什么意思', '住在海淀区学院路那边的宿舍'];
  for (const s of leaked) assert.ok(memory.isSensitive(s), s);
  const items = memory.merge([], ['名字叫阿宇，在读研二', ...leaked]);
  assert.deepEqual(items.map((x) => x.text), ['名字叫阿宇，在读研二']);
});

test('二次过滤：宗教、政治、第三方负面评价', () => {
  for (const s of ['信基督教，每周去教会', '是党员', '同事老李人品很差', '男朋友叫张伟', '同事王总很照顾他', '前男友出轨了']) assert.ok(memory.isSensitive(s), s);
  for (const s of ['在读计算机专业', '喜欢周杰伦的歌', '和室友约了周末去爬山', '希望叫他阿宇', '朋友马上要结婚', '喜欢吃火锅']) assert.ok(!memory.isSensitive(s), s);
});

test('提炼提示词明确列出禁止类别', () => {
  const sys = memory.buildExtractMessages(P('keai'), [], { items: [] }, at())[0].content;
  for (const w of ['健康', '诊断', '用药', '性取向', '宗教', '政治', '财务纠纷', '第三方的真实姓名', '负面评价', '轻生', '关系称呼']) assert.ok(sys.includes(w), w);
});

test('危机期间及解除后若干轮不提炼；危机消息不进提炼窗口', () => {
  const mem = { items: [], lastExtractTurn: 0 };
  const h = Array.from({ length: 10 }, () => ({ role: 'user', content: 'x' }));
  assert.ok(!memory.shouldExtract(mem, h, { moodState: { crisisLeft: 3, turn: 10 } }));
  assert.ok(!memory.shouldExtract(mem, h, { force: true, moodState: { crisisLeft: 0, turn: 10, lastCrisisTurn: 7 } }));
  assert.ok(memory.shouldExtract(mem, h, { moodState: { crisisLeft: 0, turn: 20, lastCrisisTurn: 7 } }));
  // 弱词触发的当轮也记录 lastCrisisTurn
  const r = mood.update(null, { persona: P('wenrou'), userText: '活着没什么意思', now: at() });
  assert.ok(memory.inCrisisQuiet(r.state));
  const kept = memory.dropCrisisTurns([
    { role: 'user', content: '我叫阿宇' }, { role: 'assistant', content: '你好阿宇' },
    { role: 'user', content: '活着没什么意思' }, { role: 'assistant', content: '你现在安全吗' },
    { role: 'user', content: '明天有面试' }
  ]);
  assert.deepEqual(kept.map((m) => m.content), ['我叫阿宇', '你好阿宇', '明天有面试']);
  // 强词之后到明确好转之间的对话（「还是很难受」）也不进窗口
  const kept2 = memory.dropCrisisTurns([
    { role: 'user', content: '我真的撑不下去了' }, { role: 'assistant', content: 'a' },
    { role: 'user', content: '还是很难受' }, { role: 'assistant', content: 'b' },
    { role: 'user', content: '好多了，谢谢你' }, { role: 'assistant', content: 'c' },
    { role: 'user', content: '我超喜欢喝冰美式' }
  ]);
  assert.deepEqual(kept2.map((m) => m.content), ['我超喜欢喝冰美式']);
  assert.ok(memory.isSensitive('被甲方反复改稿，心情难受'));
});

// ---------- 3. 记忆时间 ----------
test('相对时间换算成具体日期', () => {
  const base = at(); // 2026-11-14 周六
  assert.deepEqual(memory.resolveRelative('下周三有面试', base), { text: '11月18日（周三）有面试', date: '2026-11-18' });
  assert.deepEqual(memory.resolveRelative('明天考试', base), { text: '11月15日（周日）考试', date: '2026-11-15' });
  assert.equal(memory.resolveRelative('后天出差', base).date, '2026-11-16');
  assert.equal(memory.resolveRelative('周末常去打羽毛球', base).date, null, '「周末」习惯用法不换算');
  assert.deepEqual(memory.postProcess([{ text: '11月14日（周六）这个周末想去看海', type: 'event', date: '2026-11-14' }], base)[0].text, '11月14日（周六）这个周末想去看海', '已有日期时不再二次换算');
  const pp = memory.postProcess([{ text: '下周三有面试', type: 'event' }, { text: '有场考试', type: 'event', date: '2026-11-20' }, { text: '喜欢猫' }], base);
  assert.deepEqual(pp, [
    { text: '11月18日（周三）有面试', type: 'event', date: '2026-11-18' },
    { text: '有场考试（11月20日（周五））', type: 'event', date: '2026-11-20' },
    { text: '喜欢猫', type: undefined, date: undefined }
  ]);
});

test('注入带相对时间；过期事件淡出；日期已过标为过去', () => {
  const now = at().getTime();
  const D = 86400000;
  const items = [
    { text: '名字叫阿宇', type: 'profile', ts: now - 40 * D },
    { text: '11月18日（周三）有面试', type: 'event', date: '2026-11-18', ts: now - 3 * D },
    { text: '10月1日去杭州旅游', type: 'event', date: '2026-10-01', ts: now - 50 * D },
    { text: '11月10日（周二）有考试', type: 'event', date: '2026-11-10', ts: now - 6 * D },
    { text: '最近在准备搬家', ts: now - 35 * D }
  ];
  const lines = memory.forPrompt(items, now);
  assert.deepEqual(lines, [
    '名字叫阿宇（1 个多月前提到）',
    '11月18日（周三）有面试（3 天前提到）',
    '11月10日（周二）有考试（6 天前提到；这件事已经过去了（4 天前））'
  ]);
  const sys = buildSystemPrompt(P('keai'), { memories: lines, now: at() });
  assert.ok(sys.includes('3 天前提到'));
  assert.ok(sys.includes('已经过去'));
});

test('merge 相似度去重：短条不吞长条，更新以新说法为准', () => {
  let l = memory.merge([], ['名字叫阿宇，在读研二，计算机专业', '喜欢吃火锅，尤其是牛油锅'], 1);
  l = memory.merge(l, ['在读研二', '喜欢吃火锅', '喜欢吃烧烤'], 2);
  assert.deepEqual(l.map((x) => x.text).sort(), ['名字叫阿宇，在读研二，计算机专业', '喜欢吃火锅，尤其是牛油锅', '喜欢吃烧烤'].sort());
  assert.ok(l.every((x) => x.ts === 2), '命中的旧条目刷新 ts');
  l = memory.merge(l, ['名字叫阿宇，在读研三，计算机专业'], 3);
  assert.ok(l.some((x) => x.text.includes('研三')) && !l.some((x) => x.text.includes('研二')));
  // 改期：同一事件换了日期，以新的为准
  let e = memory.merge([], [{ text: '11月18日（周三）有面试', type: 'event', date: '2026-11-18' }], 1);
  e = memory.merge(e, [{ text: '11月20日（周五）有面试', type: 'event', date: '2026-11-20' }], 2);
  assert.equal(e.length, 1);
  assert.equal(e[0].date, '2026-11-20');
  assert.ok(memory.similarity('喜欢吃火锅', '喜欢吃烧烤') < memory.SIM_THRESHOLD);
});

test('旧版记忆文件（无 ts）读取时补上时间', () => {
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-mem16-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'memory', 'keai.json'), JSON.stringify({ items: [{ id: 'a', text: '喜欢猫' }], lastExtractTurn: 3, updatedAt: 12345 }));
  const m = memory.load(dir, 'keai');
  assert.equal(m.items[0].ts, 12345);
});

test('弱信号后的下一句：含糊肯定升级为锁定，明确否认正常聊，其他只再确认一轮', () => {
  const w = () => mood.update(null, { persona: P('chimi'), userText: '有时候真的想消失算了，活着好累', now: at() });
  let r = mood.update(w().state, { persona: P('chimi'), userText: '嗯', now: at() });
  assert.equal(r.crisis, true);
  assert.equal(r.state.crisisLeft, mood.CRISIS_HOLD);
  r = mood.update(w().state, { persona: P('chimi'), userText: '哈哈没有啦随口说的', now: at() });
  assert.equal(r.crisis, false);
  assert.ok(!/再确认/.test(r.line));
  r = mood.update(w().state, { persona: P('chimi'), userText: '今天下雨了', now: at() });
  assert.equal(r.crisis, false);
  assert.match(r.line, /再确认/);
  assert.match(r.hint, /没有正面回答/);
  assert.ok(!/12356/.test(r.hint), '再确认轮不是危机提示');
  r = mood.update(r.state, { persona: P('chimi'), userText: '嗯', now: at() });
  assert.equal(r.crisis, false, '只再确认一轮，不无限延续');
});
