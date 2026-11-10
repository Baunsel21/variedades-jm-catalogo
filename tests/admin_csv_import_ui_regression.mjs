import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRODUCT_COLUMNS, PRODUCT_COLUMNS_V2 } from '../scripts/fase7_csv_preview.mjs';
import { initializeCsvPreviewUi } from '../scripts/admin_csv_preview.mjs';

function csvFile(text) {
  const bytes = new TextEncoder().encode(text);
  return { size: bytes.byteLength, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}
class FakeNode {
  constructor(tagName='div') { this.tagName=tagName; this.children=[]; this.textContent=''; this.hidden=false; this.disabled=false; this.listeners=new Map(); this.files=[]; this.value=''; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  async trigger(type) { return this.listeners.get(type)?.({}); }
  appendChild(node) { this.children.push(node); node.parentNode=this; return node; }
  replaceChildren(...nodes) { this.children=[...nodes]; }
  createTextNode(text) { return {textContent:text}; }
}
class FakeDocument {
  constructor(nodes) { this.nodes=new Map(Object.entries(nodes)); this.body=new FakeNode('body'); }
  getElementById(id) { return this.nodes.get(id)||null; }
  createElement(tagName) { return new FakeNode(tagName); }
}
function makeUi(csv, { confirm=true, rpcReady=true, schemaVersion=1, commit=async()=>({ok:true,inserted:1}), refresh=async()=>true }={}) {
  const ids={
    csvProductFile:Object.assign(new FakeNode('input'),{files:csv?[csvFile(csv)]:[]}),
    csvPreviewSchemaVersion:Object.assign(new FakeNode('select'),{value:String(schemaVersion)}),
    csvPreviewButton:new FakeNode('button'), csvPreviewClear:new FakeNode('button'),
    csvPreviewImportButton:new FakeNode('button'), csvPreviewDownloadReport:new FakeNode('button'),
    csvPreviewStatus:new FakeNode(), csvPreviewSummary:new FakeNode(), csvPreviewErrors:new FakeNode(),
    csvPreviewErrorList:new FakeNode('ul'), csvPreviewErrorsNote:new FakeNode(), csvPreviewRows:new FakeNode('tbody'), csvPreviewRowsNote:new FakeNode(),
  };
  const documentRef=new FakeDocument(ids); let commits=[]; let refreshes=0; let readinessChecks=0; let readinessVersions=[]; let commitVersions=[];
  const browserRef={confirm:()=>confirm};
  globalThis.checkAdminCsvImportRpcReady=async version=>{ readinessChecks+=1; readinessVersions.push(version); return rpcReady; };
  globalThis.commitAdminCsvProducts=async(rows,version)=>{ commits.push(rows); commitVersions.push(version); return commit(rows,version); };
  globalThis.refreshAdminAfterCsvImport=async()=>{ refreshes+=1; return refresh(); };
  globalThis.getAdminCsvPreviewExistingCodes=()=>[];
  initializeCsvPreviewUi(documentRef,browserRef);
  return {ids,documentRef,get commits(){return commits;},get commitVersions(){return commitVersions;},get readinessVersions(){return readinessVersions;},get refreshes(){return refreshes;},get readinessChecks(){return readinessChecks;}};
}
const header=PRODUCT_COLUMNS.join(',');
const headerV2=PRODUCT_COLUMNS_V2.join(',');

// Solo después de una preview limpia permite confirmar; envía exactamente el allowlist y recarga admin.
{
  const ui=makeUi(`${header}\nSKU-001,Corset,Accesorios,12000,25000,2`);
  assert.equal(ui.ids.csvPreviewImportButton.disabled,true);
  await ui.ids.csvPreviewButton.trigger('click');
  assert.equal(ui.ids.csvPreviewImportButton.disabled,false);
  await ui.ids.csvPreviewImportButton.trigger('click');
  assert.equal(ui.commits.length,1);
  assert.deepEqual(ui.commits[0],[{row:2,code:'SKU-001',name:'Corset',category:'Accesorios',cost:12000,sale_price:25000,quantity:2}]);
  assert.equal(ui.refreshes,1);
  assert.match(ui.ids.csvPreviewStatus.textContent,/Importación confirmada: 1 producto nuevo/);
  assert.match(ui.ids.csvPreviewSummary.textContent,/importación confirmada: 1 nuevos/);
  assert.doesNotMatch(ui.ids.csvPreviewSummary.textContent,/dry-run: sí · escritura: no/);
  assert.equal(ui.ids.csvPreviewImportButton.disabled,true);
}

// Si el endpoint no está desplegado, mantiene el preview pero no ofrece la acción de escritura.
{
  const ui=makeUi(`${header}\nSKU-NO-RPC,Corset,Accesorios,12000,25000,2`,{rpcReady:false});
  await ui.ids.csvPreviewButton.trigger('click');
  assert.equal(ui.readinessChecks,1);
  assert.equal(ui.ids.csvPreviewImportButton.disabled,true);
  assert.match(ui.ids.csvPreviewStatus.textContent,/aún no está disponible/);
  await ui.ids.csvPreviewImportButton.trigger('click');
  assert.equal(ui.commits.length,0);
}

// El usuario puede cancelar; no hay solicitud ni refresh.
{
  const ui=makeUi(`${header}\nSKU-002,Corset,Accesorios,12000,25000,2`,{confirm:false});
  await ui.ids.csvPreviewButton.trigger('click');
  await ui.ids.csvPreviewImportButton.trigger('click');
  assert.equal(ui.commits.length,0);
  assert.equal(ui.refreshes,0);
}

// Filas inválidas o demasiadas filas nunca habilitan el commit.
{
  const ui=makeUi(`${header}\nSKU-003,Corset,Accesorios,12000,25000,2\nSKU-003,Duplicado,Accesorios,1,2,1`);
  await ui.ids.csvPreviewButton.trigger('click');
  assert.equal(ui.ids.csvPreviewImportButton.disabled,true);
  await ui.ids.csvPreviewImportButton.trigger('click');
  assert.equal(ui.commits.length,0);
}
{
  const rows=Array.from({length:251},(_,i)=>`SKU-${i+1},Producto,Accesorios,1,2,1`).join('\n');
  const ui=makeUi(`${header}\n${rows}`);
  await ui.ids.csvPreviewButton.trigger('click');
  assert.equal(ui.ids.csvPreviewImportButton.disabled,true);
  assert.match(ui.ids.csvPreviewStatus.textContent,/máximo 250/);
  assert.equal(ui.commits.length,0);
}

// Resultado ambiguo de red no revela payload y obliga a previsualizar otra vez antes de reintentar.
{
  const privateName='Nombre-Producto-No-Debe-Aparecer';
  const ui=makeUi(`${header}\nSKU-SECRET,${privateName},Accesorios,1,2,1`,{commit:async()=>{throw new Error(privateName);}});
  await ui.ids.csvPreviewButton.trigger('click');
  await ui.ids.csvPreviewImportButton.trigger('click');
  assert.equal(ui.commits.length,1);
  assert.match(ui.ids.csvPreviewStatus.textContent,/No se confirmó el resultado/);
  assert.match(ui.ids.csvPreviewSummary.textContent,/resultado de importación no confirmado/);
  assert.doesNotMatch(ui.ids.csvPreviewSummary.textContent,/dry-run: sí · escritura: no/);
  assert.doesNotMatch(ui.ids.csvPreviewStatus.textContent,/SKU-SECRET|Nombre-Producto/);
  assert.equal(ui.ids.csvPreviewImportButton.disabled,true);
}

// v2 mantiene la importación bloqueada cuando falta su RPC y envía el payload extendido solo si está disponible.
{
  const variants=JSON.stringify([{color:'Negro',size:'S',stock:1,color_hex:'#222222'}]).replace(/"/g,'""');
  const csv=`${headerV2}\nSKU-V2,Body chain,Accesorios,10,20,1,https://cdn.example.test/item.jpg,"${variants}"`;
  const unavailable=makeUi(csv,{schemaVersion:2,rpcReady:false});
  await unavailable.ids.csvPreviewButton.trigger('click');
  assert.equal(unavailable.ids.csvPreviewImportButton.disabled,true);
  assert.equal(unavailable.readinessVersions[0],2);
  assert.match(unavailable.ids.csvPreviewStatus.textContent,/RPC v2.*no está disponible/i);
  const ready=makeUi(csv,{schemaVersion:2,rpcReady:true});
  await ready.ids.csvPreviewButton.trigger('click');
  assert.equal(ready.ids.csvPreviewImportButton.disabled,false);
  await ready.ids.csvPreviewImportButton.trigger('click');
  assert.equal(ready.commitVersions[0],2);
  assert.equal(ready.commits[0][0].image_url,'https://cdn.example.test/item.jpg');
  assert.equal(ready.commits[0][0].variants[0].stock,1);
}

delete globalThis.commitAdminCsvProducts;
delete globalThis.checkAdminCsvImportRpcReady;
delete globalThis.refreshAdminAfterCsvImport;
delete globalThis.getAdminCsvPreviewExistingCodes;
const adminHtml=readFileSync(new URL('../admin.html',import.meta.url),'utf8');
assert.ok(adminHtml.includes("window.checkAdminCsvImportRpcReady=async(schemaVersion=1)=>{"));
assert.ok(adminHtml.includes("admin_import_products_csv_v2"));
assert.ok(adminHtml.includes("error?.code==='IMPORT_LIMIT_EXCEEDED'"));
console.log('admin_csv_import_ui_regression: PASS (confirmation, allowlist payload, invalid/oversized block, ambiguous result safe handling)');
