import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const privacyHtml = await readFile(new URL('../politica-privacidad.html', import.meta.url), 'utf8');
const faqHtml = await readFile(new URL('../preguntas-frecuentes.html', import.meta.url), 'utf8');
const returnsHtml = await readFile(new URL('../cambios-devoluciones.html', import.meta.url), 'utf8');
const sitemapXml = await readFile(new URL('../sitemap.xml', import.meta.url), 'utf8');
const robotsTxt = await readFile(new URL('../robots.txt', import.meta.url), 'utf8');

const footerPolicyLinks = indexHtml.match(/<div class="footerPolicyLinks">([\s\S]*?)<\/div>/)?.[1] ?? '';
const checkoutPrivacyNote = indexHtml.match(/<p class="checkoutPrivacyNote">([\s\S]*?)<\/p>/)?.[1] ?? '';
assert.equal((indexHtml.match(/href="\/politica-privacidad\.html"/g) || []).length, 2, 'Catálogo/modal y checkout enlazan privacidad.');
assert.equal((indexHtml.match(/href="\/preguntas-frecuentes\.html"/g) || []).length, 3, 'Catálogo, modal y checkout enlazan FAQ.');
assert.equal((indexHtml.match(/href="\/cambios-devoluciones\.html"/g) || []).length, 2, 'El catálogo y el checkout enlazan la política de cambios y devoluciones.');
assert.ok(footerPolicyLinks.includes('href="/cambios-devoluciones.html"'), 'El pie conserva el enlace de cambios y devoluciones.');
assert.ok(checkoutPrivacyNote.includes('href="/cambios-devoluciones.html"'), 'El checkout permite consultar la política antes de continuar.');
assert.equal((faqHtml.match(/href="\/cambios-devoluciones\.html"/g) || []).length, 1, 'La FAQ enlaza la política de cambios y devoluciones.');
assert.match(robotsTxt, /^User-agent: \*$/m);
assert.match(robotsTxt, /^Allow: \/$/m);
assert.match(robotsTxt, /^Disallow: \/admin\.html$/m);
assert.match(robotsTxt, /^Sitemap: https:\/\/sirevya\.com\.co\/sitemap\.xml$/m);
const sitemapUrls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url);
assert.deepEqual(sitemapUrls, [
  'https://sirevya.com.co/',
  'https://sirevya.com.co/politica-privacidad.html',
  'https://sirevya.com.co/preguntas-frecuentes.html',
  'https://sirevya.com.co/cambios-devoluciones.html',
], 'El sitemap incluye solo la portada y páginas estáticas públicas confirmadas.');
assert.equal((sitemapXml.match(/<url>/g) || []).length, sitemapUrls.length);

const privacySections = [
  '1. Responsable del tratamiento',
  '2. Datos que podemos recolectar',
  '3. Finalidades del tratamiento',
  '4. Autorización',
  '5. Encargados y terceros',
  '6. Seguridad',
  '7. Derechos del titular',
  '8. Consultas, reclamos y solicitudes',
  '9. Vigencia y cambios',
];
for (const section of privacySections) {
  assert.ok(indexHtml.includes(section), `El modal original conserva ${section}.`);
  assert.ok(privacyHtml.includes(section), `La página independiente conserva ${section}.`);
}
assert.ok(indexHtml.includes('En Sirevya nos comprometemos a proteger los datos personales'));
assert.ok(privacyHtml.includes('En Sirevya nos comprometemos a proteger los datos personales'));
assert.ok(privacyHtml.includes('Antes de usar esta página como aviso legal definitivo'));
assert.match(privacyHtml, /href="\/index\.html"/);

const faqQuestions = [
  '¿Cómo encuentro un producto?',
  '¿Dónde consulto tallas, colores o detalles de un producto?',
  '¿Cómo se calcula el envío?',
  '¿Qué medios de pago están disponibles?',
  '¿Puedo pagar contraentrega?',
  '¿Cómo contacto a Sirevya?',
  '¿Puedo consultar precios y disponibilidad sin conexión?',
];
for (const question of faqQuestions) assert.ok(faqHtml.includes(question), `La FAQ incluye ${question}.`);
assert.ok(faqHtml.includes('Esta guía no reemplaza las políticas comerciales de la tienda.'));
assert.ok(faqHtml.includes('filtros de disponibilidad, color o talla'));
assert.doesNotMatch(faqHtml, /limitar los resultados por precio/i, 'La FAQ no anuncia el rango de precio retirado.');
assert.match(faqHtml, /href="\/index\.html"/);

