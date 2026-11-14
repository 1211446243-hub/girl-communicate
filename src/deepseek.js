'use strict';
// DeepSeek（OpenAI 兼容）流式客户端，主进程和 prompt-tests 共用
const DEFAULT_BASE = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-flash';

// 注意：DeepSeek 已于 2026-07-24 停用 deepseek-chat / deepseek-reasoner，当前名称为 deepseek-flash / deepseek-v4-pro。
// 新模型默认开启「思考模式」（慢、且忽略 temperature），聊天场景默认关闭。
async function* streamChat({ apiKey, baseUrl = DEFAULT_BASE, model = DEFAULT_MODEL, messages, temperature = 1.0, thinking = false, signal }) {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature, stream: true, thinking: { type: thinking ? 'enabled' : 'disabled' } }),
    signal
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch { /* ignore */ }
    throw new Error(describeHttpError(res.status, detail));
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content; // 思考内容 reasoning_content 不展示
        if (delta) yield delta;
      } catch { /* 忽略不完整的行 */ }
    }
  }
}

async function complete(opts) {
  let out = '';
  for await (const d of streamChat(opts)) out += d;
  return out;
}

function describeHttpError(status, detail) {
  const map = {
    401: 'API Key 无效或已失效（401）',
    402: '账户余额不足（402），请到 DeepSeek 开放平台充值',
    422: '请求参数有误（422），请检查模型名称',
    429: '请求太频繁（429），请稍后再试',
    500: 'DeepSeek 服务器错误（500），请稍后再试',
    503: 'DeepSeek 服务繁忙（503），请稍后再试'
  };
  return (map[status] || `请求失败（HTTP ${status}）`) + (detail ? `：${detail}` : '');
}

module.exports = { streamChat, complete, DEFAULT_BASE, DEFAULT_MODEL };
