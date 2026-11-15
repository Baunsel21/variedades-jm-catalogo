import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const frontend = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const edge = await readFile(new URL('../supabase/functions/wompi-create-checkout/index.ts', import.meta.url), 'utf8');

assert.match(frontend, /const WOMPI_PUBLIC_KEY\s*=\s*"pub_prod_[^"]+"/,
  'la tienda en producción debe conservar una llave pública de producción');
assert.match(edge, /Deno\.env\.get\("WOMPI_ENVIRONMENT"\)\s*\?\?\s*"prod"/,
  'el ambiente por defecto de la función debe ser producción');
assert.match(edge, /wompiEnvironment\s*===\s*"test"\s*\?\s*"WOMPI_INTEGRITY_SECRET_TEST"\s*:\s*"WOMPI_INTEGRITY_SECRET"/,
  'la función debe seleccionar la llave de integridad por ambiente sin mezclar nombres');
assert.match(edge, /sha256Hex\(`\$\{reference\}\$\{amountInCents\}COP\$\{expirationTime\}\$\{integritySecret\}`\)/,
  'el hash debe concatenar referencia, monto en centavos, COP, expiración y secreto, en ese orden');
assert.match(edge, /return json\(\{\s*reference, amountInCents, signature, expirationTime,/,
  'el servidor debe devolver los valores usados para firmar');

const amountField = frontend.indexOf("'amount-in-cents':String(amountInCents)");
const referenceField = frontend.indexOf("'reference':data.reference", amountField);
const signatureField = frontend.indexOf("'signature:integrity':data.signature", referenceField);
const expirationField = frontend.indexOf("'expiration-time':expirationTime", signatureField);
assert.ok(amountField >= 0 && referenceField > amountField && signatureField > referenceField && expirationField > signatureField,
  'el formulario debe enviar monto, referencia, firma y expiration-time junto al mismo intento');
assert.match(frontend, /new Date\(expirationTime\)\.toISOString\(\)===expirationTime/,
  'el frontend debe rechazar expiraciones no canónicas antes de abrir Wompi');

console.log('PASS Wompi integrity contract: production public-key marker, environment-specific secret selection, canonical signed fields and expiration-time submitted with the same transaction; no network or payment.');
