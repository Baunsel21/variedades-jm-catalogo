import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const admin = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const storefront = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(source, name) {
  const marker = `function ${name}(`;
  let start = source.indexOf(marker);
  assert.notEqual(start, -1, `Existe function ${name}.`);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `La función ${name} tiene cuerpo.`);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; i += 1; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (char === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  assert.fail(`No se pudo cerrar la función ${name}.`);
}

const adminNames = [
  'variantKey', 'normalizeVariantText', 'normalizeVariantHex', 'parseVariants',
  'normalizeAdminColorName', 'variantColorHexFromList', 'defaultAdminColorVariant', 'renameAdminColorVariants', 'setAdminColorHexInVariants',
  'addAdminColorVariants', 'adminColorHasStock', 'adminColorHasPhoto', 'adminColorHasHex', 'adminVariantHasProtectedData',
  'adminVariantKeyCollisions', 'adminVariantCollisionMessage', 'hiddenAdminVariantsWithData', 'uncoloredAdminVariants', 'uncoloredAdminVariantsHaveDuplicateSizes',
  'assignUncoloredAdminVariants', 'discardAdminColorVariants', 'discardHiddenAdminVariants', 'collectVariantDraft',
];
const adminFunctions = adminNames.map(name => extractFunction(admin, name));
const stockRows = [{ dataset: { varColor: 'Azul petróleo', varSize: 'M' }, value: '7' }];
const adminContext = vm.createContext({
  document: { querySelectorAll(selector) { return selector === '#variantEditorRows .variantAdminStock' ? stockRows : []; } },
  variantDraft: [{ color: 'Azul petróleo', size: 'M', stock: 3, image_path: 'products/synthetic/m.jpg', color_hex: '#2468AC' }],
  variantMemory: [],
});
vm.runInContext(adminFunctions.join('\n'), adminContext);

assert.equal(adminContext.normalizeVariantHex('#Aa12Ff'), '#aa12ff');
for (const invalid of ['#abc', 'abc123', '#12345678', 'url(javascript:alert(1))', 'red']) {
  assert.equal(adminContext.normalizeVariantHex(invalid), '', `Rechaza HEX inseguro/malformado: ${invalid}`);
}
const parsed = JSON.parse(JSON.stringify(adminContext.parseVariants([
  { color: 'Rojo', size: 'S', stock: 2, color_hex: '#AABBCC' },
  { color: 'Azul', size: 'M', stock: 1, color_hex: 'url(http://evil)' },
])));
assert.equal(parsed[0].color_hex, '#aabbcc');
assert.equal(Object.hasOwn(parsed[1], 'color_hex'), false);

const opaqueLegacy = [{ color: '', size: '', stock: 4, image_path: 'products/synthetic/unkeyed.jpg' }];
assert.deepEqual(JSON.parse(JSON.stringify(adminContext.parseVariants(opaqueLegacy))), opaqueLegacy, 'El admin conserva como opaca una fila legacy sin color/talla pero con stock/foto.');
assert.deepEqual(JSON.parse(JSON.stringify(adminContext.hiddenAdminVariantsWithData(opaqueLegacy, [{ color: 'Menta', size: 'M', stock: 0 }]))), opaqueLegacy, 'La fila opaca no se puede guardar silenciosamente fuera del grid.');
const hiddenHexOnly = [{ color: 'Menta', size: 'XL', stock: 0, image_path: '', color_hex: '#123456' }];
assert.deepEqual(JSON.parse(JSON.stringify(adminContext.hiddenAdminVariantsWithData(hiddenHexOnly, [{ color: 'Menta', size: 'S', stock: 0 }]))), hiddenHexOnly, 'Un HEX oculto también requiere confirmación explícita.');

