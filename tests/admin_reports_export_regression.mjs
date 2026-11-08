import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const admin=fs.readFileSync(new URL('../admin.html',import.meta.url),'utf8');
function extractFunction(name){
  const start=admin.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`Missing function ${name}`);
  const end=admin.indexOf('\n}',start);
  assert.notEqual(end,-1,`Unterminated function ${name}`);
  return admin.slice(start,end+2);
}
const downloads=[];
const toasts=[];
const statusHost={textContent:''};
const context=vm.createContext({
  adminSessionAuthorized:true,
  dashboardCoreSnapshot:{loaded:false,busy:false,error:'',updatedAt:null},
  ventas:[],
  downloads,
  toasts,
  statusHost,
  $:id=>id==='salesReportSnapshotStatus'?statusHost:null,
  downloadFile:(...args)=>downloads.push(args),
  toast:message=>toasts.push(message)
});
vm.runInContext([
  extractFunction('safeCSVCell'),
  extractFunction('salesReportSnapshotStatus'),
  extractFunction('renderSalesReportSnapshotStatus'),
  extractFunction('salesReportExportBlockReason'),
  extractFunction('exportSalesReportCSV')
].join('\n'),context);

const blockedCases=[
  {name:'sesión cerrada',authorized:false,snapshot:{loaded:true,busy:false,error:'',updatedAt:'2026-11-08T12:00:00Z'}},
  {name:'nunca cargado',authorized:true,snapshot:{loaded:false,busy:false,error:'',updatedAt:null}},
  {name:'actualización en curso',authorized:true,snapshot:{loaded:true,busy:true,error:'',updatedAt:'2026-11-08T12:00:00Z'}},
  {name:'última carga fallida',authorized:true,snapshot:{loaded:true,busy:false,error:'Falló la actualización',updatedAt:'2026-11-08T11:00:00Z'}}
];
for(const testCase of blockedCases){
  context.adminSessionAuthorized=testCase.authorized;
  context.dashboardCoreSnapshot=testCase.snapshot;
  const before=downloads.length;
  assert.equal(context.exportSalesReportCSV(),false,`Se permitió exportar con ${testCase.name}`);
  assert.equal(downloads.length,before,`Se descargó un archivo con ${testCase.name}`);
  assert.ok(toasts.at(-1),`Falta el motivo visible para ${testCase.name}`);
}

const statusCases=[
  {authorized:false,snapshot:{loaded:true,busy:false,error:'',updatedAt:'2026-11-08T12:00:00Z'},expected:'sesión administrativa no está activa'},
  {authorized:true,snapshot:{loaded:false,busy:false,error:'',updatedAt:null},expected:'Ventas pendientes de consulta'},
  {authorized:true,snapshot:{loaded:true,busy:true,error:'',updatedAt:'2026-11-08T12:00:00Z'},expected:'Actualizando ventas'},
  {authorized:true,snapshot:{loaded:true,busy:false,error:'falló',updatedAt:'2026-11-08T12:00:00Z'},expected:'snapshot anterior de sales'},
  {authorized:true,snapshot:{loaded:false,busy:false,error:'falló',updatedAt:null},expected:'Los ceros visibles no significan'},
  {authorized:true,snapshot:{loaded:true,busy:false,error:'',updatedAt:'2026-11-08T12:00:00Z'},expected:'No incluye ni concilia automáticamente pedidos COD/Wompi.'}
];
for(const testCase of statusCases){
  context.adminSessionAuthorized=testCase.authorized;
  context.dashboardCoreSnapshot=testCase.snapshot;
  context.renderSalesReportSnapshotStatus();
  assert.ok(statusHost.textContent.includes(testCase.expected),`Estado no visible: ${testCase.expected}`);
}
const reportRenderer=admin.match(/function renderReportes\(\)\{[\s\S]*?\n\}/)?.[0];
const loaderStart=admin.indexOf('async function cargarTodo(){');
const loaderEnd=admin.indexOf('\nfunction adminViewNeedsLiveAvailability',loaderStart);
const loader=admin.slice(loaderStart,loaderEnd);
assert.ok(reportRenderer?.includes('renderSalesReportSnapshotStatus()'),'El render de Reportes incluye el banner');
assert.ok(loader.includes('dashboardCoreSnapshot.busy=true;renderDashboardPeriod();renderSalesReportSnapshotStatus();')&&loader.includes('dashboardCoreSnapshot.busy=false;renderDashboardPeriod();renderSalesReportSnapshotStatus();'),'El loader actualiza el banner al comenzar y resolver la consulta');
assert.ok(admin.includes('id="salesReportSnapshotStatus" class="muted" role="status" aria-live="polite"'),'El estado de frescura se anuncia de forma accesible');

context.adminSessionAuthorized=true;
context.dashboardCoreSnapshot={loaded:true,busy:false,error:'',updatedAt:'2026-11-08T12:00:00Z'};
context.ventas=[{
  sale_date:'2026-11-08',product_code:'JM-01',product_name:'=HYPERLINK("https://example.invalid")',
  quantity:2,cost_price:60000,sale_price:100000,phone:'3001234567',email:'private@example.invalid',
  payment_method:'wompi',transaction_id:'private-transaction-id'
}];
assert.equal(context.exportSalesReportCSV(),true);
assert.equal(downloads.length,1);
const [filename,csv,mime]=downloads[0];
assert.equal(filename,'sirevya_reporte_ventas.csv');
assert.equal(mime,'text/csv;charset=utf-8');
assert.ok(csv.startsWith('\uFEFF'));
assert.ok(csv.includes('Ganancia bruta estimada'));
assert.ok(csv.includes("'=HYPERLINK"),'La fórmula del producto debe quedar neutralizada');
assert.ok(!csv.includes('3001234567')&&!csv.includes('private@example.invalid')&&!csv.includes('private-transaction-id'),'El CSV no exporta PII ni metadatos de pago');
assert.ok(!extractFunction('exportSalesReportCSV').includes('payment_method')&&!extractFunction('exportSalesReportCSV').includes('transaction_id'),'El reporte mantiene solo las columnas de registros internos de sales');
assert.ok(toasts.at(-1).includes('no incluye pedidos COD/Wompi'));

console.log('PASS admin_reports_export_regression: bloquea export stale/error/sin sesión; exporta solo sales, sin PII ni COD/Wompi y neutraliza fórmulas.');
