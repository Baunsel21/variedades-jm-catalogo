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

const passwordValidator = extract(/function validateAdminPasswordInputs\(current,next,confirmation,requireCurrent=true\)\{[\s\S]*?\n\}/, 'Debe existir el validador puro de contraseña administrativa');
const passwordContext = run(passwordValidator);
const validate = passwordContext.validateAdminPasswordInputs;
assert.equal(validate('old-password', 'NuevaClave-2026!', 'NuevaClave-2026!'), '', 'Acepta una clave válida y confirmada');
assert.match(validate('', 'NuevaClave-2026!', 'NuevaClave-2026!'), /actual/, 'Exige clave actual en cambio normal');
assert.equal(validate('', 'NuevaClave-2026!', 'NuevaClave-2026!', false), '', 'Recovery validado puede omitir la clave actual');
assert.match(validate('old-password', 'short', 'short'), /12 caracteres/, 'Aplica mínimo de 12 caracteres');
assert.match(validate('old-password', 'NuevaClave-2026!', 'distinta'), /no coincide/, 'Rechaza confirmación distinta');
assert.match(validate('old-password', 'old-password', 'old-password'), /diferente/, 'Rechaza reutilizar la clave actual');

const redirectHelper = extract(/function getAdminRecoveryRedirectUrl\(origin=window\.location\.origin\)\{[\s\S]*?\n\}/, 'Debe existir el helper de redirect de recovery');
const redirectContext = run(redirectHelper, { URL });
assert.equal(redirectContext.getAdminRecoveryRedirectUrl('https://sirevya.com.co'), 'https://sirevya.com.co/admin.html', 'Usa el callback canónico solicitado');
assert.equal(redirectContext.getAdminRecoveryRedirectUrl('https://www.sirevya.com.co'), '', 'No acepta host alterno');
assert.equal(redirectContext.getAdminRecoveryRedirectUrl('https://sirevya.com.co.evil.example'), '', 'No acepta sufijo engañoso');
assert.equal(redirectContext.getAdminRecoveryRedirectUrl('http://localhost:4173'), '', 'No permite recovery desde preview/local');
assert.ok(admin.includes('sb.auth.resetPasswordForEmail(email,{redirectTo})'), 'La recuperación usa Supabase Auth con redirect explícito');
assert.ok(admin.includes('Si el correo está asociado a una cuenta compatible'), 'El resultado exitoso no enumera usuarios');

const requestRecoverySource = extract(/async function requestAdminPasswordRecovery\(inPanel=false\)\{[\s\S]*?\n\}/, 'Debe existir el flujo de recuperación');
const recoveryRequests = [];
async function requestRecoveryFrom(origin) {
  const messages = [];
  const context = run(`${redirectHelper}\n${requestRecoverySource}`, {
    URL,
    window: { location: { origin } },
    configured: () => true,
    ensureAdminAuthClient() {},
    $: () => ({ value: 'admin@example.test' }),
    sb: { auth: { resetPasswordForEmail: async (email, options) => { recoveryRequests.push({ email, redirectTo: options.redirectTo }); return { error: null }; } } },
    loginMsg: message => messages.push(message),
    setAdminSecurityStatus: message => messages.push(message),
  });
  await context.requestAdminPasswordRecovery();
  return messages[0];
}
assert.match(await requestRecoveryFrom('http://localhost:4173'), /dominio oficial/, 'Preview/local no inicia el recovery');
assert.equal(recoveryRequests.length, 0, 'Preview/local no contacta Auth');
assert.match(await requestRecoveryFrom('https://sirevya.com.co'), /Si el correo está asociado/, 'La solicitud oficial usa respuesta neutra');
assert.equal(recoveryRequests.length, 1);
assert.equal(recoveryRequests[0].email, 'admin@example.test');
assert.equal(recoveryRequests[0].redirectTo, 'https://sirevya.com.co/admin.html');
const panelRecoveryMessages = [];
const panelRecovery = run(`${redirectHelper}\n${admin.match(/function adminAuthOperationStillCurrent\(userId,authEpoch\)\{[\s\S]*?\n\}/)[0]}\n${requestRecoverySource}`, {
  URL,
  window: { location: { origin: 'https://sirevya.com.co' } },
  configured: () => true,
  adminSessionAuthorized: true,
  adminSessionUserId: 'synthetic-admin',
  adminAuthEpoch: 2,
  adminAuthOperationStillCurrent: () => true,
  assertCurrentAdminAuthorization: async () => ({ id: 'synthetic-admin', email: 'validated-admin@example.test' }),
  ensureAdminAuthClient() {},
  $: () => ({ value: 'spoofed@example.test', textContent: 'spoofed@example.test' }),
  sb: { auth: { resetPasswordForEmail: async (email, options) => { recoveryRequests.push({ email, redirectTo: options.redirectTo }); return { error: null }; } } },
  loginMsg: message => panelRecoveryMessages.push(message),
  setAdminSecurityStatus: (message, kind) => panelRecoveryMessages.push({ message, kind }),
});
await panelRecovery.requestAdminPasswordRecovery(true);
assert.equal(recoveryRequests[1].email, 'validated-admin@example.test', 'El recovery del panel usa la cuenta Auth confirmada, no el DOM');
assert.equal(recoveryRequests[1].redirectTo, 'https://sirevya.com.co/admin.html');
assert.equal(panelRecoveryMessages[0].kind, 'ok');

