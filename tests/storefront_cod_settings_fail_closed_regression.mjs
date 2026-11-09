import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const match = html.match(/^async function refreshCODPaymentSettings\(\{silent=true\}=\{\}\)\{[\s\S]*?^\}/m);
assert.ok(match, 'refreshCODPaymentSettings actual presente');

async function runCase({response, modalOpen = false}) {
  const calls = {rpc: 0, sync: 0, update: 0, warn: 0, syncedEnabled: null, syncedCities: null, rpcName: null};
  let context;
  const sandbox = {
    sb: {
      rpc: async name => {
        calls.rpc += 1;
        calls.rpcName = name;
        return response;
      }
    },
    codPaymentEnabled: true,
    codAllowedCities: ['cali'],
    codPaymentSettingsLoaded: false,
    codPaymentSettingsPromise: null,
    syncPaymentOptions: () => {
      calls.sync += 1;
      calls.syncedEnabled = context.codPaymentEnabled;
      calls.syncedCities = Array.from(context.codAllowedCities);
    },
    updateShipping: () => { calls.update += 1; },
    $(id) {
      if (id !== 'checkoutModal') return null;
      return {classList: {contains: name => name === 'open' && modalOpen}};
    },
    console: {warn: () => { calls.warn += 1; }}
  };
  context = vm.createContext(sandbox);
  vm.runInContext(match[0], context);
  const result = await context.refreshCODPaymentSettings({silent: false});
  return {context, calls, result};
}

const networkFailure = await runCase({response: {data: null, error: new Error('synthetic network failure')}, modalOpen: true});
assert.equal(networkFailure.result, false);
assert.equal(networkFailure.context.codPaymentEnabled, false, 'RPC error fails closed');
assert.deepEqual(Array.from(networkFailure.context.codAllowedCities), [], 'No city is assumed allowed on RPC error');
assert.equal(networkFailure.context.codPaymentSettingsLoaded, false);
assert.equal(networkFailure.calls.rpcName, 'get_public_storefront_cod_settings');
assert.equal(networkFailure.calls.rpc, 1);
assert.equal(networkFailure.calls.sync, 1);
assert.equal(networkFailure.calls.syncedEnabled, false, 'UI sync receives disabled state');
assert.deepEqual(networkFailure.calls.syncedCities, []);
assert.equal(networkFailure.calls.update, 1, 'Open checkout refreshes after settings failure');
assert.equal(networkFailure.calls.warn, 1);

const malformedPayload = await runCase({response: {data: {enabled: true, allowed_cities: null}, error: null}});
assert.equal(malformedPayload.result, false);
assert.equal(malformedPayload.context.codPaymentEnabled, false, 'Malformed response fails closed');
assert.deepEqual(Array.from(malformedPayload.context.codAllowedCities), []);

const enabledResponse = await runCase({response: {data: {enabled: true, allowed_cities: [' Cali ', 'Santiago de Cali']}, error: null}});
assert.equal(enabledResponse.result, true);
assert.equal(enabledResponse.context.codPaymentEnabled, true, 'Valid configured COD remains enabled');
assert.deepEqual(Array.from(enabledResponse.context.codAllowedCities), ['cali', 'santiago de cali']);
assert.equal(enabledResponse.calls.syncedEnabled, true);

const disabledResponse = await runCase({response: {data: {enabled: false, allowed_cities: ['Cali']}, error: null}});
assert.equal(disabledResponse.result, true, 'A valid explicit disabled configuration is still loaded');
assert.equal(disabledResponse.context.codPaymentEnabled, false, 'Explicit server disable remains authoritative');
assert.equal(disabledResponse.calls.syncedEnabled, false);

console.log('storefront_cod_settings_fail_closed_regression: PASS (synthetic RPC failure/malformed/valid responses; no network, order, or payment)');
