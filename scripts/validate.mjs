import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const admin=read('admin.html'),catalog=read('index.html');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'sirevya-validate-'));
try{
 for(const [name,html] of [['admin',admin],['catalog',catalog]]){
  let i=0;
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
   if(/application\/ld\+json/i.test(match[1])){JSON.parse(match[2]);continue;}
   const file=path.join(temp,`${name}-${i++}.js`);fs.writeFileSync(file,match[2]);
   const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
   assert.equal(result.status,0,`${name}: ${result.stderr}`);
  }
 }
 const sdk=html=>html.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^\"]+)" integrity="(sha384-[^\"]+)" crossorigin="anonymous"><\/script>/);
 assert.ok(sdk(admin)&&sdk(catalog),'SDK exacto e integridad obligatorios');
 assert.deepEqual(sdk(admin).slice(1),sdk(catalog).slice(1),'SDK idéntico en ambas superficies');
 assert.ok(!/supabase-js@2"/.test(admin+catalog),'Sin SDK flotante');
 assert.ok(admin.includes("sb.rpc('is_store_admin')"));
 assert.ok(admin.includes('onAuthStateChange')&&admin.includes("signOut({scope:'local'})"));
 assert.ok(!/async function signup\(/.test(admin),'No alta pública oculta');
 for(const rpc of ['admin_update_web_order_status_secure','admin_adjust_inventory_movement_secure','admin_register_inventory_sale_secure','admin_delete_product_secure','admin_archive_sales'])assert.ok(admin.includes(rpc),rpc);
 assert.ok(catalog.includes("sb.rpc('get_public_category_order')"));
 assert.ok(catalog.includes('mailto:sirevya99@gmail.com')&&!catalog.includes('573128561773'));
 assert.ok(catalog.includes('refreshInventoryStatus()},15000)'));
 assert.ok(admin.includes('refreshPublicAvailability()},15000)'));
 const cell=admin.match(/function safeCSVCell\(value\)\{[\s\S]*?\n\}/)?.[0];
 assert.ok(cell,'Serializador CSV común');
 const context=vm.createContext({});vm.runInContext(cell,context);
 for(const text of ['=1+1','+SUM(A1:A2)','-cmd','@calc','  =HYPERLINK("https://example.test")','\t=1+1'])assert.ok(context.safeCSVCell(text).startsWith('"\''),`Fórmula neutralizada: ${text}`);
 assert.equal(context.safeCSVCell(-25),'"-25"');
 assert.equal(context.safeCSVCell('Camisa "M"'),'"Camisa ""M"""');
 assert.equal(context.safeCSVCell('Cali'),'"Cali"');
 assert.ok(admin.includes("${esc(({home:'Pantalla de inicio'"),'Etiqueta de promoción escapada');
 console.log('PASS: sintaxis, SDK/SRI, autorización, wrappers, CSV y límites de regresión.');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
