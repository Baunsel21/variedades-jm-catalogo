import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const admin = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
function extract(name) {
  const match = admin.match(new RegExp(`function ${name}\\([^\\n]*\\)\\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `Debe existir ${name}`);
  return match[0];
}
const ids = ['dashboardSalesStatus','dashboardPeriod','dashboardRevenue','dashboardAverage','dashboardSaleCount','dashboardStockCounts','dashboardInventoryStatus','dashboardCodPending','dashboardWompiReview','dashboardOrdersStatus','dashboardWompiStatus'];
const nodes = Object.fromEntries(ids.map(id => [id, {textContent:'',value:'day',className:''}]));
const ctx = vm.createContext({
  $: id => nodes[id] || null,
  money: value => `COP ${value}`,
  availableQuantity: p => Number(p.availableQuantity ?? p.quantity) || 0,
  pedidoEstado: p => String(p.status ?? 'pendiente').trim().toLowerCase(),
  ventas: [], productos: [], pedidos: [],
  dashboardCoreSnapshot: {loaded:false,busy:false,error:'',updatedAt:null},
  dashboardOrdersUpdatedAt: null,
  dashboardWompiSnapshot: {loaded:false,busy:false,error:'',count:0,updatedAt:null},
  adminDeferredModuleLoaded: {orders:false},
  moduleLoadErrors: {}, pedidosLoadError:'', cargarPedidosBusy:false, publicAvailabilityWarning:''
});
vm.runInContext(['orderDateKeyColombia','summarizeDashboardPeriod','renderDashboardPeriod'].map(extract).join('\n'), ctx);
const fixture = [
  {sale_date:'2026-11-01',quantity:2,sale_price:100},
  {sale_date:'2026-11-02',quantity:3,sale_price:200},
  {sale_date:'2026-11-08',quantity:1,sale_price:400},
  {sale_date:'2026-11-09',quantity:1,sale_price:999},
  {sale_date:'2026-02-31',quantity:1,sale_price:999},
  {sale_date:'2026-11-08',quantity:1,sale_price:null},
  {sale_date:'2026-11-08',quantity:true,sale_price:50},
  {sale_date:'2026-11-08',quantity:1,sale_price:10.5},
  {sale_date:'2026-11-08',quantity:1,sale_price:''}
];
const products = [
  {availableQuantity:0,availabilityVerified:true},
  {availableQuantity:2,availabilityVerified:true},
  {availableQuantity:3,availabilityVerified:true},
  {quantity:8,availabilityVerified:false}
];
const now = new Date('2026-11-09T02:00:00Z'); // Colombia todavía 8 de noviembre
let summary = ctx.summarizeDashboardPeriod(fixture, products, 'day', now);
assert.equal(summary.fromDate,'2026-11-08');
assert.equal(summary.toDate,'2026-11-08');
assert.equal(summary.revenue,400);
assert.equal(summary.count,1);
assert.equal(summary.average,400);
assert.equal(summary.invalidSales,5);
assert.equal(summary.low,1); assert.equal(summary.out,1); assert.equal(summary.unverified,1);
summary = ctx.summarizeDashboardPeriod(fixture, products, 'week', now);
assert.equal(summary.fromDate,'2026-11-02');
assert.equal(summary.revenue,1000); assert.equal(summary.count,2); assert.equal(summary.average,500);
assert.equal(ctx.summarizeDashboardPeriod([],[], 'day',now).average,null,'No fabrica promedio sobre cero registros');
summary=ctx.summarizeDashboardPeriod([{sale_date:'2026-11-08',quantity:Number.MAX_SAFE_INTEGER,sale_price:2}],[],'day',now);
assert.equal(summary.count,0,'No acepta montos fuera del rango entero seguro');

ctx.renderDashboardPeriod();
assert.equal(nodes.dashboardRevenue.textContent,'—');
assert.equal(nodes.dashboardCodPending.textContent,'—');
assert.equal(nodes.dashboardWompiReview.textContent,'—');
assert.match(nodes.dashboardOrdersStatus.textContent,/no consultado/);
ctx.dashboardCoreSnapshot={loaded:true,busy:false,error:'',updatedAt:now};
ctx.dashboardWompiSnapshot={loaded:true,busy:false,error:'',count:50,updatedAt:now};
ctx.adminDeferredModuleLoaded.orders=true;
ctx.pedidos=[{status:'pendiente'},{status:'confirmado'}];
ctx.renderDashboardPeriod();
assert.equal(nodes.dashboardSaleCount.textContent,'0','Vacío confirmado es distinto de no disponible');
assert.equal(nodes.dashboardAverage.textContent,'—');
assert.equal(nodes.dashboardCodPending.textContent,'1');
assert.equal(nodes.dashboardWompiReview.textContent,'50 o más','No presenta un corte de 50 filas como conteo exhaustivo');
ctx.pedidosLoadError='red';ctx.dashboardWompiSnapshot.error='red';ctx.dashboardCoreSnapshot.error='red';
ctx.renderDashboardPeriod();
for(const id of ['dashboardRevenue','dashboardCodPending','dashboardWompiReview'])assert.equal(nodes[id].textContent,'—','Un error no cuenta como cero ni revive el snapshot como vigente');
ctx.dashboardCoreSnapshot.error='';ctx.dashboardCoreSnapshot.busy=true;
ctx.renderDashboardPeriod();assert.match(nodes.dashboardSalesStatus.textContent,/Consultando/);
assert.ok(admin.includes('promedio por registro de venta, no por pedido'),'Semántica de promedio explícita');
assert.ok(admin.includes('Paginación visual, no conciliación financiera.'),'Snapshot COD no se presenta como conciliado');
assert.ok(admin.includes("dashboardCoreSnapshot={loaded:false,busy:false,error:'',updatedAt:null};dashboardOrdersUpdatedAt=null;"),'Los snapshots se eliminan al bloquear sesión');
console.log('OK dashboard_period_regression: ventanas Colombia, integridad de importes, inventario verificado y estados de fuentes.');
