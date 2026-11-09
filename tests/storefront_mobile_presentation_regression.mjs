import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.doesNotMatch(source, /\.jmTicker\s*,[^{}]*\{[^}]*display\s*:\s*none/i,
  'El ticker no se oculta junto con otros elementos en breakpoints móviles.');
assert.doesNotMatch(source, /\.jmTicker\s*\{[^}]*display\s*:\s*none/i,
  'No hay una regla directa que oculte el ticker.');
assert.match(source, /@media\(max-width:700px\)\{\s*\.jmTicker\{display:block!important/,
  'El ticker aparece explícitamente en móvil.');
assert.match(source, /\.jmTicker:hover \.jmTickerTrack,\.jmTicker:focus-within \.jmTickerTrack\{animation-play-state:paused\}/,
  'El movimiento se puede pausar al pasar el cursor o enfocar contenido.');
assert.match(source, /@media\(prefers-reduced-motion:reduce\)\{\.jmTicker\{overflow-x:auto!important/,
  'Con movimiento reducido, los mensajes siguen accesibles mediante desplazamiento.');
assert.match(source, /Tarifas según ciudad/);
assert.match(source, /Compra segura/);
assert.match(source, /Consulta las condiciones de envío vigentes/);

assert.match(source, /<a class="waHelpFloat" href="https:\/\/wa\.me\/573025469983\?text=Hola%2C%20necesito%20asesor%C3%ADa%20sobre%20un%20producto\."/,
  'El destino y número de WhatsApp permanecen intactos.');
assert.match(source, /<span class="waHelpLabel"><b>Asesoría<\/b><\/span>/,
  'El texto del botón flotante usa el rótulo solicitado.');
assert.match(source, /aria-label="Contactar con asesoría por WhatsApp"/,
  'El nombre accesible coincide con el texto visible.');
assert.match(source, /\.waHelpFloat:focus-visible\{outline:/,
  'El enlace conserva un indicador visible de teclado.');
assert.match(source, /@media\(prefers-reduced-motion:reduce\)\{\.waHelpFloat\{transition:none!important\}\}/,
  'La microinteracción respeta movimiento reducido.');
assert.match(source, /body\.cartOpen \.waHelpFloat|#checkoutModal\.open[^{]*\.waHelpFloat/,
  'Se conservan las reglas existentes para evitar solapar carrito/checkout.');

console.log('storefront_mobile_presentation_regression: OK (ticker móvil y WhatsApp accesible, destino preservado)');
