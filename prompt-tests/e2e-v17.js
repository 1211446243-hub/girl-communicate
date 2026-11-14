'use strict';
// v1.7 端到端冒烟（真实 DeepSeek，需要 DEEPSEEK_API_KEY；不会打印或保存 Key）：
// xvfb-run -a npx electron prompt-tests/e2e-v17.js
// 覆盖：「正在输入…」延迟、追发排队 / 打字取消 / 真实发出、主动消息调度与未回上限、写入记录并标记 proactive、设置项保存。
const path = require('path');
const fs = require('fs');
const PROJ = path.join(__dirname, '..');
const UD = path.join(require('os').tmpdir(), 'zj-e2e-v17');
fs.rmSync(UD, { recursive: true, force: true });
process.env.ZHIJIAN_USER_DATA = UD;
process.env.ZHIJIAN_USE_ENV_KEY = '1';
process.env.ZHIJIAN_E2E = '1';
process.env.ZHIJIAN_FOLLOW_MS = '4000';
const { app, BrowserWindow } = require('electron');
require(path.join(PROJ, 'src', 'main.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[e2e]', ...a);
const hist = (id) => { try { return JSON.parse(fs.readFileSync(path.join(UD, 'history', `${id}.json`), 'utf8')); } catch { return []; } };
app.whenReady().then(async () => {
  await sleep(3500);
  const T = global.__zhijianTest;
  const store = require(path.join(PROJ, 'src', 'store.js'));
  const win = BrowserWindow.getAllWindows()[0];
  const js = (c) => win.webContents.executeJavaScript(c);
  const waitIdle = async () => { for (let i = 0; i < 120; i++) { await sleep(250); if (await js('Object.keys(zhijianApp.state.streaming).length === 0')) return; } };
  try {
    log('settings defaults:', JSON.stringify({ followUp: store.getSettings().followUp, proactive: store.getSettings().proactive }));
    await js(`document.querySelector('#onboard [data-ob="skip"]') && document.querySelector('#onboard [data-ob="skip"]').click()`);
    await js(`zhijianApp.selectPersona('keai')`); await sleep(1500);
    store.saveSettings({ followUp: 'off' }); // 先关掉，避免第一轮自动排追发干扰计时
    // 1) 回复延迟：发送后至少 1 秒才出现；期间显示「正在输入…」和三个点
    const t0 = Date.now();
    await js(`document.querySelector('#input').value = '今晚跟室友去吃火锅了，点了好多毛肚'; document.querySelector('#composer').requestSubmit();`);
    await sleep(300);
    const typing = await js(`[document.querySelector('#chatStatus').textContent.includes('正在输入'), !!document.querySelector('#messages .msg.ai:last-child .typing-dots')]`);
    let shownAt = 0;
    for (let i = 0; i < 240 && !shownAt; i++) { await sleep(100); if (await js('Object.keys(zhijianApp.state.streaming).length === 0')) shownAt = Date.now(); }
    log('typing shown:', typing.join(','), 'reply after ms:', shownAt - t0, '(>=1000:', shownAt - t0 >= 1000, ')');
    // 2) 追发：排队 → 打字取消
    store.saveSettings({ followUp: 'normal' });
    let plan = null; for (let i = 0; i < 40 && !plan; i++) plan = T.scheduleFollowUp('keai');
    log('follow-up scheduled:', !!plan, 'topics:', plan && plan.topics.join(' / '));
    await js(`document.querySelector('#input').value = '我'; document.querySelector('#input').dispatchEvent(new Event('input'))`); await sleep(400);
    log('typing cancels follow-up:', !T.followTimers.has('keai'));
    await js(`document.querySelector('#input').value = ''`);
    // 3) 追发真实发出：4 秒后生成，界面先显示三个点再出现，记录里标记 proactive
    plan = null; for (let i = 0; i < 40 && !plan; i++) plan = T.scheduleFollowUp('keai');
    const n0 = hist('keai').length;
    let sawDots = false;
    for (let i = 0; i < 160; i++) {
      await sleep(250);
      if (await js(`!!document.querySelector('#messages .msg.proactive .typing-dots')`)) sawDots = true;
      if (hist('keai').length > n0 && !(await js(`!!document.querySelector('#messages .msg.proactive .typing-dots')`))) break;
    }
    await sleep(300);
    let h = hist('keai');
    const fu = h[h.length - 1];
    log('follow-up sent:', fu && fu.proactive === true && fu.kind === 'followup', 'saw typing dots:', sawDots, 'rendered:', await js(`document.querySelectorAll('#messages .msg.proactive .bubble:not(.typing-hold)').length > 0 && !document.querySelector('#messages .msg.proactive .typing-dots')`));
    log('follow-up text:', fu && fu.content);
    log('no regen button on proactive:', await js(`!document.querySelector('#messages .msg.proactive [data-act="regen"]')`));
    log('no chained follow-up:', T.scheduleFollowUp('keai') === null);
    // 4) 主动消息：把记录挪到 9 小时前，调度应放行；发出后（未回复）不再继续发
    store.saveSettings({ proactive: 'rare' });
    const shift = 9 * 3600000;
    store.saveHistory('keai', hist('keai').filter((m) => !m.proactive).map((m) => ({ ...m, ts: m.ts - shift })));
    const hr = new Date().getHours() + new Date().getMinutes() / 60;
    const inWin = hr >= 8.5 && hr < 23.5;
    const picked = T.proactiveTick();
    log('proactive tick picked:', picked, '(in window:', inWin, ')');
    if (picked) {
      for (let i = 0; i < 120 && !T.pending.size === false; i++) await sleep(250);
      for (let i = 0; i < 120 && T.pending.size; i++) await sleep(250);
      await sleep(3500);
      h = hist('keai');
      const pm = h[h.length - 1];
      log('proactive sent:', pm.proactive === true && pm.kind === 'proactive', 'text:', pm.content);
      log('proactive count saved:', JSON.stringify(store.getProactiveState().personas.keai));
      log('second tick blocked (unanswered ≤1):', T.proactiveTick() === null);
      log('rendered in chat:', await js(`document.querySelectorAll('#messages .msg.proactive').length`));
    }
    // 5) 你回来了：正常回复，主动消息参与上下文
    await js(`document.querySelector('#input').value = '刚忙完，你在干嘛'; document.querySelector('#composer').requestSubmit();`); await sleep(300); await waitIdle(); await sleep(400);
    h = hist('keai');
    log('reply after proactive:', h[h.length - 1].role === 'assistant' && !h[h.length - 1].proactive, h[h.length - 1].content);
    // 6) 设置页
    await js(`zhijianApp.showView('settings')`); await sleep(500);
    await js(`document.querySelector('#followUpInput').value = 'off'; document.querySelector('#proactiveInput').value = 'normal'; document.querySelector('#btnSaveProactive').click()`); await sleep(500);
    log('settings saved:', JSON.stringify({ followUp: store.getSettings().followUp, proactive: store.getSettings().proactive }));
    log('electron:', process.versions.electron, 'app package version:', require(path.join(PROJ, 'package.json')).version);
    await js(`document.querySelector('#followUpInput').closest('.panel').scrollIntoView()`); await sleep(300); // 截图避开 Key 区域
    await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(__dirname, 'round11-v1.7', 'e2e-settings.png'), img.toPNG()));
    await js(`zhijianApp.showView('chat')`); await sleep(600);
    await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(__dirname, 'round11-v1.7', 'e2e-chat.png'), img.toPNG()));
  } catch (e) { log('ERROR', e && e.stack); }
  app.exit(0);
});
