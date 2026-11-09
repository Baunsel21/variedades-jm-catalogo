import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const admin = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const extract = (pattern, message) => {
  const source = admin.match(pattern)?.[0];
  assert.ok(source, message);
  return source;
};
const run = (source, globals = {}) => {
  const context = vm.createContext(globals);
  new vm.Script(source).runInContext(context);
  return context;
};

const authListenerSource = extract(
  /function ensureAdminAuthClient\(\)\{[\s\S]*?\n\}/,
  'Debe existir el listener de eventos Auth administrativo',
);
const startAppSource = extract(
  /async function startApp\(\)\{[\s\S]*?\n\}/,
  'Debe existir el inicio del panel con validación de identidad',
);

function createAuthEventHarness({ userId = '', authorized = false, recoveryMode = false } = {}) {
  const listeners = [];
  const timers = [];
  const effects = [];
  let context;
  context = run(authListenerSource, {
    sb: {
      auth: {
        onAuthStateChange(callback) {
          listeners.push(callback);
          return { data: { subscription: { id: 'synthetic-subscription' } } };
        },
      },
    },
    adminAuthSubscription: null,
    adminSessionAuthorized: authorized,
    adminSessionUserId: userId,
    adminPasswordRecoveryMode: recoveryMode,
    lockAdminPanel(message) {
      effects.push({ type: 'lock', message });
      context.adminSessionAuthorized = false;
      context.adminSessionUserId = '';
      context.adminPasswordRecoveryMode = false;
    },
    startApp() {
      effects.push({ type: 'startApp' });
    },
    revalidateAdminAuthorization() {
      effects.push({ type: 'revalidate' });
    },
    setTimeout(callback, delay) {
      assert.equal(delay, 0, 'El trabajo Auth se difiere fuera del callback');
      timers.push(callback);
      return timers.length;
    },
  });
  context.ensureAdminAuthClient();
  assert.equal(listeners.length, 1, 'Registra un solo listener Auth');
  return { context, listener: listeners[0], timers, effects };
}

const recovery = createAuthEventHarness();
recovery.listener('PASSWORD_RECOVERY', { user: { id: 'synthetic-admin-A' } });
assert.equal(recovery.context.adminPasswordRecoveryMode, true, 'PASSWORD_RECOVERY activa el modo de recuperación');
assert.equal(recovery.effects.length, 0, 'El callback no inicia el panel de forma síncrona');
assert.equal(recovery.timers.length, 1, 'El inicio del panel queda diferido');
recovery.timers.shift()();
assert.deepEqual(recovery.effects, [{ type: 'startApp' }], 'El callback diferido inicia la validación normal del panel');

const signedOut = createAuthEventHarness({ userId: 'synthetic-admin-B', authorized: true, recoveryMode: true });
signedOut.listener('SIGNED_OUT', null);
assert.deepEqual(signedOut.effects, [{ type: 'lock', message: 'Sesión cerrada. Vuelve a entrar.' }], 'SIGNED_OUT bloquea el panel');
assert.equal(signedOut.context.adminSessionAuthorized, false);
assert.equal(signedOut.context.adminSessionUserId, '');
assert.equal(signedOut.context.adminPasswordRecoveryMode, false);
assert.equal(signedOut.timers.length, 0, 'SIGNED_OUT no vuelve a iniciar el panel');

const staleAccountEvent = createAuthEventHarness({ userId: 'synthetic-admin-B', authorized: true });
staleAccountEvent.listener('SIGNED_IN', { user: { id: 'synthetic-admin-A' } });
assert.deepEqual(
  staleAccountEvent.effects,
  [{ type: 'lock', message: 'La cuenta cambió. Validando autorización…' }],
  'Un evento tardío de otra cuenta primero bloquea el estado actual',
);
assert.equal(staleAccountEvent.context.adminSessionAuthorized, false, 'El evento tardío no autoriza directamente el panel');
assert.equal(staleAccountEvent.context.adminSessionUserId, '', 'El evento tardío no sustituye la identidad guardada');
assert.equal(staleAccountEvent.timers.length, 1, 'Cualquier continuación queda diferida');

const firstUserRead = startAppSource.indexOf('await sb.auth.getUser()');
const roleRead = startAppSource.indexOf("await sb.rpc('is_store_admin')");
const confirmedUserRead = startAppSource.indexOf('await sb.auth.getUser()', firstUserRead + 1);
const panelVisible = startAppSource.indexOf('$("loginScreen").classList.add("hidden")');
assert.ok(
  firstUserRead >= 0 && roleRead > firstUserRead && confirmedUserRead > roleRead && panelVisible > confirmedUserRead,
  'El inicio diferido vuelve a leer usuario, rol y usuario confirmado antes de mostrar el panel',
);

console.log('OK admin_account_auth_events_regression: recovery diferido, logout fail-closed y evento de cuenta obsoleta bajo mocks.');
