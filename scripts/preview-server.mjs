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
]);

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
  const allowedAsset=url.origin===window.location.origin&&url.pathname.startsWith('/__preview_assets/');
  if(url.origin!==window.location.origin||url.pathname.startsWith('/__preview_api')||!allowedAsset){
   return new Response(JSON.stringify({error:'Operación de red bloqueada en preview seguro.'}),{status:403,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})
  }
  return nativeFetch(input,init)
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

function rewriteUrlAttribute(tag, name, replacement) {
  const pattern = new RegExp(`(\\s${name}\\s*=\\s*)(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'gi');
  return tag.replace(pattern, (match, prefix, doubleQuoted, singleQuoted, unquoted) => {
    const value = doubleQuoted ?? singleQuoted ?? unquoted ?? '';
    return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value) ? `${prefix}"${replacement}" data-preview-blocked="external"` : match;
  });
}

function scrubExternalMarkup(html) {
  html = html.replace(/<script\b(?=[^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  html = html.replace(/<script\b(?=[^>]*\bsrc\s*=)[^>]*\/?>/gi, '');
  html = html.replace(/<link\b(?=[^>]*\bhref\s*=)[^>]*>/gi, '');
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

export async function renderPreviewHtml({ root = ROOT, version = getVersion(root), sourceHtml } = {}) {
  let html = sourceHtml ?? await readFile(path.join(root, 'index.html'), 'utf8');
  html = scrubExternalMarkup(html);
  html = replaceAssignment(html, 'SUPABASE_URL', 'window.location.origin+"/__preview_api"');
  html = replaceAssignment(html, 'SUPABASE_KEY', '"preview-no-secret"');
  html = replaceAssignment(html, 'WOMPI_PUBLIC_KEY', '"PREVIEW_DISABLED"');
  html = replaceAssignment(html, 'WOMPI_SIGNATURE_ENDPOINT', 'window.location.origin+"/__preview_api/functions/v1/wompi-create-checkout"');
  html = replaceAssignment(html, 'IMAGE_WORKER_URL', 'window.location.origin+"/__preview_assets"');
  html = html.replace(/\b(?:sb_(?:publishable|secret)_[A-Za-z0-9_-]{8,}|pub_(?:test|prod)_[A-Za-z0-9_-]{8,})\b/gi, 'PREVIEW_DISABLED');
  html = html.replace(/\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, 'PREVIEW_DISABLED');
  html = scrubRemoteUrlLiterals(html);
  html = html.replace('const sb=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);', 'const sb=window.__SIREVYA_PREVIEW_CLIENT__;');
  if (!html.includes('const sb=window.__SIREVYA_PREVIEW_CLIENT__;')) throw new Error('No se sustituyó la inicialización Supabase; transformación rechazada.');
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
  const headInjection = `${head[0]}<meta name="robots" content="noindex,nofollow"><script data-sirevya-preview="safe-client">${PREVIEW_CLIENT_SCRIPT}</script>`;
  html = html.slice(0, head.index) + headInjection + html.slice(head.index + head[0].length);
  if (html.indexOf('<script data-sirevya-preview="safe-client">') !== html.search(/<script\b/i)) throw new Error('El guard no es el primer script; transformación rechazada.');
  const banner = `<aside id="previewSafetyBanner" role="status" style="position:relative;z-index:9999;pointer-events:none;padding:10px 14px;background:#37131d;color:#fff;border-bottom:2px solid #dca45f;text-align:center;font:700 13px/1.4 system-ui"><strong>PREVIEW DE DESARROLLO</strong> · GitHub <code>${escapeHtml(version.branch)}@${escapeHtml(version.commit)}</code> · productos, stock y tarifas de envío son datos sintéticos (no oferta real) · pagos, pedidos, reservas y cambios reales están deshabilitados.</aside>`;
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
    [/<script\b[^>]*\bsrc\s*=/i, 'script con src'],
    [/<link\b[^>]*\bhref\s*=/i, 'recurso link'],
    [/<(?:a|area)\b[^>]*\b(?:href|xlink:href)\s*=\s*(["'])(?:[a-z][a-z0-9+.-]*:|\/\/)/i, 'enlace externo'],
    [/<form\b[^>]*\baction\s*=\s*(["'])(?:[a-z][a-z0-9+.-]*:|\/\/)/i, 'action externa'],
    [/<(?:button|input)\b[^>]*\bformaction\s*=\s*(["'])(?:[a-z][a-z0-9+.-]*:|\/\/)/i, 'formaction externo'],
  ];
  for (const [pattern, label] of unsafe) if (pattern.test(html)) throw new Error(`Quedó ${label}; transformación rechazada.`);
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
    if (url.pathname === '/__preview_assets' || url.pathname.startsWith('/__preview_assets/')) {
      return send(res, 200, 'image/svg+xml; charset=utf-8', placeholderSvg, headOnly);
    }
    if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/storefront') {
      try { return send(res, 200, 'text/html; charset=utf-8', await renderPreviewHtml({ root, version: versionProvider() }), headOnly); }
      catch (error) {
        console.error('[preview] html transform failed:', error.message);
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
