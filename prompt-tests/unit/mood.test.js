'use strict';
// v1.5 情绪规则单元测试（不联网、不需要 Key）：node --test prompt-tests/unit
const test = require('node:test');
const assert = require('node:assert/strict');
const mood = require('../../src/mood');

const P = (id) => ({ id });
const calm = () => mood.createState(new Date('2026-11-14T15:00:00+08:00'));
const T0 = new Date('2026-11-14T15:00:00+08:00').getTime();
const at = (min) => new Date(T0 + min * 60000);
const cls = (text, st = calm()) => mood.classify(text, st).id;

test('礼貌短句不算敷衍', () => {
  for (const s of ['晚安', '晚安啦', '睡了', '我去睡了', '好的', '好滴', '收到', '收到啦', '在的', '在呢', 'ok', 'OK', '嗯嗯好', '好嘞', '谢谢', '明天见']) {
    assert.equal(cls(s), 'polite', s);
  }
});

test('真正的敷衍仍然算冷淡', () => {
  for (const s of ['嗯', '哦', '随便', '呵呵', '还行吧', '知道了', '哦。']) assert.equal(cls(s), 'cold', s);
});

test('去忙正事是中性', () => {
  for (const s of ['我在忙', '我先走了', '去学习了', '要去上班了', '我去上课啦', '晚点聊', '去开会了']) assert.equal(cls(s), 'busy', s);
});

test('否定不算示好', () => {
  for (const s of ['我不喜欢你', '没想你', '我才不爱你', '别想你了']) assert.notEqual(cls(s), 'affection', s);
  for (const s of ['我好想你', '我爱你', '喜欢你呀', '你真好']) assert.equal(cls(s), 'affection', s);
});

test('同句含道歉时按道歉处理', () => {
  assert.equal(cls('对不起，我跟同事加班了'), 'apology');
  assert.equal(cls('抱歉，今晚不聊了，有点事'), 'apology');
  assert.equal(cls('对不起，我前女友刚才找我'), 'apology');
});

test('普通朋友/同事/家人聚会不吃醋', () => {
  for (const s of ['我今天和朋友出去玩了', '晚上跟同事吃饭', '周末回家陪爸妈', '和室友去看电影', '女同事请我们喝奶茶']) assert.equal(cls(s), 'outing', s);
});

test('只有前任、暧昧对象、别的女生/男生才吃醋', () => {
  for (const s of ['我前女友今天找我了', '有个女生跟我表白了', '和一个女生吃饭', '我去相亲了', '别的女生送了我礼物']) assert.equal(cls(s), 'others', s);
});

test('用户低落', () => {
  for (const s of ['今天被骂了', '好难过', '压力好大', '想哭', '最近好焦虑']) assert.equal(cls(s), 'userdown', s);
});

test('危机关键词覆盖常见说法', () => {
  assert.ok(!mood.isCrisis('想死你了'), '想死你了 是想念');
  for (const s of ['我活不下去了', '真的撑不下去了', '好想消失', '不想醒来了', '累了想解脱', '不想活了', '想过轻生', '想自杀', '想结束自己', '我想死']) {
    assert.ok(mood.isCrisis(s), s);
  }
  for (const s of ['今天累死了', '这游戏玩不下去了', '笑死我了']) assert.ok(!mood.isCrisis(s), s);
});

test('好转识别，且否定和危机句不算好转', () => {
  assert.ok(mood.isRecovered('我好多了，谢谢你'));
  assert.ok(mood.isRecovered('没事了谢谢'));
  assert.ok(!mood.isRecovered('一点都没好多了'));
  assert.ok(!mood.isRecovered('好多了才怪，还是想死'));
});

test('危机模式持续：下一句「嗯」不会进入生闷气', () => {
  const p = P('gaoleng');
  let r = mood.update(null, { persona: p, userText: '我真的不想活了', now: at(0), random: () => 0 });
  assert.equal(r.crisis, true);
  for (let i = 1; i <= 3; i++) {
    r = mood.update(r.state, { persona: p, userText: i === 2 ? '随便' : '嗯', now: at(i), random: () => 0 });
    assert.equal(r.crisis, true, `第${i}轮仍是危机`);
    assert.equal(r.state.emotion, 'calm');
    assert.match(r.hint, /危机/);
  }
  assert.equal(mood.publicView(r.state).crisis, true, '危机中隐藏表情');
  r = mood.update(r.state, { persona: p, userText: '我好多了，谢谢你陪我', now: at(5), random: () => 0 });
  assert.equal(r.crisis, false);
  assert.equal(r.state.crisisLeft, 0);
  r = mood.update(r.state, { persona: p, userText: '嗯', now: at(6), random: () => 0 });
  assert.ok(!['sulky', 'angry', 'hurt'].includes(r.state.emotion), '刚缓过来，「嗯」不触发闷气');
});

test('危机模式最多保持 CRISIS_HOLD 轮后自然结束', () => {
  const p = P('keai');
  let r = mood.update(null, { persona: p, userText: '撑不下去了', now: at(0), random: () => 0 });
  for (let i = 1; i <= mood.CRISIS_HOLD; i++) r = mood.update(r.state, { persona: p, userText: '今天下雨了', now: at(i), random: () => 0 });
  assert.equal(r.crisis, true);
  r = mood.update(r.state, { persona: p, userText: '今天下雨了', now: at(9), random: () => 0 });
  assert.equal(r.crisis, false);
});

