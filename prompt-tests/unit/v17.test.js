'use strict';
// v1.7 新增用例：话题延伸追发与不定时主动消息的调度、上限、取消、危机屏蔽、时段
const test = require('node:test');
const assert = require('node:assert/strict');
const pro = require('../../src/proactive');
const mood = require('../../src/mood');
const { parseChatFile } = require('../../src/chatfile');

const at = (h, m = 0, d = 14) => new Date(2026, 10, d, h, m, 0);
const H = 3600000;
const conv = (t0, extra = []) => [
  { role: 'user', content: '今晚跟室友去吃火锅了，辣到流眼泪', ts: t0 },
  { role: 'assistant', content: '哈哈哈辣成那样还吃', ts: t0 + 5000 },
  ...extra
];
const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };

// ---------- 追发 ----------
test('追发：命中概率时返回 40s–3min 的延迟，并带上用户最近的话', () => {
  const plan = pro.planFollowUp({ settings: { followUp: 'rare' }, history: conv(at(20).getTime()), rng: seq(0.1, 0.5) });
  assert.ok(plan);
  assert.ok(plan.delayMs >= 40000 && plan.delayMs <= 180000, String(plan.delayMs));
  assert.ok(plan.topics[0].includes('火锅'));
});

test('追发：概率没抽中就不发；偶尔≈1/3、正常≈1/2', () => {
  assert.equal(pro.planFollowUp({ settings: { followUp: 'rare' }, history: conv(1), rng: () => 0.34 }), null);
  assert.ok(pro.planFollowUp({ settings: { followUp: 'normal' }, history: conv(1), rng: () => 0.34 }));
  let n = 0; let r = 12345;
  const rng = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 3000; i++) if (pro.planFollowUp({ settings: { followUp: 'rare' }, history: conv(1), rng })) n++;
  assert.ok(n > 850 && n < 1150, `rare 命中 ${n}/3000`);
});

test('追发：关闭时不发', () => {
  assert.equal(pro.planFollowUp({ settings: { followUp: 'off' }, history: conv(1), rng: () => 0 }), null);
});

test('追发：每轮最多一次，不能连环追', () => {
  const h = conv(1, [{ role: 'assistant', content: '诶我突然想吃毛肚', ts: 9e5, proactive: true, kind: 'followup' }]);
  assert.equal(pro.planFollowUp({ settings: { followUp: 'normal' }, history: h, rng: () => 0 }), null);
  // 用户又说话、她又回复之后，新一轮可以再追
  h.push({ role: 'user', content: '毛肚确实好吃，下次点两份', ts: 1e6 }, { role: 'assistant', content: '嗯嗯', ts: 1e6 + 1 });
  assert.ok(pro.planFollowUp({ settings: { followUp: 'normal' }, history: h, rng: () => 0 }));
});

test('追发：只有在她刚回复完（最后一条是她的正常回复）时才排；失败的半截回复不追', () => {
  const h = conv(1); h.pop();
  assert.equal(pro.planFollowUp({ settings: { followUp: 'normal' }, history: h, rng: () => 0 }), null);
  const h2 = conv(1); h2[1].partial = true;
  assert.equal(pro.planFollowUp({ settings: { followUp: 'normal' }, history: h2, rng: () => 0 }), null);
});

test('追发：用户只说了嗯/好的，或说去忙/去睡，不追', () => {
  for (const u of ['嗯', '好的～', '哈哈哈', 'ok', '晚安，我睡了', '我先去忙了', '去上课啦，回头聊']) {
    const h = [{ role: 'user', content: u, ts: 1 }, { role: 'assistant', content: '好', ts: 2 }];
    assert.equal(pro.planFollowUp({ settings: { followUp: 'normal' }, history: h, rng: () => 0 }), null, u);
  }
});

