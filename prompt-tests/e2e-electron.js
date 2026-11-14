'use strict';
// 端到端冒烟测试（真实 DeepSeek 调用，需要 DEEPSEEK_API_KEY；不会打印或保存 Key）：
// npx electron prompt-tests/e2e-electron.js   （Linux 无桌面时用 xvfb-run）
const path = require('path');
const fs = require('fs');
const PROJ = path.join(__dirname, '..');
const UD = path.join(require('os').tmpdir(), 'zj-e2e-ud');
process.env.ZHIJIAN_USER_DATA = UD;
process.env.ZHIJIAN_USE_ENV_KEY = '1';
const { app, BrowserWindow } = require('electron');
require(path.join(PROJ, 'src', 'main.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[e2e]', ...a);
const hist = (id) => { try { return JSON.parse(fs.readFileSync(path.join(UD, 'history', `${id}.json`), 'utf8')); } catch { return []; } };
app.whenReady().then(async () => {
  await sleep(3500);
  const win = BrowserWindow.getAllWindows()[0];
  const js = (c) => win.webContents.executeJavaScript(c);
  const waitIdle = async () => { for (let i = 0; i < 120; i++) { await sleep(500); if (await js('Object.keys(zhijianApp.state.streaming).length === 0')) return; } };
  const say = async (t) => { await js(`document.querySelector('#input').value = ${JSON.stringify(t)}; document.querySelector('#composer').requestSubmit();`); await sleep(300); await waitIdle(); await sleep(400); };
  try {
    await js(`document.querySelector('#onboard [data-ob="skip"]') && document.querySelector('#onboard [data-ob="skip"]').click()`);
    await js(`zhijianApp.selectPersona('keai')`); await sleep(1500);
    await say('你好呀，我叫阿宇，在读研二');
    let h = hist('keai'); log('send ok:', h.length === 2 && h[1].role === 'assistant');
    const first = h[1].content;
    await js(`[...document.querySelectorAll('#messages .msg.ai.last-ai [data-act="regen"]')].pop().click()`); await sleep(300); await waitIdle(); await sleep(400);
    h = hist('keai'); log('regen ok:', h.length === 2, 'changed:', h[1].content !== first);
    // 失败 + 重试
    const store = require(path.join(PROJ, 'src', 'store.js'));
    store.saveSettings({ baseUrl: 'https://127.0.0.1:9' });
    await say('下周三我有个面试');
    const errBtn = await js(`!!document.querySelector('#messages .msg.err .retry')`);
    h = hist('keai'); log('failure shows retry:', errBtn, 'user saved:', h[h.length - 1].role === 'user');
    store.saveSettings({ baseUrl: 'https://api.deepseek.com' });
    await js(`document.querySelector('#messages .msg.err .retry').click()`); await sleep(300); await waitIdle(); await sleep(400);
    h = hist('keai'); log('retry ok:', h.length === 4 && h[3].role === 'assistant' && h.filter((m) => m.content === '下周三我有个面试').length === 1);
    // 没有 Key 时原文保留在输入框
    process.env.ZHIJIAN_USE_ENV_KEY = '0';
    await js(`document.querySelector('#input').value = '没key的一句'; document.querySelector('#composer').requestSubmit();`); await sleep(1200);
    log('no-key keeps input:', await js(`document.querySelector('#input').value`) === '没key的一句', 'not saved:', hist('keai').length === 4);
    process.env.ZHIJIAN_USE_ENV_KEY = '1';
    await js(`document.querySelector('#input').value = ''`);
    await say('我超喜欢橘猫，讨厌香菜');
    // 记忆：换人设时强制提炼
    await js(`zhijianApp.selectPersona('gaoleng')`); await sleep(9000);
    let mem = null; try { mem = JSON.parse(fs.readFileSync(path.join(UD, 'memory', 'keai.json'), 'utf8')); } catch {}
    log('memory extracted:', mem ? mem.items.map((x) => x.text) : null);
    // 记忆注入后回来问
    await js(`zhijianApp.selectPersona('keai')`); await sleep(1500);
    await say('你还记得我下周有什么事吗');
    h = hist('keai'); log('memory recall reply:', h[h.length - 1].content.slice(0, 80));
    // 清空 → 备份 → 撤销
    const n = h.length;
    const memFile = path.join(UD, 'memory', 'keai.json');
    const memBefore = fs.existsSync(memFile) ? JSON.parse(fs.readFileSync(memFile, 'utf8')).items.length : 0;
    await js(`document.querySelector('#btnClear').click()`); await sleep(600);
    log('clear modal shown:', await js(`!document.querySelector('#clearModal').classList.contains('hidden')`), 'memory checkbox default checked:', await js(`document.querySelector('#clearMemInput').checked`));
    await js(`document.querySelector('#clearOk').click()`); await sleep(1200);
    const backups = fs.readdirSync(path.join(UD, 'backups'));
    log('cleared:', hist('keai').length === 0, 'backup files:', backups.length, 'memory cleared too:', memBefore > 0 && !fs.existsSync(memFile));
    await js(`document.querySelector('#toast .toast-act').click()`); await sleep(1200);
    const memAfter = fs.existsSync(memFile) ? JSON.parse(fs.readFileSync(memFile, 'utf8')).items : [];
    log('undo restored:', hist('keai').length === n, 'rendered msgs:', await js(`document.querySelectorAll('#messages .msg').length`), 'memory restored:', memAfter.length === memBefore, 'items have ts:', memAfter.every((x) => Number(x.ts) > 0));
    // 搜索
    await js(`zhijianApp.openSearch(); zhijianApp.runSearch('面试')`); await sleep(300);
    log('search hits:', await js(`document.querySelectorAll('#messages mark.hl').length`));
    // 托盘：关闭窗口应隐藏而不是退出
    win.close(); await sleep(800);
    log('close→tray hidden:', !win.isDestroyed() && !win.isVisible());
  } catch (e) { log('ERROR', e && e.stack); }
  app.exit(0);
});
