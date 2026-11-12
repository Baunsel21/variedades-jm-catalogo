import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const index = readFileSync(new URL('index.html', root), 'utf8');
const admin = readFileSync(new URL('admin.html', root), 'utf8');
const migration = readFileSync(new URL('supabase/migrations/20261112010000_storefront_floating_promotions.sql', root), 'utf8');

const normalizerStart = index.indexOf('function normalizeFloatingPromoCampaign(payload){');
const normalizerEnd = index.indexOf('\nfunction floatingPromoCampaignCategoriesExist', normalizerStart);
assert.ok(normalizerStart >= 0 && normalizerEnd > normalizerStart, 'normalizador de campaña pública presente');
const normalizerSource = index.slice(normalizerStart, normalizerEnd);

const buttons = [
  { key: 'best_selling', label: 'Más vendido', icon: '👑', background_color: '#fff8e7', text_color: '#5d4012', accent_color: '#c6a15b', appearance: 'gold', target_category: 'Accesorios', sort_order: 1 },
  { key: 'trending', label: 'Tendencia', icon: '🔥', background_color: '#fff8e7', text_color: '#5d4012', accent_color: '#c6a15b', appearance: 'solid', target_category: 'Pulseras', sort_order: 2 },
  { key: 'top_product', label: 'Producto Top', icon: '⭐', background_color: '#fff8e7', text_color: '#5d4012', accent_color: '#c6a15b', appearance: 'outline', target_category: 'Collares', sort_order: 3 },
];
function normalize(payload, { catalogLoaded = true } = {}) {
  const context = vm.createContext({
    FLOATING_PROMO_KEYS: ['best_selling', 'trending', 'top_product'],
    productos: [
      { category: 'Accesorios' },
      { category: 'Pulseras' },
      { category: 'Collares' },
    ],
    catalogInitialLoadComplete: catalogLoaded,
    input: payload,
  });
  vm.runInContext(`${normalizerSource}\nglobalThis.output = normalizeFloatingPromoCampaign(input);`, context);
  return context.output;
}

const valid = normalize({ success: true, campaign: { enabled: true, interval_seconds: 20, visible_seconds: 3, campaign_version: 4, buttons: [...buttons].reverse() } });
assert.equal(valid.enabled, true);
assert.equal(valid.campaign_version, '4');
assert.deepEqual(Array.from(valid.buttons, button => button.key), ['best_selling', 'trending', 'top_product'], 'orden final por sort_order');
assert.equal(normalize({ success: false, campaign: { enabled: true, buttons } }), null, 'respuesta RPC fallida no se muestra');
assert.equal(normalize({ success: true, campaign: { enabled: true, interval_seconds: 20, visible_seconds: 3, campaign_version: 4, buttons: buttons.map((button, i) => i === 0 ? { ...button, target_category: 'No existe' } : button) } }), null, 'destino inexistente falla cerrado tras cargar el catálogo');
assert.equal(normalize({ success: true, campaign: { enabled: true, interval_seconds: 20, visible_seconds: 3, campaign_version: 4, buttons: buttons.map((button, i) => i === 0 ? { ...button, target_category: 'Aún no cargada' } : button) } }, { catalogLoaded: false })?.enabled, true, 'una respuesta temprana espera a la carga del catálogo y se revalida antes de mostrarse');
assert.equal(normalize({ success: true, campaign: { enabled: true, interval_seconds: 20, visible_seconds: 3, campaign_version: 4, buttons: buttons.map((button, i) => i === 1 ? { ...button, accent_color: 'url(javascript:alert(1))' } : button) } }), null, 'color no HEX falla cerrado');
assert.equal(normalize({ success: true, campaign: { enabled: true, interval_seconds: 20, visible_seconds: 3, campaign_version: 4, buttons: buttons.map((button, i) => i === 2 ? { ...button, sort_order: 2 } : button) } }), null, 'orden duplicado falla cerrado');
assert.equal(normalize({ success: true, campaign: { enabled: false, interval_seconds: 20, visible_seconds: 3, campaign_version: 0, buttons: buttons.map(button => ({ ...button, target_category: '' })) } })?.enabled, false, 'configuración de inicio permanece apagada');

