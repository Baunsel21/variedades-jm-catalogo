import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.PREVIEW_HOST || '0.0.0.0';

export const DEMO_PRODUCTS = Object.freeze([
  {
    id: 'preview-corset-001', name: 'Corset de muestra', code: 'DEMO-001', category: 'CORSET',
    sale_price: 60000, price: 60000, quantity: 4, colors: ['Negro'], sizes: ['S', 'M'],
    variants: [{ color: 'Negro', size: 'S', stock: 2 }, { color: 'Negro', size: 'M', stock: 2 }],
    description: 'Producto ficticio para revisar la interfaz. No está disponible para compra.',
    size_guide: 'Guía ficticia: talla S/M', size_guide_image: '', image_paths: [], image_url: '',
  },
  {
    id: 'preview-cadena-002', name: 'Cadena de cuerpo de muestra', code: 'DEMO-002', category: 'CADENA DE CUERPO',
    sale_price: 30000, price: 30000, quantity: 5, colors: ['Dorado'], sizes: [],
    variants: [{ color: 'Dorado', size: '', stock: 5 }],
    description: 'Producto ficticio para revisar filtros y favoritos. No está disponible para compra.',
    size_guide: '', size_guide_image: '', image_paths: [], image_url: '',
  },
  {
    id: 'preview-camison-003', name: 'Camisón de muestra', code: 'DEMO-003', category: 'CAMISONES',
    sale_price: 55000, price: 55000, quantity: 3, colors: ['Vino'], sizes: ['S', 'M'],
    variants: [{ color: 'Vino', size: 'S', stock: 1 }, { color: 'Vino', size: 'M', stock: 2 }],
    description: 'Producto ficticio para revisar el catálogo. No está disponible para compra.',
    size_guide: 'Guía ficticia: talla S/M', size_guide_image: '', image_paths: [], image_url: '',
  },
  {
    id: 'preview-agotado-004', name: 'Producto agotado de muestra', code: 'DEMO-004', category: 'CAMISONES',
    sale_price: 32000, price: 32000, quantity: 0, colors: ['Negro'], sizes: ['S'],
    variants: [{ color: 'Negro', size: 'S', stock: 0 }],
    description: 'Producto ficticio sin unidades, disponible solo para probar el filtro de agotados. Nunca puede comprarse.',
    size_guide: 'Guía ficticia: talla S', size_guide_image: '', image_paths: [], image_url: '',
  },
]);

const PREVIEW_TIME = '2026-11-08T12:00:00.000Z';
export const DEMO_ADMIN_ROWS = Object.freeze({
  products: DEMO_PRODUCTS.map((product, index) => ({
    ...product, cost_price: Math.round(product.sale_price * 0.45), location: 'Bodega sintética',
    created_at: PREVIEW_TIME, updated_at: PREVIEW_TIME, is_active: true, display_order: index + 1,
  })),
  sales: [{ id: 'preview-sale-001', product_id: 'preview-corset-001', product_code: 'DEMO-001', product_name: 'Corset de muestra', quantity: 1, sale_price: 60000, cost_price: 27000, sale_date: '2026-11-08', created_at: PREVIEW_TIME, total: 60000 }],
  categories: [
    { id: 'preview-category-001', name: 'CORSET', sort_order: 100 },
    { id: 'preview-category-002', name: 'CADENA DE CUERPO', sort_order: 200 },
    { id: 'preview-category-003', name: 'CAMISONES', sort_order: 300 },
  ],
  web_orders: [{ id: 'preview-order-001', customer_name: 'Cliente de muestra', customer_phone: '0000000000', customer_email: 'cliente@example.invalid', customer_city: 'Cali', customer_address: 'Dirección ficticia 123', payment_method: 'contraentrega', status: 'pendiente', total: 59000, shipping_cost: 0, items: [{ name: 'Corset de muestra', code: 'DEMO-001', qty: 1, price: 59000, color: 'Negro', size: 'M' }], created_at: PREVIEW_TIME }],
  clients: [{ id: 'preview-client-001', name: 'Cliente de muestra', phone: '0000000000', email: 'cliente@example.invalid', city: 'Cali', created_at: PREVIEW_TIME, total_purchases: 1 }],
  suppliers: [{ id: 'preview-supplier-001', name: 'Proveedor ficticio', phone: '0000000000', email: 'proveedor@example.invalid', created_at: PREVIEW_TIME }],
  expenses: [{ id: 'preview-expense-001', description: 'Gasto de demostración', amount: 12000, expense_date: '2026-11-08', created_at: PREVIEW_TIME, category: 'Muestra' }],
  inventory_movements: [{ id: 'preview-movement-001', product_id: 'preview-corset-001', product_code: 'DEMO-001', product_name: 'Corset de muestra', type: 'entrada', quantity: 4, reason: 'Fixture sintético', created_at: PREVIEW_TIME }],
  sirevya_wompi_inventory_reconciliation: [],
});

