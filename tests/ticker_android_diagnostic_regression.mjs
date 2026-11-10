import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const helper = source.match(/function evaluateTickerPhysicalProbe\(input\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(helper, 'El helper puro de resultado de movimiento está disponible.');
const context = vm.createContext({});
vm.runInContext(helper, context);
const evaluate = context.evaluateTickerPhysicalProbe;

const moving = evaluate({
  reducedMotion: false,
  animationName: 'jmTickerMove',
  animationDuration: '30s',
  animationIterationCount: 'infinite',
  animationPlayState: 'running',
  hasOverflow: true,
  positions: [500, 487, 473, 460, 445, 432, 417, 404],
});
assert.equal(moving.pass, true, 'Una animación móvil activa y con posiciones cambiantes pasa.');

const reduced = evaluate({ reducedMotion: true, animationName: 'none', hasOverflow: true });
assert.equal(reduced.pass, true, 'Reduced motion detiene la animación y deja mensajes desplazables.');
assert.equal(evaluate({ reducedMotion: true, animationName: 'jmTickerMove', hasOverflow: true }).pass, false,
  'La preferencia de movimiento reducido no debe dejar la animación en curso.');
assert.equal(evaluate({ reducedMotion: true, animationName: 'none', hasOverflow: false }).pass, false,
  'El texto debe seguir accesible aunque se desactive la animación.');
assert.equal(evaluate({
  reducedMotion: false,
  animationName: 'jmTickerMove',
  animationDuration: '30s',
  animationIterationCount: 'infinite',
  animationPlayState: 'running',
  hasOverflow: true,
  positions: [40, 40, 40, 40, 40, 40, 40, 40],
}).pass, false, 'Un track estático no pasa solo por reportar animation-name.');

const start = source.indexOf('function runTickerPhysicalDiagnostic()');
const end = source.indexOf('runTickerPhysicalDiagnostic();', start);
assert.ok(start >= 0 && end > start, 'El ejecutor de la prueba física está conectado.');
const browserProbe = source.slice(start, end);
assert.match(browserProbe, /get\('verificarTicker'\)!=='1'/, 'El diagnóstico está apagado salvo URL explícita.');
assert.match(browserProbe, /getBoundingClientRect\(\)\.left/, 'La prueba mide movimiento renderizado real.');
assert.match(browserProbe, /prefers-reduced-motion: reduce/, 'La prueba reconoce la preferencia del dispositivo.');
assert.match(browserProbe, /aria-live/, 'El resultado se anuncia accesiblemente.');
assert.doesNotMatch(browserProbe, /\.rpc\(|localStorage|sessionStorage|fetch\(/, 'El diagnóstico no llama Supabase, no guarda estado ni hace peticiones.');

console.log('ticker_android_diagnostic_regression: PASS (medición real, reduced-motion y sin mutaciones)');
