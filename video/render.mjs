// Renders video/walkthrough.html to MP4 by driving headless Chrome frame-by-frame.
// Usage: node video/render.mjs                      -> video/out/how-it-works-silent.mp4 (+ poster in public/video);
//        then `python3 video/sound.py` adds the soundtrack
//        node video/render.mjs --cut short            -> 30-second edit (see CUTS in walkthrough.html)
//        node video/render.mjs --stills 2,9,20,30   -> PNG stills into --out dir for review
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FPS = 30;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const stills = arg('--stills');
const cutName = arg('--cut');
const langName = arg('--lang');
const outDir = resolve(arg('--out', join(root, 'public', 'video')));

const profile = mkdtempSync(join(tmpdir(), 'ss-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${profile}`,
  '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });

async function waitForDevtools() {
  for (let i = 0; i < 100; i++) {
    try { return await (await fetch('http://127.0.0.1:9333/json/version')).json(); } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  throw new Error('Chrome DevTools did not start');
}

await waitForDevtools();
const target = await (await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map(); const listeners = [];
ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
  else listeners.forEach(l => l(msg));
});
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
const loaded = new Promise(r => listeners.push(m => m.method === 'Page.loadEventFired' && r()));
await send('Page.navigate', { url: pathToFileURL(join(here, 'walkthrough.html')).href + '?render' + (cutName ? `&cut=${cutName}` : '') + (langName ? `&lang=${langName}` : '') });
await loaded;
await evaluate('document.fonts.ready.then(() => Promise.all([...document.images].map(i => i.decode())))');
const duration = await evaluate('window.DURATION');

async function shot(t, file, format = 'png') {
  await evaluate(`window.renderAt(${t})`);
  const { data } = await send('Page.captureScreenshot', format === 'png' ? { format } : { format, quality: 92 });
  writeFileSync(file, Buffer.from(data, 'base64'));
}

mkdirSync(outDir, { recursive: true });
if (stills) {
  for (const t of stills.split(',').map(Number)) await shot(t, join(outDir, `still-${String(t).replace('.', '_')}.png`));
  console.log('stills written to', outDir);
} else {
  const frames = mkdtempSync(join(tmpdir(), 'ss-frames-'));
  const total = Math.round(duration * FPS);
  for (let f = 0; f < total; f++) {
    await shot(f / FPS, join(frames, `${String(f).padStart(5, '0')}.jpg`), 'jpeg');
    if (f % 150 === 0) console.log(`frame ${f}/${total}`);
  }
  mkdirSync(join(here, 'out'), { recursive: true });
  const mp4 = join(here, 'out', `how-it-works${cutName ? '-' + cutName : ''}${langName ? '-' + langName : ''}-silent.mp4`);
  if (cutName) writeFileSync(join(here, 'out', `cut-${cutName}.json`), await evaluate('JSON.stringify(window.SEGMENTS)'));
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(frames, '%05d.jpg'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
  if (!cutName && !langName) await shot(16.2, join(outDir, 'how-it-works-poster.jpg'), 'jpeg');
  rmSync(frames, { recursive: true, force: true });
  console.log('wrote', mp4);
}

ws.close();
const exited = new Promise(r => chrome.once('exit', r));
chrome.kill();
await exited;
rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
