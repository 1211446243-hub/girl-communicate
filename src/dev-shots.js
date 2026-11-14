'use strict';
// 开发用：自动截图（ZHIJIAN_SHOTS=<输出目录> 时才会加载，不进入打包）。v1.5 新界面：18 起编号；v1.6：26 起。
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const store = require('./store');
const memory = require('./memory');

module.exports = function devShots(win, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const wc = win.webContents;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => wc.executeJavaScript(code);
  const shot = async (name) => { const img = await win.capturePage(); fs.writeFileSync(path.join(outDir, name), img.toPNG()); console.log('[shots]', name); };
  const hover = async (selector) => {
    const r = await js(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
    if (r) { wc.sendInputEvent({ type: 'mouseMove', x: r.x, y: r.y }); await sleep(120); wc.sendInputEvent({ type: 'mouseMove', x: r.x + 1, y: r.y + 1 }); }
    return r;
  };
  const t0 = Date.now() - 3 * 3600000;
  const seedHistory = [
    ['user', '今天面试终于结束了', 0], ['assistant', '诶！！怎么样怎么样|||面试官凶不凶', 1],
    ['user', '还行吧，就是问了好多项目细节', 2], ['assistant', '那你肯定答得很好（叉腰）|||小满说的，不许反驳', 3],
    ['user', '下周三会通知结果', 4], ['assistant', '那下周三我陪你一起等！|||等通知的时候不许乱想哦', 5],
    ['user', '好，我先去吃饭了', 6], ['assistant', '去吧去吧，多吃点|||吃完回来讲给我听今天吃了什么', 7]
  ].map(([role, content, i]) => ({ role, content, ts: t0 + i * 90000 }));

  wc.once('did-finish-load', async () => {
    try {
      await sleep(2600);
      // 18：首次启动引导（没有 Key、没有走过引导时自动弹出）
      await shot('18-新手引导-第1步-v1.5.png');
      await js(`zhijianApp.obStep(2)`); await sleep(500);
      await shot('18-新手引导-第2步-v1.5.png');
      await js(`document.querySelector('#onboard [data-ob="skip"]').click()`); await sleep(1200);

      // 19：未填 Key 也能浏览人设，悬停看示例对话
      await js(`zhijianApp.showView('picker')`); await sleep(900);
      await hover('#cards .card:nth-child(2)'); await sleep(700);
      await shot('19-人设卡片-悬停预览示例对话-v1.5.png');
      await hover('#cards .card:nth-child(1) .card-mood'); await sleep(600);
      await shot('19-人设卡片-悬停心情大图-v1.5.png');
      wc.sendInputEvent({ type: 'mouseMove', x: 5, y: 5 });

      // 20：痴迷人设首次进入的边界说明
      await js(`document.querySelector('#cards .card:last-child').click()`); await sleep(900);
      await shot('20-痴迷-首次说明-v1.5.png');
      await js(`document.querySelector('#noticeCancel').click()`); await sleep(400);

      // 准备一段可爱人设的聊天 + 记忆
      store.saveHistory('keai', seedHistory);
      store.saveMood('keai', { emotion: 'happy', intensity: 2, cause: '你分享了好消息', causeKey: 'goodnews', lastChatAt: Date.now() - 60000, updatedAt: Date.now() });
      memory.save(app.getPath('userData'), 'keai', { items: memory.merge([], ['希望被叫「阿宇」', '在读研二，计算机专业', '今天刚面试完，下周三出结果', '喜欢橘猫和火锅', '约好了吃完饭回来讲吃了什么']), lastExtractTurn: 4 });
      store.setApiKey('sk-demo000000000000000000demo');
      await js(`zhijianApp.selectPersona('keai')`); await sleep(1800);
      await js(`document.querySelector('#keyBanner').classList.add('hidden')`);

      // 21：她记得的事
      await js(`zhijianApp.openMemory()`); await sleep(700);
      await shot('21-她记得的事-v1.5.png');
      await js(`document.querySelector('#memClose').click()`); await sleep(300);

      // 26（v1.6）：记忆带时间；27（v1.6）：清空时询问是否一并清空记忆（默认勾选）
      const D = 86400000; const n0 = Date.now();
      memory.save(app.getPath('userData'), 'keai', { items: [
        { id: 'a', text: '希望被叫「阿宇」', type: 'profile', ts: n0 - 40 * D },
        { id: 'b', text: '在读研二，计算机专业', type: 'profile', ts: n0 - 12 * D },
        { id: 'c', text: '11月18日（周三）出面试结果', type: 'event', date: '2026-11-18', ts: n0 - 3 * D },
        { id: 'd', text: '喜欢橘猫和火锅', type: 'preference', ts: n0 - D },
        { id: 'e', text: '约好了吃完饭回来讲吃了什么', type: 'promise', ts: n0 }
      ], lastExtractTurn: 4 });
      await js(`zhijianApp.openMemory()`); await sleep(700);
      await shot('26-她记得的事-带时间-v1.6.png');
      await js(`document.querySelector('#memClose').click()`); await sleep(300);
      await js(`document.querySelector('#btnClear').click()`); await sleep(700);
      await shot('27-清空确认-一并清空记忆-v1.6.png');
      await js(`document.querySelector('#clearCancel').click()`); await sleep(300);

      // 22：搜索并高亮定位
      await js(`zhijianApp.openSearch(); document.querySelector('#searchInput').value = '下周三'; zhijianApp.runSearch('下周三')`); await sleep(900);
      await shot('22-聊天记录搜索-v1.5.png');
      await js(`document.querySelector('#searchClose').click()`); await sleep(300);

      // 23：发送失败可一键重试；悬停气泡出现复制 / 重新生成
      await js(`(() => { const box = document.querySelector('#messages'); const m = document.createElement('div'); m.className = 'msg me'; m.innerHTML = '<div class="bubble">吃完啦，今天吃的是番茄牛腩</div>'; box.appendChild(m); zhijianApp.startPlaceholder('keai'); zhijianApp.finishStream('keai', null, '请求太频繁（429），请稍后再试'); })()`);
      await sleep(700);
      await shot('23-发送失败-重试按钮-v1.5.png');
      await js(`document.querySelectorAll('#messages .msg.err').forEach((x) => x.remove()); document.querySelector('#messages .msg.me:last-of-type') && [...document.querySelectorAll('#messages .msg.me')].pop().remove()`);
      await js(`(() => { const all = document.querySelectorAll('#messages .msg.ai'); const l = all[all.length - 1]; l.classList.add('last-ai'); l.scrollIntoView({ block: 'center' }); })()`); await sleep(300);
      await hover('#messages .msg.ai.last-ai .bubble'); await sleep(500);
      await shot('23-悬停-复制与重新生成-v1.5.png');

      // 24：设置：高级设置折叠、记忆开关、托盘与通知
      await js(`zhijianApp.showView('settings')`); await sleep(900);
      await js(`document.querySelector('#memoryInput').scrollIntoView({ block: 'start' })`); await sleep(500);
      await shot('24-设置-记忆与高级设置折叠-v1.5.png');
      await js(`document.querySelector('#trayInput').scrollIntoView({ block: 'center' })`); await sleep(500);
      await shot('25-设置-托盘与通知-v1.5.png');
    } catch (e) { console.error('[shots] error', e); }
    setTimeout(() => { app.exit(0); }, 500);
  });
};
