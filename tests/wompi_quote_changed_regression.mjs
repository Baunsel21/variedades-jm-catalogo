import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const edgePath=new URL('../supabase/functions/wompi-create-checkout/index.ts',import.meta.url);
const edge=fs.readFileSync(edgePath,'utf8');
const sql=fs.readFileSync(new URL('../supabase/migrations/20261108100000_storefront_coupons.sql',import.meta.url),'utf8');
const catalog=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');

function extractTsFunction(name,signature,jsSignature){
  const start=edge.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`Missing function ${name}`);
  const end=edge.indexOf('\n}',start);
  assert.notEqual(end,-1,`Unterminated function ${name}`);
  const raw=edge.slice(start,end+2);
  const executable=raw.replace(signature,jsSignature);
  assert.notEqual(executable,raw,`Could not adapt TypeScript signature for ${name}`);
  return executable;
}
const context=vm.createContext({Number,String,NaN});
vm.runInContext([
  extractTsFunction('copAmount',/function copAmount\(value: unknown\): number \| null \{/,'function copAmount(value) {'),
  extractTsFunction('shouldReleaseSideEffectsAfterPrepareFailure',/function shouldReleaseSideEffectsAfterPrepareFailure\(code: unknown\): boolean \{/,'function shouldReleaseSideEffectsAfterPrepareFailure(code) {')
].join('\n'),context);

assert.equal(context.copAmount(125000),125000);
assert.equal(context.copAmount('125000'),125000);
for(const amount of [true,false,null,undefined,125000.5,'125000.5','']){
  assert.equal(context.copAmount(amount),null,`Monto COP inválido aceptado: ${String(amount)}`);
}
assert.equal(context.shouldReleaseSideEffectsAfterPrepareFailure('WOMPI_QUOTE_CHANGED'),false);
assert.equal(context.shouldReleaseSideEffectsAfterPrepareFailure('WOMPI_INVENTORY_RESERVATION_FAILED'),true);
assert.equal(context.shouldReleaseSideEffectsAfterPrepareFailure('WOMPI_PREPARE_FAILED'),true);

const failureStart=edge.indexOf('if (!preparationResponse.ok || preparation?.success !== true) {');
const failureEnd=edge.indexOf('\n    const expiryDate =',failureStart);
assert.ok(failureStart>=0&&failureEnd>failureStart,'No se encontró el branch de error de prepare');
const failureBranch=edge.slice(failureStart,failureEnd);
const codeOffset=failureBranch.indexOf('const code = String(preparation?.code ?? "WOMPI_PREPARE_FAILED");');
const releaseGuardOffset=failureBranch.indexOf('if (shouldReleaseSideEffectsAfterPrepareFailure(code)) {');
const releaseCallOffset=failureBranch.indexOf('await releaseSideEffectsIfNoOrder(');
const cleanupFlagOffset=failureBranch.indexOf('cleanupStarted = false;');
assert.ok(codeOffset>=0&&releaseGuardOffset>codeOffset&&releaseCallOffset>releaseGuardOffset&&cleanupFlagOffset>releaseGuardOffset,'El cleanup se decide por código antes de desarmar el finally');
assert.ok(!failureBranch.slice(codeOffset,releaseGuardOffset).includes('releaseSideEffectsIfNoOrder('),'No hay cleanup incondicional antes de clasificar quote changed');
const executableFailureBranch=failureBranch.replace('const copOrNull = (value: unknown) =>','const copOrNull = (value) =>');
assert.notEqual(executableFailureBranch,failureBranch,'Se adaptó la anotación del helper inline a JavaScript para el fixture');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const runPrepareFailure=new AsyncFunction(
  'preparationResponse','preparation','releaseSideEffectsIfNoOrder','shouldReleaseSideEffectsAfterPrepareFailure',
  'rpcObject','copAmount','json','supabaseUrl','serviceRoleKey','reference','couponCode','state',
  `let cleanupStarted=true; try {\n${executableFailureBranch}\n} finally { state.cleanupStarted=cleanupStarted; }`
);
async function simulatePrepareFailure(code){
  let activeHold=true;
  let releases=0;
  const state={};
  const result=await runPrepareFailure(
    {ok:true},
    {success:false,code,quote:{total:125001,shipping:0,discount_total:0,coupon_discount_total:0}},
    async()=>{releases++;activeHold=false;return {safe:true,orderExists:false,released:true};},
    context.shouldReleaseSideEffectsAfterPrepareFailure,
    value=>Array.isArray(value)?value[0]:value,
    context.copAmount,
    (body,status)=>({body,status}),
    'https://supabase.example','service-role-placeholder','WOMPI-REF-1','',state,
  );
  return {result,releases,activeHold,cleanupStarted:state.cleanupStarted};
}
const quoteMismatch=await simulatePrepareFailure('WOMPI_QUOTE_CHANGED');
assert.equal(quoteMismatch.releases,0);
assert.equal(quoteMismatch.activeHold,true);
assert.equal(quoteMismatch.cleanupStarted,false);
assert.equal(quoteMismatch.result.status,409);
const otherFailure=await simulatePrepareFailure('WOMPI_INVENTORY_RESERVATION_FAILED');
assert.equal(otherFailure.releases,1,'Otros errores conservan el cleanup existente');
assert.equal(otherFailure.activeHold,false);
assert.equal(otherFailure.cleanupStarted,false);

const sqlStart=sql.indexOf('CREATE OR REPLACE FUNCTION public.prepare_storefront_wompi_checkout(');
const sqlEnd=sql.indexOf('REVOKE ALL ON FUNCTION public.prepare_storefront_wompi_checkout',sqlStart);
assert.ok(sqlStart>=0&&sqlEnd>sqlStart,'No se encontró el RPC transaccional de prepare');
const prepareSql=sql.slice(sqlStart,sqlEnd);
const mismatchStart=prepareSql.indexOf('IF v_original_subtotal<>v_expected_original_subtotal');
const mismatchEnd=prepareSql.indexOf('END IF;',mismatchStart);
const inventoryReserve=prepareSql.indexOf('public.reserve_order_inventory(v_reference,p_items,10)');
const couponReserve=prepareSql.indexOf('public.reserve_storefront_coupon_redemption(');
assert.ok(mismatchStart>=0&&mismatchEnd>mismatchStart&&inventoryReserve>mismatchEnd&&couponReserve>mismatchEnd,'El RPC rechaza quote changed antes de nuevas reservas de inventario/cupón');
assert.ok(!prepareSql.slice(mismatchStart,mismatchEnd).includes('release_inventory_reservation'),'La rama SQL quote changed no libera un hold previo de esa referencia');

const clientStart=catalog.indexOf("if(data?.code==='WOMPI_QUOTE_CHANGED'){");
const clientEnd=catalog.indexOf('\n   }\n   const localFile',clientStart);
assert.ok(clientStart>=0&&clientEnd>clientStart,'No se encontró el branch de cliente quote changed');
const clientBranch=catalog.slice(clientStart,clientEnd);
assert.ok(clientBranch.includes('updateCheckoutSummary()')&&!/forgetReservationRecord|releaseInventory|removeItem/.test(clientBranch),'El cliente refresca cotización visible y conserva la referencia/reserva anterior');

const firstQuoteMismatch=edge.indexOf('if (expectedTotal !== totalCop || expectedDiscountTotal !== discountTotal');
const referenceCreation=edge.indexOf('let reference = String(body?.reference ?? "").trim();');
assert.ok(firstQuoteMismatch>=0&&referenceCreation>firstQuoteMismatch,'Quote mismatch inicial retorna antes de verificar/insertar pedido o reservar lock');
const numericInputGuard=edge.indexOf('const expectedAmountsAreNumeric =');
assert.ok(numericInputGuard>=0&&numericInputGuard<firstQuoteMismatch&&edge.includes('Number.isSafeInteger(amount)'),'El endpoint valida tipos y COP entero seguro antes de comparar');

console.log('PASS wompi_quote_changed_regression: COP entero estricto; quote changed no libera la reserva previa ni crea nueva; cliente conserva referencia.');
