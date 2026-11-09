import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const privacyHtml = await readFile(new URL('../politica-privacidad.html', import.meta.url), 'utf8');
const faqHtml = await readFile(new URL('../preguntas-frecuentes.html', import.meta.url), 'utf8');

assert.equal((indexHtml.match(/href="\/politica-privacidad\.html"/g) || []).length, 2, 'Catálogo/modal y checkout enlazan privacidad.');
assert.equal((indexHtml.match(/href="\/preguntas-frecuentes\.html"/g) || []).length, 3, 'Catálogo, modal y checkout enlazan FAQ.');

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
assert.ok(privacyHtml.includes('Esta política es un texto informativo preparado para el funcionamiento actual del catálogo.'));
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
assert.match(faqHtml, /href="\/index\.html"/);

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

for (const [name, html] of [['privacy', privacyHtml], ['faq', faqHtml]]) {
  assert.doesNotMatch(html, /<script\b|<iframe\b/i, `${name} permanece como HTML estático sin JS ni iframes.`);
  assert.doesNotMatch(html, /<(?:img|script|iframe|source|audio|video)\b[^>]*\b(?:src|href)\s*=\s*["']https?:\/\//i, `${name} no carga recursos activos externos.`);
  assert.doesNotMatch(html, /<link\b(?=[^>]*rel=["'](?:stylesheet|preload|preconnect)["'])[^>]*href=["']https?:\/\//i, `${name} no importa estilos ni recursos externos.`);
  assert.doesNotMatch(html, /noindex,nofollow/i, `${name} no hereda el bloqueo de indexación exclusivo del preview.`);
}

console.log('public_policies_regression: OK (texto y enlaces conservados; canonical/OG/Twitter únicos; HTML estático sin recursos activos externos).');
