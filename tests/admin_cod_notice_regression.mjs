import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url);
const html=fs.readFileSync(new URL('admin.html',root),'utf8');
const helper=fs.readFileSync(new URL('scripts/cod_notice.js',root),'utf8');
function extract(name){const text=html.match(new RegExp('(?:async )?function '+name+'\\([^)]*\\)\\{[\\s\\S]*?\\n\\}'))?.[0];assert.ok(text,name);return text}
const names=['setAdminCodNoticeStatus','updateAdminCodNoticeControls','resetAdminCodNotice','readAdminCodNoticeForm','previewAdminCodNotice','adminCodNoticeRequestCurrent','verifyAdminCodNoticeAccess','loadAdminCodNotice','saveAdminCodNotice'];
function setup(){
 const nodes={};for(const id of ['codNoticeEnabled','codNoticeTitle','codNoticeBody','saveCodNoticeBtn','reloadCodNoticeBtn','codNoticeAdminStatus','codNoticeAdminPreview'])nodes[id]={disabled:false,checked:false,value:'',textContent:'',innerHTML:'',prepend:()=>{}};
 const events=[],queries=[],context=vm.createContext({$:(id)=>nodes[id],adminSessionAuthorized:true,adminAuthEpoch:1,adminSessionUserId:'admin-id',document:{createElement:()=>({textContent:''})},notifyPublicCatalogChanged:(type)=>events.push(type),sb:{auth:{getUser:async()=>({data:{user:{id:'admin-id'}},error:null})},rpc:async(name,payload)=>{queries.push({name,payload});return name==='is_store_admin'?{data:true,error:null}:{data:{success:true,enabled:false,title:'Borrador',body:'Condición'},error:null}}}});
 vm.runInContext(helper+'\nlet adminCodNoticeLoaded=false,adminCodNoticeBusy=false,adminCodNoticeSequence=0;\n'+names.map(extract).join('\n'),context);
 return {context,nodes,events,queries};
}
const {context,nodes,events,queries}=setup();
await context.loadAdminCodNotice();assert.equal(nodes.saveCodNoticeBtn.disabled,false);assert.equal(nodes.codNoticeTitle.value,'Borrador');
nodes.codNoticeEnabled.checked=true;nodes.codNoticeTitle.value='Condiciones';nodes.codNoticeBody.value='- Primer punto\n- Segundo <script>';
context.previewAdminCodNotice();assert.ok(nodes.codNoticeAdminPreview.innerHTML.includes('&lt;script&gt;'));
context.sb.rpc=async(name,payload)=>{queries.push({name,payload});return name==='is_store_admin'?{data:true,error:null}:{data:{success:true,enabled:payload.p_enabled,title:payload.p_title,body:payload.p_body},error:null}};
await context.saveAdminCodNotice();assert.deepEqual(events,['cod-notice-changed']);
const saved=queries.find(q=>q.name==='admin_save_storefront_cod_notice');
assert.deepEqual(Object.keys(saved.payload).sort(),['p_body','p_enabled','p_title']);assert.equal(saved.payload.p_body,'- Primer punto\n- Segundo <script>');
assert.ok(nodes.codNoticeAdminStatus.textContent.includes('Mensaje guardado'));
context.resetAdminCodNotice();assert.equal(nodes.codNoticeTitle.value,'');assert.equal(nodes.codNoticeBody.value,'');assert.equal(nodes.saveCodNoticeBtn.disabled,true);
// Falta de permiso no empieza lectura de copy.
const denied=setup();denied.context.sb.rpc=async(name)=>{denied.queries.push(name);return {data:false,error:null}};
assert.equal(await denied.context.loadAdminCodNotice(),false);assert.deepEqual(denied.queries,['is_store_admin']);assert.equal(denied.nodes.saveCodNoticeBtn.disabled,true);
// Cambio de cuenta entre permiso y lectura detiene la consulta.
const switched=setup();let userCalls=0;
switched.context.sb.auth.getUser=async()=>({data:{user:{id:++userCalls===1?'admin-id':'other-id'}},error:null});
assert.equal(await switched.context.loadAdminCodNotice(),false);assert.ok(!switched.queries.some(q=>q.name==='admin_get_storefront_cod_notice'));
// Un request completado tras logout no repuebla editor o desbloquea nueva sesión.
const late=setup();let finish;late.context.sb.rpc=async(name)=>name==='is_store_admin'?{data:true,error:null}:await new Promise(r=>finish=r);
const load=late.context.loadAdminCodNotice();await new Promise(resolve=>setImmediate(resolve));assert.ok(finish);
late.context.adminAuthEpoch++;late.context.adminSessionAuthorized=false;late.context.resetAdminCodNotice();
finish({data:{success:true,enabled:true,title:'Viejo',body:'Viejo'},error:null});assert.equal(await load,false);assert.equal(late.nodes.codNoticeTitle.value,'');assert.equal(late.nodes.saveCodNoticeBtn.disabled,true);
// Error ambiguo de guardado no afirma éxito ni permite repetición ciega.
const fail=setup();await fail.context.loadAdminCodNotice();fail.nodes.codNoticeEnabled.checked=true;fail.nodes.codNoticeTitle.value='Condiciones';fail.nodes.codNoticeBody.value='Texto';
fail.context.sb.rpc=async(name)=>name==='is_store_admin'?{data:true,error:null}:{data:null,error:{message:'Red interrumpida'}};
await fail.context.saveAdminCodNotice();assert.equal(fail.events.length,0);assert.equal(fail.nodes.saveCodNoticeBtn.disabled,true);assert.ok(fail.nodes.codNoticeAdminStatus.textContent.includes('No se pudo confirmar'));
const invalid=setup();await invalid.context.loadAdminCodNotice();invalid.nodes.codNoticeEnabled.checked=true;invalid.nodes.codNoticeTitle.value='';const count=invalid.queries.length;await invalid.context.saveAdminCodNotice();assert.equal(invalid.queries.length,count,'Texto inválido no envía RPC');
assert.ok(html.includes('<script src="scripts/cod_notice.js"></script>'));
assert.ok(html.includes('resetAdminCodNotice();'));
const block=names.map(extract).join('\n');assert.ok(!/localStorage|sessionStorage|console\./.test(block),'No persistir borrador ni loguearlo');
assert.ok(!/admin_save_storefront_cod_settings|admin_update_web_order_status|updateUser|signInWithPassword/.test(block));
console.log('PASS admin_cod_notice_regression: permiso e identidad, preview escapado, guardado confirmado, errores y logout sin respuestas stale.');
