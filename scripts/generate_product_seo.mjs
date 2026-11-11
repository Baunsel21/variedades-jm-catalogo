import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SITE_ORIGIN = 'https://sirevya.com.co';
export const PRODUCT_PATH_PREFIX = '/productos/';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_SIZE = 1000;
const MAX_ROWS = 100000;
const MAX_SITEMAP_URLS = 50000;
const IMAGE_WORKER_URL = 'https://sirevya-images.variedadesjm99.workers.dev';
const STATIC_FILES = [
  '404.html',
  'CNAME',
  'admin.html',
  'cambios-devoluciones.html',
  'hero-sirevya.webp',
  'index.html',
  'logo-sirevya-circular.webp',
  'logo-sirevya.webp',
  'manifest.webmanifest',
  'offline.html',
  'politica-privacidad.html',
  'preguntas-frecuentes.html',
  'robots.txt',
  'share-sirevya.png',
  'sitemap.xml',
  'sw.js',
];
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function decodeCommonEntities(value) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, number) => {
      const codePoint = Number(number);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : ' ';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, number) => {
      const codePoint = Number.parseInt(number, 16);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : ' ';
    });
}

export function plainText(value) {
  return decodeCommonEntities(String(value ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(value, maxLength) {
  const text = String(value ?? '').trim();
  const chars = Array.from(text);
  if (chars.length <= maxLength) return text;
  return `${chars.slice(0, Math.max(0, maxLength - 1)).join('').trimEnd()}…`;
}

function metaDescription(product) {
  const source = product.description || `Conoce ${product.name} en el catálogo de Sirevya.`;
  const enriched = /[.!?]$/.test(source)
    ? `${source} Consulta sus detalles en la tienda.`
    : `${source}. Consulta sus detalles en la tienda.`;
  return truncate(enriched, 160);
}

function safePublicImage(value) {
  let raw = String(value ?? '').trim();
  if (!raw || (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw))) return null;
  try {
    if (/^https?:\/\//i.test(raw)) {
      const url = new URL(raw);
      if (!url.hostname || url.username || url.password) return null;
      if (url.hostname === new URL(IMAGE_WORKER_URL).hostname || /(^|\.)r2\.dev$/i.test(url.hostname)) {
        raw = url.pathname;
      } else if (url.pathname.includes('/product-images/')) {
        raw = url.pathname.slice(url.pathname.indexOf('/product-images/') + '/product-images/'.length);
      } else {
        if (url.protocol !== 'https:' || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname)) return null;
        return url.href;
      }
    } else {
      const marker = '/product-images/';
      if (raw.includes(marker)) raw = raw.slice(raw.indexOf(marker) + marker.length);
      else if (raw.startsWith('product-images/')) raw = raw.slice('product-images/'.length);
    }
    raw = raw.split(/[?#]/)[0].replace(/^\/+/, '');
    if (!raw) return null;
    let decoded;
    try {
      decoded = raw.split('/').map(part => decodeURIComponent(part)).join('/');
    } catch {
      decoded = raw;
    }
    const segments = decoded.split('/');
    if (segments.some(segment => segment === '.' || segment === '..' || /[\u0000-\u001f\u007f]/.test(segment))) return null;
    return `${IMAGE_WORKER_URL}/${segments.map(part => encodeURIComponent(part)).join('/')}`;
  } catch {
    return null;
  }
}

function normalizeProduct(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('El catálogo público contiene una fila inválida.');
  }
  const id = String(row.id ?? '').trim().toLowerCase();
  if (!UUID_PATTERN.test(id)) throw new Error('El catálogo público contiene un identificador de producto inválido.');
  const name = plainText(row.name);
  if (!name) throw new Error('El catálogo público contiene un producto sin nombre.');
  const rawPrice = row.sale_price;
  const parsedPrice = rawPrice == null || rawPrice === '' ? null : Number(rawPrice);
  const price = Number.isSafeInteger(parsedPrice) && parsedPrice >= 0 ? parsedPrice : null;
  return {
    id,
    name,
    description: plainText(row.description),
    category: plainText(row.category),
    code: plainText(row.code ?? row.sku),
    image: safePublicImage(row.image_url),
    price,
  };
}

export function productPath(product) {
  const id = String(product?.id ?? '').trim().toLowerCase();
  if (!UUID_PATTERN.test(id)) throw new Error('No se puede formar una ruta con un ID de producto inválido.');
  return `${PRODUCT_PATH_PREFIX}${id}/`;
}

function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function renderProductPage(rawProduct) {
  const product = normalizeProduct(rawProduct);
  const canonical = new URL(productPath(product), SITE_ORIGIN).href;
  const title = truncate(`${product.name} | Sirevya`, 60);
  const description = metaDescription(product);
  const detailUrl = `/?producto=${encodeURIComponent(product.id)}`;
  const formattedPrice = product.price == null
    ? ''
    : new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(product.price);
  const imageMarkup = product.image
    ? `<img class="product-image" src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" width="900" height="900" loading="eager" fetchpriority="high" decoding="async">`
    : '<div class="image-placeholder" aria-hidden="true">Sirevya</div>';
  const imageMeta = product.image
    ? `<meta property="og:image" content="${escapeHtml(product.image)}">\n<meta name="twitter:image" content="${escapeHtml(product.image)}">`
    : '';
  const priceMeta = product.price == null
    ? ''
    : `<meta property="product:price:amount" content="${product.price}">\n<meta property="product:price:currency" content="COP">`;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description,
    ...(product.image ? { image: [product.image] } : {}),
    ...(product.code ? { sku: product.code } : {}),
    ...(product.category ? { category: product.category } : {}),
    ...(product.price == null ? {} : {
      offers: {
        '@type': 'Offer',
        url: canonical,
        priceCurrency: 'COP',
        price: String(product.price),
        seller: { '@type': 'Organization', name: 'Sirevya' },
      },
    }),
  };
  const categoryMarkup = product.category
    ? `<p class="category">${escapeHtml(product.category)}</p>`
    : '';
  const codeMarkup = product.code
    ? `<p class="code">Referencia: ${escapeHtml(product.code)}</p>`
    : '';
  const priceMarkup = formattedPrice
    ? `<p class="price">${escapeHtml(formattedPrice)}</p>`
    : '<p class="price-note">Consulta el precio vigente en la tienda.</p>';
  const descriptionMarkup = product.description
    ? `<p class="description">${escapeHtml(product.description)}</p>`
    : '<p class="description">Consulta los detalles y opciones de este producto en la tienda Sirevya.</p>';

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="index,follow,max-image-preview:large">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="Sirevya">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:locale" content="es_CO">
${imageMeta}
${priceMeta}
<meta name="twitter:card" content="${product.image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<script type="application/ld+json">${jsonForScript(schema)}</script>
<style>
:root{color-scheme:light;--ink:#1d1b1b;--muted:#6f6763;--wine:#7b1730;--gold:#c7a56b;--paper:#fffdf9;--line:#e8e1d9}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}.shell{max-width:1080px;margin:0 auto;padding:22px}.top{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);padding:8px 0 18px}.brand{font-family:Georgia,serif;font-size:27px;font-style:italic;font-weight:700;color:var(--wine);text-decoration:none}.top a:last-child{color:var(--wine);font-weight:700;text-decoration:none}.product{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,.85fr);gap:clamp(24px,5vw,64px);align-items:center;padding:clamp(24px,6vw,70px) 0}.visual{min-height:320px;border-radius:22px;background:#f4efe9;display:grid;place-items:center;overflow:hidden}.product-image{display:block;width:100%;height:auto;max-height:680px;object-fit:contain}.image-placeholder{padding:50px 20px;color:var(--wine);font:italic 32px Georgia,serif}.category{color:var(--wine);font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.title{margin:8px 0 14px;font:700 clamp(32px,5vw,52px)/1.1 Georgia,serif}.description{color:#413b38;white-space:pre-line}.code{color:var(--muted);font-size:13px}.price{margin:20px 0;color:var(--wine);font-size:25px;font-weight:800}.price-note{margin:20px 0;color:var(--muted)}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:26px}.button{display:inline-flex;justify-content:center;align-items:center;min-height:48px;padding:12px 20px;border:1px solid var(--wine);border-radius:12px;background:var(--wine);color:#fff;text-decoration:none;font-weight:800}.button.secondary{background:transparent;color:var(--wine)}.note{color:var(--muted);font-size:13px;margin-top:18px}.foot{border-top:1px solid var(--line);padding:18px 0 8px;color:var(--muted);font-size:13px}.foot a{color:var(--wine)}@media(max-width:700px){.shell{padding:14px}.product{grid-template-columns:1fr;gap:20px;padding:24px 0}.visual{min-height:240px}.title{font-size:34px}.actions{display:grid}.button{width:100%}}
</style>
</head>
<body>
<div class="shell">
<header class="top"><a class="brand" href="/" aria-label="Sirevya, volver al inicio">Sirevya</a><a href="/">Volver a la tienda</a></header>
<main class="product">
<div class="visual">${imageMarkup}</div>
<article>
${categoryMarkup}
<h1 class="title">${escapeHtml(product.name)}</h1>
${descriptionMarkup}
${codeMarkup}
${priceMarkup}
<div class="actions"><a class="button" href="${detailUrl}">Ver producto y comprar</a><a class="button secondary" href="/">Seguir comprando</a></div>
<p class="note">La ficha de compra, selección de variantes y disponibilidad se consultan en la tienda.</p>
</article>
</main>
<footer class="foot"><a href="/preguntas-frecuentes.html">Preguntas frecuentes</a> · <a href="/cambios-devoluciones.html">Cambios y devoluciones</a> · <a href="/politica-privacidad.html">Privacidad</a></footer>
</div>
</body>
</html>
`;
}

function decodeXml(value) {
  return String(value).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function mergeSitemap(staticSitemap, productUrls) {
  const staticUrls = [];
  for (const match of String(staticSitemap).matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)) {
    let url;
    try {
      url = new URL(decodeXml(match[1].trim()));
    } catch {
      throw new Error('El sitemap base contiene una URL inválida.');
    }
    if (url.origin !== SITE_ORIGIN || url.search || url.hash) {
      throw new Error('El sitemap base contiene una URL fuera del dominio canónico.');
    }
    staticUrls.push(url.href);
  }
  if (!staticUrls.length) throw new Error('El sitemap base no contiene páginas públicas.');
  const urls = [...new Set(staticUrls)];
  for (const productUrl of [...productUrls].sort()) {
    const parsed = new URL(productUrl);
    if (parsed.origin !== SITE_ORIGIN || !parsed.pathname.startsWith(PRODUCT_PATH_PREFIX) || parsed.search || parsed.hash) {
      throw new Error('Se rechazó una ruta de producto fuera del formato canónico.');
    }
    if (!urls.includes(parsed.href)) urls.push(parsed.href);
  }
  if (urls.length > MAX_SITEMAP_URLS) throw new Error('El sitemap supera el límite de 50.000 URLs.');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(url => `  <url><loc>${escapeXml(url)}</loc></url>`).join('\n')}\n</urlset>\n`;
}

export function readPublicSupabaseConfig(indexHtml) {
  const matchConstant = name => {
    const match = String(indexHtml).match(new RegExp(`\\bconst\\s+${name}\\s*=\\s*(['\"])(.*?)\\1\\s*;`));
    return match?.[2] ?? '';
  };
  const rawUrl = matchConstant('SUPABASE_URL').trim();
  const anonKey = matchConstant('SUPABASE_KEY').trim();
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('No se pudo leer la configuración pública de Supabase desde index.html.');
  }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co') || url.username || url.password || !anonKey) {
    throw new Error('La configuración pública de Supabase no cumple el formato HTTPS esperado.');
  }
  return { url: url.origin, anonKey };
}