test('追发：危机期间及之后几轮不发', () => {
  let r = mood.update(null, { persona: { id: 'wenrou' }, userText: '我真的撑不下去了', now: at(20) });
  assert.equal(pro.planFollowUp({ settings: { followUp: 'normal' }, history: conv(1), moodState: r.state, rng: () => 0 }), null);
  // 明确好转之后的若干轮仍然屏蔽
  r = mood.update(r.state, { persona: { id: 'wenrou' }, userText: '我好多了，谢谢你陪我', now: at(20, 5) });
  assert.equal(r.state.crisisLeft, 0);
  assert.equal(pro.planFollowUp({ settings: { followUp: 'normal' }, history: conv(1), moodState: r.state, rng: () => 0 }), null);
  // 弱信号当轮也不追
  const w = mood.update(null, { persona: { id: 'wenrou' }, userText: '活着没什么意思', now: at(20) });
  w.state.lastCrisis = true;
  assert.equal(pro.planFollowUp({ settings: { followUp: 'normal' }, history: conv(1), moodState: w.state, rng: () => 0 }), null);
  // 安静期过后恢复
  let st = r.state;
  for (let i = 0; i < 6; i++) st = mood.update(st, { persona: { id: 'wenrou' }, userText: '今天去图书馆了', now: at(21, i) }).state;
  assert.ok(pro.planFollowUp({ settings: { followUp: 'normal' }, history: conv(1), moodState: st, rng: () => 0 }));
});

test('追发：生闷气（强度≥2）时少追', () => {
  const st = { emotion: 'sulky', intensity: 2, turn: 3, lastCrisisTurn: -999 };
  assert.equal(pro.planFollowUp({ settings: { followUp: 'rare' }, history: conv(1), moodState: st, rng: () => 0.2 }), null);
  assert.ok(pro.planFollowUp({ settings: { followUp: 'rare' }, history: conv(1), moodState: st, rng: () => 0.1 }));
});

// ---------- 主动找你 ----------
const plan = (o) => pro.planProactive({ settings: { proactive: 'rare' }, id: 'keai', pstate: {}, ...o });

test('主动：空闲够久才发（偶尔 4–8 小时，同一空闲期结果稳定）', () => {
  const t0 = at(9).getTime();
  const h = conv(t0);
  assert.equal(plan({ history: h, now: at(12, 59) }), null); // < 4h
  assert.ok(plan({ history: h, now: at(17, 10) }));          // > 8h
  // 同一空闲期内每分钟检查结果一致：找到第一次可发的分钟后，之后都可发
  let first = null;
  for (let m = 0; m <= 9 * 60; m++) {
    const ok = !!plan({ history: h, now: new Date(t0 + 5000 + m * 60000) });
    if (ok && first === null) first = m;
    if (first !== null) assert.ok(ok || !pro.inWindow(new Date(t0 + 5000 + m * 60000)), `m=${m}`);
  }
  assert.ok(first >= 240 && first <= 480, `first=${first}`);
});

test('主动：只在 8:30–23:30 发', () => {
  const h = conv(at(0, 10, 13).getTime());
  assert.equal(plan({ history: h, now: at(8, 29) }), null);
  assert.ok(plan({ history: h, now: at(8, 30) }));
  assert.ok(plan({ history: h, now: at(23, 29) }));
  assert.equal(plan({ history: h, now: at(23, 30) }), null);
  assert.equal(plan({ history: h, now: at(2, 0) }), null);
  assert.equal(pro.slotOf(at(8, 40)).id, 'morning');
  assert.equal(pro.slotOf(at(12, 0)).id, 'lunch');
  assert.equal(pro.slotOf(at(18, 0)).id, 'dinner');
  assert.equal(pro.slotOf(at(21, 0)).id, 'evening');
});

test('主动：未回复的主动消息最多 1 条（含追发）', () => {
  const t0 = at(0, 10, 13).getTime();
  const h = conv(t0, [{ role: 'assistant', content: '早呀', ts: t0 + 9 * H, proactive: true, kind: 'proactive' }]);
  assert.equal(plan({ history: h, now: at(22) }), null);
  const h2 = conv(t0, [{ role: 'assistant', content: '诶说到火锅', ts: t0 + 60000, proactive: true, kind: 'followup' }]);
  assert.equal(plan({ history: h2, now: at(22) }), null);
  // 你回了之后才可能有下一条
  h.push({ role: 'user', content: '早，刚醒', ts: t0 + 10 * H }, { role: 'assistant', content: '懒虫', ts: t0 + 10 * H + 1 });
  assert.ok(plan({ history: h, now: new Date(t0 + 19 * H) }));
});

