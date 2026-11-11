import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import {
  buildSite,
  escapeHtml,
  fetchPublicCatalog,
  mergeSitemap,
  productPath,
  readPublicSupabaseConfig,
  renderProductPage,
} from '../scripts/generate_product_seo.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(await fs.readFile(path.join(root, 'tests/fixtures/seo_public_catalog.json'), 'utf8'));
const firstId = fixture[0].id;
const secondId = fixture[1].id;
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sirevya-seo-prerender-'));
const output = path.join(tempRoot, 'site');

assert.equal(escapeHtml('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;');
assert.equal(productPath(fixture[0]), `/productos/${firstId}/`);
assert.throws(() => productPath({ id: '../admin.html' }), /ID de producto inválido/);

const config = readPublicSupabaseConfig(`const SUPABASE_URL='https://project.example.supabase.co';\nconst SUPABASE_KEY='anon-public-test-key';`);
assert.deepEqual(config, { url: 'https://project.example.supabase.co', anonKey: 'anon-public-test-key' });
assert.throws(() => readPublicSupabaseConfig(`const SUPABASE_URL='http://project.example.supabase.co'; const SUPABASE_KEY='x';`), /HTTPS esperado/);

const pagedRows = [
  { id: '11111111-1111-4111-8111-111111111111' },
  { id: '22222222-2222-4222-8222-222222222222' },
  { id: '33333333-3333-4333-8333-333333333333' },
];
const requestedRanges = [];
const loadedRows = await fetchPublicCatalog({
  url: 'https://project.example.supabase.co',
  anonKey: 'public-test-key',
  pageSize: 2,
  maxRows: 10,
  fetchImpl: async (url, options) => {
    assert.equal(url, 'https://project.example.supabase.co/rest/v1/rpc/get_public_catalog');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.body, '{}');
    assert.equal(options.headers.apikey, 'public-test-key');
    assert.equal(options.headers.authorization, 'Bearer public-test-key');
    const range = options.headers.range;
    requestedRanges.push(range);
    const [start, end] = range.split('-').map(Number);
    const batch = pagedRows.slice(start, end + 1);
    const last = start + batch.length - 1;
    return new Response(JSON.stringify(batch), {
      status: 200,
      headers: { 'content-range': batch.length ? `${start}-${last}/${pagedRows.length}` : `*/${pagedRows.length}` },
    });
  },
});
assert.deepEqual(loadedRows, pagedRows);
assert.deepEqual(requestedRanges, ['0-1', '2-3']);

const clampedRanges = [];
const clampedRows = await fetchPublicCatalog({
  url: 'https://project.example.supabase.co',
  anonKey: 'public-test-key',
  pageSize: 2,
  maxRows: 10,
  fetchImpl: async (_url, options) => {
    const range = options.headers.range;
    clampedRanges.push(range);
    const start = Number(range.split('-')[0]);
    const batch = pagedRows.slice(start, start + 1);
    return new Response(JSON.stringify(batch), {
      status: 200,
      headers: { 'content-range': `${start}-${start + batch.length - 1}/${pagedRows.length}` },
    });
  },
});
assert.deepEqual(clampedRows, pagedRows);
assert.deepEqual(clampedRanges, ['0-1', '1-2', '2-3']);

const missingRange = await fetchPublicCatalog({
  url: 'https://project.example.supabase.co',
  anonKey: 'public-test-key',
  pageSize: 2,
  maxRows: 10,
  fetchImpl: async () => new Response(JSON.stringify(pagedRows.slice(0, 1)), { status: 200 }),
}).catch(error => error);
assert.match(missingRange.message, /no confirmó el conteo exacto/);

const onePageOnly = await fetchPublicCatalog({
  url: 'https://project.example.supabase.co',
  anonKey: 'public-test-key',
  pageSize: 2,
  maxRows: 10,
  fetchImpl: async () => new Response(JSON.stringify(pagedRows), { status: 200 }),
}).catch(error => error);
assert.match(onePageOnly.message, /no paginada/);

