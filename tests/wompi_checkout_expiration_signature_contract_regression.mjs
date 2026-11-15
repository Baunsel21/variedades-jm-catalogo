import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const frontend = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const checkout = await readFile(new URL('../supabase/functions/wompi-create-checkout/index.ts', import.meta.url), 'utf8');
const webhook = await readFile(new URL('../supabase/functions/wompi-webhook/index.ts', import.meta.url), 'utf8');

assert.match(frontend, /const WOMPI_PUBLIC_KEY\s*=\s*"pub_prod_[^"]+"/,
  'la tienda pública debe conservar su llave de producción');
assert.match(frontend, /const WOMPI_PUBLIC_ENVIRONMENT\s*=\s*WOMPI_PUBLIC_KEY\.startsWith\('pub_test_'\).*WOMPI_PUBLIC_KEY\.startsWith\('pub_prod_'\)/,
  'el ambiente enviado debe derivarse del prefijo de la llave pública');
assert.match(frontend, /environment:WOMPI_PUBLIC_ENVIRONMENT/,
  'el checkout debe declarar al servidor el ambiente de su llave pública');

assert.match(checkout, /const WOMPI_PRODUCTION_ENVIRONMENT:\s*WompiEnvironment\s*=\s*"prod"/,
  'el handler de producción debe fijar el ambiente a prod en su propio código');
assert.match(checkout, /const wompiEnvironment = WOMPI_PRODUCTION_ENVIRONMENT/,
  'el checkout no debe tomar el ambiente de una variable compartida');
assert.doesNotMatch(checkout, /Deno\.env\.get\(["']WOMPI_ENVIRONMENT["']\)/,
  'el checkout no debe leer WOMPI_ENVIRONMENT global');
assert.match(checkout, /const integritySecret = Deno\.env\.get\("WOMPI_INTEGRITY_SECRET"\)/,
  'el checkout debe leer únicamente el secreto de integridad de producción');
assert.doesNotMatch(checkout, /WOMPI_INTEGRITY_SECRET_TEST/,
  'el handler de producción no debe seleccionar el secreto TEST');
assert.match(checkout, /requestedWompiEnvironment\s*!==\s*wompiEnvironment/,
  'el checkout debe rechazar un ambiente de cliente distinto antes de crear reservas u órdenes');
assert.match(checkout, /return json\(\{\s*environment: wompiEnvironment, reference, amountInCents, signature, expirationTime,/,
  'la respuesta del checkout debe identificar el ambiente usado para firmar');

assert.match(webhook, /const expectedEnvironment = "prod" as const/,
  'el webhook de producción debe fijar prod localmente');
assert.doesNotMatch(webhook, /Deno\.env\.get\(["']WOMPI_ENVIRONMENT["']\)/,
  'el webhook no debe leer WOMPI_ENVIRONMENT global');
assert.match(webhook, /const eventSecret = Deno\.env\.get\("WOMPI_EVENT_SECRET"\)/,
  'el webhook debe leer el secreto de eventos de producción');
assert.match(webhook, /const privateKey = Deno\.env\.get\("WOMPI_PRIVATE_KEY"\)/,
  'el webhook debe leer la llave privada de producción');
assert.doesNotMatch(webhook, /WOMPI_EVENT_SECRET_TEST|WOMPI_PRIVATE_KEY_TEST/,
  'el handler de producción no debe seleccionar credenciales TEST');
assert.match(webhook, /const wompiBaseUrl = "https:\/\/production\.wompi\.co\/v1"/,
  'la consulta autenticada del webhook debe apuntar solo a la API de producción');

assert.match(checkout, /sha256Hex\(`\$\{reference\}\$\{amountInCents\}COP\$\{expirationTime\}\$\{integritySecret\}`\)/,
  'la firma debe conservar referencia, centavos, COP, expiration-time y secreto en el orden esperado');
const amountField = frontend.indexOf("'amount-in-cents':String(amountInCents)");
const referenceField = frontend.indexOf("'reference':data.reference", amountField);
const signatureField = frontend.indexOf("'signature:integrity':data.signature", referenceField);
const expirationField = frontend.indexOf("'expiration-time':expirationTime", signatureField);
assert.ok(amountField >= 0 && referenceField > amountField && signatureField > referenceField && expirationField > signatureField,
  'el formulario debe enviar el monto, la referencia, la firma y expiration-time del mismo intento');
assert.match(frontend, /if\(data\.environment!==WOMPI_PUBLIC_ENVIRONMENT\)/,
  'el navegador debe comprobar que la respuesta coincide con su llave pública');
assert.match(frontend, /new Date\(expirationTime\)\.toISOString\(\)===expirationTime/,
  'el frontend debe rechazar expiraciones no canónicas antes de abrir Wompi');

console.log('PASS Wompi production contract: fixed production environment, production-only secrets/endpoints, client environment gate, integrity signature and preserved expiration-time; no network or payment.');