assert.equal((index.match(/id="floatingPromoWidget"/g) || []).length, 1, 'un solo nodo flotante global');
function cssBlock(selector, predicate = () => true) {
  return [...index.matchAll(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^}]*}`, 'g'))]
    .map(match => match[0]).reverse().find(predicate) || '';
}
const whatsappFloatCss = cssBlock('.waHelpFloat{', block => block.includes('width:102px'));
const promoWidgetCss = cssBlock('.floatingPromoWidget{', block => block.includes('width:102px'));
const promoActionCss = cssBlock('.floatingPromoAction{', block => block.includes('width:102px'));
assert.match(whatsappFloatCss, /width:102px;height:40px;min-height:40px/, 'WhatsApp conserva su caja compacta de escritorio');
assert.match(promoActionCss, /width:102px;height:40px;min-width:102px;min-height:40px/, 'cada botón de campaña iguala WhatsApp en escritorio');
assert.match(promoWidgetCss, /right:max\(12px,env\(safe-area-inset-right\)\);bottom:calc\(max\(12px,env\(safe-area-inset-bottom\)\) \+ 46px\)/, 'la campaña queda justo encima de WhatsApp y alineada a la derecha');
assert.match(index, /@media\(max-width:390px\)[\s\S]*\.floatingPromoWidget\{[^}]*width:98px[\s\S]*\.floatingPromoAction\{[^}]*width:98px[^}]*height:38px/, 'la caja compartida se adapta a móvil');
assert.equal((admin.match(/class="floatingPromoAdminButton"/g) || []).length, 3, 'admin configura exactamente tres botones');
assert.match(admin, /sb\.rpc\('get_public_storefront_floating_promotions'\)/);
assert.match(admin, /20261112010000_storefront_floating_promotions\.sql/);
assert.match(admin, /el formulario queda bloqueado y no muestra valores simulados/);
assert.match(admin, /floatingPromotionsSettingsLoaded=false;setFloatingPromoFormDisabled\(true\)/, 'un getter ausente deja el formulario cerrado sin crear una campaña local');
assert.match(admin, /clearFloatingPromoSettingsForm\(\);\s*const missingRpc/, 'un error de carga borra los valores no confirmados en Supabase');
assert.match(index, /get_public_storefront_floating_promotions/);
assert.match(index, /FLOATING_PROMO_DISMISSAL_KEY='sirevya_floating_promo_dismissed_v1'/);
assert.match(index, /localStorage\.setItem\(FLOATING_PROMO_DISMISSAL_KEY,String\(version\)\)/, 'el cierre persiste por versión de campaña');
assert.match(index, /if\(floatingPromoIsBlocked\(\)\)/, 'no aparece sobre checkout, carrito, ficha o popup estacional');
assert.match(index, /selectCategory\(currentOption\.value\)/, 'el botón usa el enrutador existente de categorías');
assert.match(index, /\.floatingPromoActions\{display:flex;flex-direction:column;align-items:stretch/, 'Más vendido, Tendencia y Producto Top se apilan como botones independientes');
assert.match(index, /\.floatingPromoAction\{[^}]*display:flex;flex-direction:row;align-items:center;justify-content:flex-start/, 'cada CTA muestra icono a la izquierda y etiqueta alineada');
assert.doesNotMatch(index, /\.floatingPromoActions\{display:grid;grid-template-columns:repeat\(3/, 'el widget no vuelve al diseño de tres columnas');
assert.match(index, /prefers-reduced-motion:reduce/, 'los estilos respetan movimiento reducido');
assert.match(index, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)!important/, 'beneficios del footer se mantienen en cuatro columnas en escritorio');
assert.match(index, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/, 'beneficios del footer pasan a dos columnas en móvil');
assert.match(index, /grid-template-columns:1fr!important/, 'beneficios del footer pasan a una columna en pantallas muy estrechas');
assert.match(index, /<div class="name">\$\{esc\(elegantProductTitle\(p\.name\)\)\}<\/div>/, 'tarjeta usa la presentación refinada sin mutar el nombre almacenado');
const renderStart = index.indexOf('function renderFloatingPromoWidget(campaign){');
const renderEnd = index.indexOf('\nfunction scheduleFloatingPromoCycle', renderStart);
assert.ok(renderStart >= 0 && renderEnd > renderStart);
assert.doesNotMatch(index.slice(renderStart, renderEnd), /innerHTML/, 'el copy administrable se inserta como texto, no HTML');
assert.doesNotMatch(index.slice(renderStart, renderEnd), /Descubre el catálogo/, 'el diseño del widget conserva solo las tres filas y la X');
assert.match(index, /floatingPromoCampaignCategoriesExist\(campaign\)/, 'categorías vuelven a validarse antes de mostrar la campaña');
assert.match(index, /floatingPromoFooterObserver/, 'un observer retira la campaña al entrar al footer');

const blockerStart = index.indexOf('function floatingPromoIsBlocked(){');
const blockerEnd = index.indexOf('\nfunction renderFloatingPromoWidget', blockerStart);
assert.ok(blockerStart >= 0 && blockerEnd > blockerStart, 'bloqueador de widget presente');
const blockerSource = index.slice(blockerStart, blockerEnd);
function isFloatingPromoBlockedForFooter(footerRect) {
  const elements = {
    contactanos: footerRect ? { hidden: false, getBoundingClientRect: () => footerRect } : null,
    seasonalPromoOverlay: { hidden: true },
  };
  const blockerContext = vm.createContext({
    document: { visibilityState: 'visible' },
    catalogInitialLoadComplete: true,
    window: { innerHeight: 800 },
    $(id) { return elements[id] || null; },
    floatingPromoModalOpen() { return false; },
  });
  vm.runInContext(`${blockerSource}\nglobalThis.blocked = floatingPromoIsBlocked();`, blockerContext);
  return blockerContext.blocked;
}
assert.equal(isFloatingPromoBlockedForFooter({ top: 700, bottom: 950 }), true, 'widget oculto al entrar al footer');
assert.equal(isFloatingPromoBlockedForFooter({ top: 900, bottom: 1200 }), false, 'widget permitido cuando el footer queda bajo el viewport');
assert.equal(isFloatingPromoBlockedForFooter(null), false, 'sin footer visible el ciclo normal no se bloquea');

assert.match(admin, /get_public_storefront_floating_promotions/);
assert.match(admin, /admin_save_storefront_floating_promotions/);
assert.match(admin, /adminAuthOperationStillCurrent\(userId,authEpoch\)/, 'lectura/escritura se descartan si cambia la sesión');
assert.match(admin, /el formulario permanece bloqueado/, 'RPC no disponible deja controles fail-closed');
assert.match(admin, /floating-promotions-changed/, 'admin anuncia los cambios guardados al catálogo');
assert.match(migration, /ALTER TABLE public\.storefront_promotion_settings[\s\S]*ADD COLUMN IF NOT EXISTS floating_buttons_config jsonb/);
assert.doesNotMatch(migration, /CREATE TABLE/i, 'la configuración reutiliza el singleton existente y no crea una tabla duplicada');
assert.match(migration, /auth\.uid\(\) IS DISTINCT FROM v_admin_user_id/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.admin_save_storefront_floating_promotions\(jsonb\) FROM PUBLIC, anon, authenticated/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_save_storefront_floating_promotions\(jsonb\) TO authenticated/);
assert.match(migration, /v_enabled AND \(v_category = '' OR NOT EXISTS/);

const clearStart = admin.indexOf('function clearFloatingPromoSettingsForm(){');
const clearEnd = admin.indexOf('\nfunction floatingPromoProductCategories', clearStart);
assert.ok(clearStart >= 0 && clearEnd > clearStart, 'helper de borrado para estado desconocido presente');
const unavailableFields = [
  { type: 'checkbox', checked: true, hidden: false },
  { type: 'text', value: 'Más vendido', hidden: false },
  { type: 'number', value: '20', hidden: false },
  { type: 'color', value: '#fff8e7', hidden: false },
  { type: 'select-one', tagName: 'SELECT', value: 'Accesorios', selectedIndex: 1, hidden: false },
];
const unavailableBox = {
  attributes: {},
  setAttribute(name, value) { this.attributes[name] = value; },
  querySelectorAll(selector) { assert.equal(selector, 'input,select'); return unavailableFields; },
};
const clearContext = vm.createContext({ $(id) { return id === 'floatingPromotionsSettingsBox' ? unavailableBox : null; } });
vm.runInContext(`${admin.slice(clearStart, clearEnd)}\nglobalThis.clearUnavailable = clearFloatingPromoSettingsForm;`, clearContext);
clearContext.clearUnavailable();
assert.equal(unavailableBox.attributes['data-settings-unavailable'], 'true');
assert.equal(unavailableFields[0].checked, false);
assert.equal(unavailableFields[1].value, '');
assert.equal(unavailableFields[2].value, '');
assert.equal(unavailableFields[3].hidden, true, 'sin datos cargados no se muestra un color predeterminado como persistido');
assert.equal(unavailableFields[4].value, '');
assert.equal(unavailableFields[4].selectedIndex, -1);

const adminLoadStart = admin.indexOf('async function loadFloatingPromotionsAdmin(showStatus=true){');
const adminLoadEnd = admin.indexOf('\nasync function saveFloatingPromotionsAdmin', adminLoadStart);
assert.ok(adminLoadStart >= 0 && adminLoadEnd > adminLoadStart, 'loader admin de campaña presente');
const adminLoadSource = admin.slice(adminLoadStart, adminLoadEnd);
assert.match(adminLoadSource, /requestToken===floatingPromotionsRequestToken/, 'el token descarta lecturas superadas');
assert.match(adminLoadSource, /if\(!hadSettings\)clearFloatingPromoSettingsForm\(\)/, 'la carga inicial borra los defaults antes de consultar Supabase');
assert.match(admin.slice(admin.indexOf('async function saveFloatingPromotionsAdmin'), admin.indexOf('function seasonalPromoFieldValue')),
  /floatingPromotionsRequestToken\+\+/, 'guardar invalida cualquier respuesta de lectura pendiente');
assert.match(admin.slice(admin.indexOf('function lockAdminPanel'), admin.indexOf('function setAdmin')), /floatingPromotionsRequestToken\+\+/,
  'cerrar sesión invalida cargas pendientes');

const pendingCampaignReads = [];
const appliedCampaignVersions = [];
const campaignRequestContext = vm.createContext({
  adminSessionUserId: 'admin-user',
  adminAuthEpoch: 7,
  adminSessionAuthorized: true,
  floatingPromotionsSettingsLoaded: false,
  floatingPromotionsRequestToken: 0,
  sb: { rpc: () => new Promise(resolve => pendingCampaignReads.push(resolve)) },
  adminAuthOperationStillCurrent: (userId, epoch) => userId === 'admin-user' && epoch === 7,
  setFloatingPromoFormDisabled() {},
  clearFloatingPromoSettingsForm() {},
  setFloatingPromoStatus() {},
  applyFloatingPromoSettings(campaign) { appliedCampaignVersions.push(Number(campaign.campaign_version)); },
});
vm.runInContext(`${adminLoadSource}\nglobalThis.loadCampaign = loadFloatingPromotionsAdmin;`, campaignRequestContext);
const firstCampaignLoad = campaignRequestContext.loadCampaign(false);
const secondCampaignLoad = campaignRequestContext.loadCampaign(false);
assert.equal(pendingCampaignReads.length, 2);
pendingCampaignReads[0]({ data: { success: true, campaign: { campaign_version: 1 } }, error: null });
assert.equal(await firstCampaignLoad, false, 'la primera respuesta vieja se descarta');
assert.deepEqual(appliedCampaignVersions, [], 'la respuesta superada no pisa el formulario');
pendingCampaignReads[1]({ data: { success: true, campaign: { campaign_version: 2 } }, error: null });
assert.equal(await secondCampaignLoad, true, 'la última lectura válida aplica');
assert.deepEqual(appliedCampaignVersions, [2]);
assert.equal(campaignRequestContext.floatingPromotionsSettingsLoaded, true);

console.log('floating_promotions_ui_regression: PASS (three buttons, categories, dismissal, fail-closed, layout and admin load race)');
