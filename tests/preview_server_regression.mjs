import assert from 'node:assert/strict';
import vm from 'node:vm';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPreviewServer, DEMO_ADMIN_ROWS, DEMO_PRODUCTS, PREVIEW_ADMIN_CLIENT_SCRIPT, PREVIEW_ADMIN_USER, PREVIEW_CLIENT_SCRIPT, renderPreviewHtml } from '../scripts/preview-server.mjs';

const html = await renderPreviewHtml();
const standalonePrivacyHtml = await readFile(new URL('../politica-privacidad.html', import.meta.url), 'utf8');
const standaloneFaqHtml = await readFile(new URL('../preguntas-frecuentes.html', import.meta.url), 'utf8');
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
assert.equal((html.match(/href="\/politica-privacidad\.html"/g) || []).length, 2, 'Catálogo/modal y checkout enlazan la página de privacidad.');
assert.equal((html.match(/href="\/preguntas-frecuentes\.html"/g) || []).length, 3, 'Catálogo, modal y checkout enlazan la FAQ.');
assert.equal((html.match(/href="\/cambios-devoluciones\.html"/g) || []).length, 1, 'El pie de la tienda de preview enlaza la página informativa nueva.');
for (const section of ['1. Responsable del tratamiento', '2. Datos que podemos recolectar', '3. Finalidades del tratamiento', '4. Autorización', '5. Encargados y terceros', '6. Seguridad', '7. Derechos del titular', '8. Consultas, reclamos y solicitudes', '9. Vigencia y cambios']) {
  assert.ok(html.includes(section), `El modal conserva ${section}.`);
  assert.ok(standalonePrivacyHtml.includes(section), `La página estática publica ${section}.`);
}
assert.ok(standalonePrivacyHtml.includes('Esta política es un texto informativo preparado para el funcionamiento actual del catálogo.'));
assert.doesNotMatch(standalonePrivacyHtml, /<script\b|<iframe\b/i);
assert.doesNotMatch(standalonePrivacyHtml, /<(?:img|script|iframe|source|audio|video)\b[^>]*\b(?:src|href)\s*=\s*["']https?:\/\//i);
assert.doesNotMatch(standalonePrivacyHtml, /<link\b(?=[^>]*rel=["'](?:stylesheet|preload|preconnect)["'])[^>]*href=["']https?:\/\//i);
for (const question of ['¿Cómo encuentro un producto?', '¿Dónde consulto tallas, colores o detalles de un producto?', '¿Cómo se calcula el envío?', '¿Qué medios de pago están disponibles?', '¿Puedo pagar contraentrega?', '¿Cómo contacto a Sirevya?', '¿Puedo consultar precios y disponibilidad sin conexión?']) {
  assert.ok(standaloneFaqHtml.includes(question), `La FAQ incluye ${question}.`);
}
assert.ok(standaloneFaqHtml.includes('Esta guía no reemplaza las políticas comerciales de la tienda.'));
assert.doesNotMatch(standaloneFaqHtml, /<script\b|<iframe\b/i);
assert.doesNotMatch(standaloneFaqHtml, /<(?:img|script|iframe|source|audio|video)\b[^>]*\b(?:src|href)\s*=\s*["']https?:\/\//i);
assert.doesNotMatch(standaloneFaqHtml, /<link\b(?=[^>]*rel=["'](?:stylesheet|preload|preconnect)["'])[^>]*href=["']https?:\/\//i);

const adminHtml = await renderPreviewHtml({ mode: 'admin' });
assert.match(adminHtml, /ADMIN DE PREVIEW/);
assert.match(adminHtml, /identidad, productos, ventas, stock y pedidos son sintéticos/);
assert.match(adminHtml, /supabase\.createClient\(/);
assert.match(adminHtml, /admin-preview@example\.invalid/);
assert.match(adminHtml, /PREVIEW_DISABLED/);
assert.match(adminHtml, /<link id="appFavicon" rel="icon" href="\/__preview_assets\/blocked\.svg">/);
assert.match(adminHtml, /let brandName="Variedades JM";/);
assert.match(adminHtml, /let brandIcon="";/);
assert.match(adminHtml, /let brandIconPath="";/);
assert.match(adminHtml, /<script type="module" src="\.\/scripts\/admin_csv_preview\.mjs"><\/script>/);
assert.deepEqual([...adminHtml.matchAll(/<script\b[^>]*\bsrc\s*=[^>]*>/gi)].map(match => match[0]), ['<script type="module" src="./scripts/admin_csv_preview.mjs">']);
assert.doesNotMatch(adminHtml, /\b[a-z0-9-]+\.supabase\.co\b/i);
assert.doesNotMatch(adminHtml, /\b(?:sb_(?:publishable|secret)_[A-Za-z0-9_-]{8,}|pub_(?:test|prod)_[A-Za-z0-9_-]{8,})\b/i);
assert.equal((adminHtml.match(/<head\b/gi)||[]).length, 1, 'El recibo emergente del admin se deshabilita en preview.');
assert.equal((adminHtml.match(/<body\b/gi)||[]).length, 1);
assert.match(adminHtml, /data-sirevya-preview="safe-client"/);
assert.equal(adminHtml.indexOf('<script data-sirevya-preview="safe-client">'), adminHtml.search(/<script\b/i), 'El shim admin se carga antes de cualquier script del panel.');
const safeImageFunction = adminHtml.match(/function publicWorkerImage\(value\)\{[^\n]*\}/)?.[0];
assert.ok(safeImageFunction, 'El preview conserva el resolver de imagen fail-closed.');
const imageContext = { imageObjectKey: value => value, IMAGE_WORKER_URL: 'https://preview.invalid/__preview_assets', encodeURIComponent };
vm.runInNewContext(`${safeImageFunction};globalThis.previewImage=publicWorkerImage;`, imageContext);
assert.equal(imageContext.previewImage('https://evil.example/image.png'), '');
assert.equal(imageContext.previewImage('data:image/png;base64,AAAA'), '');
assert.equal(imageContext.previewImage('images/demo.png'), 'https://preview.invalid/__preview_assets/images/demo.png');
const rawAdminHtml = await readFile(new URL('../admin.html', import.meta.url), 'utf8');
const hostileFaviconHtml = await renderPreviewHtml({ mode: 'admin', sourceHtml: rawAdminHtml.replace('href=""', 'href="https://evil.example/favicon.ico"') });
assert.match(hostileFaviconHtml, /<link id="appFavicon" rel="icon" href="\/__preview_assets\/blocked\.svg">/);
assert.doesNotMatch(hostileFaviconHtml, /evil\.example|https?:\/\//i);
assert.equal(DEMO_ADMIN_ROWS.products.length, DEMO_PRODUCTS.length);
assert.equal(PREVIEW_ADMIN_USER.id, 'preview-admin-user');

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
const soldOutSample = catalog.data.find(product => product.code === 'DEMO-004');
assert.ok(soldOutSample, 'El preview incluye un producto ficticio agotado para probar disponibilidad.');
assert.equal(soldOutSample.quantity, 0);
assert.ok(soldOutSample.variants.length > 0 && soldOutSample.variants.every(variant => variant.stock === 0));
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

let adminNativeFetchCalls = 0;
const adminHandlers = {};
const adminLocation = { origin: 'http://preview.test', href: 'http://preview.test/admin-preview' };
const adminWindow = {
  location: adminLocation,
  document: { addEventListener: (name, handler) => { adminHandlers[name] = handler; } },
  HTMLFormElement: function MockAdminForm() {},
  navigator: { sendBeacon: () => true },
  fetch: async () => { adminNativeFetchCalls++; return new Response('synthetic asset'); },
  open: () => { throw new Error('window.open no debe navegar desde admin-preview'); },
};
vm.runInNewContext(PREVIEW_ADMIN_CLIENT_SCRIPT, { window: adminWindow, URL, Response, console });
const adminClient = adminWindow.supabase.createClient('unused', 'unused');
const adminSession = await adminClient.auth.getSession();
assert.equal(adminSession.data.session.user.id, PREVIEW_ADMIN_USER.id);
assert.equal(adminSession.data.session.access_token, 'PREVIEW_DISABLED');
assert.equal((await adminClient.auth.getUser()).data.user.email, 'admin-preview@example.invalid');
assert.equal((await adminClient.rpc('is_store_admin')).data, true);
assert.equal((await adminClient.rpc('get_public_catalog')).data.length, DEMO_PRODUCTS.length);
const adminSales = await adminClient.from('sales').select('*').range(0, 10);
assert.equal(adminSales.data.length, 1);
const adminOrders = await adminClient.from('web_orders').select('*').range(0, 10);
assert.equal(adminOrders.data.length, 1);
assert.equal(adminOrders.data[0].customer_email, 'cliente@example.invalid');
assert.equal((await adminClient.rpc('admin_update_web_order_status_secure', { p_order_id: 'preview-order-001', p_status: 'confirmado' })).error.code, 'PREVIEW_BLOCKED');
assert.equal((await adminClient.from('products').update({ quantity: 999 }).eq('id', 'preview-corset-001')).error.code, 'PREVIEW_BLOCKED');
assert.equal((await adminClient.auth.updateUser({ password: 'not-a-real-password' })).error.code, 'PREVIEW_BLOCKED');
assert.equal((await adminClient.functions.invoke('wompi-create-checkout', { body: {} })).error.code, 'PREVIEW_BLOCKED');
assert.equal((await adminWindow.fetch('https://example.com/external')).status, 403);
assert.equal((await adminWindow.fetch('/__preview_assets/demo.svg', { method: 'GET' })).status, 200);
assert.equal((await adminWindow.fetch('/__preview_assets/demo.svg', { method: 'HEAD' })).status, 200);
for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  assert.equal((await adminWindow.fetch('/__preview_assets/demo.svg', { method })).status, 403, `${method} se bloquea en admin-preview.`);
}
assert.equal(adminNativeFetchCalls, 2, 'Solo GET/HEAD local a assets sintéticos delega al servidor.');
assert.equal(adminWindow.navigator.sendBeacon('https://example.com/track', '{}'), false);
assert.throws(() => new adminWindow.XMLHttpRequest(), /deshabilitada/);
assert.throws(() => new adminWindow.WebSocket(), /deshabilitada/);
assert.throws(() => new adminWindow.EventSource(), /deshabilitada/);
assert.equal(adminWindow.open('https://checkout.wompi.co/demo'), null);
assert.throws(() => new adminWindow.HTMLFormElement().submit(), /Formulario deshabilitado/);

const external = await window.fetch('https://example.com/should-not-leave-preview');
assert.equal(external.status, 403);
const localBackend = await window.fetch('/__preview_api/functions/v1/wompi-create-checkout');
assert.equal(localBackend.status, 403);
const localAsset = await window.fetch('/__preview_assets/demo.svg');
assert.equal(localAsset.status, 200);
const localAssetHead = await window.fetch('/__preview_assets/demo.svg', { method: 'HEAD' });
assert.equal(localAssetHead.status, 200);
for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  assert.equal((await window.fetch('/__preview_assets/demo.svg', { method })).status, 403, `${method} se bloquea antes de nativeFetch en storefront.`);
}
assert.equal(nativeFetchCalls, 2, 'Solo GET/HEAD delegan al servidor local el asset sintético permitido.');
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
  const hubHtml = await response.text();
  assert.match(hubHtml, /Variedades JM \/ Sirevya/);
  assert.match(hubHtml, /href="\/storefront"/);
  assert.match(hubHtml, /href="\/admin-preview"/);
  const storefrontResponse = await fetch(actualBase + '/storefront');
  assert.equal(storefrontResponse.status, 200);
  const storefrontHtml = await storefrontResponse.text();
  assert.match(storefrontHtml, /PREVIEW DE DESARROLLO/);
  assert.doesNotMatch(storefrontHtml, /admin_csv_preview\.mjs/);
  assert.match(storefrontHtml, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(storefrontHtml, /navigator\.serviceWorker\.register\('\/sw\.js'/);
  const previewManifestResponse = await fetch(actualBase + '/manifest.webmanifest');
  assert.equal(previewManifestResponse.status, 200);
  assert.match(previewManifestResponse.headers.get('content-type'), /application\/manifest\+json/);
  const previewManifest = await previewManifestResponse.json();
  assert.equal(previewManifest.start_url, '/storefront');
  assert.equal(previewManifest.name, 'Sirevya — Preview');
  assert.deepEqual(previewManifest.icons.map(icon => icon.src), ['/assets/pwa/icon-192.png', '/assets/pwa/icon-512.png']);
  const workerResponse = await fetch(actualBase + '/sw.js');
  assert.equal(workerResponse.status, 200);
  const previewWorker = await workerResponse.text();
  assert.match(previewWorker, /sirevya-shell-v1/);
  assert.doesNotMatch(previewWorker, /caches\.put\s*\(/);
  const workerHead = await fetch(actualBase + '/sw.js', { method: 'HEAD' });
  assert.equal(workerHead.status, 200);
  assert.equal(await workerHead.text(), '');
  const offlineResponse = await fetch(actualBase + '/offline.html');
  assert.equal(offlineResponse.status, 200);
  const offlineText = await offlineResponse.text();
  assert.match(offlineText, /No mostramos inventario, precios ni tarifas guardados como si fueran actuales/);
  for (const [path, size] of [['/assets/pwa/icon-192.png', 192], ['/assets/pwa/icon-512.png', 512]]) {
    const iconResponse = await fetch(actualBase + path);
    assert.equal(iconResponse.status, 200);
    assert.match(iconResponse.headers.get('content-type'), /image\/png/);
    const icon = Buffer.from(await iconResponse.arrayBuffer());
    assert.equal(icon.readUInt32BE(16), size);
    assert.equal(icon.readUInt32BE(20), size);
  }
  assert.equal((await fetch(actualBase + '/assets/pwa/icon-999.png')).status, 404);
  const privacyResponse = await fetch(actualBase + '/politica-privacidad.html');
  assert.equal(privacyResponse.status, 200);
  assert.match(privacyResponse.headers.get('content-type'), /text\/html/);
  const previewPrivacyHtml = await privacyResponse.text();
  assert.match(previewPrivacyHtml, /PREVIEW DE DESARROLLO/);
  assert.match(previewPrivacyHtml, /noindex,nofollow/);
  assert.match(previewPrivacyHtml, /Política de Tratamiento de Datos Personales/);
  assert.match(previewPrivacyHtml, /<link rel="canonical" href="\/politica-privacidad\.html">/);
  assert.match(previewPrivacyHtml, /<meta property="og:url" content="\/politica-privacidad\.html">/);
  assert.match(previewPrivacyHtml, /<meta property="og:image" content="\/__preview_assets\/blocked\.svg">/);
  assert.match(previewPrivacyHtml, /<meta name="twitter:image" content="\/__preview_assets\/blocked\.svg">/);
  assert.doesNotMatch(previewPrivacyHtml, /<script\b|<iframe\b|https?:\/\//i);
  assert.equal((await fetch(actualBase + '/politica-privacidad.html', { method: 'POST', body: 'blocked' })).status, 403);
  assert.equal((await fetch(actualBase + '/politica-desconocida.html')).status, 404);
  const faqResponse = await fetch(actualBase + '/preguntas-frecuentes.html');
  assert.equal(faqResponse.status, 200);
  assert.match(faqResponse.headers.get('content-type'), /text\/html/);
  const previewFaqHtml = await faqResponse.text();
  assert.match(previewFaqHtml, /PREVIEW DE DESARROLLO/);
  assert.match(previewFaqHtml, /noindex,nofollow/);
  assert.match(previewFaqHtml, /¿Cómo se calcula el envío\?/);
  assert.match(previewFaqHtml, /<link rel="canonical" href="\/preguntas-frecuentes\.html">/);
  assert.match(previewFaqHtml, /<meta property="og:url" content="\/preguntas-frecuentes\.html">/);
assert.match(previewFaqHtml, /<meta property="og:image" content="\/__preview_assets\/blocked\.svg">/);
assert.match(previewFaqHtml, /<meta name="twitter:image" content="\/__preview_assets\/blocked\.svg">/);
assert.doesNotMatch(previewFaqHtml, /<script\b|<iframe\b|https?:\/\//i);
assert.match(previewFaqHtml, /href="\/cambios-devoluciones\.html"/);
assert.equal((await fetch(actualBase + '/preguntas-frecuentes.html', { method: 'POST', body: 'blocked' })).status, 403);
  const returnsResponse = await fetch(actualBase + '/cambios-devoluciones.html');
  assert.equal(returnsResponse.status, 200);
  assert.match(returnsResponse.headers.get('content-type'), /text\/html/);
  const previewReturnsHtml = await returnsResponse.text();
  assert.match(previewReturnsHtml, /PREVIEW DE DESARROLLO/);
  assert.match(previewReturnsHtml, /noindex,nofollow/);
  assert.match(previewReturnsHtml, /Derecho de retracto en compras a distancia/);
  assert.match(previewReturnsHtml, /quince \(15\) días calendario/);
  assert.match(previewReturnsHtml, /<link rel="canonical" href="\/cambios-devoluciones\.html">/);
  assert.match(previewReturnsHtml, /<meta property="og:url" content="\/cambios-devoluciones\.html">/);
  assert.match(previewReturnsHtml, /<meta property="og:image" content="\/__preview_assets\/blocked\.svg">/);
  assert.match(previewReturnsHtml, /<meta name="twitter:image" content="\/__preview_assets\/blocked\.svg">/);
  assert.match(previewReturnsHtml, /href="\/storefront"/);
  for (const label of ['whatsapp', 'email', 'ley1480', 'ley2439', 'sic']) {
    assert.match(previewReturnsHtml, new RegExp(`data-preview-disabled="${label}" aria-disabled="true"`));
  }
  assert.doesNotMatch(previewReturnsHtml, /<script\b|<iframe\b|https?:\/\/|mailto:|wa\.me/i);
  assert.equal((await fetch(actualBase + '/cambios-devoluciones.html', { method: 'POST', body: 'blocked' })).status, 403);
  assert.equal((await fetch(actualBase + '/cambios-devoluciones-desconocido.html')).status, 404);
  assert.equal((await fetch(actualBase + '/faq.html')).status, 404);
  const adminResponse = await fetch(actualBase + '/admin-preview');
  assert.equal(adminResponse.status, 200);
  assert.match(await adminResponse.text(), /ADMIN DE PREVIEW/);
  const adminModuleResponse = await fetch(actualBase + '/scripts/admin_csv_preview.mjs');
  assert.equal(adminModuleResponse.status, 200);
  assert.match(adminModuleResponse.headers.get('content-type'), /text\/javascript/);
  assert.match(await adminModuleResponse.text(), /previewProductsCsv/);
  const adminModuleHead = await fetch(actualBase + '/scripts/admin_csv_preview.mjs', { method: 'HEAD' });
  assert.equal(adminModuleHead.status, 200);
  assert.equal(await adminModuleHead.text(), '');
  const parserModuleResponse = await fetch(actualBase + '/scripts/fase7_csv_preview.mjs');
  assert.equal(parserModuleResponse.status, 200);
  assert.match(await parserModuleResponse.text(), /export function previewProductsCsv/);
  const parserModuleHead = await fetch(actualBase + '/scripts/fase7_csv_preview.mjs', { method: 'HEAD' });
  assert.equal(parserModuleHead.status, 200);
  assert.equal(await parserModuleHead.text(), '');
  assert.equal((await fetch(actualBase + '/scripts/unknown.mjs')).status, 404);
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const response = await fetch(actualBase + '/scripts/admin_csv_preview.mjs', {
      method,
      ...(method === 'OPTIONS' ? {} : { body: 'blocked' }),
    });
    assert.equal(response.status, 403, `${method} must remain blocked for the CSV module route.`);
  }
  const routesResponse = await fetch(actualBase + '/manus-routes.json');
  assert.equal(routesResponse.status, 200);
  const routes = await routesResponse.json();
  assert.deepEqual(routes.routes.map(route => route.path), ['/', '/storefront', '/admin-preview', '/politica-privacidad.html', '/preguntas-frecuentes.html', '/cambios-devoluciones.html']);
  assert.ok(routes.routes.every(route => typeof route.title === 'string'));
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
  const first = await (await fetch(tempBase + '/storefront')).text();
  assert.match(first, /refresh-version-one/);
  await writeFile(path.join(tempRoot, 'index.html'), alternateSource.replace('first-version', 'refresh-version-two'));
  const second = await (await fetch(tempBase + '/storefront')).text();
  assert.match(second, /refresh-version-two/);
  assert.doesNotMatch(second, /refresh-version-one/);
} finally {
  tempServer.close();
  await once(tempServer, 'close');
  await rm(tempRoot, { recursive: true, force: true });
}

console.log('preview_server_regression: OK (fixtures sintéticos; credenciales y hosts scrubbed; navegación, red, pagos, pedidos, reservas e inventario real bloqueados; refresh sin cache)');
