import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const notFound = read('404.html');
const offline = read('offline.html');
const catalog = read('index.html');
const robots = read('robots.txt');
const sitemap = read('sitemap.xml');

assert.match(notFound, /<html lang="es">/i);
assert.match(notFound, /<meta name="robots" content="noindex,follow">/i);
assert.match(notFound, /<title>Página no encontrada \| Sirevya<\/title>/);
assert.match(notFound, /<h1 id="not-found-title">No encontramos esta página<\/h1>/);
assert.match(notFound, /href="\/"[^>]*>Volver a la tienda/);
assert.match(notFound, /href="\/preguntas-frecuentes\.html"/);
assert.match(notFound, /href="\/cambios-devoluciones\.html"/);
assert.doesNotMatch(notFound, /<link\b[^>]*rel=["']canonical/i, 'una página 404 no debe declarar canonical a la portada');
assert.doesNotMatch(notFound, /<script\b|supabase/i, 'la 404 es estática y no requiere JavaScript ni servicios');
assert.match(offline, /<meta name="robots" content="noindex,follow">/i, 'la página de fallback PWA no se indexa como tienda activa');
const keywordTag = catalog.match(/<meta name="keywords" content="([^"]+)"/i);
assert.ok(keywordTag, 'la portada ofrece palabras clave en el HTML inicial');
assert.ok(keywordTag[1].split(',').map(value => value.trim()).filter(Boolean).length >= 3 && keywordTag[1].split(',').map(value => value.trim()).filter(Boolean).length <= 8, 'el panel SEO recibe entre tres y ocho palabras clave');
assert.match(catalog, /<h1 class="brandName">Sirevya<\/h1>/, 'el wordmark visible conserva el único H1 semántico de la portada');
assert.doesNotMatch(catalog, /class="catalogSeoHeading"|Moda y accesorios en Sirevya<\/h1>/, 'no se añade un título visible redundante sobre el catálogo');
assert.equal((catalog.match(/<h1\b/gi) || []).length, 1, 'la portada conserva un solo H1');
const title = catalog.match(/<title>([^<]+)<\/title>/i)?.[1] || '';
const description = catalog.match(/<meta name="description" content="([^"]+)"/i)?.[1] || '';
assert.ok(title.length >= 30 && title.length <= 60, 'title de portada cumple longitud SEO');
assert.ok(description.length >= 50 && description.length <= 160, 'description de portada cumple longitud SEO');
assert.match(catalog, /<link rel="canonical" href="https:\/\/sirevya\.com\.co\/"\s*>/i);
assert.match(catalog, /<meta property="og:url" content="https:\/\/sirevya\.com\.co\/"\s*>/i);
assert.match(robots, /^User-agent: \*/m);
assert.match(robots, /^Allow: \/$/m);
assert.match(robots, /^Disallow: \/admin\.html$/m);
assert.match(robots, /^Sitemap: https:\/\/sirevya\.com\.co\/sitemap\.xml$/m);

const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
assert.deepEqual(urls, [
  'https://sirevya.com.co/',
  'https://sirevya.com.co/politica-privacidad.html',
  'https://sirevya.com.co/preguntas-frecuentes.html',
  'https://sirevya.com.co/cambios-devoluciones.html',
], 'el sitemap contiene únicamente páginas públicas canónicas');
assert.equal(new Set(urls).size, urls.length, 'el sitemap no duplica rutas');
assert.ok(!urls.some(url => /(?:404|offline|admin)\.html$/i.test(url)), 'el sitemap excluye 404, offline y administración');

console.log('seo_routes_regression: PASS (404 custom/noindex, offline noindex, robots y sitemap coherentes)');
