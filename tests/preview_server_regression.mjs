import assert from 'node:assert/strict';
import vm from 'node:vm';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPreviewServer, DEMO_PRODUCTS, PREVIEW_CLIENT_SCRIPT, renderPreviewHtml } from '../scripts/preview-server.mjs';

const html = await renderPreviewHtml();
assert.match(html, /PREVIEW DE DESARROLLO/);
assert.match(html, /productos, stock y tarifas de envío son datos sintéticos \(no oferta real\)/);
assert.match(html, /pointer-events:none/);
assert.match(html, /pagos, pedidos, reservas y cambios reales están deshabilitados/);
assert.match(html, /DEMO-001/);
assert.match(html, /window\.__SIREVYA_PREVIEW_CLIENT__/);
assert.match(html, /noindex,nofollow/);
assert.match(html, /const WOMPI_PUBLIC_KEY="PREVIEW_DISABLED";/);
assert.match(html, /const sb=window\.__SIREVYA_PREVIEW_CLIENT__;/);
assert.doesNotMatch(html, /\b[a-z0-9-]+\.supabase\.co\b/i);
assert.doesNotMatch(html, /\b(?:sb_(?:publishable|secret)_[A-Za-z0-9_-]{8,}|pub_(?:test|prod)_[A-Za-z0-9_-]{8,})\b/i);
assert.doesNotMatch(html, /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/);
assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=\s*(["'])(?:https?:)?\/\//i);
assert.doesNotMatch(html, /<link\b[^>]*\bhref\s*=\s*(["'])(?:https?:)?\/\//i);
assert.doesNotMatch(html, /<a\b[^>]*\bhref\s*=\s*(["'])(?:https?:\/\/|\/\/|tel:|mailto:|javascript:)/i);

const alternateSource = `<!doctype html><html><head><meta http-equiv="refresh" content="0; url=https://outside.example"><link rel="stylesheet" href="https://cdn.example/style.css"><script src="https://cdn.example/sdk.js"></script></head><body><a href="https://checkout.wompi.co/p/demo">pay</a><form action="https://example.com/submit"></form><script>
let SUPABASE_URL = 'https://another-project.supabase.co';
var SUPABASE_KEY = 'eyJabcdefghijklmnop.abcdefghijk.abcdefghijk';
const WOMPI_PUBLIC_KEY = 'pub_prod_fake_testing_key_123456789';
let WOMPI_SIGNATURE_ENDPOINT = SUPABASE_URL + '/functions/v1/wompi-create-checkout';
const IMAGE_WORKER_URL = 'https://images.example.workers.dev';
const sb=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
const previewMarker='first-version';
</script></body></html>`;
const alternateHtml = await renderPreviewHtml({
  sourceHtml: alternateSource,
  version: { branch: 'preview/development', commit: 'abc123', dirty: false },
});
assert.match(alternateHtml, /first-version/);
assert.doesNotMatch(alternateHtml, /another-project\.supabase\.co|cdn\.example|checkout\.wompi\.co|example\.com\/submit/i);
assert.doesNotMatch(alternateHtml, /pub_prod_fake|eyJabcdefghijklmnop/);
assert.doesNotMatch(alternateHtml, /http-equiv="refresh"/i);
assert.match(alternateHtml, /const sb=window\.__SIREVYA_PREVIEW_CLIENT__;/);
const adversarialSource = alternateSource
  .replace('<head>', `<head><script>window.open('https://checkout.wompi.co/p/demo'); const apiUrl='https://api.example.com/data'; window.__headProbe=true;</script><script src=https://cdn.example/unquoted.js></script>`)
  .replace('<a href="https://checkout.wompi.co/p/demo">pay</a>', '<a href=data:text/html,blocked>data</a><area href=blob:https://preview.test/id>blob</area>')
  .replace('<form action="https://example.com/submit"></form>', '<form action=javascript:alert(1)><input formaction=mailto:demo@example.com><button formaction=blob:https://preview.test/id></button></form><iframe src=https://evil.example></iframe><area href=tel:12345>tel</area>');
const adversarialHtml = await renderPreviewHtml({
  sourceHtml: adversarialSource,
  version: { branch: 'preview/development', commit: 'abc123', dirty: false },
});
assert.ok(adversarialHtml.indexOf('data-sirevya-preview="safe-client"') < adversarialHtml.indexOf('window.__headProbe=true'), 'El guard se ejecuta antes que scripts inline del head.');
const adversarialWithoutXmlNamespaces = adversarialHtml.replace(/\bxmlns(?::[\w.-]+)?\s*=\s*(["'])http:\/\/www\.w3\.org\/[^"']*\1/gi, '');
assert.doesNotMatch(adversarialWithoutXmlNamespaces, /https?:\/\/|href\s*=\s*["']?(?:data:|blob:|javascript:|mailto:|tel:)|action\s*=\s*["']?(?:data:|blob:|javascript:|mailto:|tel:)|formaction\s*=\s*["']?(?:data:|blob:|javascript:|mailto:|tel:)/i);
assert.doesNotMatch(adversarialHtml, /<iframe\b|<script\b[^>]*\bsrc\s*=/i);
await assert.rejects(
  renderPreviewHtml({
    sourceHtml: alternateSource.replace("const previewMarker='first-version';", "window.location.href='https://checkout.wompi.co/p/demo';"),
    version: { branch: 'preview/development', commit: 'abc123', dirty: false },
  }),
  /navegación programática/,
);
for (const assignment of [
  'location = target;',
  "const target='https:'+'/'+'/evil.example'; globalThis['loc'+'ation'] = target;",
  "window['location']['href'] = target;",
]) {
  await assert.rejects(
    renderPreviewHtml({
      sourceHtml: alternateSource.replace("const previewMarker='first-version';", assignment),
      version: { branch: 'preview/development', commit: 'abc123', dirty: false },
    }),
    /navegación programática/,
    `Rechaza navegación calculada: ${assignment}`,
  );
}
for (const assignment of [
  "const OTHER_API_KEY='unrecognized_test_credential_123456';",
  "const API_KEY='unrecognized_test_credential_123456';",
  'let ACCESS_TOKEN=`unrecognized_test_credential_123456`;',
  "const CLIENT_SECRET='unrecognized_test_credential_123456';",
]) {
  await assert.rejects(
    renderPreviewHtml({
      sourceHtml: alternateSource.replace("const previewMarker='first-version';", assignment),
      version: { branch: 'preview/development', commit: 'abc123', dirty: false },
    }),
    /asignación de credencial/,
    `Rechaza asignación de credencial: ${assignment.split('=')[0]}`,
  );
}
const safePlaceholderHtml = await renderPreviewHtml({
  sourceHtml: alternateSource.replace("const previewMarker='first-version';", "const API_KEY='PREVIEW_DISABLED';"),
  version: { branch: 'preview/development', commit: 'abc123', dirty: false },
});
assert.match(safePlaceholderHtml, /const API_KEY='PREVIEW_DISABLED';/);

let nativeFetchCalls = 0;
const handlers = {};
const location = { origin: 'http://preview.test', href: 'http://preview.test/' };
const window = {
  location,
  document: { addEventListener: (name, handler) => { handlers[name] = handler; } },
  HTMLFormElement: function MockForm() {},
  navigator: { sendBeacon: () => true },
  fetch: async () => { nativeFetchCalls += 1; return new Response('asset'); },
  open: () => { throw new Error('window.open no debe navegar desde preview'); },
};
vm.runInNewContext(PREVIEW_CLIENT_SCRIPT, { window, location, URL, Response, console });
const client = window.__SIREVYA_PREVIEW_CLIENT__;
const catalog = await client.rpc('get_public_catalog');
assert.equal(catalog.error, null);
assert.equal(catalog.data.length, DEMO_PRODUCTS.length);
assert.equal(catalog.data[0].code, 'DEMO-001');
assert.equal(catalog.data[0].quantity, 4, 'La cantidad mostrada pertenece a fixtures sintéticos.');
const shipping = await client.rpc('get_public_storefront_shipping_settings');
assert.equal(shipping.data.success, true);
assert.equal((await client.rpc('get_online_payment_status')).data.online_payments_enabled, false);
assert.equal((await client.rpc('get_public_storefront_cod_settings')).data.enabled, false);
for (const name of ['get_storefront_cart_quote', 'attach_inventory_reservation', 'release_inventory_reservation', 'create_contra_delivery_order_with_quote', 'record_storefront_marketing_event']) {
  const result = await client.rpc(name, { preview: true });
  assert.equal(result.data, null, `${name} no debe producir un resultado operativo.`);
  assert.equal(result.error.code, 'PREVIEW_BLOCKED');
}
const directRead = await client.from('products').select('id,description').eq('id', 'preview-corset-001').maybeSingle();
assert.equal(directRead.data.code, 'DEMO-001');
const write = await client.from('products').insert({ id: 'real' });
assert.equal(write.error.code, 'PREVIEW_BLOCKED');
assert.equal((await client.functions.invoke('wompi-create-checkout', { body: {} })).error.code, 'PREVIEW_BLOCKED');
assert.equal(await client.auth.getSession().then(result => result.data.session), null);

const external = await window.fetch('https://example.com/should-not-leave-preview');
assert.equal(external.status, 403);
const localBackend = await window.fetch('/__preview_api/functions/v1/wompi-create-checkout');
assert.equal(localBackend.status, 403);
const localAsset = await window.fetch('/__preview_assets/demo.svg');
assert.equal(localAsset.status, 200);
assert.equal(nativeFetchCalls, 1, 'Solo se delega al servidor local el asset sintético permitido.');
assert.equal(window.navigator.sendBeacon('https://example.com/telemetry', '{}'), false);
assert.throws(() => new window.XMLHttpRequest(), /deshabilitada/);
assert.throws(() => new window.WebSocket(), /deshabilitada/);
assert.throws(() => new window.EventSource(), /deshabilitada/);
assert.equal(window.open('https://checkout.wompi.co/p/demo'), null);
assert.throws(() => new window.HTMLFormElement().submit(), /Formulario deshabilitado/);
assert.throws(() => new window.HTMLFormElement().requestSubmit(), /Formulario deshabilitado/);
let navigationPrevented = false;
handlers.click({
  target: { closest: () => ({ href: 'https://checkout.wompi.co/p/demo' }) },
  preventDefault() { navigationPrevented = true; },
  stopImmediatePropagation() {},
});
assert.equal(navigationPrevented, true, 'Los clics externos se cancelan en captura.');
navigationPrevented = false;
handlers.click({
  target: { closest: () => ({ href: 'blob:http://preview.test/id' }) },
  preventDefault() { navigationPrevented = true; },
  stopImmediatePropagation() {},
});
assert.equal(navigationPrevented, true, 'Los esquemas blob también se cancelan.');
let submitPrevented = false;
handlers.submit({ preventDefault() { submitPrevented = true; }, stopImmediatePropagation() {} });
assert.equal(submitPrevented, true, 'Todos los formularios quedan deshabilitados.');

async function checkServer(server, base) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const localBase = base || `http://127.0.0.1:${address.port}`;
  return localBase;
}

const actualServer = createPreviewServer();
const actualBase = await checkServer(actualServer);
try {
  const response = await fetch(actualBase + '/');
  assert.equal(response.status, 200);
  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /navigate-to 'self'/);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.match(await response.text(), /PREVIEW DE DESARROLLO/);
  const versionResponse = await fetch(actualBase + '/__version');
  const version = await versionResponse.json();
  assert.equal(version.status, 'ready');
  assert.equal(version.branch, 'preview/development');
  assert.ok(version.commit);
  const apiResponse = await fetch(actualBase + '/__preview_api/rest/v1/rpc/create_contra_delivery_order_with_quote', { method: 'POST', body: '{}' });
  assert.equal(apiResponse.status, 403);
  const assetResponse = await fetch(actualBase + '/__preview_assets/products/demo.svg');
  assert.equal(assetResponse.status, 200);
  assert.match(assetResponse.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await assetResponse.text(), /imagen sintética/);
  assert.equal((await fetch(actualBase + '/admin.html')).status, 404);
} finally {
  actualServer.close();
  await once(actualServer, 'close');
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'sirevya-preview-refresh-'));
const tempServer = createPreviewServer({
  root: tempRoot,
  versionProvider: () => ({ branch: 'preview/development', commit: 'test-refresh', dirty: false, data: 'synthetic', writes: false }),
});
try {
  await writeFile(path.join(tempRoot, 'index.html'), alternateSource.replace('first-version', 'refresh-version-one'));
  const tempBase = await checkServer(tempServer);
  const first = await (await fetch(tempBase + '/')).text();
  assert.match(first, /refresh-version-one/);
  await writeFile(path.join(tempRoot, 'index.html'), alternateSource.replace('first-version', 'refresh-version-two'));
  const second = await (await fetch(tempBase + '/')).text();
  assert.match(second, /refresh-version-two/);
  assert.doesNotMatch(second, /refresh-version-one/);
} finally {
  tempServer.close();
  await once(tempServer, 'close');
  await rm(tempRoot, { recursive: true, force: true });
}

console.log('preview_server_regression: OK (fixtures sintéticos; credenciales y hosts scrubbed; navegación, red, pagos, pedidos, reservas e inventario real bloqueados; refresh sin cache)');