export const PREVIEW_CLIENT_SCRIPT = String.raw`(()=>{
 const products=${JSON.stringify(DEMO_PRODUCTS)};
 const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
 const details=products.map(p=>({id:p.id,description:p.description,size_guide:p.size_guide,size_guide_image:p.size_guide_image}));
 const readRpc={
  get_public_catalog:()=>products,
  get_public_catalog_multifotos:()=>[],
  get_public_product_details:()=>details,
  get_public_product_details_for_product:args=>details.filter(row=>row.id===String(args&&args.p_product_id||'')),
  get_public_product_descriptions:()=>details,
  get_public_category_order:()=>['CORSET','CADENA DE CUERPO','CAMISONES'],
  get_public_storefront_shipping_settings:()=>({success:true,national_shipping_cost:10000,free_shipping_threshold:130000,free_shipping_in_cali:true}),
  get_online_payment_status:()=>({online_payments_enabled:false}),
  get_public_storefront_cod_settings:()=>({enabled:false,allowed_cities:[]}),
  get_public_storefront_product_combos:()=>[],
  get_public_storefront_promotion:()=>null
 };
 const blocked=name=>({data:null,error:{code:'PREVIEW_BLOCKED',message:'Operación deshabilitada en preview: '+String(name||'operación')}});
 function builder(kind,name,args){
  const filters={}; let writeName='';
  return {
   range(){return this},select(){return this},order(){return this},limit(){return this},
   eq(key,val){filters[String(key)]=val;return this},match(values){Object.assign(filters,values||{});return this},
   maybeSingle(){return this.execute().then(result=>{if(result.error)return result;const rows=Array.isArray(result.data)?result.data:[];return {data:rows[0]||result.data||null,error:null}})},
   single(){return this.maybeSingle()},
   insert(){writeName='insert';return this},update(){writeName='update';return this},delete(){writeName='delete';return this},upsert(){writeName='upsert';return this},
   execute(){
    if(writeName)return Promise.resolve(blocked('table '+name+' '+writeName));
    if(kind==='rpc'){
     if(!Object.prototype.hasOwnProperty.call(readRpc,name))return Promise.resolve(blocked('RPC '+name));
     try{return Promise.resolve({data:clone(readRpc[name](args)),error:null})}catch{return Promise.resolve(blocked('RPC '+name))}
    }
    if(kind==='table'&&name==='products'){
     const rows=products.filter(row=>Object.entries(filters).every(([key,val])=>String(row[key]??'')===String(val??'')));
     return Promise.resolve({data:clone(rows),error:null});
    }
    return Promise.resolve(blocked('tabla '+name));
   },
   then(resolve,reject){return this.execute().then(resolve,reject)}
  };
 }
 const inertChannel={on(){return this},subscribe(){return this},unsubscribe(){return Promise.resolve('ok')}};
 window.__SIREVYA_PREVIEW_MODE__=true;
 window.__SIREVYA_PREVIEW_CAPABILITIES__={data:'sintética',payments:false,orders:false,reservations:false,inventoryWrites:false,realtime:false};
 window.__SIREVYA_PREVIEW_CLIENT__={
  rpc:(name,args)=>builder('rpc',String(name),args),
  from:name=>builder('table',String(name),null),
  channel:()=>inertChannel,removeChannel:()=>Promise.resolve('ok'),
  auth:{getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
  functions:{invoke:async name=>blocked('Edge Function '+name)}
 };
 window.open=()=>null;
 const doc=window.document;
 if(doc&&typeof doc.addEventListener==='function'){
  doc.addEventListener('click',event=>{
   const anchor=event.target&&typeof event.target.closest==='function'?event.target.closest('a[href],area[href]'):null;
   if(!anchor)return;
   try{const url=new URL(anchor.href,window.location.href);if(!['http:','https:'].includes(url.protocol)||url.origin!==window.location.origin){event.preventDefault();if(event.stopImmediatePropagation)event.stopImmediatePropagation()}}catch{event.preventDefault()}
  },true);
  doc.addEventListener('submit',event=>{event.preventDefault();if(event.stopImmediatePropagation)event.stopImmediatePropagation()},true);
 }
 try{const form=window.HTMLFormElement&&window.HTMLFormElement.prototype;if(form){form.submit=function(){throw new Error('Formulario deshabilitado en preview seguro')};form.requestSubmit=function(){throw new Error('Formulario deshabilitado en preview seguro')}}}catch{}
 const nativeFetch=window.fetch.bind(window);
 window.fetch=async(input,init)=>{
  const raw=typeof input==='string'?input:(input&&input.url)||String(input);
  let url;try{url=new URL(raw,window.location.href)}catch{return new Response(JSON.stringify({error:'preview bloqueado'}),{status:403,headers:{'Content-Type':'application/json'}})}
  const method=String((init&&init.method)||(input&&input.method)||'GET').toUpperCase();
  const allowedAsset=url.origin===window.location.origin&&url.pathname.startsWith('/__preview_assets/')&&['GET','HEAD'].includes(method);
  if(url.origin!==window.location.origin||url.pathname.startsWith('/__preview_api')||!allowedAsset){
   return new Response(JSON.stringify({error:'Operación de red bloqueada en preview seguro.'}),{status:403,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})
  }
  return nativeFetch(input,init)
 };
 const blockedApi=function(){throw new Error('API de red deshabilitada en preview seguro')};
 try{window.XMLHttpRequest=blockedApi;window.WebSocket=blockedApi;window.EventSource=blockedApi}catch{}
 try{if(window.navigator)Object.defineProperty(window.navigator,'sendBeacon',{value:()=>false,configurable:false})}catch{}
})();`;

export const PREVIEW_ADMIN_USER = Object.freeze({
  id: 'preview-admin-user', email: 'admin-preview@example.invalid',
  user_metadata: { jm_brand_name: 'Variedades JM', jm_brand_icon_path: '' },
});