const observedVerifier = {};
const verifierSource = extract(/async function verifyAdminCurrentPassword\(user,password\)\{[\s\S]*?\n\}/, 'Debe existir verificación temporal de clave actual');
const verifierContext = run(verifierSource, {
  SUPABASE_URL: 'https://synthetic-project.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_synthetic_only',
  supabase: {
    createClient(url, key, options) {
      observedVerifier.client = { url, key, options };
      return { auth: {
        signInWithPassword: async credentials => {
          observedVerifier.credentials = credentials;
          return { data: { user: { id: 'synthetic-admin' } }, error: null };
        },
        signOut: async options => { observedVerifier.signOut = options; return { error: null }; },
      } };
    },
  },
});
await verifierContext.verifyAdminCurrentPassword({ id: 'synthetic-admin', email: 'admin@example.test' }, 'synthetic-password');
assert.equal(observedVerifier.client.options.auth.persistSession, false, 'El verificador no persiste sesión');
assert.equal(observedVerifier.client.options.auth.autoRefreshToken, false, 'El verificador no renueva sesión');
assert.equal(observedVerifier.client.options.auth.detectSessionInUrl, false, 'El verificador no procesa tokens URL');
assert.equal(observedVerifier.credentials.email, 'admin@example.test');
assert.equal(observedVerifier.credentials.password, 'synthetic-password');
assert.equal(observedVerifier.signOut.scope, 'local', 'Cierra solo el cliente temporal');

const authorizationSource = extract(/async function assertCurrentAdminAuthorization\(userId,authEpoch\)\{[\s\S]*?\n\}/, 'Debe existir verificación actual de sesión y rol');
let roleReadAfterSessionChange = false;
const staleAuthorization = run(`${admin.match(/function adminAuthOperationStillCurrent\(userId,authEpoch\)\{[\s\S]*?\n\}/)[0]}\n${admin.match(/function adminAuthOperationError\(message,code='ADMIN_AUTH_STALE'\)\{[\s\S]*?\n\}/)[0]}\n${authorizationSource}`, {
  adminAuthEpoch: 4,
  adminSessionAuthorized: true,
  adminSessionUserId: 'synthetic-admin',
  sb: {
    auth: { getUser: async () => { staleAuthorization.adminAuthEpoch++; return { data: { user: { id: 'synthetic-admin' } }, error: null }; } },
    rpc: async () => { roleReadAfterSessionChange = true; return { data: true, error: null }; },
  },
});
await assert.rejects(staleAuthorization.assertCurrentAdminAuthorization('synthetic-admin', 4), /cambió/);
assert.equal(roleReadAfterSessionChange, false, 'No consulta/actualiza el rol luego de cambiar la época de sesión');

