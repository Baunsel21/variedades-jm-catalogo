import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const admin = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20261116020000_safe_financial_history_archive.sql', import.meta.url), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Existe ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0; let quote = ''; let escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const c = source[i];
    if (quote) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth += 1;
    if (c === '}') { depth -= 1; if (!depth) return source.slice(start, i + 1); }
  }
  throw new Error(`No se pudo cerrar ${name}`);
}

const context = vm.createContext({ productos: [{ category: 'CORSET' }], catalogInitialLoadComplete: true });
vm.runInContext(`const FLOATING_PROMO_KEYS=['best_selling','trending','top_product'];${extractFunction(index, 'normalizeFloatingPromoCampaign')}`, context);
const base = {
  success: true,
  campaign: {
    enabled: true, interval_seconds: 10, visible_seconds: 3, campaign_version: 1,
    buttons: [
      { key: 'best_selling', label: 'Más vendido', icon: '👑', target_category: 'CORSET', sort_order: 1, appearance: 'gold', background_color: '#fff8e7', text_color: '#5d4012', accent_color: '#c6a15b' },
      { key: 'trending', label: 'Tendencia', icon: '🔥', target_category: 'CORSET', sort_order: 2, appearance: 'gold', background_color: '#fff8e7', text_color: '#5d4012', accent_color: '#c6a15b' },
      { key: 'top_product', label: 'Producto Top', icon: '⭐', target_category: 'CORSET', sort_order: 3, appearance: 'gold', background_color: '#fff8e7', text_color: '#5d4012', accent_color: '#c6a15b' },
    ],
  },
};
for (let mask = 0; mask < 8; mask += 1) {
  const payload = JSON.parse(JSON.stringify(base));
  payload.campaign.buttons.forEach((button, index) => { button.enabled = Boolean(mask & (1 << index)); });
  const normalized = context.normalizeFloatingPromoCampaign(payload);
  assert.ok(normalized, `La combinación ${mask} debe ser válida`);
  assert.deepEqual(JSON.parse(JSON.stringify(normalized.buttons.map(button => button.enabled))), [0, 1, 2].map(index => Boolean(mask & (1 << index))));
}
assert.match(admin, /id="floatingPromoEnabled"/);
assert.equal((admin.match(/data-floating-promo-key="(?:best_selling|trending|top_product)"/g) || []).length, 3);
assert.match(admin, /admin_save_storefront_floating_promotions/);

for (const token of ['admin_preview_history_archive', 'admin_archive_sales', 'admin_archive_expenses', 'admin_restore_latest_expenses_archive', 'admin_history_actions']) assert.match(migration, new RegExp(token));
assert.match(migration, /No elimina filas, no usa CASCADE/);
assert.match(migration, /p_confirmation text/);
assert.match(admin, /previewHistoryArchive/);
assert.match(admin, /exportExpensesReportCSV/);
assert.match(admin, /Los gastos contables no se eliminan/);
console.log('floating_promotions_and_history_regression: PASS (8 combinaciones, persistencia por RPC, previsualización, exportación y archivado seguro).');
