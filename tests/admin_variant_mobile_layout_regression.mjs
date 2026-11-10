import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';

const source = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const head = source.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] || '';
const css = [...head.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map(match => match[1]).join('\n');
assert.ok(css.includes('.variantAdminHead{display:none!important}') && css.includes('.variantMobileLabel{display:block'),
  'El admin define cabecera y etiquetas móviles del editor de variantes.');
assert.match(source, /<label class="variantAdminStockCell"><span class="variantMobileLabel">Stock<\/span><input class="variantAdminStock"/);

const chromium = process.env.CHROMIUM_BIN || (spawnSync('which', ['chromium'], { encoding: 'utf8' }).stdout || '').trim();
if (!chromium) {
  console.log('admin_variant_mobile_layout_regression: SKIP (Chromium no está instalado)');
  process.exit(0);
}

const row = `<div class="variantAdminTable">
  <div class="variantAdminRow variantAdminHead"><div>Color / HEX</div><div>Talla</div><div>Stock</div><div>Foto de esta referencia</div></div>
  <div class="variantAdminRow">
    <div class="variantAdminCell variantAdminColorCell"><span class="variantMobileLabel">Color / HEX</span><span class="variantColorPreview" style="background:#982342"></span><span>Rojo</span></div>
    <div class="variantAdminCell"><span class="variantMobileLabel">Talla</span>M</div>
    <label class="variantAdminStockCell"><span class="variantMobileLabel">Stock</span><input class="variantAdminStock" type="number" value="2"></label>
    <div class="variantPhotoCell"><span class="variantMobileLabel">Foto de esta referencia</span><input class="variantColorPhoto" type="file" accept="image/*"><div class="variantPhotoHint">Selecciona la foto correspondiente a Rojo / M</div></div>
  </div>
</div>`;
const fixture = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main id="variantEditorRows">${row}</main></body></html>`;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sirevya-variant-mobile-'));
const fixturePath = path.join(tempDir, 'admin-variants.html');
fs.writeFileSync(fixturePath, fixture);

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const port = await reservePort();
const browser = spawn(chromium, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1',
  '--remote-allow-origins=*', `--user-data-dir=${path.join(tempDir, 'profile')}`, 'about:blank',
], { stdio: 'ignore' });
let socket;
try {
  let version;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { version = await fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.json()); break; }
    catch { await sleep(100); }
  }
  assert.ok(version?.webSocketDebuggerUrl, 'Chromium DevTools endpoint starts');
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then(response => response.json());
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject, timer } = pending.get(message.id);
    clearTimeout(timer); pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message)); else resolve(message.result || {});
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await cdp('Page.enable'); await cdp('Runtime.enable');
  async function measure(width, mobile) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile });
    await cdp('Emulation.setTouchEmulationEnabled', mobile ? { enabled: true, maxTouchPoints: 1 } : { enabled: false });
    const loaded = new Promise(resolve => {
      const listener = event => {
        const message = JSON.parse(event.data);
        if (message.method === 'Page.loadEventFired') { socket.removeEventListener('message', listener); resolve(); }
      };
      socket.addEventListener('message', listener);
    });
    await cdp('Page.navigate', { url: `file://${fixturePath}` }); await loaded;
    await sleep(50);
    const evaluated = await cdp('Runtime.evaluate', {
      expression: `(() => { const root=document.documentElement,row=document.querySelector('.variantAdminRow:not(.variantAdminHead)'),head=document.querySelector('.variantAdminHead'),photo=document.querySelector('.variantPhotoCell'); const labels=[...document.querySelectorAll('.variantMobileLabel')]; return {viewport:root.clientWidth,headDisplay:getComputedStyle(head).display,rowWidth:row.clientWidth,rowScrollWidth:row.scrollWidth,photoGridColumn:getComputedStyle(photo).gridColumn,labels:labels.map(x=>getComputedStyle(x).display),stockInputWidth:document.querySelector('.variantAdminStock').getBoundingClientRect().width}; })()`,
      returnByValue: true,
    });
    const result = evaluated.result?.value;
    console.log(`admin-variant-layout width=${width}: ${JSON.stringify(result)}`);
    return result;
  }
  for (const [width, mobile] of [[390, true], [1280, false]]) {
    const layout = await measure(width, mobile);
    assert.ok(layout && layout.viewport === width, `Chromium viewport is ${width}px`);
    assert.ok(layout.rowWidth > 0 && layout.rowScrollWidth <= layout.rowWidth + 1,
      `${width}px: variant row has no horizontal overflow (${JSON.stringify(layout)})`);
    if (mobile) {
      assert.equal(layout.headDisplay, 'none', 'mobile hides the four-column desktop header');
      assert.ok(layout.labels.every(display => display === 'block'), 'mobile shows labels for color, size, stock, and photo');
      assert.equal(layout.photoGridColumn, '1 / -1', 'photo control uses the full row width on mobile');
      assert.ok(layout.stockInputWidth > 0, 'stock input remains visible and usable');
    } else {
      assert.notEqual(layout.headDisplay, 'none', 'desktop keeps the four-column header');
      assert.ok(layout.labels.every(display => display === 'none'), 'desktop keeps compact header without repeated labels');
    }
  }
} finally {
  try { socket?.close(); } catch {}
  const exited = new Promise(resolve => browser.once('exit', resolve));
  browser.kill('SIGTERM');
  await Promise.race([exited, sleep(3000).then(() => browser.kill('SIGKILL'))]);
  await sleep(250);
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
}
console.log('admin_variant_mobile_layout_regression: PASS (Chromium, mobile and desktop)');