const added = JSON.parse(JSON.stringify(adminContext.addAdminColorVariants([], 'Azul petróleo', ['S', 'M'], '#2468AC')));
assert.deepEqual(added.map(v => [v.color, v.size, v.stock, v.color_hex]), [
  ['Azul petróleo', 'S', 0, '#2468ac'],
  ['Azul petróleo', 'M', 0, '#2468ac'],
]);
const newSize = JSON.parse(JSON.stringify(adminContext.defaultAdminColorVariant('Azul petróleo', 'L', added)));
assert.deepEqual(newSize, { color: 'Azul petróleo', size: 'L', stock: 0, image_path: '', color_hex: '#2468ac' });
const renamed = JSON.parse(JSON.stringify(adminContext.renameAdminColorVariants([
  { color: 'Azul petróleo', size: 'M', stock: 7, image_path: 'p/m.jpg', color_hex: '#2468ac' },
], 'ÁZUL PETRÓLEO', 'Menta')));
assert.deepEqual(renamed, [{ color: 'Menta', size: 'M', stock: 7, image_path: 'p/m.jpg', color_hex: '#2468ac' }]);
const recolored = JSON.parse(JSON.stringify(adminContext.setAdminColorHexInVariants(added, 'azul PETRÓLEO', '#db7799')));
assert.ok(recolored.every(v => v.color_hex === '#db7799'));
const cleared = JSON.parse(JSON.stringify(adminContext.setAdminColorHexInVariants(recolored, 'Azul petróleo', '')));
assert.ok(cleared.every(v => !Object.hasOwn(v, 'color_hex')));
assert.equal(adminContext.adminColorHasStock([{ color: 'Menta', size: 'S', stock: 1 }], 'menta'), true);
assert.equal(adminContext.adminColorHasStock([{ color: 'Menta', size: 'S', stock: 0 }], 'menta'), false);
const hiddenColor = [{ color: 'Menta', size: 'XL', stock: 5, image_path: 'products/synthetic/hidden.jpg', color_hex: '#00aa88' }];
assert.equal(adminContext.adminColorHasStock(hiddenColor, 'menta'), true, 'La guardia ve stock en una talla oculta.');
assert.equal(adminContext.adminColorHasPhoto(hiddenColor, 'menta'), true, 'La guardia detecta fotos de variantes.');
assert.deepEqual(JSON.parse(JSON.stringify(adminContext.hiddenAdminVariantsWithData(hiddenColor, [{ color: 'Menta', size: 'S', stock: 0 }]))), hiddenColor);
const legacyVariants = [{ color: '', size: 'M', stock: 4, image_path: 'products/synthetic/legacy-m.jpg' }];
const mappedLegacy = JSON.parse(JSON.stringify(adminContext.assignUncoloredAdminVariants(legacyVariants, 'Azul petróleo', ['M'], '#2468AC')));
assert.deepEqual(mappedLegacy, [{ color: 'Azul petróleo', size: 'M', stock: 4, image_path: 'products/synthetic/legacy-m.jpg', color_hex: '#2468ac' }]);
assert.deepEqual(JSON.parse(JSON.stringify(adminContext.hiddenAdminVariantsWithData(mappedLegacy, mappedLegacy))), []);
assert.equal(adminContext.uncoloredAdminVariantsHaveDuplicateSizes([
  { color: '', size: 'M', stock: 1 }, { color: 'Sin color', size: 'M', stock: 2 },
]), true, 'Los duplicados legacy no se fusionan silenciosamente.');
const aliasCollision = [
  { color: 'Azul', size: 'M', stock: 3, image_path: 'products/synthetic/blue-m.jpg' },
  { color: 'ÁZUL', size: 'M', stock: 4, image_path: 'products/synthetic/accent-blue-m.jpg', color_hex: '#123456' },
];
assert.equal(adminContext.adminVariantKeyCollisions(aliasCollision).length, 1, 'Aliases acentuados/espaciados equivalentes son una colisión antes de renombrar.');
assert.equal(adminContext.renameAdminColorVariants(aliasCollision, 'Azul', 'Menta'), null, 'Un renombre con colisión debe fallar, no devolver filas duplicadas.');
assert.equal(adminContext.addAdminColorVariants(aliasCollision, 'Naranja', ['M'], '#ee8844'), null, 'Una edición sobre aliases ambiguos queda bloqueada.');
const duplicateCollision = [
  { color: 'Menta', size: 'M', stock: 3, image_path: 'products/synthetic/menta-m.jpg' },
  { color: 'Menta', size: 'M', stock: 4, image_path: 'products/synthetic/menta-m-legacy.jpg', color_hex: '#123456' },
];
assert.equal(adminContext.adminVariantKeyCollisions(duplicateCollision).length, 1, 'Se detectan claves exactas que el Map colapsaría.');
assert.equal(adminContext.addAdminColorVariants(duplicateCollision, 'Naranja', ['M'], '#ee8844'), null, 'No se opera sobre un arreglo ya colisionado.');
assert.equal(adminContext.assignUncoloredAdminVariants([
  { color: '', size: 'M', stock: 4, image_path: 'products/synthetic/legacy-m.jpg' },
  { color: 'Azul petróleo', size: 'M', stock: 3, image_path: 'products/synthetic/current-m.jpg', color_hex: '#778899' },
], 'Azul petróleo', ['M'], '#2468AC'), null, 'El remapeo legacy no fusiona claves color/talla existentes.');

