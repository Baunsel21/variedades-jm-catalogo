import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const head = source.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1];
const tickerMarkup = source.match(/<div class="jmTicker">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/)?.[0];
assert.ok(head && tickerMarkup, 'Fixture usa head y markup real del ticker.');
const css = [...head.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((match) => match[1]).join('\n');
assert.ok(css.includes('.jmTickerTrack') && css.includes('@keyframes jmTickerMove'), 'Fixture conserva CSS real del ticker.');

const probe = `
(() => {
  const ticker = document.querySelector('.jmTicker');
  const track = document.querySelector('.jmTickerTrack');
  const text = track?.querySelector('.jmTickerSequence span');
  if (!ticker || !track || !text) { window.__tickerResult = { error: 'ticker markup missing' }; return; }
  const positions = [];
  const start = performance.now();
  const sample = () => {
    positions.push(text.getBoundingClientRect().left);
    if (performance.now() - start < 2200) requestAnimationFrame(sample);
    else {
      const style = getComputedStyle(track);
      const xs = positions.filter(Number.isFinite);
      window.__tickerResult = {
        width: document.documentElement.clientWidth,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        noPreference: matchMedia('(prefers-reduced-motion: no-preference)').matches,
        animationName: style.animationName,
        animationDuration: style.animationDuration,
        animationPlayState: style.animationPlayState,
        tickerWidth: ticker.clientWidth,
        scrollWidth: ticker.scrollWidth,
        textExcursion: xs.length ? Math.max(...xs) - Math.min(...xs) : 0,
        changedSamples: xs.slice(1).filter((x, i) => Math.abs(x - xs[i]) > 0.05).length,
        sampleCount: xs.length,
      };
    }
  };
  requestAnimationFrame(sample);
})();`;

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${tickerMarkup}<script>${probe}</script></body></html>`;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sirevya-ticker-cdp-'));
const fixturePath = path.join(tempDir, 'ticker.html');
fs.writeFileSync(fixturePath, html);

const chromium = process.env.CHROMIUM_BIN || (spawnSync('which', ['chromium'], { encoding: 'utf8' }).stdout || '').trim();
if (!chromium) {
  console.log('ticker_animation_browser_regression: SKIP (Chromium no está instalado)');
  process.exit(0);
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const port = await reservePort();
const browser = spawn(chromium, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1',
  '--remote-allow-origins=*', `--user-data-dir=${path.join(tempDir, 'profile')}`, 'about:blank',
], { stdio: 'ignore' });
let socket;

try {
  let version;
  for (let i = 0; i < 60; i++) {
    try {
      version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
      break;
    } catch { await sleep(100); }
  }
  assert.ok(version?.webSocketDebuggerUrl, 'Chromium DevTools endpoint starts.');
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then((response) => response.json());
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject, timer } = pending.get(message.id);
    clearTimeout(timer);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result || {});
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });

  await cdp('Page.enable');
  await cdp('Runtime.enable');
  const fileUrl = `file://${fixturePath}`;
  async function measure(width, reducedMotion) {
    const mobile = width <= 700;
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile });
    await cdp('Emulation.setTouchEmulationEnabled', mobile ? { enabled: true, maxTouchPoints: 1 } : { enabled: false });
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }] });
    const loaded = new Promise((resolve) => {
      const listener = (event) => {
        const message = JSON.parse(event.data);
        if (message.method === 'Page.loadEventFired') {
          socket.removeEventListener('message', listener);
          resolve();
        }
      };
      socket.addEventListener('message', listener);
    });
    await cdp('Page.navigate', { url: fileUrl });
    await loaded;
    if (!mobile) await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: width - 2, y: 898 });
    await sleep(2450);
    const result = await cdp('Runtime.evaluate', { expression: 'window.__tickerResult', returnByValue: true });
    const measurement = result.result?.value;
    console.log(`ticker-measurement width=${width} reduced=${reducedMotion}: ${JSON.stringify(measurement)}`);
    return measurement;
  }

  for (const width of [320, 360, 390, 430, 700, 1280]) {
    const result = await measure(width, false);
    assert.ok(result && !result.error, `width ${width}: probe returned a measurement`);
    assert.equal(result.reducedMotion, false, `width ${width}: normal-motion preference is active`);
    assert.equal(result.noPreference, true, `width ${width}: browser reports no preference to reduce motion`);
    assert.equal(result.animationName, 'jmTickerMove', `width ${width}: ticker CSS animation is enabled`);
    assert.equal(result.animationPlayState, 'running', `width ${width}: ticker animation is not paused`);
    assert.ok(result.scrollWidth > result.tickerWidth, `width ${width}: full ticker content exceeds the viewport`);
    assert.ok(result.textExcursion > 8 && result.changedSamples >= 8, `width ${width}: rendered message moved (${JSON.stringify(result)})`);
    console.log(`ticker-motion width=${width}: moved ${result.textExcursion.toFixed(1)}px in 2.2s (${result.changedSamples} changing frames)`);
  }

  await measure(390, false);
  const focused = await cdp('Runtime.evaluate', { expression: `(() => { const ticker=document.querySelector('.jmTicker'); const track=ticker?.querySelector('.jmTickerTrack'); if(!ticker||!track)return null; ticker.tabIndex=0; ticker.focus(); return {focusWithin:ticker.matches(':focus-within'),playState:getComputedStyle(track).animationPlayState}; })()`, returnByValue: true });
  assert.equal(focused.result?.value?.focusWithin, true, 'mobile ticker can receive focus for the accessible pause');
  assert.equal(focused.result?.value?.playState, 'paused', 'focus-within pauses autoplay at 390px');
  const resumed = await cdp('Runtime.evaluate', { expression: `(() => { const ticker=document.querySelector('.jmTicker'); ticker?.blur(); return getComputedStyle(ticker?.querySelector('.jmTickerTrack')).animationPlayState; })()`, returnByValue: true });
  assert.equal(resumed.result?.value, 'running', 'removing focus resumes normal autoplay at 390px');

  const reduced = await measure(390, true);
  assert.ok(reduced && !reduced.error, 'reduced-motion probe returned a measurement');
  assert.equal(reduced.reducedMotion, true, 'explicit reduced-motion preference is recognized');
  assert.equal(reduced.animationName, 'none', 'reduced-motion intentionally disables autoplay');
  assert.ok(reduced.scrollWidth > reduced.tickerWidth, 'reduced-motion keeps the text manually accessible');
  assert.ok(reduced.textExcursion < 2, 'reduced-motion does not animate the message');
  console.log('ticker-motion width=390 reduced-motion: autoplay off, text remains accessible');
} finally {
  try { socket?.close(); } catch {}
  const exited = new Promise((resolve) => browser.once('exit', resolve));
  browser.kill('SIGTERM');
  await Promise.race([exited, sleep(3000).then(() => browser.kill('SIGKILL'))]);
  await sleep(250);
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
}

console.log('ticker_animation_browser_regression: PASS (actual rendered text movement)');