const rendered = renderProductPage(fixture[0]);
assert.match(rendered, new RegExp(`<title>Cinturilla &lt; edición &amp; cómoda \\| Sirevya<\\/title>`));
const titleText = rendered.match(/<title>([^<]+)<\/title>/)?.[1];
const descriptionText = rendered.match(/<meta name="description" content="([^"]*)">/)?.[1];
assert.ok(titleText && titleText.length <= 60, 'título de ficha breve y no vacío');
assert.ok(descriptionText && descriptionText.length >= 50 && descriptionText.length <= 160, 'meta description dentro del rango comprobado');
assert.match(rendered, /<meta name="robots" content="index,follow,max-image-preview:large">/);
assert.match(rendered, new RegExp(`<link rel="canonical" href="https://sirevya\\.com\\.co/productos/${firstId}/">`));
assert.match(rendered, /<meta property="og:type" content="product">/);
assert.match(rendered, /<meta property="product:price:currency" content="COP">/);
assert.match(rendered, /<meta property="product:price:amount" content="69900">/);
assert.match(rendered, /<img class="product-image"[^>]+loading="eager"/);
const r2Page = renderProductPage({ ...fixture[0], image_url: 'https://public-assets.r2.dev/product-images/look/coat%20one.webp?cache=1' });
assert.match(r2Page, /src="https:\/\/sirevya-images\.variedadesjm99\.workers\.dev\/product-images\/look\/coat%20one\.webp"/);
assert.match(rendered, new RegExp(`href="/\\?producto=${firstId}"`), 'la compra vuelve a la ruta de ficha ya soportada por la tienda');
assert.doesNotMatch(rendered, /NO_PUBLICAR_CAMPOS_AJENOS/);
assert.doesNotMatch(rendered, /<b>/);
const jsonLdText = rendered.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
assert.ok(jsonLdText, 'la ficha incluye datos estructurados JSON-LD');
const jsonLd = JSON.parse(jsonLdText);
assert.equal(jsonLd['@type'], 'Product');
assert.equal(jsonLd.name, fixture[0].name);
assert.equal(jsonLd.offers.price, '69900');
assert.equal(jsonLd.offers.priceCurrency, 'COP');
assert.equal(jsonLd.offers.url, `https://sirevya.com.co/productos/${firstId}/`);
assert.equal(jsonLd.image[0], fixture[0].image_url);
assert.ok(rendered.includes('\\u003c'), 'JSON-LD protege caracteres que podrían cerrar un elemento script');

const noImagePage = renderProductPage(fixture[1]);
assert.doesNotMatch(noImagePage, /javascript:alert/);
assert.doesNotMatch(noImagePage, /property="og:image"/);
assert.doesNotMatch(noImagePage, /"offers"/);
assert.match(noImagePage, /image-placeholder/);

const baseSitemap = await fs.readFile(path.join(root, 'sitemap.xml'), 'utf8');
const combinedSitemap = mergeSitemap(baseSitemap, [
  `https://sirevya.com.co/productos/${firstId}/`,
  `https://sirevya.com.co/productos/${secondId}/`,
]);
const sitemapUrls = [...combinedSitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
assert.equal(sitemapUrls.length, 6);
assert.equal(new Set(sitemapUrls).size, sitemapUrls.length);
assert.ok(sitemapUrls.includes(`https://sirevya.com.co/productos/${firstId}/`));
assert.ok(sitemapUrls.includes('https://sirevya.com.co/'));
assert.ok(!sitemapUrls.some(url => /(?:admin|offline|404)\.html$/i.test(url)));
assert.throws(() => mergeSitemap(baseSitemap, ['https://outside.example.test/productos/x/']), /formato canónico/);

const built = await buildSite({ root, outDir: output, products: fixture });
assert.equal(built.productCount, 2);
assert.equal(built.sitemapUrlCount, 6);
assert.equal(await fs.readFile(path.join(output, `productos/${firstId}/index.html`), 'utf8'), rendered);
assert.equal(await fs.readFile(path.join(output, 'robots.txt'), 'utf8'), await fs.readFile(path.join(root, 'robots.txt'), 'utf8'));
assert.equal(await fs.readFile(path.join(output, 'CNAME'), 'utf8'), await fs.readFile(path.join(root, 'CNAME'), 'utf8'));
assert.ok(await fs.stat(path.join(output, '.nojekyll')));
assert.match(await fs.readFile(path.join(output, 'sitemap.xml'), 'utf8'), new RegExp(`<loc>https://sirevya\\.com\\.co/productos/${firstId}/</loc>`));
await assert.rejects(buildSite({ root, outDir: root, products: fixture }), /no puede ser la raíz/);

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (!relative || relative.endsWith('/')) relative = `${relative}index.html`;
  const candidate = path.resolve(output, relative);
  if (!candidate.startsWith(`${output}${path.sep}`)) {
    response.writeHead(400).end('bad path');
    return;
  }
  try {
    const content = await fs.readFile(candidate);
    response.writeHead(200, { 'content-type': candidate.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
    response.end(content);
  } catch {
    response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    response.end(await fs.readFile(path.join(output, '404.html')));
  }
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
try {
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const productResponse = await fetch(`${baseUrl}/productos/${firstId}/`);
  assert.equal(productResponse.status, 200);
  assert.match(await productResponse.text(), /<h1 class="title">Cinturilla/);
  const legacyResponse = await fetch(`${baseUrl}/?producto=${firstId}`);
  assert.equal(legacyResponse.status, 200);
  assert.match(await legacyResponse.text(), /function openDirectProductFromLocation/);
  const missingResponse = await fetch(`${baseUrl}/productos/99999999-9999-4999-8999-999999999999/`);
  assert.equal(missingResponse.status, 404);
} finally {
  await new Promise(resolve => server.close(resolve));
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('seo_prerender_regression: PASS (HTML individual, canonical/meta/JSON-LD/robots/sitemap, RPC pagination, sanitized fields, stable legacy query and local HTTP navigation).');
