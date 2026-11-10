import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseCheckoutCedula } from '../supabase/functions/wompi-create-checkout/cedula.mjs';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const edge = fs.readFileSync(new URL('../supabase/functions/wompi-create-checkout/index.ts', import.meta.url), 'utf8');

assert.deepEqual(parseCheckoutCedula(undefined), { value: '', error: 'required' });
assert.deepEqual(parseCheckoutCedula('   '), { value: '', error: 'required' });
assert.deepEqual(parseCheckoutCedula('  CC-12345678  '), { value: 'CC-12345678', error: null });
assert.deepEqual(parseCheckoutCedula('A'.repeat(60)), { value: 'A'.repeat(60), error: null });
for (const invalid of ['A'.repeat(61), 12345678, '12\n34', '12\u008034']) {
  assert.equal(parseCheckoutCedula(invalid).error, 'invalid', `Rechaza tipo/control/largo inválido: ${String(invalid).slice(0, 10)}`);
}

function extractFunction(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Existe ${name}.`);
  const open = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  assert.fail(`No se pudo cerrar ${name}.`);
}

const validationFields = {
  customerName: { value: 'Cliente Sintético' }, customerCedulaType: { value: 'CC' }, customerCedula: { value: '   ' },
  customerPhone: { value: '3000000000' }, customerEmail: { value: 'synthetic@example.test', checkValidity: () => true },
  customerCity: { value: 'Cali' }, customerCityOther: { value: '' }, customerAddress: { value: 'Calle sintética 1' },
  customerNeighborhood: { value: 'Barrio sintético' },
};
const validationContext = vm.createContext({ $: id => validationFields[id] || null });
vm.runInContext(extractFunction(index, 'getCheckoutValidationErrors'), validationContext);
let errors = JSON.parse(JSON.stringify(validationContext.getCheckoutValidationErrors()));
assert.deepEqual(errors.map(error => error.id), ['customerCedula'], 'Cédula vacía es el error antes de iniciar checkout.');
validationFields.customerCedula.value = ' CC-12345678 ';
errors = JSON.parse(JSON.stringify(validationContext.getCheckoutValidationErrors()));
assert.deepEqual(errors, [], 'Un documento no vacío se acepta sin restringirlo a solo dígitos.');
validationFields.customerCedulaType.value = '';
assert.deepEqual(JSON.parse(JSON.stringify(validationContext.getCheckoutValidationErrors().map(error => error.id))), ['customerCedulaType'], 'El tipo de documento también es obligatorio para Wompi.');
validationFields.customerCedulaType.value = 'CC';
validationFields.customerCedula.value = 'X'.repeat(61);
assert.equal(validationContext.getCheckoutValidationErrors()[0].id, 'customerCedula');
for (const invalidControl of ['12\n34', '12\u007f34', '12\u008034']) {
  validationFields.customerCedula.value = invalidControl;
  assert.equal(validationContext.getCheckoutValidationErrors()[0].id, 'customerCedula', 'La UI rechaza C0, DEL y C1 igual que el parser Edge.');
}

const cleanupSummary = { hidden: false, textContent: 'error' };
const cleanupField = { removed: [], removeAttribute(name) { this.removed.push(name); } };
const cleanupTypeField = { removed: [], removeAttribute(name) { this.removed.push(name); } };
const cleanupMessage = { textContent: 'Escribe tu documento.', style: { display: 'block' } };
const cleanupTypeMessage = { textContent: 'Selecciona un tipo.', style: { display: 'block' } };
const cleanupContext = vm.createContext({
  $: id => id === 'checkoutValidationSummary' ? cleanupSummary : id === 'customerCedulaType' ? cleanupTypeField : id === 'customerCedula' ? cleanupField : null,
  checkoutErrorElement: id => id === 'customerCedulaType' ? cleanupTypeMessage : id === 'customerCedula' ? cleanupMessage : null,
});
vm.runInContext(`const checkoutValidationFieldIds=['customerName','customerCedulaType','customerCedula','customerPhone','customerEmail','customerCity','customerCityOther','customerAddress','customerNeighborhood'];\n${extractFunction(index, 'clearCheckoutValidation')}`, cleanupContext);
cleanupContext.clearCheckoutValidation();
assert.equal(cleanupSummary.hidden, true);
assert.deepEqual(cleanupField.removed, ['aria-invalid']);
assert.deepEqual(cleanupTypeField.removed, ['aria-invalid']);
assert.equal(cleanupMessage.textContent, '');
assert.equal(cleanupTypeMessage.textContent, '');
assert.equal(cleanupMessage.style.display, 'none', 'Cerrar/reabrir checkout limpia el error viejo de cédula.');
assert.equal(cleanupTypeMessage.style.display, 'none', 'Cerrar/reabrir checkout limpia el error viejo del tipo de documento.');

const orderFields = { ...validationFields, customerCedula: { value: '  CC-987654  ' } };
const orderContext = vm.createContext({
  $: id => orderFields[id] || null,
  checkoutCityValue: () => 'Cali', selectedPayment: () => 'PSE', checkoutShipping: 0,
  getCheckoutItems: () => [{ id: 'synthetic-product', name: 'Synthetic', code: 'SYN-1', qty: 1, color: 'Azul', size: 'M' }],
  comboPriceForItem: item => item.price ?? 10,
  normalizeCheckoutCouponCode: value => String(value ?? '').trim().toUpperCase(),
  checkoutCouponCode: '',
  currentCheckoutCouponQuote: () => null,
});
vm.runInContext(extractFunction(index, 'buildOrderPayload'), orderContext);
const payload = JSON.parse(JSON.stringify(orderContext.buildOrderPayload()));
assert.equal(payload.cedula, 'CC-987654', 'buildOrderPayload conserva el valor recortado para el servidor.');
assert.equal(payload.cedula_type, 'CC', 'buildOrderPayload conserva el tipo requerido por Wompi.');
assert.equal(payload.payment, 'PSE');

assert.match(index, /id="customerCedulaType"[^>]*required[^>]*aria-describedby="checkoutErrorCustomerCedulaType"/);
assert.match(index, /id="customerCedula"[^>]*required[^>]*aria-describedby="checkoutErrorCustomerCedula"/);
assert.match(index, /id="checkoutErrorCustomerCedula"/);
assert.doesNotMatch(index, /Cédula \(opcional\)|Cédula es opcional|La cédula es opcional/);
assert.match(index, /'customer-data:legal-id':payload\.cedula/);
assert.doesNotMatch(index, /if\(payload\.cedula\)fields\['customer-data:legal-id'\]/);
assert.match(index, /'customer-data:legal-id-type':payload\.cedula_type/);
assert.match(index, /p_customer_cedula:payload\.cedula/);
assert.match(index, /if\(payment!=='Contra entrega'\)\{[\s\S]*?payWithWompi\(payload\);return;/, 'PSE/Nequi/tarjeta conservan la ruta común Wompi después de validar la quote y el total.');
assert.ok(index.includes("const checkoutValidationFieldIds=['customerName','customerCedulaType','customerCedula'"));
assert.ok(index.includes(String.raw`\u007f-\u009f`), 'La regex de UI cubre los controles C1 además de C0/DEL.');

const parsePos = edge.indexOf('parseCheckoutCedula(body?.cedula ?? body?.customer_cedula)');
const invalidGuardPos = edge.indexOf('CUSTOMER_CEDULA_INVALID');
const handlerStart = edge.indexOf('Deno.serve(');
const firstFetchPos = edge.indexOf('await fetch(', handlerStart);
assert.ok(parsePos >= 0 && invalidGuardPos > parsePos && firstFetchPos > invalidGuardPos, 'La Edge valida tipo/largo/control antes de cualquier llamada remota.');
const existingLookupPos = edge.indexOf('const existing = existingRows[0]');
const newReferenceGuardPos = edge.indexOf('if (!existing && !customerCedula)');
const prepareCheckoutPos = edge.indexOf('fetch(`${supabaseUrl}/rest/v1/rpc/prepare_storefront_wompi_checkout`');
assert.ok(existingLookupPos >= 0 && newReferenceGuardPos > existingLookupPos && prepareCheckoutPos > newReferenceGuardPos, 'Una referencia nueva sin documento se rechaza antes de preparar y reservar el checkout.');
const existingCedulaGuardPos = edge.indexOf('if (!customerCedula)', existingLookupPos);
const terminalRetryPos = edge.indexOf('const terminalTransaction = Boolean(existingTransactionId)', existingLookupPos);
assert.ok(existingCedulaGuardPos > newReferenceGuardPos && terminalRetryPos > existingCedulaGuardPos, 'Una nueva tentativa sobre una referencia existente requiere cédula antes de liberar reservas terminales.');

const migration = fs.readFileSync(new URL('../supabase/migrations/20261109090000_require_customer_cedula.sql', import.meta.url), 'utf8');
assert.match(migration, /BEFORE INSERT OR UPDATE OF customer_cedula, payment_method/);
assert.match(migration, /v_method = 'contra entrega'/);
assert.match(migration, /CUSTOMER_CEDULA_REQUIRED/);
assert.match(migration, /CREATE TRIGGER[\s\S]*ON public\.web_orders/);
assert.doesNotMatch(migration, /ALTER TABLE public\.orders|NOT NULL/);

console.log('PASS checkout_cedula_regression: UI required/cleanup, C1 controls, payload legal-id/type, server guard, reference retry and COD trigger contract.');
