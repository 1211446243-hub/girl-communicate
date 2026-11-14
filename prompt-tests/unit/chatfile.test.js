'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseChatFile, safeFileName } = require('../../src/chatfile');

test('导入：兼容导出格式', () => {
  const r = parseChatFile(JSON.stringify({ app: '之间', persona: { id: 'keai', name: '林小满' }, messages: [{ role: 'user', content: '在吗', ts: 1 }, { role: 'assistant', content: '在！', ts: 2 }] }));
  assert.ok(r.ok);
  assert.equal(r.messages.length, 2);
  assert.equal(r.persona.id, 'keai');
});
test('导入：拒绝坏结构', () => {
  assert.ok(!parseChatFile('not json').ok);
  assert.ok(!parseChatFile('{"messages": [{"role": "system", "content": "x"}]}').ok);
  assert.ok(!parseChatFile('{"app": "别的软件", "messages": []}').ok);
  assert.ok(!parseChatFile('{"foo": 1}').ok);
});
test('导出文件名过滤 Windows 非法字符', () => {
  assert.equal(safeFileName('a/b:c*?"<>|d'), 'a_b_c______d');
  assert.equal(safeFileName('CON'), '_CON');
  assert.equal(safeFileName('名字. '), '名字');
});
