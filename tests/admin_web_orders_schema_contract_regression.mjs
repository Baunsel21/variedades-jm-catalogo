import assert from 'node:assert/strict';
import fs from 'node:fs';

const admin = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const match = admin.match(/sb\.from\('web_orders'\)\.select\('([^']+)'\)/);
assert.ok(match, 'El dashboard debe tener una consulta explícita de web_orders');

const selected = match[1].split(',').map((column) => column.trim()).filter(Boolean);
assert.deepEqual(selected, ['id', 'status', 'created_at', 'total', 'payment_method']);
for (const removed of ['payment_status', 'payment_state', 'wompi_status']) {
  assert.equal(selected.includes(removed), false, `No debe consultar ${removed} en web_orders`);
}

console.log('admin_web_orders_schema_contract_regression: PASS');