export const PREVIEW_ADMIN_CLIENT_SCRIPT = String.raw`(()=>{
 const tables=${JSON.stringify(DEMO_ADMIN_ROWS)};
 const products=${JSON.stringify(DEMO_PRODUCTS)};
 const details=products.map(p=>({id:p.id,description:p.description,size_guide:p.size_guide,size_guide_image:p.size_guide_image}));
 const user=${JSON.stringify(PREVIEW_ADMIN_USER)};
 const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
 const session={access_token:'PREVIEW_DISABLED',refresh_token:'PREVIEW_DISABLED',token_type:'bearer',expires_in:3600,expires_at:4102444800,user:clone(user)};
 const blocked=name=>({data:null,error:{code:'PREVIEW_BLOCKED',message:'Operación deshabilitada en preview: '+String(name||'operación')}});
 const rpcData={
  is_store_admin:()=>true,
  get_public_catalog:()=>products,
  get_public_catalog_multifotos:()=>[],
  get_public_product_details:()=>details,
  get_public_product_details_for_product:args=>details.filter(row=>row.id===String(args&&args.p_product_id||'')),
  get_public_product_descriptions:()=>details,
  get_public_category_order:()=>['CORSET','CADENA DE CUERPO','CAMISONES'],
  get_public_storefront_shipping_settings:()=>({success:true,national_shipping_cost:10000,free_shipping_threshold:130000,free_shipping_in_cali:true}),
  get_online_payment_status:()=>({online_payments_enabled:false}),
  get_public_storefront_cod_settings:()=>({enabled:false,allowed_cities:[]}),
  admin_get_storefront_cod_settings:()=>({enabled:false,allowed_cities:[]}),
  admin_list_storefront_product_combos:()=>[],
  admin_get_storefront_marketing_metrics:()=>[],
  get_public_storefront_promotion:()=>({enabled:false,style:'romantic',eyebrow:'',title:'Promoción de muestra',message:'Sin campañas activas en este entorno sintético.',button_label:'Explorar catálogo',button_url:'#catalogo',background_color:'#381426',accent_color:'#ff78a6',text_color:'#ffffff',popup_size:'small',popup_shape:'rounded',popup_position:'center',animation_style:'none',animate:false,delay_ms:0,visible_duration_ms:3000,display_frequency:'once_per_session',start_at:null,end_at:null})
 };
 function tableBuilder(name){
  const filters=[];let writeName='',offset=0,limitValue=Infinity,sortKey='',ascending=true;
  const query={
   select(){return query},order(key,options={}){sortKey=String(key);ascending=options.ascending!==false;return query},range(from,to){offset=Math.max(0,Number(from)||0);limitValue=Math.max(0,(Number(to)||offset)-offset+1);return query},limit(value){limitValue=Math.max(0,Number(value)||0);return query},
   eq(key,value){filters.push(row=>String(row[key]??'')===String(value??''));return query},neq(key,value){filters.push(row=>String(row[key]??'')!==String(value??''));return query},
   in(key,values){const set=new Set(Array.isArray(values)?values.map(String):[]);filters.push(row=>set.has(String(row[key]??'')));return query},is(key,value){filters.push(row=>value===null?row[key]==null:row[key]===value);return query},
   gte(key,value){filters.push(row=>row[key]>=value);return query},gt(key,value){filters.push(row=>row[key]>value);return query},lte(key,value){filters.push(row=>row[key]<=value);return query},lt(key,value){filters.push(row=>row[key]<value);return query},
   match(values){for(const [key,value] of Object.entries(values||{}))filters.push(row=>String(row[key]??'')===String(value??''));return query},filter(){return query},or(){return query},not(){return query},
   maybeSingle(){return query.execute().then(result=>result.error?result:{data:(result.data||[])[0]||null,error:null})},single(){return query.maybeSingle()},
   insert(){writeName='insert';return query},update(){writeName='update';return query},delete(){writeName='delete';return query},upsert(){writeName='upsert';return query},
   execute(){
    if(writeName)return Promise.resolve(blocked('tabla '+name+' '+writeName));
    if(!Object.prototype.hasOwnProperty.call(tables,name))return Promise.resolve(blocked('tabla '+name));
    let rows=clone(tables[name]).filter(row=>filters.every(test=>test(row)));
    if(sortKey)rows.sort((a,b)=>{const left=a[sortKey],right=b[sortKey];const result=left===right?0:left==null?1:right==null?-1:left<right?-1:1;return ascending?result:-result});
    return Promise.resolve({data:rows.slice(offset,offset+limitValue),error:null});
   },then(resolve,reject){return query.execute().then(resolve,reject)}
  };
  return query;
 }
 const subscription={unsubscribe(){}};
 const client={
  rpc:async(name,args)=>Object.prototype.hasOwnProperty.call(rpcData,name)?{data:clone(rpcData[name](args)),error:null}:blocked('RPC '+name),
  from:tableBuilder,channel:()=>({on(){return this},subscribe(){return this},unsubscribe:async()=> 'ok'}),removeChannel:async()=> 'ok',
  auth:{
   getSession:async()=>({data:{session:clone(session)},error:null}),getUser:async()=>({data:{user:clone(user)},error:null}),
   onAuthStateChange:()=>({data:{subscription}}),signOut:async()=>({error:null}),
   signInWithPassword:async()=>blocked('inicio de sesión'),updateUser:async()=>blocked('actualización de Auth'),resetPasswordForEmail:async()=>blocked('recuperación de Auth'),
   mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:'aal1',nextLevel:'aal1'},error:null}),listFactors:async()=>({data:{all:[],totp:[],phone:[]},error:null}),enroll:async()=>blocked('enrolamiento MFA'),challenge:async()=>blocked('challenge MFA'),verify:async()=>blocked('verificación MFA'),unenroll:async()=>blocked('eliminación MFA')}
  },
  functions:{invoke:async name=>blocked('Edge Function '+name)}
 };
 window.__SIREVYA_PREVIEW_MODE__=true;
 window.__SIREVYA_PREVIEW_CAPABILITIES__={identity:'sintética',data:'sintética',payments:false,orders:false,reservations:false,inventoryWrites:false,authWrites:false,realtime:false};
 window.__SIREVYA_PREVIEW_CLIENT__=client;
 window.supabase={createClient:()=>client};
 window.open=()=>null;
 const doc=window.document;
 if(doc&&typeof doc.addEventListener==='function'){
  doc.addEventListener('click',event=>{const anchor=event.target&&typeof event.target.closest==='function'?event.target.closest('a[href],area[href]'):null;if(!anchor)return;try{const url=new URL(anchor.href,window.location.href);if(!['http:','https:'].includes(url.protocol)||url.origin!==window.location.origin){event.preventDefault();if(event.stopImmediatePropagation)event.stopImmediatePropagation()}}catch{event.preventDefault()}},true);
  doc.addEventListener('submit',event=>{event.preventDefault();if(event.stopImmediatePropagation)event.stopImmediatePropagation()},true);
 }
 try{const form=window.HTMLFormElement&&window.HTMLFormElement.prototype;if(form){form.submit=function(){throw new Error('Formulario deshabilitado en preview seguro')};form.requestSubmit=function(){throw new Error('Formulario deshabilitado en preview seguro')}}}catch{}
 const nativeFetch=window.fetch.bind(window);
 window.fetch=async(input,init={})=>{
  const raw=typeof input==='string'?input:(input&&input.url)||String(input);let url;
  try{url=new URL(raw,window.location.href)}catch{return new Response(JSON.stringify({error:'preview bloqueado'}),{status:403,headers:{'Content-Type':'application/json'}})}
  const method=String(init.method||(input&&input.method)||'GET').toUpperCase();
  const allowedAsset=url.origin===window.location.origin&&url.pathname.startsWith('/__preview_assets/')&&['GET','HEAD'].includes(method);
  if(!allowedAsset)return new Response(JSON.stringify({error:'Red y escrituras bloqueadas en preview seguro.'}),{status:403,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  return nativeFetch(input,init);
 };
 const blockedApi=function(){throw new Error('API de red deshabilitada en preview seguro')};
 try{window.XMLHttpRequest=blockedApi;window.WebSocket=blockedApi;window.EventSource=blockedApi}catch{}
 try{if(window.navigator)Object.defineProperty(window.navigator,'sendBeacon',{value:()=>false,configurable:false})}catch{}
})();`;

