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

for (const [name, html] of [['privacy', privacyHtml], ['faq', faqHtml]]) {
  assert.doesNotMatch(html, /<script\b|<iframe\b|https?:\/\//i, `${name} no carga scripts, iframes ni recursos externos.`);
  assert.doesNotMatch(html, /noindex,nofollow/i, `${name} no hereda el bloqueo de indexación exclusivo del preview.`);
}

console.log('public_policies_regression: OK (texto de privacidad conservado; enlaces de catálogo/checkout; FAQ factual; HTML estático sin recursos externos).');
