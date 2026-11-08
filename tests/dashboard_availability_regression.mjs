import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const admin = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
function extract(name) {
  const found = admin.match(new RegExp(`function ${name}\\([^\\n]*\\)\\{[\\s\\S]*?\\n\\}`));
  assert.ok(found, `Debe existir la función ${name}`);
  return found[0];
}
const functions = ['availableQuantity','availableVariants','saleAvailableQuantity','saleProductIsAvailable','availabilityDisplay','availabilityBadge'].map(extract).join('\n');
const context = vm.createContext({parseVariants: value => Array.isArray(value) ? value : [], stockBadge: quantity => `stock:${quantity}`});
new vm.Script(functions).runInContext(context);

const unverified = {quantity: 8, variants: [{color:'Negro', size:'M', stock:8}], availabilityVerified:false};
assert.equal(context.availableQuantity(unverified), 0, 'No sustituye una cotización ausente por stock físico');
assert.equal(context.availableVariants(unverified).length, 0, 'No expone variantes no verificadas');
assert.equal(context.saleAvailableQuantity(unverified), 0, 'El selector de venta no puede vender inventario no verificado');
assert.equal(context.saleProductIsAvailable(unverified), false, 'Producto sin disponibilidad verificada queda no vendible');
assert.equal(context.availabilityDisplay(unverified), 'No verificada', 'La interfaz no presenta stock desconocido como cero agotado');
assert.equal(context.availabilityBadge(unverified), '<span class="badge">No verificada</span>', 'La etiqueta visual distingue disponibilidad desconocida');

const verified = {quantity: 10, availableQuantity: 3, availableVariants: [{color:'Negro',size:'M',stock:3}], availabilityVerified:true};
assert.equal(context.availableQuantity(verified), 3, 'Usa la cantidad live verificada');
assert.equal(context.saleAvailableQuantity(verified), 3, 'Usa variantes live verificadas en el flujo de venta');
assert.equal(context.saleProductIsAvailable(verified), true, 'Mantiene venta cuando existe disponibilidad verificada');
const verifiedEmptyVariants = {quantity: 0, availableQuantity: 0, availableVariants: [], variants: [{color:'Rojo',size:'S',stock:4}], availabilityVerified:true};
assert.equal(context.availableVariants(verifiedEmptyVariants).length, 0, 'Una respuesta live vacía no revive variantes físicas antiguas');
assert.equal(context.saleProductIsAvailable(verifiedEmptyVariants), false, 'La lista live vacía y verificada no permite vender variantes reservadas');

const compatibleLegacy = {quantity: 2, variants: [{color:'Azul',size:'S',stock:2}]};
assert.equal(context.availableQuantity(compatibleLegacy), 2, 'Preserva compatibilidad de objetos anteriores que no traen el marcador');
assert.equal(context.availableVariants(compatibleLegacy).length, 1, 'Preserva parseo legacy de variantes');

assert.ok(admin.includes('const verified=!!current&&variantAvailabilityVerified') && admin.includes('availableQuantity:verified?Math.max(0,Number(current.quantity)||0):0'), 'La carga inicial exige cantidades live verificadas y marca lo ausente como cero');
assert.ok(admin.includes('publicAvailabilityWarning') && admin.includes('No se pudo verificar la disponibilidad reservada'), 'Presenta aviso visible ante fallo del RPC live');
assert.ok(admin.includes("['availabilityWarningDashboard','availabilityWarningInventory']"), 'Muestra advertencia en dashboard e inventario');
assert.ok(admin.includes('Unidades físicas') && admin.includes('Ganancia bruta estimada') && admin.includes('No es total conciliado de pedidos web'), 'Evita llamar disponible al stock físico o conciliados a reportes no conciliados');
assert.ok(admin.includes('disabled=!verified||stock<=0') && admin.includes("'Disponibilidad no verificada'"), 'Deshabilita la tarjeta de venta y explica la disponibilidad no verificada');
assert.ok(admin.includes('if(!saleProductIsAvailable(p))return alert(p.availabilityVerified===false?"No se puede registrar la venta: disponibilidad no verificada.":"No hay stock disponible.")'), 'El registro final vuelve a bloquear disponibilidad ausente');
assert.ok(admin.includes('No se puede registrar una venta hasta verificar stock y reservas.'), 'La vista previa de venta evita mostrar cero engañoso si falta verificación');

console.log('OK dashboard_availability_regression: fail-closed de stock y compatibilidad legacy.');
