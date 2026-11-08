import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const admin = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const source = name => {
  const code = admin.match(new RegExp(`function\\s+${name}\\([^\\n]*\\)\\{[\\s\\S]*?\\n\\}`))?.[0];
  assert.ok(code, `Debe existir ${name}`);
  return code;
};
const brandFunctions = ['adminBrandCacheKey', 'clearLegacyAdminBrandCache', 'clearAdminBrandCache', 'storeAdminBrandCache', 'loadAdminBrandForUser']
  .map(source).join('\n');
const values = new Map([
  ['jm_brand_name', 'Marca legacy de A'],
  ['jm_brand_icon', 'legacy-a.png'],
  ['jm_brand_icon_path', 'branding/legacy-a.png'],
]);
let vmContext;
const applied = [];
const localStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};
vmContext = vm.createContext({
  brandName: 'Variedades JM', brandIcon: '', brandIconPath: '', localStorage,
  publicWorkerImage: path => `preview-asset:${path}`,
  applyBrand() { applied.push([vmContext.brandName, vmContext.brandIcon, vmContext.brandIconPath]); },
});
new vm.Script(brandFunctions).runInContext(vmContext);

// Cuenta A puede recuperar exclusivamente la caché con namespace de A.
values.set(vmContext.adminBrandCacheKey('A', 'name'), 'Marca privada de A');
values.set(vmContext.adminBrandCacheKey('A', 'icon_path'), 'branding/a.png');
values.set(vmContext.adminBrandCacheKey('A', 'icon'), 'preview-asset:branding/a.png');
const brandA = vmContext.loadAdminBrandForUser({ id: 'A', user_metadata: {} });
assert.equal(brandA.name, 'Marca privada de A');
assert.equal(brandA.iconPath, 'branding/a.png');
assert.ok(!values.has('jm_brand_name') && !values.has('jm_brand_icon') && !values.has('jm_brand_icon_path'), 'Las claves legacy sin propietario se descartan.');

// B no tiene metadata ni caché: recibe defaults, no la marca que dejó A.
const brandBWithoutMetadata = vmContext.loadAdminBrandForUser({ id: 'B', user_metadata: {} });
assert.equal(brandBWithoutMetadata.name, 'Variedades JM');
assert.equal(brandBWithoutMetadata.icon, '');
assert.equal(brandBWithoutMetadata.iconPath, '');
assert.equal(values.get(vmContext.adminBrandCacheKey('A', 'name')), 'Marca privada de A', 'La caché namespaced de A se conserva sin mostrarse a B.');

// El campo legacy también debe limpiar caché de la propia cuenta cuando viene explícitamente vacío.
values.set(vmContext.adminBrandCacheKey('B', 'icon'), 'preview-asset:branding/b-old.png');
values.set(vmContext.adminBrandCacheKey('B', 'icon_path'), 'branding/b-old.png');
const brandBWithEmptyLegacyIcon = vmContext.loadAdminBrandForUser({
  id: 'B', user_metadata: { jm_brand_icon: '' },
});
assert.equal(brandBWithEmptyLegacyIcon.icon, '');
assert.equal(brandBWithEmptyLegacyIcon.iconPath, '');

// Metadata vacía es una instrucción explícita para limpiar, no permiso para heredar caché.
values.set(vmContext.adminBrandCacheKey('B', 'name'), 'Marca anterior de B');
values.set(vmContext.adminBrandCacheKey('B', 'icon_path'), 'branding/b-old.png');
const brandBWithEmptyMetadata = vmContext.loadAdminBrandForUser({
  id: 'B', user_metadata: { jm_brand_name: '', jm_brand_icon_path: '' },
});
assert.equal(brandBWithEmptyMetadata.name, 'Variedades JM');
assert.equal(brandBWithEmptyMetadata.icon, '');
assert.equal(brandBWithEmptyMetadata.iconPath, '');

// Metadata positiva de B prevalece sin leer ni sobrescribir el namespace de A.
const brandBFromMetadata = vmContext.loadAdminBrandForUser({
  id: 'B', user_metadata: { jm_brand_name: 'Marca de B', jm_brand_icon_path: 'branding/b.png' },
});
assert.equal(brandBFromMetadata.name, 'Marca de B');
assert.equal(brandBFromMetadata.iconPath, 'branding/b.png');
assert.equal(brandBFromMetadata.icon, 'preview-asset:branding/b.png');
assert.equal(values.get(vmContext.adminBrandCacheKey('A', 'name')), 'Marca privada de A');

const startApp = admin.match(/async function startApp\(\)\{[\s\S]*?\n\}/)?.[0] || '';
assert.match(startApp, /adminSessionAuthorized=true;adminSessionUserId=user\.id;[\s\S]*?loadAdminBrandForUser\(user\)/, 'La marca se hidrata solo después de validar e identificar la sesión.');
assert.match(source('saveBrand'), /storeAdminBrandCache\(userId,brandName,brandIcon,brandIconPath\)/);
assert.match(source('resetBrand'), /clearAdminBrandCache\(userId\)/);
assert.match(source('lockAdminPanel'), /brandName='Variedades JM';brandIcon='';brandIconPath=''/);

console.log('OK admin_brand_account_isolation_regression: caché namespaced, metadata vacía/ausente, lock y aislamiento A→B.');
