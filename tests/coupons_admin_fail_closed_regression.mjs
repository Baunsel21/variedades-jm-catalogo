import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');

function extractAsyncFunction(name) {
  const marker = `async function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Falta ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const character = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') quote = character;
    else if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`${name} no tiene cierre`);
}

const loadSource = extractAsyncFunction('loadStorefrontCouponsAdmin');
const saveSource = extractAsyncFunction('saveStorefrontCoupon');

function makeContext({ rpc, live }) {
  const disabledEvents = [];
  const statuses = [];
  let renders = 0;
  const calls = [];
  const context = vm.createContext({
    adminSessionUserId: 'synthetic-admin',
    adminAuthEpoch: 7,
    adminAuthOperationStillCurrent: (userId, epoch) => userId === live.userId && epoch === live.epoch,
    storefrontCouponsAdmin: [],
    storefrontCouponsAdminLoaded: false,
    storefrontCouponSaving: false,
    storefrontCouponEditingId: '',
    STOREFRONT_COUPON_FORM_IDS: [],
    sb: {
      async rpc(name, args) {
        calls.push({ name, args });
        return rpc(name, args);
      },
    },
    setStorefrontCouponFormDisabled(disabled) { disabledEvents.push(Boolean(disabled)); },
    renderStorefrontCouponsAdminList() { renders += 1; },
    setStorefrontCouponsAdminStatus(message, kind) { statuses.push({ message: String(message), kind }); },
  });
  vm.runInContext(`${loadSource}\n${saveSource}`, context);
  return { context, disabledEvents, statuses, calls, get renders() { return renders; } };
}

const missingLive = { userId: 'synthetic-admin', epoch: 7 };
const missingRpc = makeContext({
  live: missingLive,
  rpc: async () => ({ data: null, error: { message: 'PGRST202 function missing' } }),
});
assert.equal(await missingRpc.context.loadStorefrontCouponsAdmin(true), false);
assert.equal(missingRpc.context.storefrontCouponsAdminLoaded, false);
assert.equal(JSON.stringify(missingRpc.context.storefrontCouponsAdmin), '[]');
assert.deepEqual(missingRpc.disabledEvents, [true, true], 'los controles quedan deshabilitados antes y después de un fallo');
assert.match(missingRpc.statuses.at(-1).message, /controles siguen deshabilitados/);
assert.equal(missingRpc.calls.length, 1);

const successLive = { userId: 'synthetic-admin', epoch: 7 };
const success = makeContext({
  live: successLive,
  rpc: async () => ({ data: [], error: null }),
});
assert.equal(await success.context.loadStorefrontCouponsAdmin(true), true);
assert.equal(success.context.storefrontCouponsAdminLoaded, true);
assert.deepEqual(success.disabledEvents, [true, false]);
assert.match(success.statuses.at(-1).message, /límites de uso se vuelven a validar en el servidor/);

let resolveDelayed;
const delayedLive = { userId: 'synthetic-admin', epoch: 7 };
const delayed = makeContext({
  live: delayedLive,
  rpc: () => new Promise(resolve => { resolveDelayed = resolve; }),
});
const delayedLoad = delayed.context.loadStorefrontCouponsAdmin(true);
delayedLive.epoch += 1;
resolveDelayed({ data: [{ id: 'synthetic-coupon' }], error: null });
assert.equal(await delayedLoad, false);
assert.equal(delayed.context.storefrontCouponsAdminLoaded, false);
assert.equal(JSON.stringify(delayed.context.storefrontCouponsAdmin), '[]');
assert.equal(delayed.renders, 1, 'la respuesta tardía no vuelve a renderizar después del cambio de sesión');
assert.equal(delayed.statuses.at(-1).message, 'Cargando cupones…');
assert.equal(await delayed.context.saveStorefrontCoupon(), false, 'una sesión obsoleta no puede guardar');
assert.equal(delayed.calls.length, 1, 'la llamada save no alcanza el RPC tras el cambio de sesión');

console.log('PASS coupons_admin_fail_closed_regression: RPC ausente deshabilita, carga válida habilita y la sesión obsoleta no actualiza ni guarda.');