test('主动：每个人设每天上限（偶尔 2 / 正常 3），跨天清零', () => {
  const h = conv(at(0, 10, 13).getTime());
  let ps = {};
  ps = pro.recordSent(ps, 'keai', at(9), 'proactive'); ps.lastAny = 0;
  assert.ok(plan({ history: h, now: at(15), pstate: ps }));
  ps = pro.recordSent(ps, 'keai', at(12), 'proactive'); ps.lastAny = 0;
  assert.equal(plan({ history: h, now: at(15), pstate: ps }), null);
  assert.ok(pro.planProactive({ settings: { proactive: 'normal' }, id: 'keai', history: h, now: at(15), pstate: ps }));
  ps = pro.recordSent(ps, 'keai', at(13), 'proactive'); ps.lastAny = 0;
  assert.equal(pro.planProactive({ settings: { proactive: 'normal' }, id: 'keai', history: h, now: at(15), pstate: ps }), null);
  assert.ok(plan({ history: h, now: at(9, 0, 15), pstate: ps })); // 第二天
});

test('主动：不同人设之间至少隔 90 分钟，不刷屏', () => {
  const h = conv(at(0, 10, 13).getTime());
  const ps = pro.recordSent({}, 'gaoleng', at(14), 'proactive');
  assert.equal(plan({ history: h, now: at(15), pstate: ps }), null);
  assert.ok(plan({ history: h, now: at(15, 31), pstate: ps }));
});

test('主动：只找最近聊过的人设（偶尔 1 位 / 正常 2 位，7 天内）', () => {
  const histories = {
    keai: conv(at(10, 0, 13).getTime()),
    gaoleng: conv(at(11, 0, 13).getTime()),
    huopo: conv(at(9, 0, 13).getTime()),
    wenrou: conv(at(9, 0, 1).getTime())
  };
  const go = (id, m) => pro.planProactive({ settings: { proactive: m }, id, history: histories[id], histories, pstate: {}, now: at(15) });
  assert.ok(go('gaoleng', 'rare'));
  assert.equal(go('keai', 'rare'), null);
  assert.ok(go('keai', 'normal'));
  assert.equal(go('huopo', 'normal'), null);
  assert.deepEqual(pro.recentPersonas(histories, 7, at(15), 7), ['gaoleng', 'keai', 'huopo']);
});

test('主动：关闭 / 没聊过时不发', () => {
  assert.equal(pro.planProactive({ settings: { proactive: 'off' }, id: 'keai', history: conv(at(0, 10, 13).getTime()), now: at(15) }), null);
  assert.equal(plan({ history: [], now: at(15) }), null);
});

test('主动：危机期间只发温和关心（每天最多 1 条）', () => {
  const r = mood.update(null, { persona: { id: 'wenrou' }, userText: '我真的撑不下去了', now: at(0, 10, 13) });
  const h = conv(at(0, 10, 13).getTime());
  const p1 = plan({ history: h, now: at(15), moodState: r.state });
  assert.equal(p1.kind, 'care');
  const ps = pro.recordSent({}, 'keai', at(9), 'care'); ps.lastAny = 0;
  assert.equal(plan({ history: h, now: at(15), moodState: r.state, pstate: ps }), null);
  const ins = pro.proactiveInstruction({ plan: p1, now: at(15), lastAt: h[1].ts });
  assert.match(ins, /12356/);
  assert.match(ins, /不开玩笑/);
  assert.match(ins, /不要说它一定是 24 小时/);
  const normal = plan({ history: h, now: at(15) });
  assert.equal(normal.kind, 'chat');
});

