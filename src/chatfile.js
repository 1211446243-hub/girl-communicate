'use strict';
// 聊天记录文件的校验与导出文件名处理（纯函数，主进程与单元测试共用）
// 校验导入 / 备份的 JSON：兼容「导出为 JSON」的格式 { app, persona, exportedAt, messages:[{role, content, ts}] }
function parseChatFile(raw) {
  let data;
  try { data = typeof raw === 'string' ? JSON.parse(raw.replace(/^\ufeff/, '')) : raw; } catch { return { ok: false, message: '不是有效的 JSON 文件' }; }
  const list = Array.isArray(data) ? data : (data && Array.isArray(data.messages) ? data.messages : null);
  if (!list) return { ok: false, message: '文件里没有找到 messages 聊天记录' };
  if (data && !Array.isArray(data) && data.app && data.app !== '之间') return { ok: false, message: '这不是「之间」导出的聊天记录' };
  const out = [];
  let ts = Date.now() - list.length * 1000;
  for (const m of list) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') return { ok: false, message: '聊天记录格式不对（每条需要 role 和 content）' };
    const t = Number(m.ts);
    ts = Number.isFinite(t) && t > 0 ? t : ts + 1000;
    const item = { role: m.role, content: m.content.slice(0, 20000), ts };
    if (m.partial) item.partial = true;
    out.push(item);
  }
  if (!out.length) return { ok: false, message: '文件里的聊天记录是空的' };
  return { ok: true, messages: out.slice(-2000), persona: (data && data.persona) || null, mood: (data && data.mood) || null, memory: (data && data.memory && Array.isArray(data.memory.items)) ? data.memory : null };
}


// Windows 文件名里不能出现 \ / : * ? " < > | 和控制字符，结尾也不能是点或空格
function safeFileName(name, fallback = '聊天记录') {
  let s = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = `_${s}`;
  return s.slice(0, 80) || fallback;
}

module.exports = { parseChatFile, safeFileName };
