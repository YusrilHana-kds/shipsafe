// Full-page phone screenshot via headless Chrome device emulation.
// Usage: node video/mobile-shot.mjs <url> <out.png> [width=390]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, out, w = '390'] = process.argv.slice(2);
const W = +w, H = 844;
const profile = mkdtempSync(join(tmpdir(), 'ss-m-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--remote-debugging-port=9334', `--user-data-dir=${profile}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 100; i++) { try { await (await fetch('http://127.0.0.1:9334/json/version')).json(); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
const t = await (await fetch('http://127.0.0.1:9334/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pend = new Map(); const evs = [];
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } else evs.forEach(f => f(m)); });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
const loaded = new Promise(r => evs.push(m => m.method === 'Page.loadEventFired' && r()));
await send('Page.navigate', { url });
await loaded;
await new Promise(r => setTimeout(r, 2500));
const { result } = await send('Runtime.evaluate', { expression: 'document.documentElement.scrollHeight', returnByValue: true });
const fullH = result.value;
const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: W, height: fullH, scale: 1 } });
writeFileSync(out, Buffer.from(data, 'base64'));
console.log('height', fullH);
ws.close(); const ex = new Promise(r => chrome.once('exit', r)); chrome.kill(); await ex;
rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
