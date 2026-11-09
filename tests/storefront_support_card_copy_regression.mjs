import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const card = source.match(/<section class="detailPersonalizedCard"[\s\S]*?<\/section>/)?.[0] ?? '';
assert.ok(card, 'La tarjeta de confianza sigue presente en el detalle de producto.');
assert.match(card, /SIREVYA · COMPRA CON CONFIANZA/);
assert.match(card, /<h3>Tu compra, con acompañamiento<\/h3>/);
assert.match(card, /disponibilidad, tallas, colores, envíos y opciones de pago antes de confirmar tu pedido/);
assert.match(card, /Consultar por WhatsApp/);
assert.doesNotMatch(card, /<h3>Atención personalizada<\/h3>|ESTAMOS PARA AYUDARTE/);
const whatsappHref = card.match(/<a class="detailPersonalizedLink" href="([^"]+)"/)?.[1] ?? '';
assert.equal(whatsappHref, 'https://wa.me/573025469983?text=Hola%2C%20necesito%20asesor%C3%ADa%20sobre%20un%20producto%20de%20Sirevya.',
  'Se conserva exactamente el destino autorizado de atención.');
assert.match(card, /rel="noopener noreferrer"/);

console.log('storefront_support_card_copy_regression: PASS');
