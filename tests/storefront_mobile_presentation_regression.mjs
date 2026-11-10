import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.doesNotMatch(source, /\.jmTicker\s*,[^{}]*\{[^}]*display\s*:\s*none/i,
  'El ticker no se oculta junto con otros elementos en breakpoints móviles.');
assert.doesNotMatch(source, /\.jmTicker\s*\{[^}]*display\s*:\s*none/i,
  'No hay una regla directa que oculte el ticker.');
assert.match(source, /@media\(max-width:700px\)\{\s*\.jmTicker\{display:block!important/,
  'El ticker aparece explícitamente en móvil.');
assert.match(source, /@media\(hover:hover\) and \(pointer:fine\)\{\.jmTicker:hover \.jmTickerTrack\{animation-play-state:paused\}\}/,
  'Solo un puntero fino con hover real puede pausar el ticker; el hover pegajoso táctil no lo detiene.');
assert.match(source, /\.jmTicker:focus-within \.jmTickerTrack\{animation-play-state:paused\}/,
  'La pausa por foco de teclado se conserva para accesibilidad.');
assert.match(source, /@media\(prefers-reduced-motion:reduce\)\{\.jmTicker\{overflow-x:auto!important/,
  'Con movimiento reducido, los mensajes siguen accesibles mediante desplazamiento.');
assert.match(source, /Tarifas según ciudad/);
assert.match(source, /Compra segura/);
assert.match(source, /Consulta las condiciones de envío vigentes/);
assert.match(source, /La mejor calidad, tu estilo, nuestra pasión/);
assert.match(source, /Nuevos productos/);
const tickerSequences = [...source.matchAll(/<div class="jmTickerSequence"([^>]*)>([\s\S]*?)<\/div>/g)];
assert.equal(tickerSequences.length, 2, 'El loop se construye con dos secuencias completas y simétricas.');
assert.equal((tickerSequences[0][2].match(/<span(?:\s|>)/g) || []).length, 5, 'Cada secuencia contiene los cinco mensajes comerciales previstos.');
assert.match(tickerSequences[0][2], /data-shipping-policy>/, 'La secuencia accesible contiene el copy dinámico de envío.');
assert.match(tickerSequences[1][1], /aria-hidden="true"/, 'La copia visual duplicada no se lee dos veces.');
assert.match(tickerSequences[1][2], /data-shipping-policy-copy>/, 'La secuencia duplicada mantiene un target propio para el mensaje dinámico.');
assert.match(source, /\.jmTickerTrack\{display:flex;width:max-content;gap:0/);
assert.match(source, /\.jmTickerSequence\{display:inline-flex;align-items:center;flex:0 0 auto;gap:48px;padding-right:48px;white-space:nowrap\}/);
assert.match(source, /@keyframes jmTickerMove\{from\{transform:translateX\(0\)\}to\{transform:translateX\(-50%\)\}\}/);
assert.ok(source.includes('.jmTickerTrack{padding:7px 0!important;font-size:clamp(10px,2.8vw,12px)!important;animation-duration:30s!important;gap:0!important}'),
  'La separación móvil heredada no crea un hueco adicional entre las secuencias.');
assert.match(source, /\.jmTickerSequence\{gap:clamp\(18px,5vw,28px\)!important;padding-right:clamp\(18px,5vw,28px\)!important\}/,
  'La separación se adapta a móvil sin cortar palabras.');

assert.match(source, /<a class="waHelpFloat" href="https:\/\/wa\.me\/573025469983\?text=Hola%2C%20necesito%20asesor%C3%ADa%20sobre%20un%20producto\."/,
  'El destino y número de WhatsApp permanecen intactos.');
assert.match(source, /<span class="waHelpLabel"><b>Asesoría<\/b><\/span>/,
  'El texto del botón flotante usa el rótulo solicitado.');
assert.match(source, /aria-label="Contactar con asesoría por WhatsApp"/,
  'El nombre accesible coincide con el texto visible.');
assert.match(source, /\.waHelpFloat\{[^}]*background:#fffaf3!important;[^}]*border:[^;]*;[^}]*border-radius:14px!important/,
  'La CTA utiliza una superficie neutra con borde y sombra discretos.');
assert.doesNotMatch(source, /\.waHelpFloat\{[^}]*background:#(?:075e54|0a6f61)/i,
  'El botón no vuelve al fondo verde dominante.');
assert.match(source, /\.waHelpIcon\{[^}]*border-radius:0;background:transparent!important/,
  'El icono reconocible no aparece dentro de un círculo verde/blanco grande.');
assert.match(source, /\.waHelpIcon:before\{width:22px;height:22px;background:#25d366\}/,
  'El verde se conserva únicamente en el glifo de WhatsApp.');
assert.match(source, /\.waHelpFloat:focus-visible\{outline:/,
  'El enlace conserva un indicador visible de teclado.');
assert.match(source, /@media\(prefers-reduced-motion:reduce\)\{\.waHelpFloat\{transition:none!important\}\}/,
  'La microinteracción respeta movimiento reducido.');
assert.match(source, /body\.cartOpen \.waHelpFloat|#checkoutModal\.open[^{]*\.waHelpFloat/,
  'Se conservan las reglas existentes para evitar solapar carrito/checkout.');

console.log('storefront_mobile_presentation_regression: OK (ticker móvil y WhatsApp accesible, destino preservado)');
