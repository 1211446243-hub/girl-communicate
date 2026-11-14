'use strict';
// v1.7.1 回复长度：只检查人设配置、系统提示词和情绪说明。
// 这些是离线文案断言，不是真实模型对话，也不能保证以后每次生成都一样。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadPersonas, buildSystemPrompt } = require('../../src/prompt');
const mood = require('../../src/mood');
const pro = require('../../src/proactive');

const root = path.join(__dirname, '..', '..');
const P = Object.fromEntries(loadPersonas(path.join(root, 'personas')).map((p) => [p.id, p]));
const OTHERS = ['keai', 'nianren', 'huopo', 'wenrou', 'zhixing', 'chimi'];
const CONTENT = {
  keai: '我今天好累',
  nianren: '我要去跟朋友吃饭了',
  huopo: '好无聊啊',
  wenrou: '我今天又搞砸了',
  zhixing: '今天好累',
  chimi: '我今天和朋友出去玩了'
};
const SHORT = {
  keai: '晚安',
  nianren: '晚安',
  huopo: '在吗',
  wenrou: '在吗',
  zhixing: '在吗',
  chimi: '我要去睡觉了',
  gaoleng: '在吗'
};

function bubbles(reply) { return String(reply || '').split(/\|\|\|/).map((s) => s.trim()).filter(Boolean); }
function replyOf(id, user) {
  const ex = P[id].examples.find((e) => e.user === user);
  assert.ok(ex, `${id} 缺少示例：${user}`);
  return ex.reply;
}
function hint(id, emotion, extra = {}) {
  const st = { emotion, intensity: extra.intensity || 2, cause: extra.cause || '', askCount: extra.askCount || 0, toldCause: !!extra.toldCause, justTold: !!extra.justTold, reunionLeft: extra.reunionLeft || 0, causeKey: extra.causeKey || '', careLeft: 0, note: '', soothe: 0 };
  return mood.hintFor(st, mood.traitsOf({ id }), extra.crisis || false, { id });
}

test('高冷的句长说明和示例保持原样', () => {
  assert.equal(P.gaoleng.style.sentence, '极短为多，常常只回一两句，有时就一个「嗯。」；偶尔才说三句。很少感叹号，句号和省略号多。不要每轮都说完整。');
  assert.equal(replyOf('gaoleng', '我今天加班到现在，好累啊'), '嗯。|||吃饭了没。');
  assert.equal(replyOf('gaoleng', '在吗'), '在。');
  const s = buildSystemPrompt(P.gaoleng, {});
  assert.match(s, /每条尽量短/);
  assert.match(s, /开心才可以多说/);
  assert.match(s, /极短为多/);
  assert.doesNotMatch(s, /通常回 2～4 句/);
});

test('其余六位的系统提示要求有内容时通常 2～4 句，并写明短答例外', () => {
  for (const id of OTHERS) {
    const s = buildSystemPrompt(P[id], {});
    assert.match(P[id].style.sentence, /2～4 句/, id);
    assert.match(s, /通常回 2～4 句/, id);
    assert.match(s, /短确认/, id);
    assert.match(s, /晚安/, id);
    assert.match(s, /生闷气/, id);
    assert.match(s, /不要每条、每轮都以问句结尾/, id);
    assert.match(s, /危机或认真谈安全的时候禁止拆条/, id);
    assert.match(s, /12356/, id);
    assert.doesNotMatch(s, /每条尽量短/, id);
  }
  assert.match(buildSystemPrompt(P.huopo, {}), /你本来就活泼/);
  assert.match(buildSystemPrompt(P.wenrou, {}), /仍然是聊天，不是演讲/);
});

test('有内容的示例通常是 2～3 条气泡，短确认示例仍然短', () => {
  for (const id of OTHERS) {
    const long = replyOf(id, CONTENT[id]);
    const parts = bubbles(long);
    assert.ok(parts.length >= 2 && parts.length <= 3, `${id} 气泡数 ${parts.length}`);
    assert.ok(long.replace(/\s/g, '').length >= 36, id);
    assert.ok(parts.filter((b) => /[？?]$/.test(b)).length < parts.length, `${id} 不应每条都问`);
    const short = replyOf(id, SHORT[id]);
    assert.ok(short.replace(/\s/g, '').length <= 24, `${id} 短示例过长：${short}`);
    assert.ok(bubbles(short).length <= 2, id);
  }
  assert.ok(replyOf('gaoleng', '在吗').length <= 4);
});

