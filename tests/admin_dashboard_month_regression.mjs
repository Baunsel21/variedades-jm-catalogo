import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const admin=fs.readFileSync(new URL('../admin.html',import.meta.url),'utf8');
function extract(name){const text=admin.match(new RegExp('function '+name+'\\([^\\n]*\\)\\{[\\s\\S]*?\\n\\}'))?.[0];assert.ok(text,name);return text}
const ctx=vm.createContext({availableQuantity:p=>Number(p.availableQuantity??p.quantity)||0});
vm.runInContext(['orderDateKeyColombia','summarizeDashboardPeriod'].map(extract).join('\n'),ctx);
const fixture=[
 {sale_date:'2026-10-31',quantity:1,sale_price:900},
 {sale_date:'2026-11-01',quantity:2,sale_price:100},
 {sale_date:'2026-11-02',quantity:3,sale_price:200},
 {sale_date:'2026-11-08',quantity:1,sale_price:400},
 {sale_date:'2026-11-09',quantity:1,sale_price:800},
 {sale_date:'2026-11-08',quantity:true,sale_price:100},
 {sale_date:'2026-11-08',quantity:1,sale_price:null},
 {sale_date:'2026-11-31',quantity:1,sale_price:50}
];
let result=ctx.summarizeDashboardPeriod(fixture,[],'month',new Date('2026-11-09T02:00:00Z'));
assert.equal(result.fromDate,'2026-11-01');assert.equal(result.toDate,'2026-11-08');
assert.equal(result.revenue,1200);assert.equal(result.count,3);assert.equal(result.average,400);assert.equal(result.invalidSales,3);
assert.equal(ctx.summarizeDashboardPeriod(fixture,[],'day',new Date('2026-11-09T02:00:00Z')).revenue,400,'El modo día no cambia');
assert.equal(ctx.summarizeDashboardPeriod(fixture,[],'week',new Date('2026-11-09T02:00:00Z')).revenue,1000,'El modo semana no cambia');
const year=[{sale_date:'2026-12-01',quantity:1,sale_price:10},{sale_date:'2026-12-31',quantity:1,sale_price:20},{sale_date:'2027-01-01',quantity:1,sale_price:30}];
result=ctx.summarizeDashboardPeriod(year,[],'month',new Date('2027-01-01T04:59:59Z'));
assert.equal(result.fromDate,'2026-12-01');assert.equal(result.toDate,'2026-12-31');assert.equal(result.revenue,30);
result=ctx.summarizeDashboardPeriod(year,[],'month',new Date('2027-01-01T05:00:00Z'));
assert.equal(result.fromDate,'2027-01-01');assert.equal(result.toDate,'2027-01-01');assert.equal(result.revenue,30);assert.equal(result.count,1);
const leap=[{sale_date:'2028-01-31',quantity:1,sale_price:50},{sale_date:'2028-02-01',quantity:1,sale_price:60},{sale_date:'2028-02-29',quantity:1,sale_price:70},{sale_date:'2028-03-01',quantity:1,sale_price:80}];
result=ctx.summarizeDashboardPeriod(leap,[],'month',new Date('2028-03-01T04:00:00Z'));
assert.equal(result.fromDate,'2028-02-01');assert.equal(result.toDate,'2028-02-29');assert.equal(result.revenue,130);
const empty=ctx.summarizeDashboardPeriod([],[],'month',new Date('2026-11-08T12:00:00Z'));
assert.equal(empty.revenue,0);assert.equal(empty.average,null);
assert.ok(admin.includes('<option value="month">Este mes, hasta hoy</option>'));
assert.ok(admin.includes('promedio por registro de venta, no por pedido. No se suman COD y Wompi'));
console.log('PASS admin_dashboard_month_regression: mes calendario hasta hoy en Colombia, medianoche/año/bisiesto, exclusiones y paridad día/semana.');
