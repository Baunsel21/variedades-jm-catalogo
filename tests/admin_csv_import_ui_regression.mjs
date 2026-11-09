import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRODUCT_COLUMNS } from '../scripts/fase7_csv_preview.mjs';
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
function makeUi(csv, { confirm=true, rpcReady=true, commit=async()=>({ok:true,inserted:1}), refresh=async()=>true }={}) {
  const ids={
    csvProductFile:Object.assign(new FakeNode('input'),{files:csv?[csvFile(csv)]:[]}),
    csvPreviewButton:new FakeNode('button'), csvPreviewClear:new FakeNode('button'),
    csvPreviewImportButton:new FakeNode('button'), csvPreviewDownloadReport:new FakeNode('button'),
    csvPreviewStatus:new FakeNode(), csvPreviewSummary:new FakeNode(), csvPreviewErrors:new FakeNode(),
    csvPreviewErrorList:new FakeNode('ul'), csvPreviewErrorsNote:new FakeNode(), csvPreviewRows:new FakeNode('tbody'), csvPreviewRowsNote:new FakeNode(),
  };
  const documentRef=new FakeDocument(ids); let commits=[]; let refreshes=0; let readinessChecks=0;
  const browserRef={confirm:()=>confirm};
  globalThis.checkAdminCsvImportRpcReady=async()=>{ readinessChecks+=1; return rpcReady; };
  globalThis.commitAdminCsvProducts=async rows=>{ commits.push(rows); return commit(rows); };
  globalThis.refreshAdminAfterCsvImport=async()=>{ refreshes+=1; return refresh(); };
  globalThis.getAdminCsvPreviewExistingCodes=()=>[];
  initializeCsvPreviewUi(documentRef,browserRef);
  return {ids,documentRef,get commits(){return commits;},get refreshes(){return refreshes;},get readinessChecks(){return readinessChecks;}};
}
const header=PRODUCT_COLUMNS.join(',');

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

delete globalThis.commitAdminCsvProducts;
delete globalThis.checkAdminCsvImportRpcReady;
delete globalThis.refreshAdminAfterCsvImport;
delete globalThis.getAdminCsvPreviewExistingCodes;
const adminHtml=readFileSync(new URL('../admin.html',import.meta.url),'utf8');
assert.ok(adminHtml.includes("window.checkAdminCsvImportRpcReady=async()=>{"));
assert.ok(adminHtml.includes("sb.rpc('admin_import_products_csv',{p_rows:[]})"));
assert.ok(adminHtml.includes("error?.code==='IMPORT_LIMIT_EXCEEDED'"));
console.log('admin_csv_import_ui_regression: PASS (confirmation, allowlist payload, invalid/oversized block, ambiguous result safe handling)');