const updateSource = extract(/async function applyAdminPasswordUpdate\(next,userId,authEpoch\)\{[\s\S]*?\n\}/, 'Debe existir el cambio de clave con guards de identidad');
const successfulUpdateCalls = [];
const successfulUpdate = run(updateSource, {
  adminPasswordRecoveryMode: false,
  adminAuthOperationStillCurrent: () => true,
  assertCurrentAdminAuthorization: async () => { successfulUpdateCalls.push('assert'); return { id: 'synthetic-admin' }; },
  sb: { auth: {
    updateUser: async payload => { successfulUpdateCalls.push({ type: 'update', payload }); return { error: null }; },
    signOut: async options => { successfulUpdateCalls.push({ type: 'signOut', options }); return { error: null }; },
  } },
  $: () => ({ classList: { remove() {} } }),
  setAdminSecurityStatus: message => successfulUpdateCalls.push({ type: 'status', message }),
});
await successfulUpdate.applyAdminPasswordUpdate('synthetic-new-password', 'synthetic-admin', 7);
assert.equal(successfulUpdateCalls.filter(call => call === 'assert').length, 2, 'Revalida identidad y rol antes y después de updateUser');
assert.equal(successfulUpdateCalls.find(call => call?.type === 'signOut').options.scope, 'others');

let racedEpoch = 9;
let racedAuthorized = true;
let racedUserId = 'synthetic-admin';
let racedSignOutCalls = 0;
const racedUpdate = run(updateSource, {
  adminPasswordRecoveryMode: false,
  adminAuthOperationStillCurrent: (userId, epoch) => epoch === racedEpoch && racedAuthorized && userId === racedUserId,
  adminAuthOperationError: message => new Error(message),
  assertCurrentAdminAuthorization: async (userId, epoch) => {
    if (epoch !== racedEpoch || !racedAuthorized || userId !== racedUserId) throw new Error('La sesión administrativa cambió.');
    return { id: userId };
  },
  sb: { auth: {
    updateUser: async () => { racedEpoch++; racedAuthorized = false; racedUserId = 'different-account'; return { error: null }; },
    signOut: async () => { racedSignOutCalls++; return { error: null }; },
  } },
  $: () => ({ classList: { remove() {} } }),
  setAdminSecurityStatus() {},
});
await assert.rejects(racedUpdate.applyAdminPasswordUpdate('synthetic-new-password', 'synthetic-admin', 9), /cambió/);
assert.equal(racedSignOutCalls, 0, 'Un cambio de cuenta durante updateUser nunca revoca sesiones de otra cuenta');