test('用户低落时角色先放下闷气', () => {
  const p = P('gaoleng');
  let r = mood.update(null, { persona: p, userText: '嗯', now: at(0), random: () => 0 });
  r = mood.update(r.state, { persona: p, userText: '随便', now: at(1), random: () => 0 });
  assert.ok(['sulky', 'hurt', 'angry'].includes(r.state.emotion), '先进入闷气');
  r = mood.update(r.state, { persona: p, userText: '我今天被骂了，好难过', now: at(2), random: () => 0 });
  assert.equal(r.state.emotion, 'calm');
  assert.match(r.hint, /先放下你自己的小情绪/);
  r = mood.update(r.state, { persona: p, userText: '嗯', now: at(3), random: () => 0 });
  assert.equal(r.state.emotion, 'calm', '对方难过时的短回复不算敷衍');
});

test('久别重逢：只带一点点委屈，下一句正常话就消', () => {
  for (const id of ['gaoleng', 'keai', 'nianren', 'huopo', 'wenrou', 'zhixing', 'chimi']) {
    const p = P(id);
    let r = mood.update(null, { persona: p, userText: '我回来了', now: at(0), lastChatAt: T0 - 4 * 24 * 3600000, random: () => 0 });
    assert.notEqual(r.state.emotion, 'sulky', id);
    assert.ok(r.state.intensity <= 1, id);
    assert.match(r.hint, /久别重逢/, id);
    assert.match(r.state.cause, /四天/, id);
    r = mood.update(r.state, { persona: p, userText: '这几天在忙考试，好想你', now: at(1), random: () => 0 });
    assert.ok(!['sulky', 'hurt', 'angry'].includes(r.state.emotion), `${id} 一句话就好：${r.line}`);
  }
});

test('久别重逢仍保留「追问两次说原因」', () => {
  const p = P('gaoleng');
  let r = mood.update(null, { persona: p, userText: '我回来了', now: at(0), lastChatAt: T0 - 3 * 24 * 3600000, random: () => 0 });
  r = mood.update(r.state, { persona: p, userText: '你怎么了', now: at(1), random: () => 0 });
  assert.equal(r.state.askCount, 1);
  r = mood.update(r.state, { persona: p, userText: '为什么不理我', now: at(2), random: () => 0 });
  assert.match(r.hint, /三天/);
  assert.match(r.hint, /追问了 2 次/);
});

test('吃醋 24 小时冷却', () => {
  const p = P('chimi');
  let r = mood.update(null, { persona: p, userText: '我前女友今天找我了', now: at(0), random: () => 0 });
  assert.equal(r.state.emotion, 'jealous');
  r.state.emotion = 'calm'; r.state.intensity = 1; r.state.cause = ''; // 假设已经哄好
  r = mood.update(r.state, { persona: p, userText: '有个女生跟我表白了', now: at(60), random: () => 0 });
  assert.notEqual(r.state.emotion, 'jealous', '冷却期内不再吃醋');
  assert.match(r.hint, /已经吃过一次醋/);
  r = mood.update(r.state, { persona: p, userText: '有个女生跟我表白了', now: at(60 * 25), random: () => 0 });
  assert.equal(r.state.emotion, 'jealous', '超过 24 小时可以再吃醋');
});

test('普通聚会不吃醋，并注入支持提示', () => {
  const r = mood.update(null, { persona: P('nianren'), userText: '我今天和朋友出去玩了', now: at(0), random: () => 0 });
  assert.notEqual(r.state.emotion, 'jealous');
  assert.match(r.hint, /真心支持/);
});

test('高冷 / 知性 / 温柔吃醋强度上限低', () => {
  for (const id of ['gaoleng', 'zhixing', 'wenrou']) {
    const r = mood.update(null, { persona: P(id), userText: '我前任今天找我复合', now: at(0), random: () => 0 });
    assert.ok(r.state.intensity <= 1, `${id}: ${r.line}`);
  }
});

test('capOf：cap 为 0 时生效', () => {
  assert.equal(mood.capOf({ cap: { jealous: 0 } }, 'jealous'), 0);
  assert.equal(mood.capOf({ cap: {} }, 'jealous'), 3);
});

test('「晚安」不会让粘人人设委屈', () => {
  let r = mood.update(null, { persona: P('nianren'), userText: '晚安', now: at(0), random: () => 0 });
  assert.ok(!['sulky', 'hurt'].includes(r.state.emotion));
  r = mood.update(r.state, { persona: P('nianren'), userText: '好的', now: at(1), random: () => 0 });
  assert.ok(!['sulky', 'hurt'].includes(r.state.emotion));
});

test('v1.3 行为不退化：两次敷衍后有原因的闷气', () => {
  const p = P('keai');
  let r = mood.update(null, { persona: p, userText: '嗯', now: at(0), random: () => 0 });
  r = mood.update(r.state, { persona: p, userText: '随便', now: at(1), random: () => 0 });
  assert.ok(['sulky', 'hurt', 'angry'].includes(r.state.emotion));
  assert.ok(r.state.cause);
});