function git(args, root = ROOT) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
}

export function getVersion(root = ROOT) {
  return {
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], root) || 'unknown',
    commit: git(['rev-parse', '--short=12', 'HEAD'], root) || 'unknown',
    dirty: Boolean(git(['status', '--porcelain'], root)),
    data: 'synthetic',
    writes: false,
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function replaceAssignment(html, name, replacement) {
  const pattern = new RegExp(`(\\b(?:const|let|var)\\s+${name}\\s*=\\s*)([^;\\n]+)(\\s*;)`, 'gi');
  let count = 0;
  const output = html.replace(pattern, (_match, prefix, _value, suffix) => { count += 1; return `${prefix}${replacement}${suffix}`; });
  if (count !== 1) throw new Error(`No se encontró exactamente una asignación de ${name}; transformación rechazada.`);
  return output;
}

function replaceAssignmentIfPresent(html, name, replacement) {
  const pattern = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=`, 'i');
  return pattern.test(html) ? replaceAssignment(html, name, replacement) : html;
}

function rewriteUrlAttribute(tag, name, replacement) {
  const pattern = new RegExp(`(\\s${name}\\s*=\\s*)(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'gi');
  return tag.replace(pattern, (match, prefix, doubleQuoted, singleQuoted, unquoted) => {
    const value = doubleQuoted ?? singleQuoted ?? unquoted ?? '';
    return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value) ? `${prefix}"${replacement}" data-preview-blocked="external"` : match;
  });
}