export async function fetchPublicCatalog({ url, anonKey, fetchImpl = fetch, pageSize = PAGE_SIZE, maxRows = MAX_ROWS }) {
  const endpoint = `${String(url).replace(/\/+$/, '')}/rest/v1/rpc/get_public_catalog`;
  const rows = [];
  let offset = 0;
  while (offset < maxRows) {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`,
        'content-type': 'application/json',
        'range-unit': 'items',
        range: `${offset}-${offset + pageSize - 1}`,
        prefer: 'count=exact',
      },
      body: '{}',
      ...(typeof AbortSignal?.timeout === 'function' ? { signal: AbortSignal.timeout(20000) } : {}),
    });
    if (!response.ok) throw new Error(`No se pudo leer el catálogo público (HTTP ${response.status}).`);
    const batch = await response.json();
    if (!Array.isArray(batch) || batch.length > pageSize) throw new Error('La RPC pública devolvió una respuesta no paginada válida.');
    const range = response.headers.get('content-range');
    if (range === '*/0' && offset === 0 && batch.length === 0) return rows;
    const rangeMatch = range?.match(/^(\d+)-(\d+|\*)\/(\d+|\*)$/);
    if (!rangeMatch || rangeMatch[3] === '*') throw new Error('La RPC pública no confirmó el conteo exacto del catálogo; no se genera un sitemap posiblemente incompleto.');
    if (Number(rangeMatch[1]) !== offset) {
      throw new Error('La paginación del catálogo público devolvió un rango inesperado.');
    }
    const total = Number(rangeMatch[3]);
    if (!Number.isSafeInteger(total) || total < 0 || total > maxRows) throw new Error('El conteo del catálogo público es inválido o supera el límite de seguridad.');
    if (total === 0 && batch.length === 0 && offset === 0) return rows;
    if (!batch.length || (rangeMatch[2] !== '*' && Number(rangeMatch[2]) - offset + 1 !== batch.length)) {
      throw new Error('La paginación del catálogo público no coincide con el rango confirmado.');
    }
    rows.push(...batch);
    if (rows.length > maxRows) throw new Error('El catálogo público supera el límite de seguridad de 100.000 filas.');
    if (rows.length >= total) {
      if (rows.length !== total) throw new Error('La paginación no coincide con el conteo total anunciado.');
      return rows;
    }
    offset += batch.length;
  }
  throw new Error('El catálogo público supera el límite de seguridad de 100.000 filas.');
}

async function copyStaticFiles(root, outDir) {
  for (const filename of STATIC_FILES) {
    const source = path.join(root, filename);
    try {
      await fs.copyFile(source, path.join(outDir, filename));
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error(`Falta el archivo estático requerido: ${filename}.`);
      throw error;
    }
  }
  await fs.cp(path.join(root, 'assets'), path.join(outDir, 'assets'), { recursive: true, errorOnExist: true });
  await fs.writeFile(path.join(outDir, '.nojekyll'), '', 'utf8');
}

export async function buildSite({ root = REPO_ROOT, outDir, products }) {
  if (!outDir) throw new Error('Indica un directorio de salida vacío.');
  const resolvedRoot = path.resolve(root);
  const resolvedOut = path.resolve(outDir);
  if (resolvedOut === resolvedRoot || resolvedRoot.startsWith(`${resolvedOut}${path.sep}`)) {
    throw new Error('El directorio de salida no puede ser la raíz del repositorio ni contenerla.');
  }
  await fs.mkdir(resolvedOut, { recursive: true });
  if ((await fs.readdir(resolvedOut)).length) throw new Error('El directorio de salida debe estar vacío; no se sobrescriben archivos existentes.');
  if (!Array.isArray(products)) throw new Error('Se requiere el arreglo del catálogo público.');
  if (products.length > MAX_SITEMAP_URLS - 10) throw new Error('El catálogo supera el límite de páginas de sitemap admitido.');

  const normalized = products.map(normalizeProduct);
  const ids = new Set();
  for (const product of normalized) {
    if (ids.has(product.id)) throw new Error('El catálogo público contiene IDs duplicados.');
    ids.add(product.id);
  }

	await copyStaticFiles(resolvedRoot, resolvedOut);
	const urls = [];
	for (let index = 0; index < normalized.length; index += 1) {
	  const product = normalized[index];
	  const route = productPath(product);
	  const pagePath = path.join(resolvedOut, route.slice(1), 'index.html');
	  await fs.mkdir(path.dirname(pagePath), { recursive: true });
	  await fs.writeFile(pagePath, renderProductPage(products[index]), 'utf8');
	  urls.push(new URL(route, SITE_ORIGIN).href);
	}

  const originalSitemap = await fs.readFile(path.join(resolvedRoot, 'sitemap.xml'), 'utf8');
  const sitemap = mergeSitemap(originalSitemap, urls);
  await fs.writeFile(path.join(resolvedOut, 'sitemap.xml'), sitemap, 'utf8');
  return { productCount: normalized.length, sitemapUrlCount: [...sitemap.matchAll(/<loc>/g)].length, outDir: resolvedOut };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out-dir') options.outDir = argv[++index];
    else if (arg === '--fixture') options.fixture = argv[++index];
    else throw new Error(`Argumento no reconocido: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.outDir) throw new Error('Uso: node scripts/generate_product_seo.mjs --out-dir <directorio> [--fixture <json>]');
  let products;
  if (options.fixture) {
    const fixturePath = path.resolve(REPO_ROOT, options.fixture);
    products = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
  } else {
    const indexHtml = await fs.readFile(path.join(REPO_ROOT, 'index.html'), 'utf8');
    const config = readPublicSupabaseConfig(indexHtml);
    products = await fetchPublicCatalog(config);
  }
  const outDir = path.resolve(REPO_ROOT, options.outDir);
  const result = await buildSite({ root: REPO_ROOT, outDir, products });
  console.log(`Generadas ${result.productCount} páginas públicas de producto; sitemap con ${result.sitemapUrlCount} URLs.`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : 'Falló la generación del sitio SEO.');
    process.exitCode = 1;
  });
}
