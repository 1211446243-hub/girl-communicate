'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const memory = require('../../src/memory');

test('不记录敏感信息', () => {
  for (const s of ['我的 key 是 sk-abcdef123456', '密码是 123456', '身份证 110101199001011234', '手机号 13812345678', '银行卡 6222020200112233445']) assert.ok(memory.isSensitive(s), s);
  assert.ok(!memory.isSensitive('在读研一，计算机专业'));
});

test('去重与上限', () => {
  let items = memory.merge([], ['喜欢猫', '在读研一']);
  items = memory.merge(items, ['喜欢猫', '喜欢猫，尤其是橘猫', '密码是 abc']);
  assert.equal(items.length, 2);
  assert.ok(items.some((x) => x.text.includes('橘猫')));
  const c = (n) => String.fromCharCode(0x4e00 + n * 41);
  const many = Array.from({ length: 30 }, (_, i) => `${c(i)}${c(i + 300)}${c(i + 600)}很重要`); // 30 条互不相似的事实
  assert.equal(memory.merge([], many).length, memory.MAX_ITEMS);
});

test('解析提炼结果', () => {
  assert.deepEqual(memory.parseFacts('```json\n{"facts":["叫阿宇","下周考试"]}\n```'), [{ text: '叫阿宇' }, { text: '下周考试' }]);
  assert.deepEqual(memory.parseFacts('{"facts":[{"text":"11月18日有面试","type":"event","date":"2026-11-18"},{"text":"喜欢猫","type":"preference"}]}'),
    [{ text: '11月18日有面试', type: 'event', date: '2026-11-18' }, { text: '喜欢猫', type: 'preference', date: undefined }]);
  assert.deepEqual(memory.parseFacts('没有'), []);
});

test('读写与提炼时机', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-mem-'));
  const mem = { items: memory.merge([], ['叫阿宇']), lastExtractTurn: 0 };
  memory.save(dir, 'keai', mem);
  assert.equal(memory.load(dir, 'keai').items[0].text, '叫阿宇');
  const h = (n) => Array.from({ length: n }, () => ({ role: 'user', content: 'x' }));
  assert.ok(!memory.shouldExtract(mem, h(7)));
  assert.ok(memory.shouldExtract(mem, h(8)));
  assert.ok(memory.shouldExtract(mem, h(3), { force: true }));
  memory.clear(dir, 'keai');
  assert.equal(memory.load(dir, 'keai').items.length, 0);
});