test('主动：生闷气时这个空闲期有时干脆不发，但结果稳定', () => {
  const h = conv(at(0, 10, 13).getTime());
  const st = { emotion: 'sulky', intensity: 3, turn: 2, lastCrisisTurn: -999 };
  const a = plan({ history: h, now: at(15), moodState: st });
  const b = plan({ history: h, now: at(16), moodState: st });
  assert.equal(!!a, !!b);
});

test('提示词：不暴露提取、不施压、痴迷不纠缠、不约见面', () => {
  const f = pro.followUpInstruction({ topics: ['今晚吃火锅'], persona: { id: 'chimi' } });
  assert.match(f, /火锅/);
  assert.match(f, /不要每次都用「你刚才说」/);
  assert.match(f, /不要提「关键词」/);
  assert.match(f, /不要催对方回复/);
  assert.match(f, /不纠缠/);
  assert.match(f, /不约现实见面/);
  const p = pro.proactiveInstruction({ plan: { kind: 'chat', slot: pro.slotOf(at(12)) }, persona: { id: 'chimi' }, moodState: { emotion: 'sulky' }, lastAt: at(6).getTime(), now: at(12) });
  assert.match(p, /中午饭点/);
  assert.match(p, /不查岗/);
  assert.match(p, /不要提对方没来找你/);
  assert.match(p, /埋怨、指责、卖惨、讨好/);
});

test('PASS / 空回复不发', () => {
  assert.equal(pro.acceptReply('PASS'), null);
  assert.equal(pro.acceptReply('  '), null);
  assert.equal(pro.acceptReply('诶说到毛肚'), '诶说到毛肚');
});

test('用户回来时不会因为没回主动消息而生气：情绪更新与是否有未回主动消息无关', () => {
  const t0 = at(10).getTime();
  const base = [{ role: 'user', content: '在吗', ts: t0 }, { role: 'assistant', content: '在', ts: t0 + 1 }];
  const withPro = [...base, { role: 'assistant', content: '吃饭没', ts: t0 + 5 * H, proactive: true, kind: 'proactive' }];
  assert.equal(pro.unansweredProactive(withPro), 1);
  const st0 = mood.update(null, { persona: { id: 'nianren' }, userText: '在吗', now: new Date(t0) }).state;
  const a = mood.update(st0, { persona: { id: 'nianren' }, userText: '刚忙完', now: new Date(t0 + 9 * H), random: () => 0.5 });
  const b = mood.update(st0, { persona: { id: 'nianren' }, userText: '刚忙完', now: new Date(t0 + 9 * H), random: () => 0.5 });
  assert.equal(a.emotion, b.emotion);
  assert.ok(!['angry', 'sulky', 'hurt', 'jealous'].includes(a.emotion), a.emotion);
  assert.match(pro.RETURN_NOTE, /不要埋怨/);
});

test('导入/备份保留 proactive 标记', () => {
  const r = parseChatFile({ app: '之间', messages: [{ role: 'user', content: 'a', ts: 1 }, { role: 'assistant', content: 'b', ts: 2, proactive: true, kind: 'followup' }] });
  assert.equal(r.messages[1].proactive, true);
  assert.equal(r.messages[1].kind, 'followup');
});

test('取消：用户说话 / 打字就取消待发追发；重新排会顶掉旧的', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const timers = pro.createTimers();
  const fired = [];
  timers.schedule('keai', 60000, () => fired.push('a'));
  t.mock.timers.tick(30000);
  assert.equal(timers.cancel('keai'), true); // 用户发消息
  t.mock.timers.tick(60000);
  assert.deepEqual(fired, []);
  timers.schedule('keai', 60000, () => fired.push('b'));
  timers.schedule('keai', 90000, () => fired.push('c')); // 顶掉 b
  timers.schedule('gaoleng', 50000, () => fired.push('g'));
  t.mock.timers.tick(60000);
  assert.deepEqual(fired, ['g']);
  t.mock.timers.tick(30000);
  assert.deepEqual(fired, ['g', 'c']);
  assert.equal(timers.size, 0);
  assert.equal(timers.cancel('keai'), false);
});