const returnsSections = [
  '1. Si recibes un producto defectuoso, dañado o diferente',
  '2. Cómo presentar una solicitud',
  '3. Revisión y respuesta',
  '4. Garantía legal',
  '5. Derecho de retracto en compras a distancia',
  '6. Cambios por talla, color o preferencia',
  '7. Gastos de envío',
  '8. Devoluciones y reembolsos',
  'Fuentes normativas y orientación',
];
for (const section of returnsSections) assert.ok(returnsHtml.includes(section), `La política incluye ${section}.`);
assert.ok(returnsHtml.includes('cinco (5) días hábiles'));
assert.ok(returnsHtml.includes('quince (15) días calendario'));
assert.ok(returnsHtml.includes('quince (15) días hábiles'));
assert.ok(returnsHtml.includes('en las mismas condiciones en que se recibió'));
assert.ok(returnsHtml.includes('Los costos de transporte y los demás gastos asociados a la devolución por retracto están a cargo del consumidor'));
assert.ok(returnsHtml.includes('el proveedor asume el transporte cuando sea necesario'));
assert.ok(returnsHtml.includes('medio de pago que prefieras'));
assert.ok(returnsHtml.includes('fecha y hora y un número de radicado o referencia'));
assert.ok(returnsHtml.includes('https://wa.me/573025469983'));
assert.ok(returnsHtml.includes('mailto:sirevya99@gmail.com'));
assert.doesNotMatch(returnsHtml, /treinta \(30\) días calendario/i, 'No usa el antiguo plazo de 30 días para retractos de comercio electrónico.');
assert.match(returnsHtml, /href="\/index\.html"/);

const shareImage = 'https://sirevya.com.co/share-sirevya.png';
function assertSocialMetadata(name, html, { url, title, description }) {
  const exactTags = [
    `<link rel="canonical" href="${url}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Sirevya">',
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:url" content="${url}">`,
    '<meta property="og:locale" content="es_CO">',
    `<meta property="og:image" content="${shareImage}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:image:alt" content="Sirevya, moda y accesorios">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
    `<meta name="twitter:image" content="${shareImage}">`,
    '<meta name="twitter:image:alt" content="Sirevya, moda y accesorios">',
  ];
  for (const tag of exactTags) {
    assert.equal((html.split(tag).length - 1), 1, `${name} debe incluir una sola vez: ${tag}`);
  }
  assert.equal((html.match(/<link rel="canonical"/g) || []).length, 1, `${name} no debe tener canonicals duplicados.`);
  assert.equal((html.match(/<meta property="og:url"/g) || []).length, 1, `${name} no debe tener og:url duplicados.`);
}

assertSocialMetadata('privacy', privacyHtml, {
  url: 'https://sirevya.com.co/politica-privacidad.html',
  title: 'Sirevya | Política de Tratamiento de Datos Personales',
  description: 'Consulta la Política de Tratamiento de Datos Personales de Sirevya y los canales disponibles para presentar solicitudes relacionadas con tus datos.',
});
assertSocialMetadata('faq', faqHtml, {
  url: 'https://sirevya.com.co/preguntas-frecuentes.html',
  title: 'Sirevya | Preguntas frecuentes',
  description: 'Respuestas sobre el catálogo Sirevya, la información de productos y las opciones que se muestran en el checkout.',
});
assertSocialMetadata('returns', returnsHtml, {
  url: 'https://sirevya.com.co/cambios-devoluciones.html',
  title: 'Sirevya | Cambios, devoluciones y reembolsos',
  description: 'Información para solicitar atención por productos defectuosos, pedidos diferentes, garantía legal, retracto, cambios y reembolsos en Sirevya.',
});

for (const [name, html] of [['privacy', privacyHtml], ['faq', faqHtml], ['returns', returnsHtml]]) {
  assert.doesNotMatch(html, /<script\b|<iframe\b/i, `${name} permanece como HTML estático sin JS ni iframes.`);
  assert.doesNotMatch(html, /<(?:img|script|iframe|source|audio|video)\b[^>]*\b(?:src|href)\s*=\s*["']https?:\/\//i, `${name} no carga recursos activos externos.`);
  assert.doesNotMatch(html, /<link\b(?=[^>]*rel=["'](?:stylesheet|preload|preconnect)["'])[^>]*href=["']https?:\/\//i, `${name} no importa estilos ni recursos externos.`);
  assert.doesNotMatch(html, /noindex,nofollow/i, `${name} no hereda el bloqueo de indexación exclusivo del preview.`);
}

console.log('public_policies_regression: OK (privacidad, FAQ, retracto/devoluciones, enlaces, SEO, sitemap y robots).');
