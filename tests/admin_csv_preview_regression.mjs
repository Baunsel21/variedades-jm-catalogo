import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {previewProductsCsv} from '../scripts/fase7_csv_preview.mjs';
const admin=fs.readFileSync(new URL('../admin.html',import.meta.url),'utf8');
const clear=admin.match(/function clearProductCsvPreview\(clearFile=true\)\{[\s\S]*?\n\}/)?.[0];
const preview=admin.match(/async function previewProductCsvFile\(\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(clear&&preview,'Herramienta local de preview integrable');
const host=()=>({innerHTML:'',replaceChildren(){this.innerHTML='';}});
const nodes={productCsvPreviewFile:{value:'',files:[]},productCsvPreviewStatus:{textContent:'',className:''},productCsvPreviewBtn:{disabled:false},productCsvPreviewErrors:host(),productCsvPreviewRows:host()};
let reads=0;
const ctx=vm.createContext({
  $:id=>nodes[id],adminSessionAuthorized:true,adminAuthEpoch:1,productCsvPreviewToken:0,
  dashboardCoreSnapshot:{loaded:true,error:'',busy:false},productos:[{code:'EXISTE'}],
  loadProductCsvPreviewModule:async()=>({previewProductsCsv}),
  esc:s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])),
  money:value=>`COP ${value}`
});
vm.runInContext(clear+'\n'+preview,ctx);
const header='code,name,category,cost,sale_price,quantity';
const file=csv=>({size:new TextEncoder().encode(csv).byteLength,arrayBuffer:async()=>{reads++;return new TextEncoder().encode(csv).buffer;}});
nodes.productCsvPreviewFile.files=[file(header+'\nA,<img src=x onerror=alert(1)>,Otros,1,2,"3"\r\n')];
await ctx.previewProductCsvFile();
assert.match(nodes.productCsvPreviewStatus.textContent,/1 fila\(s\) válida\(s\), 0 error/);
assert.match(nodes.productCsvPreviewRows.innerHTML,/&lt;img/,'Escapa nombres, no ejecuta HTML del CSV');
assert.ok(!nodes.productCsvPreviewRows.innerHTML.includes('<img'));
assert.match(nodes.productCsvPreviewStatus.textContent,/No se subió ni se importó/);
nodes.productCsvPreviewFile.files=[file(header+'\nEXISTE,Duplicado,Otros,1,2,3\n')];
await ctx.previewProductCsvFile();
assert.match(nodes.productCsvPreviewErrors.innerHTML,/ya existe/);
assert.equal(nodes.productCsvPreviewRows.innerHTML,'');
const priorReads=reads;
nodes.productCsvPreviewFile.files=[{size:1048577,arrayBuffer:()=>{throw new Error('No debe leerse');}}];
await ctx.previewProductCsvFile();assert.match(nodes.productCsvPreviewStatus.textContent,/supera el límite/);assert.equal(reads,priorReads);
let resolveBytes;
nodes.productCsvPreviewFile.files=[{size:100,arrayBuffer:()=>new Promise(resolve=>{resolveBytes=resolve;})}];
const pending=ctx.previewProductCsvFile();
ctx.clearProductCsvPreview();
resolveBytes(new TextEncoder().encode(header+'\nA,Producto,Otros,1,2,3\n').buffer);
await pending;
assert.equal(nodes.productCsvPreviewRows.innerHTML,'','No revive contenido tras navegar/cancelar');
assert.match(nodes.productCsvPreviewStatus.textContent,/No se ha leído/);
ctx.adminSessionAuthorized=false;
await ctx.previewProductCsvFile();assert.equal(reads,priorReads,'No lee archivos con sesión bloqueada');
assert.ok(!/sb\.|localStorage|sessionStorage|fetch\(|XMLHttpRequest/.test(preview),'Preview no ejecuta red, persistencia ni DML');
assert.ok(admin.includes("if(id!=='config')clearProductCsvPreview();"),'Limpia el archivo y preview al navegar');
console.log('OK admin_csv_preview_regression: parser real, límites, XSS, duplicados y cancelación sin escrituras.');