const changeSource = extract(/async function changeAdminPassword\(\)\{[\s\S]*?\n\}/, 'Debe existir la orquestación del cambio de contraseña');
function changeContext({ recoveryMode, assurance, mfaAvailable = true }) {
  const calls = [];
  const fields = {
    currentAdminPassword: { value: recoveryMode ? '' : 'synthetic-current' },
    newAdminPassword: { value: 'NuevaClave-2026!' },
    confirmAdminPassword: { value: 'NuevaClave-2026!' },
    changeAdminPasswordBtn: { disabled: false },
  };
  const context = run(changeSource, {
    adminSessionAuthorized: true,
    adminSessionUserId: 'synthetic-admin',
    adminAuthEpoch: 11,
    adminPasswordRecoveryMode: recoveryMode,
    adminAuthOperationStillCurrent: (userId, epoch) => userId === 'synthetic-admin' && epoch === 11,
    validateAdminPasswordInputs: passwordContext.validateAdminPasswordInputs,
    assertCurrentAdminAuthorization: async () => ({ id: 'synthetic-admin', email: 'admin@example.test' }),
    verifyAdminCurrentPassword: async () => { calls.push('verify-current'); },
    applyAdminPasswordUpdate: async () => { calls.push('apply-update'); },
    sb: { auth: { mfa: mfaAvailable ? { getAuthenticatorAssuranceLevel: async () => assurance } : {} } },
    $: id => fields[id] || { value: '', classList: { add() {}, remove() {} } },
    setAdminSecurityStatus: (message, kind) => calls.push({ type: 'status', message, kind }),
    lockAdminPanel: () => { calls.push('lock'); },
    console,
  });
  return { context, calls, fields };
}
const recoveryWithoutAal2 = changeContext({ recoveryMode: true, assurance: { data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null } });
await recoveryWithoutAal2.context.changeAdminPassword();
assert.ok(recoveryWithoutAal2.calls.some(call => call?.type === 'status' && /MFA requerida/.test(call.message)), 'Recovery no omite AAL2');
assert.equal(recoveryWithoutAal2.calls.includes('apply-update'), false, 'No actualiza la clave sin AAL2 cuando se exige');
assert.equal(recoveryWithoutAal2.calls.includes('verify-current'), false, 'Recovery sí omite solo la clave actual');
const recoveryWithoutMfaApi = changeContext({ recoveryMode: true, assurance: null, mfaAvailable: false });
await recoveryWithoutMfaApi.context.changeAdminPassword();
assert.ok(recoveryWithoutMfaApi.calls.some(call => call?.type === 'status' && /nivel de seguridad/.test(call.message)), 'API MFA ausente falla cerrado.');
assert.equal(recoveryWithoutMfaApi.calls.includes('apply-update'), false, 'No cambia la clave si Supabase no puede reportar AAL.');
const recoveryWithMalformedAal = changeContext({ recoveryMode: true, assurance: { data: null, error: null } });
await recoveryWithMalformedAal.context.changeAdminPassword();
assert.ok(recoveryWithMalformedAal.calls.some(call => call?.type === 'status' && /nivel de seguridad/.test(call.message)), 'Respuesta AAL incompleta falla cerrado.');
assert.equal(recoveryWithMalformedAal.calls.includes('apply-update'), false, 'No cambia la clave con una respuesta AAL incompleta.');
const recoveryWithAal2 = changeContext({ recoveryMode: true, assurance: { data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null } });
await recoveryWithAal2.context.changeAdminPassword();
assert.equal(recoveryWithAal2.calls.includes('apply-update'), true, 'Recovery permite actualizar tras AAL2');
assert.equal(recoveryWithAal2.calls.includes('verify-current'), false);
const normalChange = changeContext({ recoveryMode: false, assurance: { data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null } });
await normalChange.context.changeAdminPassword();
assert.equal(normalChange.calls.includes('verify-current'), true, 'Cambio normal valida la clave actual');
assert.equal(normalChange.calls.includes('apply-update'), true);

const closeSource = extract(/async function closeAllAdminSessions\(\)\{[\s\S]*?\n\}/, 'Debe existir cierre global con guard de sesión');
const cancelCalls = [];
const cancelContext = run(closeSource, {
  adminSessionAuthorized: true,
  adminSessionUserId: 'synthetic-admin',
  adminAuthEpoch: 5,
  adminAuthOperationStillCurrent: () => true,
  assertCurrentAdminAuthorization: async () => { cancelCalls.push('assert'); },
  confirm: () => false,
  sb: { auth: { signOut: async options => { cancelCalls.push(options); return { error: null }; } } },
  setAdminSecurityStatus() {},
  location: { reload() { cancelCalls.push('reload'); } },
});
await cancelContext.closeAllAdminSessions();
assert.equal(cancelCalls.length, 0, 'Cancelar no valida ni cierra sesiones');