function scrubExternalMarkup(html, mode = 'storefront') {
  const allowedAdminModule = '<script type="module" src="./scripts/admin_csv_preview.mjs"></script>';
  const allowedAdminModuleOpenTag = '<script type="module" src="./scripts/admin_csv_preview.mjs">';
  const retainAllowedAdminModule = tag => mode === 'admin' && tag.trim() === allowedAdminModule;
  const allowedStorefrontManifest = '<link rel="manifest" href="/manifest.webmanifest">';
  html = html.replace(/<script\b(?=[^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script\s*>/gi, tag => retainAllowedAdminModule(tag) ? tag : '');
  html = html.replace(/<script\b(?=[^>]*\bsrc\s*=)[^>]*\/>/gi, tag => mode === 'admin' && tag.trim() === allowedAdminModuleOpenTag ? tag : '');
  html = html.replace(/<link\b[^>]*>/gi, tag => {
    if (/\bid\s*=\s*(?:"appFavicon"|'appFavicon'|appFavicon)(?:\s|\/?>)/i.test(tag)) {
      return '<link id="appFavicon" rel="icon" href="/__preview_assets/blocked.svg">';
    }
    if (mode === 'storefront' && tag.trim() === allowedStorefrontManifest) return allowedStorefrontManifest;
    return '';
  });
  html = html.replace(/<meta\b[^>]*http-equiv\s*=\s*(?:"refresh"|'refresh'|refresh)[^>]*>/gi, '');
  html = html.replace(/<base\b[^>]*>/gi, '');
  html = html.replace(/<(?:iframe|object)\b[^>]*>[\s\S]*?<\/(?:iframe|object)\s*>/gi, '');
  html = html.replace(/<(?:iframe|frame|object|embed)\b[^>]*\/?>/gi, '');
  html = html.replace(/@import\s+[^;]+;/gi, '');
  html = html.replace(/<(?:a|area)\b[^>]*>/gi, tag => rewriteUrlAttribute(rewriteUrlAttribute(tag, 'href', '#'), 'xlink:href', '#'));
  html = html.replace(/<form\b[^>]*>/gi, tag => rewriteUrlAttribute(tag, 'action', '#'));
  html = html.replace(/<(?:button|input)\b[^>]*>/gi, tag => rewriteUrlAttribute(tag, 'formaction', '#'));
  html = html.replace(/<(?:img|source|video|audio)\b[^>]*>/gi, tag => {
    let out = tag;
    for (const name of ['src', 'poster', 'data-src']) out = rewriteUrlAttribute(out, name, '/__preview_assets/blocked.svg');
    return out.replace(/\ssrcset\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, ' srcset="/__preview_assets/blocked.svg"');
  });
  return html;
}

function scrubRemoteUrlLiterals(html) {
  const namespaces = [];
  html = html.replace(/\bxmlns(?::[\w.-]+)?\s*=\s*(["'])http:\/\/www\.w3\.org\/[^"']*\1/gi, attribute => {
    const token = `__PREVIEW_SAFE_XMLNS_${namespaces.length}__`;
    namespaces.push([token, attribute]);
    return token;
  });
  html = html.replace(/https?:\/\/[^\s"'`<>),;]+/gi, '/__preview_external_blocked');
  html = html.replace(/(^|[\s=(,:;{])\/\/[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/[^\s"'`<>),;]*)?/gim, '$1/__preview_external_blocked');
  for (const [token, attribute] of namespaces) html = html.replace(token, attribute);
  return html;
}

export async function renderPreviewHtml({ root = ROOT, version = getVersion(root), sourceHtml, mode = 'storefront' } = {}) {
  if (!['storefront', 'admin'].includes(mode)) throw new Error('Modo de preview no reconocido.');
  const sourceFile = mode === 'admin' ? 'admin.html' : 'index.html';
  let html = sourceHtml ?? await readFile(path.join(root, sourceFile), 'utf8');
  if (mode === 'admin') {
    html = html.replace(/w\.document\.write\(`[^`]*`\);w\.document\.close\(\);/g, "console.info('Impresión de recibos deshabilitada en preview seguro.');");
    if (/\bw\.document\.write\(/.test(html)) throw new Error('Quedó un recibo emergente en admin-preview; transformación rechazada.');
    html = replaceAssignment(html, 'brandName', '"Variedades JM"');
    html = replaceAssignment(html, 'brandIcon', '""');
    html = replaceAssignment(html, 'brandIconPath', '""');
    const imageFunctionPattern = /function\s+publicWorkerImage\(value\)\s*\{[\s\S]*?\n\}/g;
    if ([...html.matchAll(imageFunctionPattern)].length !== 1) throw new Error('No se encontró el resolver de imágenes del admin; transformación rechazada.');
    const safeImageFunction = 'function publicWorkerImage(value){const key=imageObjectKey(value);if(!key||/^(?:https?:\\/\\/|\\/\\/|data:|blob:)/i.test(key))return "";return IMAGE_WORKER_URL+"/"+key.split("/").map(part=>encodeURIComponent(part)).join("/");}';
    html = html.replace(imageFunctionPattern, safeImageFunction);
  }
  html = scrubExternalMarkup(html, mode);
  html = replaceAssignment(html, 'SUPABASE_URL', 'window.location.origin+"/__preview_api"');
  if (mode === 'admin') {
    html = replaceAssignmentIfPresent(html, 'SUPABASE_ANON_KEY', '"preview-no-secret"');
    html = replaceAssignmentIfPresent(html, 'SUPABASE_KEY', '"preview-no-secret"');
    html = replaceAssignmentIfPresent(html, 'WOMPI_PUBLIC_KEY', '"PREVIEW_DISABLED"');
    html = replaceAssignmentIfPresent(html, 'WOMPI_SIGNATURE_ENDPOINT', 'window.location.origin+"/__preview_api/functions/v1/wompi-create-checkout"');
    html = replaceAssignmentIfPresent(html, 'IMAGE_WORKER_URL', 'window.location.origin+"/__preview_assets"');
  } else {
    html = replaceAssignment(html, 'SUPABASE_KEY', '"preview-no-secret"');
    html = replaceAssignment(html, 'WOMPI_PUBLIC_KEY', '"PREVIEW_DISABLED"');
    html = replaceAssignment(html, 'WOMPI_SIGNATURE_ENDPOINT', 'window.location.origin+"/__preview_api/functions/v1/wompi-create-checkout"');
    html = replaceAssignment(html, 'IMAGE_WORKER_URL', 'window.location.origin+"/__preview_assets"');
  }
  html = html.replace(/\b(?:sb_(?:publishable|secret)_[A-Za-z0-9_-]{8,}|pub_(?:test|prod)_[A-Za-z0-9_-]{8,})\b/gi, 'PREVIEW_DISABLED');
  html = html.replace(/\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, 'PREVIEW_DISABLED');
  html = scrubRemoteUrlLiterals(html);
  if (mode === 'storefront') {
    html = html.replace('const sb=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);', 'const sb=window.__SIREVYA_PREVIEW_CLIENT__;');
    if (!html.includes('const sb=window.__SIREVYA_PREVIEW_CLIENT__;')) throw new Error('No se sustituyó la inicialización Supabase; transformación rechazada.');
  } else if (!html.includes('supabase.createClient(')) {
    throw new Error('No se encontró el cliente Supabase del admin; transformación rechazada.');
  }
  const navigationPatterns = [
    /\b(?:window|self|top|parent|globalThis|document|this)\s*(?:\.|\?\.)\s*location\s*(?:\.|\?\.)\s*(?:assign|replace)\s*(?:\?\.)?\s*\(/i,
    /\b(?:window|self|top|parent|globalThis|document|this)\s*\[\s*(["'])location\1\s*\]\s*(?:\.|\?\.)\s*(?:href|assign|replace)\s*(?:=|\()/i,
    /\b(?:window|self|top|parent|globalThis|document|this)\s*\[\s*(["'])location\1\s*\]\s*=/i,
    /\b(?:window|self|top|parent|globalThis|document|this)\s*(?:\.|\?\.)\s*location\s*(?:\.|\?\.)\s*href\s*=/i,
    /\b(?:window|self|top|parent|globalThis|document|this)\s*(?:\.|\?\.)\s*location\s*=/i,
    /\blocation\s*(?:\.|\?\.)\s*(?:assign|replace)\s*(?:\?\.)?\s*\(/i,
    /\blocation\s*\[\s*(["'])(?:assign|replace)\1\s*\]\s*\(/i,
    /\blocation\s*(?:\.|\?\.)\s*href\s*=/i,
    /\blocation\s*\[\s*(["'])href\1\s*\]\s*=/i,
  ];
  const bareLocationAssignment = [...html.matchAll(/(^|[^\w$?.])location\s*(?:\+=|-=|\*=|\/=|%=|&&=|\|\|=|\?\?=|&=|\|=|\^=|<<=|>>=|=(?!=|>))/gim)]
    .some(match => !/\b(?:const|let|var)\s+$/.test(html.slice(Math.max(0, match.index - 24), match.index + match[1].length)));
  const computedGlobalAssignment = /\b(?:window|self|top|parent|globalThis|document|this)\s*(?:\[\s*[^\]\r\n]{1,120}\s*\]){1,4}\s*(?:=|\+=|-=|\*=|\/=|%=|&&=|\|\|=|\?\?=|&=|\|=|\^=|<<=|>>=)/i.test(html);
  if (navigationPatterns.some(pattern => pattern.test(html)) || bareLocationAssignment || computedGlobalAssignment) {
    throw new Error('El HTML contiene navegación programática; transformación rechazada.');
  }
  const headTags = [...html.matchAll(/<head\b[^>]*>/gi)];
  if (headTags.length !== 1) throw new Error('No hay exactamente un <head>; transformación rechazada.');
  const head = headTags[0];
  if (/<script\b/i.test(html.slice(0, head.index))) throw new Error('Se encontró un script antes del guard de head; transformación rechazada.');
  const previewClientScript = mode === 'admin' ? PREVIEW_ADMIN_CLIENT_SCRIPT : PREVIEW_CLIENT_SCRIPT;
  const headInjection = `${head[0]}<meta name="robots" content="noindex,nofollow"><script data-sirevya-preview="safe-client">${previewClientScript}</script>`;
  html = html.slice(0, head.index) + headInjection + html.slice(head.index + head[0].length);
  if (html.indexOf('<script data-sirevya-preview="safe-client">') !== html.search(/<script\b/i)) throw new Error('El guard no es el primer script; transformación rechazada.');
  const banner = mode === 'admin'
    ? `<aside id="previewSafetyBanner" role="status" style="position:relative;z-index:9999;pointer-events:none;padding:10px 14px;background:#37131d;color:#fff;border-bottom:2px solid #dca45f;text-align:center;font:700 13px/1.4 system-ui"><strong>ADMIN DE PREVIEW</strong> · GitHub <code>${escapeHtml(version.branch)}@${escapeHtml(version.commit)}</code> · identidad, productos, ventas, stock y pedidos son sintéticos · Supabase real, Auth real, pagos y escrituras están deshabilitados.</aside>`
    : `<aside id="previewSafetyBanner" role="status" style="position:relative;z-index:9999;pointer-events:none;padding:10px 14px;background:#37131d;color:#fff;border-bottom:2px solid #dca45f;text-align:center;font:700 13px/1.4 system-ui"><strong>PREVIEW DE DESARROLLO</strong> · GitHub <code>${escapeHtml(version.branch)}@${escapeHtml(version.commit)}</code> · productos, stock y tarifas de envío son datos sintéticos (no oferta real) · pagos, pedidos, reservas y cambios reales están deshabilitados.</aside>`;
  const bodyTags = [...html.matchAll(/<body\b[^>]*>/gi)];
  if (bodyTags.length !== 1) throw new Error('No hay exactamente un <body>; transformación rechazada.');
  html = html.slice(0, bodyTags[0].index) + bodyTags[0][0] + banner + html.slice(bodyTags[0].index + bodyTags[0][0].length);
  const withoutXmlNamespaces = html.replace(/\bxmlns(?::[\w.-]+)?\s*=\s*(["'])http:\/\/www\.w3\.org\/[^"']*\1/gi, '');
  const credentialAssignments = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]*)/gi;
  for (const match of html.matchAll(credentialAssignments)) {
    const name = match[1].replace(/[^a-z0-9]/gi, '').toUpperCase();
    const looksSensitive = /(?:APIKEY|ACCESSTOKEN|SERVICEROLEKEY|CLIENTSECRET|SECRETKEY)$/.test(name);
    const expression = match[2].trim();
    const isSafePlaceholder = /^(?:(["'`])(?:PREVIEW_DISABLED|preview-no-secret)\1|null|undefined)$/i.test(expression);
    if (looksSensitive && !isSafePlaceholder) throw new Error('Quedó asignación de credencial; transformación rechazada.');
  }
  const unsafe = [
    [/\b[a-z0-9-]+\.supabase\.co\b/i, 'host Supabase'],
    [/\b(?:sb_(?:publishable|secret)_[A-Za-z0-9_-]{8,}|pub_(?:test|prod)_[A-Za-z0-9_-]{8,})\b/i, 'clave de proveedor'],
    [/<(?:a|area)\b[^>]*\b(?:href|xlink:href)\s*=\s*(["'])(?:[a-z][a-z0-9+.-]*:|\/\/)/i, 'enlace externo'],
    [/<form\b[^>]*\baction\s*=\s*(["'])(?:[a-z][a-z0-9+.-]*:|\/\/)/i, 'action externa'],
    [/<(?:button|input)\b[^>]*\bformaction\s*=\s*(["'])(?:[a-z][a-z0-9+.-]*:|\/\/)/i, 'formaction externo'],
  ];
  const allowedAdminModuleOpenTag = '<script type="module" src="./scripts/admin_csv_preview.mjs">';
  const unapprovedScriptSrc = [...html.matchAll(/<script\b[^>]*\bsrc\s*=[^>]*>/gi)]
    .some(match => mode !== 'admin' || match[0].trim() !== allowedAdminModuleOpenTag);
  if (unapprovedScriptSrc) throw new Error('Quedó un script con src no autorizado; transformación rechazada.');
  for (const [pattern, label] of unsafe) if (pattern.test(html)) throw new Error(`Quedó ${label}; transformación rechazada.`);
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(match => match[0].trim());
  if (links.some(tag => !/^<link id="appFavicon" rel="icon" href="\/__preview_assets\/blocked\.svg">$/i.test(tag)
    && !(mode === 'storefront' && /^<link rel="manifest" href="\/manifest\.webmanifest">$/i.test(tag)))) {
    throw new Error('Quedó un link distinto al favicon local; transformación rechazada.');
  }
  if (/https?:\/\//i.test(withoutXmlNamespaces) || /(^|[\s=(,:;{"'`])\/\/[a-z0-9][a-z0-9.-]*\.[a-z]{2,}/im.test(withoutXmlNamespaces)) {
    throw new Error('Quedó una URL externa literal; transformación rechazada.');
  }
  return html;
}

function send(res, status, contentType, body, headOnly = false) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'clipboard-write=(self), camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; navigate-to 'self'; form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'",
  });
  res.end(headOnly ? undefined : body);
}

const placeholderSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#35101b"/><stop offset="1" stop-color="#161214"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/><circle cx="400" cy="240" r="110" fill="none" stroke="#dca45f" stroke-width="8"/><text x="400" y="250" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="38" font-weight="700">PREVIEW</text><text x="400" y="430" text-anchor="middle" fill="#e8cda4" font-family="Arial,sans-serif" font-size="22">imagen sintética</text></svg>';
const PREVIEW_PWA_FILES = new Map([
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json; charset=utf-8']],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
  ['/offline.html', ['offline.html', 'text/html; charset=utf-8']],
  ['/assets/pwa/icon-192.png', ['assets/pwa/icon-192.png', 'image/png']],
  ['/assets/pwa/icon-512.png', ['assets/pwa/icon-512.png', 'image/png']],
]);
const PREVIEW_STATIC_PAGES = new Map([
  ['/politica-privacidad.html', 'politica-privacidad.html'],
  ['/preguntas-frecuentes.html', 'preguntas-frecuentes.html'],
  ['/cambios-devoluciones.html', 'cambios-devoluciones.html'],
]);

export function createPreviewServer({ root = ROOT, versionProvider = () => getVersion(root) } = {}) {
  return createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://preview.local');
    const headOnly = req.method === 'HEAD';
    if (req.method !== 'GET' && !headOnly) {
      console.warn(`[preview] blocked method ${req.method} ${url.pathname}`);
      return send(res, 403, 'application/json; charset=utf-8', JSON.stringify({ error: 'Escrituras deshabilitadas en preview.' }), headOnly);
    }
    if (url.pathname === '/__version' || url.pathname === '/healthz') {
      return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ status: 'ready', ...versionProvider() }), headOnly);
    }
    if (url.pathname === '/__preview_api' || url.pathname.startsWith('/__preview_api/')) {
      console.warn(`[preview] blocked backend route ${url.pathname}`);
      return send(res, 403, 'application/json; charset=utf-8', JSON.stringify({ error: 'Backend Supabase/Wompi real bloqueado en preview.' }), headOnly);
    }
    if (PREVIEW_PWA_FILES.has(url.pathname)) {
      const [fileName, contentType] = PREVIEW_PWA_FILES.get(url.pathname);
      try {
        let body = await readFile(path.join(root, fileName));
        if (url.pathname === '/manifest.webmanifest') {
          const manifest = JSON.parse(body.toString('utf8'));
          manifest.id = '/storefront';
          manifest.name = 'Sirevya — Preview';
          manifest.short_name = 'JM Preview';
          manifest.start_url = '/storefront';
          body = JSON.stringify(manifest);
        }
        return send(res, 200, contentType, body, headOnly);
      } catch {
        return send(res, 404, 'text/plain; charset=utf-8', 'PWA preview asset unavailable', headOnly);
      }
    }
    if (url.pathname === '/scripts/fase7_csv_preview.mjs' || url.pathname === '/scripts/admin_csv_preview.mjs') {
      const fileName = url.pathname === '/scripts/fase7_csv_preview.mjs' ? 'fase7_csv_preview.mjs' : 'admin_csv_preview.mjs';
      try { return send(res, 200, 'text/javascript; charset=utf-8', await readFile(path.join(root, 'scripts', fileName), 'utf8'), headOnly); }
      catch { return send(res, 404, 'text/plain; charset=utf-8', 'Preview module unavailable', headOnly); }
    }
    if (url.pathname === '/__preview_assets' || url.pathname.startsWith('/__preview_assets/')) {
      return send(res, 200, 'image/svg+xml; charset=utf-8', placeholderSvg, headOnly);
    }
    if (url.pathname === '/manus-routes.json') {
      try { return send(res, 200, 'application/json; charset=utf-8', await readFile(path.join(root, 'manus-routes.json'), 'utf8'), headOnly); }
      catch { return send(res, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'Route manifest unavailable' }), headOnly); }
    }
    if (PREVIEW_STATIC_PAGES.has(url.pathname)) {
      const pageFile = PREVIEW_STATIC_PAGES.get(url.pathname);
      try {
        let pageHtml = await readFile(path.join(root, pageFile), 'utf8');
        if ((pageHtml.match(/<head\b/gi) || []).length !== 1 || (pageHtml.match(/<body\b/gi) || []).length !== 1) throw new Error('Estructura HTML no permitida.');
        // Preview is noindex: keep these known production SEO URLs local; unknown external URLs still fail closed below.
        pageHtml = pageHtml
          .replaceAll(`https://sirevya.com.co${url.pathname}`, url.pathname)
          .replaceAll('https://sirevya.com.co/share-sirevya.png', '/__preview_assets/blocked.svg');
        if (url.pathname === '/cambios-devoluciones.html') {
          const blockedExternalLinks = [
            ['href="https://wa.me/573025469983"', 'whatsapp'],
            ['href="mailto:sirevya99@gmail.com?subject=Solicitud%20de%20cambio%20o%20devoluci%C3%B3n"', 'email'],
            ['href="https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=44306"', 'ley1480'],
            ['href="https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=257116"', 'ley2439'],
            ['href="https://sedeelectronica.sic.gov.co/temas/proteccion-al-consumidor/derechos-y-deberes/fallas-en-un-producto"', 'sic'],
          ];
          for (const [href, label] of blockedExternalLinks) {
            if (pageHtml.split(href).length - 1 !== 1) throw new Error(`Enlace externo esperado no único: ${label}.`);
            pageHtml = pageHtml.replace(href, `data-preview-disabled="${label}" aria-disabled="true" title="Enlace externo deshabilitado en preview"`);
          }
          pageHtml = pageHtml.replaceAll('href="/index.html"', 'href="/storefront"');
        }
        if (/<script\b|<iframe\b|https?:\/\/|\b(?:src|href)\s*=\s*(["'])\s*(?:\/\/|(?:data|javascript|mailto|tel):)/i.test(pageHtml)) throw new Error('Contenido activo o externo no permitido.');
        const version = versionProvider();
        pageHtml = pageHtml.replace(/<head\b[^>]*>/i, tag => `${tag}<meta name="robots" content="noindex,nofollow">`);
        const banner = `<aside id="previewSafetyBanner" role="status" style="position:relative;z-index:9999;padding:10px 14px;background:#37131d;color:#fff;border-bottom:2px solid #dca45f;text-align:center;font:700 13px/1.4 system-ui"><strong>PREVIEW DE DESARROLLO</strong> · GitHub <code>${escapeHtml(version.branch)}@${escapeHtml(version.commit)}</code> · productos, stock y tarifas son sintéticos; pagos, pedidos, reservas y cambios reales están deshabilitados.</aside>`;
        pageHtml = pageHtml.replace(/<body\b[^>]*>/i, tag => `${tag}${banner}`);
        return send(res, 200, 'text/html; charset=utf-8', pageHtml, headOnly);
      } catch (error) {
        console.error(`[preview] static page ${url.pathname} unavailable:`, error.message);
        return send(res, 500, 'text/plain; charset=utf-8', 'Página estática del preview no disponible.', headOnly);
      }
    }
    if (url.pathname === '/') {
      try { return send(res, 200, 'text/html; charset=utf-8', await readFile(path.join(root, 'preview', 'index.html'), 'utf8'), headOnly); }
      catch { return send(res, 500, 'text/plain; charset=utf-8', 'Preview hub no disponible.'); }
    }
    if (url.pathname === '/index.html' || url.pathname === '/storefront') {
      try { return send(res, 200, 'text/html; charset=utf-8', await renderPreviewHtml({ root, version: versionProvider(), mode: 'storefront' }), headOnly); }
      catch (error) {
        console.error('[preview] storefront transform failed:', error.message);
        return send(res, 500, 'text/plain; charset=utf-8', 'Preview no disponible: transformación segura falló.');
      }
    }
    if (url.pathname === '/admin-preview') {
      try { return send(res, 200, 'text/html; charset=utf-8', await renderPreviewHtml({ root, version: versionProvider(), mode: 'admin' }), headOnly); }
      catch (error) {
        console.error('[preview] admin transform failed:', error.message);
        return send(res, 500, 'text/plain; charset=utf-8', 'Preview no disponible: transformación segura falló.');
      }
    }
    return send(res, 404, 'text/plain; charset=utf-8', 'Not found', headOnly);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createPreviewServer();
  server.listen(PORT, HOST, () => {
    const version = getVersion();
    console.log(`Sirevya safe preview listening on ${HOST}:${PORT} (${version.branch}@${version.commit}); synthetic read-only fixtures; real operations blocked.`);
  });
}
