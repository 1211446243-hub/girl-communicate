'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadPersonas, buildSystemPrompt, recentRepeats } = require('../../src/prompt');

const P = Object.fromEntries(loadPersonas(path.join(__dirname, '..', '..', 'personas')).map((p) => [p.id, p]));

test('七个人设都是成年人，痴迷排在最后', () => {
  const list = loadPersonas(path.join(__dirname, '..', '..', 'personas'));
  assert.equal(list.length, 7);
  assert.ok(list.every((p) => p.age >= 18));
  assert.equal(list[list.length - 1].id, 'chimi');
});

test('痴迷人设的示例支持现实社交，首页标签中性', () => {
  const ex = P.chimi.examples.find((e) => /朋友/.test(e.user));
  assert.ok(ex && !/别的人|不许|别去/.test(ex.reply));
  assert.ok(!P.chimi.keywords.some((k) => /畸形|占有欲（/.test(k)));
  assert.ok(P.chimi.notice && P.chimi.displayType);
});

test('记忆注入系统提示，并保留安全规则', () => {
  const s = buildSystemPrompt(P.keai, { memories: ['下周三有面试'], moodHint: 'x' });
  assert.match(s, /你记得的关于对方的事/);
  assert.match(s, /下周三有面试/);
  assert.match(s, /12356/);
  assert.match(s, /不要说它一定是 24 小时/);
  assert.doesNotMatch(buildSystemPrompt(P.keai, {}), /你记得的关于对方的事/);
});

test('口头禅限频：最近说过的会被提示换说法', () => {
  const h = [
    { role: 'assistant', content: '嗯……去吧，我等你回来。|||晚安，我唯一的。' },
    { role: 'user', content: '好' },
    { role: 'assistant', content: '嗯……我把今天调成了一瓶香。' }
  ];
  const r = recentRepeats(P.chimi, h);
  assert.ok(r.includes('我唯一的'));
  assert.ok(r.some((x) => /开头的「嗯」/.test(x)));
  const s = buildSystemPrompt(P.chimi, { avoidPhrases: r });
  assert.match(s, /这一轮不要再用这些说法/);
});