const globalCalls = [];
const globalContext = run(closeSource, {
  adminSessionAuthorized: true,
  adminSessionUserId: 'synthetic-admin',
  adminAuthEpoch: 5,
  adminAuthOperationStillCurrent: () => true,
  assertCurrentAdminAuthorization: async () => { globalCalls.push('assert'); },
  confirm: () => true,
  sb: { auth: { signOut: async options => { globalCalls.push({ type: 'signOut', options }); return { error: null }; } } },
  setAdminSecurityStatus() {},
  location: { reload() { globalCalls.push('reload'); } },
});
await globalContext.closeAllAdminSessions();
assert.equal(globalCalls[0], 'assert', 'Vuelve a comprobar sesión y rol antes del cierre global');
assert.equal(globalCalls[1].options.scope, 'global');
assert.equal(globalCalls[2], 'reload');

const staleGlobalCalls = [];
let staleGlobal;
staleGlobal = run(closeSource, {
  adminSessionAuthorized: true,
  adminSessionUserId: 'synthetic-admin',
  adminAuthEpoch: 6,
  adminAuthOperationStillCurrent: (userId, epoch) => epoch === staleGlobal.adminAuthEpoch && userId === staleGlobal.adminSessionUserId && staleGlobal.adminSessionAuthorized,
  assertCurrentAdminAuthorization: async () => { staleGlobal.adminAuthEpoch++; },
  confirm: () => true,
  sb: { auth: { signOut: async options => { staleGlobalCalls.push(options); return { error: null }; } } },
  setAdminSecurityStatus() {},
  location: { reload() { staleGlobalCalls.push('reload'); } },
});
await staleGlobal.closeAllAdminSessions();
assert.equal(staleGlobalCalls.length, 0, 'Una continuación obsoleta no cierra sesiones globales');

assert.ok(admin.includes('sb.auth.signOut({scope:\'others\'})'), 'Cierra otras sesiones tras actualizar si la identidad sigue vigente');
assert.ok(admin.includes("sb.auth.signOut({scope:'global'})"), 'Incluye cierre global explícito');
assert.match(changeSource, /typeof mfa\?\.getAuthenticatorAssuranceLevel!=='function'/, 'API MFA ausente falla cerrado.');
assert.match(changeSource, /!\['aal1','aal2'\]\.includes\(currentLevel\).*!\['aal1','aal2'\]\.includes\(nextLevel\)/, 'La respuesta AAL se valida antes de autorizar el cambio.');
assert.ok(admin.includes("if(nextLevel==='aal2'&&currentLevel!=='aal2')"), 'El cambio de contraseña exige AAL2 cuando Supabase lo requiere');
assert.ok(admin.includes("const changePasswordButton=$('changeAdminPasswordBtn');if(changePasswordButton)changePasswordButton.disabled=false;"), 'El lock de sesión rehabilita el botón si una solicitud antigua quedó pendiente.');
assert.ok(!admin.includes('enforceAdminMfaBeforePanel') && !admin.includes('adminMfaSetupPanel'), 'MFA interactivo queda fuera hasta verificar la configuración live');
assert.ok(admin.includes('if(isAdmin!==true){lockAdminPanel'), 'Conserva la autorización admin del servidor');
const adminRoleAt = admin.indexOf("if(isAdmin!==true){lockAdminPanel('Esta cuenta no está autorizada para entrar al panel administrativo.'");
const identityRecheckAt = admin.indexOf('const {data:{user:confirmedUser}', adminRoleAt);
const panelVisibleAt = admin.indexOf('$("loginScreen").classList.add("hidden")', adminRoleAt);
assert.ok(adminRoleAt >= 0 && identityRecheckAt > adminRoleAt && panelVisibleAt > identityRecheckAt, 'Revalida la identidad antes de mostrar el panel');
assert.ok(!/localStorage\.setItem\([^)]*(?:password|secret|token)/i.test(admin), 'No persiste contraseñas, tokens ni secretos en localStorage');
assert.ok(admin.includes('Los tokens de acceso ya emitidos pueden seguir válidos hasta su vencimiento.'), 'Aclara el tiempo de vigencia de access tokens al cerrar sesiones');

console.log('OK admin_account_security_regression: recovery canónico, guard de época/usuario, AAL2 en recovery y cierre de sesiones bajo mocks.');