test('平静、开心、兴奋才追加正常篇幅；生闷气、委屈、困倦、低落、生气仍短', () => {
  const shortMark = { sulky: '回复极短', hurt: '语气软而短', sleepy: '短而慢', down: '话少、淡', angry: '语气冲、直接' };
  for (const id of ['gaoleng', ...OTHERS]) {
    for (const emotion of Object.keys(shortMark)) {
      const h = hint(id, emotion, { cause: '都两天没理我了' });
      assert.match(h, new RegExp(shortMark[emotion]), `${id}/${emotion}`);
      assert.doesNotMatch(h, /通常 2～4 句/, `${id}/${emotion} 不应要求凑句`);
    }
    assert.doesNotMatch(hint(id, 'jealous', { cause: '你提到了前任' }), /通常 2～4 句/, id);
  }
  for (const id of OTHERS) {
    for (const emotion of ['calm', 'happy', 'excited']) {
      const h = hint(id, emotion);
      assert.match(h, /通常 2～4 句/, `${id}/${emotion}`);
      assert.match(h, /不要每条都问/, `${id}/${emotion}`);
    }
  }
  const gHappy = hint('gaoleng', 'happy');
  assert.match(gHappy, /可以连发两三条短消息/);
  assert.match(gHappy, /只比平时多说半句/);
  assert.doesNotMatch(gHappy, /通常 2～4 句/);
  assert.match(hint('huopo', 'happy'), /比平时更健谈/);
  assert.match(hint('huopo', 'excited'), /再多一两句/);
  assert.doesNotMatch(hint('wenrou', 'happy'), /多说半句/);
  assert.doesNotMatch(hint('zhixing', 'excited'), /最多比平时多说一句/);
});

test('追问到第二次才说原因：仍然打破短敷衍，不改成正常篇幅', () => {
  for (const id of ['gaoleng', ...OTHERS]) {
    const h = hint(id, 'sulky', { cause: '都两天没理我了', askCount: 2, justTold: true });
    assert.match(h, /必须打破短敷衍/, id);
    assert.match(h, /点到为止/, id);
    assert.doesNotMatch(h, /通常 2～4 句/, id);
    const first = hint(id, 'sulky', { cause: '都两天没理我了', askCount: 1 });
    assert.match(first, /先不要把原因说透/, id);
    assert.doesNotMatch(first, /通常 2～4 句/, id);
  }
});

test('危机说明仍以安全和清楚关怀为准，不套用 2～4 句', () => {
  for (const id of ['gaoleng', ...OTHERS]) {
    const h = hint(id, 'calm', { crisis: 'cont' });
    assert.match(h, /12356/, id);
    assert.match(h, /不要说它一定是 24 小时/, id);
    assert.match(h, /110 或 120/, id);
    assert.match(h, /不要使用「\|\|\|」/, id);
    assert.doesNotMatch(h, /通常 2～4 句/, id);
  }
});

test('告别语解除危机的规则没有改', () => {
  assert.match(mood.RECOVER_RE.source, /谢谢你陪我/);
  assert.match(mood.RECOVER_RE.source, /没事了/);
  assert.equal(mood.RECOVER_RE.test('没事了，谢谢你陪我，再见'), true);
});

test('主动追发和不定时主动消息仍限制为短消息，调度常数未改', () => {
  assert.equal(pro.FOLLOW.rare.prob, 1 / 3);
  assert.equal(pro.FOLLOW.rare.minMs, 40000);
  assert.equal(pro.FOLLOW.rare.maxMs, 180000);
  assert.equal(pro.FOLLOW.normal.prob, 0.5);
  assert.equal(pro.FOLLOW.normal.minMs, 40000);
  assert.equal(pro.FOLLOW.normal.maxMs, 150000);
  assert.deepEqual(pro.PROACTIVE.rare, { minGapH: 4, maxGapH: 8, dailyCap: 2, personas: 1, recentDays: 7 });
  assert.deepEqual(pro.PROACTIVE.normal, { minGapH: 2.5, maxGapH: 5, dailyCap: 3, personas: 2, recentDays: 14 });
  assert.equal(pro.WINDOW.start, 8 * 60 + 30);
  assert.equal(pro.WINDOW.end, 23 * 60 + 30);
  assert.equal(pro.GLOBAL_SPACING_MS, 90 * 60000);
  const follow = pro.followUpInstruction({ topics: ['今晚吃了火锅'], persona: { id: 'huopo' } });
  assert.match(follow, /一到两条短消息/);
  assert.match(follow, /通常 2～4 句，这一条不适用/);
  assert.match(follow, /不要长篇/);
  const chat = pro.proactiveInstruction({ plan: { kind: 'chat', slot: { text: '晚上' } }, persona: { id: 'keai' }, now: new Date('2026-11-14T20:00:00+08:00'), lastAt: Date.now() - 6 * 3600000 });
  assert.match(chat, /一到两条短消息/);
  assert.match(chat, /不要长篇/);
  const care = pro.proactiveInstruction({ plan: { kind: 'care' }, persona: { id: 'wenrou' }, now: new Date('2026-11-14T20:00:00+08:00'), lastAt: Date.now() - 6 * 3600000 });
  assert.match(care, /12356/);
  assert.match(care, /不要按平时聊天那种 2～4 句/);
  assert.match(care, /不拆成多条/);
  assert.equal(pro.acceptReply('啊'.repeat(401)), null);
  assert.equal(pro.acceptReply('啊'.repeat(40)), '啊'.repeat(40));
});

test('1～2 秒正在输入的等待没有改', () => {
  const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  assert.match(app, /delay: 1000 \+ Math\.floor\(Math\.random\(\) \* 1000\)/);
});
