import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');

assert.match(html, /\.sidebar\s*\{[^}]*height:\s*100vh;\s*height:\s*100dvh;[^}]*overflow:\s*hidden/s,
  'el sidebar debe ocupar el viewport y contener el scroll exterior');
assert.match(html, /\.sidebarNav\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior-y:\s*contain;[^}]*-webkit-overflow-scrolling:\s*touch;[^}]*touch-action:\s*pan-y/s,
  'el área de navegación debe desplazarse con rueda y gesto táctil sin encadenar el scroll');
assert.match(html, /\.sidebarHeader\s*\{\s*flex:\s*0 0 auto\s*\}/,
  'el encabezado debe permanecer fuera del área desplazable');
assert.match(html, /\.sidebarBottom\s*\{\s*margin-top:\s*auto;\s*flex:\s*0 0 auto\s*\}/,
  'el control de cerrar sesión debe permanecer fijo al pie del sidebar');
assert.doesNotMatch(html, /\.sidebar\.open\{[^}]*overflow-y:\s*auto/s,
  'el contenedor exterior no debe crear un segundo scroll al abrir el menú móvil');

const sidebar = html.match(/<aside class="sidebar">([\s\S]*?)<\/aside>/)?.[1];
assert.ok(sidebar, 'debe existir el sidebar del administrador');
assert.match(sidebar, /<div class="sidebarHeader">[\s\S]*?class="brand"[\s\S]*?class="iconbtn sidebarClose"[\s\S]*?<\/div>/,
  'marca y control de cierre deben quedar en el encabezado fijo');
const nav = sidebar.match(/<nav class="sidebarNav"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
assert.ok(nav, 'las opciones deben estar agrupadas dentro del área scrollable');
for (const view of ['inicio', 'inventario', 'ventas', 'pedidos', 'clientes', 'proveedores', 'gastos', 'movimientos', 'reportes', 'producto', 'csvPreview', 'config']) {
  assert.match(nav, new RegExp(`data-view="${view}"`), `no debe perderse la opción ${view}`);
}
assert.match(sidebar, /<div class="sidebarBottom"><button class="navbtn" onclick="logout\(\)">[\s\S]*?Cerrar sesión[\s\S]*?<\/div>/,
  'cerrar sesión debe permanecer accesible fuera del nav desplazable');
assert.match(html, /@media\(max-width:780px\)\{[\s\S]*?\.sidebar\.open\{width:245px;padding:22px 15px\}/,
  'el drawer móvil debe conservar apertura y anchura sin abrir un segundo scroll');
assert.match(html, /\.main\{margin-left:245px;min-height:100vh\}/,
  'el layout desktop del contenido principal debe permanecer intacto');
assert.match(html, /\.main\{margin-left:0\}/,
  'el layout móvil del contenido principal debe permanecer intacto');

console.log('admin sidebar scroll regression: PASS');