const collectedContext = vm.createContext({
  document: { querySelectorAll(selector) { return selector === '#variantEditorRows .variantAdminStock' ? stockRows : []; } },
  variantDraft: [{ color: 'Azul petróleo', size: 'M', stock: 3, image_path: 'products/synthetic/m.jpg', color_hex: '#2468ac' }],
  variantMemory: [],
  variantEditorCollisionError: '',
});
vm.runInContext([
  extractFunction(admin, 'variantKey'),
  extractFunction(admin, 'normalizeVariantText'),
  extractFunction(admin, 'normalizeAdminColorName'),
  extractFunction(admin, 'normalizeVariantHex'),
  extractFunction(admin, 'parseVariants'),
  extractFunction(admin, 'adminVariantKeyCollisions'),
  extractFunction(admin, 'adminVariantCollisionMessage'),
  extractFunction(admin, 'collectVariantDraft'),
].join('\n'), collectedContext);
const collected = JSON.parse(JSON.stringify(collectedContext.collectVariantDraft()));
assert.deepEqual(collected, [{ color: 'Azul petróleo', size: 'M', stock: 7, image_path: 'products/synthetic/m.jpg', color_hex: '#2468ac' }]);

const publicFunctions = ['normalizeText', 'normalizeVariantKeyText', 'parseVariantList', 'normalizeVariants', 'variantList', 'variantStock', 'colorStock', 'colorToCss'].map(name => extractFunction(storefront, name));
const publicContext = vm.createContext({});
vm.runInContext(publicFunctions.join('\n'), publicContext);
const publicVariants = JSON.parse(JSON.stringify(publicContext.normalizeVariants([
  { color: 'Menta', size: 'S', stock: 2, color_hex: '#B4C5D6' },
  { color: 'Menta', size: 'M', stock: 1, color_hex: 'url(https://invalid)' },
])));
assert.equal(publicVariants[0].color_hex, '#b4c5d6');
assert.equal(Object.hasOwn(publicVariants[1], 'color_hex'), false);
assert.equal(publicContext.variantStock({ quantity: 7, colors: ['Azul', 'ÁZUL'], variants: aliasCollision }, 'Azul', 'M'), 0, 'Un alias acentuado duplicado se marca no vendible, no se toma solo la primera fila.');
const repeatedSpaceAliases = [
  { color: 'Azul petróleo', size: 'M', stock: 3 },
  { color: 'ÁZUL   PETROLEO', size: 'M', stock: 4 },
];
assert.equal(adminContext.adminVariantKeyCollisions(repeatedSpaceAliases).length, 1, 'Admin canonicaliza acentos y múltiples espacios.');
assert.equal(publicContext.normalizeVariantKeyText(' ÁZUL   PETROLEO '), 'azul petroleo');
const repeatedSpaceProduct = { quantity: 7, colors: ['Azul petróleo', 'ÁZUL   PETROLEO'], variants: repeatedSpaceAliases };
assert.equal(publicContext.variantStock(repeatedSpaceProduct, 'Azul petróleo', 'M'), 0, 'Storefront no vende una variante cuyo alias normalizado colisiona en admin.');
assert.equal(publicContext.colorStock(repeatedSpaceProduct, 'azul petroleo'), 7, 'El total de color sigue sumando las filas, pero cada combinación ambigua queda no vendible.');
assert.equal(publicContext.variantStock({ quantity: 0, colors: ['Menta'], variants: [{ color: 'Menta', size: 'S', stock: 2 }] }, 'Menta', 'S'), 2, 'Una combinación no ambigua conserva su disponibilidad.');
assert.equal(publicContext.normalizeVariants([{ color: '', size: '', stock: 9, image_path: 'products/synthetic/unkeyed.jpg' }]).length, 0, 'La tienda no convierte una fila sin clave en una variante vendible.');
assert.equal(publicContext.colorToCss('Menta', { variants: [{ color: 'Menta', color_hex: '#AABBCC' }] }), '#aabbcc');
assert.equal(publicContext.colorToCss('ÁZUL   PETROLEO', { variants: [{ color: 'Azul petróleo', color_hex: '#2468AC' }] }), '#2468ac', 'La búsqueda del HEX usa la misma clave canónica.');
assert.equal(publicContext.colorToCss('Azul'), '#35a9e0', 'Los productos antiguos conservan el mapa/fallback existente.');
assert.doesNotMatch(publicContext.colorToCss('Menta', { variants: [{ color: 'Menta', color_hex: 'url(javascript:alert(1))' }] }), /url|javascript/i);
assert.match(storefront, /style="background:\$\{colorToCss\(c,p\)\}"/, 'El selector de la ficha usa el HEX del producto.');
assert.match(admin, /class="adminColorManagerName"/);
assert.match(admin, /id="adminNewColorPicker" type="color"/);
assert.match(admin, /id="adminNewColorHex" type="text"/);
assert.match(admin, /defaultAdminColorVariant\(colorValue,sz,prior\)/, 'Al agregar tallas, se hereda el HEX del color.');
assert.match(admin, /adminColorHasStock\(allVariants,name\)/, 'La eliminación admin consulta memoria y filas actuales.');
assert.match(admin, /hiddenAdminVariantsWithData\(variantMemory,variantDraft\)/, 'El guardado protege variantes con stock/fotos temporalmente ocultas.');
assert.match(admin, /hiddenHexOnly=.*normalizeVariantHex\(v\.color_hex\)/, 'El guardado solicita confirmación antes de descartar HEX oculto.');
assert.match(admin, /adminVariantKeyCollisions\(prior\)/, 'El editor bloquea alias normalizados antes de colapsar el JSONB.');
assert.match(admin, /assignUncoloredAdminVariants\(source,name,sizes,hex\)/, 'La primera variante con color asigna datos legacy solo tras consentimiento.');
assert.match(admin, /assignUncoloredAdminVariants\(source,selected\[0\]/, 'La selección de paleta reasigna variante legacy explícitamente.');
assert.match(admin, /#adminColorManager \.adminColorHexText/, 'El guardado valida HEX antes de Supabase.');
assert.match(admin, /return \{\.\.\.v,image_path:updates\[key\]\|\|v\.image_path\|\|''\}/, 'La subida de fotos conserva metadata HEX existente.');

const uiDependencies = [
  'variantKey', 'normalizeVariantText', 'normalizeVariantHex', 'parseVariants',
  'normalizeAdminColorName', 'readAdminColors', 'validAdminProductColorName',
  'renameAdminColorVariants', 'adminVariantKeyCollisions', 'adminVariantCollisionMessage',
  'adminColorHasStock', 'adminColorHasPhoto', 'adminColorHasHex', 'adminVariantHasProtectedData',
  'hiddenAdminVariantsWithData', 'uncoloredAdminVariants', 'uncoloredAdminVariantsHaveDuplicateSizes',
  'assignUncoloredAdminVariants', 'addAdminColorVariants', 'discardAdminColorVariants', 'collectVariantDraft',
];
function runAdminUi(handler, initial) {
  let rows = initial.rows.map(row => ({ dataset: { ...row.dataset }, value: String(row.value) }));
  const fields = initial.fields;
  const alerts = [], confirmations = [], renderCalls = [];
  const context = vm.createContext({
    document: { querySelectorAll(selector) { return selector === '#variantEditorRows .variantAdminStock' ? rows : []; } },
    variantDraft: JSON.parse(JSON.stringify(initial.variantDraft || [])),
    variantMemory: JSON.parse(JSON.stringify(initial.variantMemory || [])),
    variantEditorCollisionError: '',
    alert(message) { alerts.push(String(message)); },
    confirm(message) { confirmations.push(String(message)); return initial.confirmResult ?? true; },
  });
  context.$ = id => fields[id] || null;
  context.renderAdminColorPalette = () => renderCalls.push('palette');
  context.renderVariantEditor = list => {
    renderCalls.push('variants');
    rows = JSON.parse(JSON.stringify(list)).map(v => ({ dataset: { varColor: v.color || '', varSize: v.size || '' }, value: String(v.stock || 0) }));
  };
  context.updateAdminVariantTotal = () => renderCalls.push('total');
  vm.runInContext([...uiDependencies.map(name => extractFunction(admin, name)), extractFunction(admin, handler)].join('\n'), context);
  context[handler](...(initial.args || []));
  return { context, fields, alerts, confirmations, renderCalls };
}

const renderFields = { variantEditor: { style: {} }, variantEditorRows: { innerHTML: '' }, pColores: { value: 'Menta' }, pTallas: { value: 'M' } };
const collisionRender = vm.createContext({
  document: { querySelectorAll() { return []; } },
  variantDraft: [], variantMemory: aliasCollision, variantEditorCollisionError: '',
});
collisionRender.$ = id => renderFields[id] || null;
collisionRender.esc = value => String(value);
vm.runInContext([
  ...['variantKey', 'normalizeVariantText', 'normalizeAdminColorName', 'normalizeVariantHex', 'parseVariants', 'adminVariantKeyCollisions', 'adminVariantCollisionMessage', 'defaultAdminColorVariant', 'adminColorFallbackCss'].map(name => extractFunction(admin, name)),
  extractFunction(admin, 'renderVariantEditor'),
].join('\n'), collisionRender);
collisionRender.renderVariantEditor(collisionRender.variantMemory);
assert.equal(renderFields.variantEditor.style.display, 'block');
assert.match(renderFields.variantEditorRows.innerHTML, /role="alert"/);
assert.ok(collisionRender.variantEditorCollisionError, 'El render bloquea aliases acentuados equivalentes antes de construir Map/filas.');

adminContext.variantMemory = duplicateCollision;
adminContext.variantEditorCollisionError = '';
assert.deepEqual(JSON.parse(JSON.stringify(adminContext.collectVariantDraft())), duplicateCollision, 'collect preserva todas las filas en conflicto en vez de colapsar el Map.');
assert.equal(adminContext.variantMemory.length, 2);
assert.ok(adminContext.variantEditorCollisionError);

const hiddenRemovalFields = {
  pColores: { value: 'Menta' },
  colorPalette: { querySelectorAll() { return []; } },
};
const hiddenRemoval = runAdminUi('applyAdminColorPaletteSelection', {
  fields: hiddenRemovalFields,
  rows: [{ dataset: { varColor: 'Menta', varSize: 'S' }, value: '0' }],
  variantMemory: [{ color: 'Menta', size: 'XL', stock: 5, image_path: 'products/synthetic/hidden-xl.jpg' }],
});
assert.equal(hiddenRemoval.fields.pColores.value, 'Menta', 'La paleta revierte el intento de quitar un color con talla oculta en memoria.');
assert.ok(hiddenRemoval.alerts.some(message => message.includes('temporalmente oculta')));
assert.ok(hiddenRemoval.context.variantMemory.some(v => v.size === 'XL' && v.stock === 5));

const hexOnlyVariant = { color: 'Menta', size: 'XL', stock: 0, image_path: '', color_hex: '#123456' };
const removeHexCancelled = runAdminUi('removeAdminProductColor', {
  fields: { pColores: { value: 'Menta' }, pTallas: { value: 'S' } },
  rows: [{ dataset: { varColor: 'Menta', varSize: 'S' }, value: '0' }],
  variantMemory: [hexOnlyVariant], args: [{ dataset: { colorName: 'Menta' } }], confirmResult: false,
});
assert.equal(removeHexCancelled.confirmations.length, 1);
assert.match(removeHexCancelled.confirmations[0], /HEX propios/);
assert.equal(removeHexCancelled.fields.pColores.value, 'Menta', 'Cancelar conserva el color/HEX.');
assert.ok(removeHexCancelled.context.variantMemory.some(v => v.size === 'XL' && v.color_hex === '#123456'));
const removeHexConfirmed = runAdminUi('removeAdminProductColor', {
  fields: { pColores: { value: 'Menta' }, pTallas: { value: 'S' } },
  rows: [{ dataset: { varColor: 'Menta', varSize: 'S' }, value: '0' }],
  variantMemory: [hexOnlyVariant], args: [{ dataset: { colorName: 'Menta' } }], confirmResult: true,
});
assert.equal(removeHexConfirmed.fields.pColores.value, '', 'Solo la confirmación explícita quita el color.');
assert.equal(removeHexConfirmed.context.variantMemory.length, 0);

const renameCollisionFields = { pColores: { value: 'Azul, ÁZUL' } };
const renameInput = { dataset: { colorName: 'Azul' }, value: 'Menta' };
const renameCollision = runAdminUi('renameAdminProductColor', {
  fields: renameCollisionFields, rows: [], variantMemory: aliasCollision,
  args: [renameInput],
});
assert.equal(renameCollisionFields.pColores.value, 'Azul, ÁZUL');
assert.equal(renameInput.value, 'Azul', 'Renombrar alias colisionados restaura el campo original.');
assert.ok(renameCollision.alerts.some(message => message.includes('duplicada')));
assert.equal(renameCollision.context.variantMemory.length, 2);

function makeLegacyColorFields() {
  return {
    pColores: { value: '' }, pTallas: { value: 'M' }, pCantidad: { value: '4' },
    adminNewColorName: { value: 'Azul petróleo', focus() {} },
    adminNewColorHex: { value: '#2468AC', setCustomValidity() {}, reportValidity() {} },
    adminNewColorPicker: { value: '#2468ac' },
  };
}
const legacyPhoto = 'products/synthetic/legacy-m.jpg';
const legacyAdd = runAdminUi('addAdminProductColor', {
  fields: makeLegacyColorFields(),
  rows: [{ dataset: { varColor: '', varSize: 'M' }, value: '4' }],
  variantMemory: [{ color: '', size: 'M', stock: 4, image_path: legacyPhoto }],
});
assert.equal(legacyAdd.fields.pColores.value, 'Azul petróleo');
assert.deepEqual(JSON.parse(JSON.stringify(legacyAdd.context.variantDraft)), [
  { color: 'Azul petróleo', size: 'M', stock: 4, image_path: legacyPhoto, color_hex: '#2468ac' },
]);
assert.equal(legacyAdd.confirmations.length, 1, 'La reasignación de legacy requiere confirmación explícita.');

const legacyAddCancelled = runAdminUi('addAdminProductColor', {
  fields: makeLegacyColorFields(),
  rows: [{ dataset: { varColor: '', varSize: 'M' }, value: '4' }],
  variantMemory: [{ color: '', size: 'M', stock: 4, image_path: legacyPhoto }],
  confirmResult: false,
});
assert.equal(legacyAddCancelled.fields.pColores.value, '', 'Cancelar no añade color ni modifica el registro legacy.');
assert.ok(legacyAddCancelled.context.variantMemory.some(v => v.color === '' && v.size === 'M' && v.stock === 4 && v.image_path === legacyPhoto));

const legacyAddCollisionFields = makeLegacyColorFields();
const legacyAddCollision = runAdminUi('addAdminProductColor', {
  fields: legacyAddCollisionFields,
  rows: [
    { dataset: { varColor: '', varSize: 'M' }, value: '4' },
    { dataset: { varColor: 'Azul petróleo', varSize: 'M' }, value: '3' },
  ],
  variantMemory: [
    { color: '', size: 'M', stock: 4, image_path: legacyPhoto },
    { color: 'Azul petróleo', size: 'M', stock: 3, image_path: 'products/synthetic/blue-m.jpg', color_hex: '#778899' },
  ],
});
assert.equal(legacyAddCollision.fields.pColores.value, '', 'El remapeo legacy que chocaría no agrega ni renombra colores.');
assert.equal(legacyAddCollision.context.variantMemory.length, 2);
assert.deepEqual(JSON.parse(JSON.stringify(legacyAddCollision.context.variantMemory.map(v => [v.color, v.size, v.stock, v.image_path]))), [
  ['', 'M', 4, legacyPhoto], ['Azul petróleo', 'M', 3, 'products/synthetic/blue-m.jpg'],
]);
assert.ok(legacyAddCollision.alerts.some(message => message.includes('combinación color/talla duplicada')));

console.log('PASS variant HEX regression: collision guards, no Map data loss, legacy mapping, stock/photo protection, HEX validation, and public swatch.');
