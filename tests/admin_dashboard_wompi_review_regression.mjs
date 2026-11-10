import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const state = html.match(/const dashboardWompiReviewStateBySession=new Map\(\);/)?.[0];
const render = html.match(/function renderDashboardWompiReviewCount\(\)\{[\s\S]*?\n\}/)?.[0];
const load = html.match(/async function loadDashboardWompiReviewCount\(force=false\)\{[\s\S]*?\n\}/)?.[0];
const renderInicio = html.match(/function renderInicio\(\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(state && render && load && renderInicio, 'Dashboard declara el estado, renderer y loader de conciliación.');
assert.match(html, /id="dashboardWompiReviewCount"/);
assert.match(html, /id="dashboardWompiReviewMeta"/);
assert.match(renderInicio, /void loadDashboardWompiReviewCount\(\)/, 'La carga del conteo se conecta al render habitual.');
assert.match(load, /head:true/, 'La consulta no descarga filas.');
assert.match(load, /\.eq\('reconciliation_status','NEEDS_REVIEW'\)/, 'Cuenta únicamente casos marcados para revisión.');
assert.doesNotMatch(load, /\.(?:insert|update|upsert|delete|rpc)\s*\(/, 'El resumen no altera datos ni llama RPC mutantes.');

function makeHarness({ responses = [], authorized = true } = {}) {
  const calls = [];
  const elements = {
    dashboardWompiReviewCount: { textContent: '—' },
    dashboardWompiReviewMeta: { textContent: '' },
  };
  const context = {
    Map,
    Number,
    String,
    adminSessionUserId: 'synthetic-admin',
    adminAuthEpoch: 7,
    adminAuthOperationStillCurrent: (userId, epoch) => authorized && userId === 'synthetic-admin' && epoch === 7,
    sb: {
      from(table) {
        calls.push({ type: 'from', table });
        return {
          select(columns, options) {
            calls.push({ type: 'select', columns, options });
            return {
              eq(column, value) {
                calls.push({ type: 'eq', column, value });
                return Promise.resolve(responses.shift() ?? { count: 0, error: null });
              },
            };
          },
        };
      },
    },
    $: id => elements[id] ?? null,
  };
  vm.runInNewContext(`${state}\n${render}\n${load}`, context);
  return { context, calls, elements };
}

const success = makeHarness({ responses: [{ count: 2, error: null }, { count: 0, error: null }] });
assert.equal(await success.context.loadDashboardWompiReviewCount(), true);
assert.equal(success.elements.dashboardWompiReviewCount.textContent, '2');
assert.match(success.elements.dashboardWompiReviewMeta.textContent, /2 conciliaci[oó]n\(es\) requieren revisi[oó]n/);
assert.deepEqual(success.calls[0], { type: 'from', table: 'sirevya_wompi_inventory_reconciliation' });
assert.equal(success.calls[1].columns, 'transaction_id');
assert.equal(success.calls[1].options.count, 'exact');
assert.equal(success.calls[1].options.head, true);
assert.deepEqual(success.calls[2], { type: 'eq', column: 'reconciliation_status', value: 'NEEDS_REVIEW' });
await success.context.loadDashboardWompiReviewCount();
assert.equal(success.calls.filter(call => call.type === 'from').length, 1, 'No repite la consulta en cada render.');
await success.context.loadDashboardWompiReviewCount(true);
assert.equal(success.elements.dashboardWompiReviewCount.textContent, '0');
assert.match(success.elements.dashboardWompiReviewMeta.textContent, /No hay conciliaciones/);
assert.equal(success.calls.filter(call => call.type === 'from').length, 2, 'El botón permite refrescar bajo demanda.');

const failed = makeHarness({ responses: [{ count: null, error: { message: 'synthetic permission failure' } }] });
assert.equal(await failed.context.loadDashboardWompiReviewCount(), false);
assert.equal(failed.elements.dashboardWompiReviewCount.textContent, '—', 'Un error no se convierte en cero.');
assert.match(failed.elements.dashboardWompiReviewMeta.textContent, /no se asume cero/);
assert.doesNotMatch(failed.elements.dashboardWompiReviewMeta.textContent, /synthetic permission failure/i, 'No expone errores internos.');

const stale = makeHarness({ authorized: false });
assert.equal(await stale.context.loadDashboardWompiReviewCount(), false);
assert.equal(stale.calls.length, 0, 'La sesión obsoleta no consulta.');
assert.equal(stale.elements.dashboardWompiReviewCount.textContent, '—');

console.log('admin_dashboard_wompi_review_regression: PASS');
