import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const admin = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const passwordValidator = admin.match(/function validateAdminPasswordInputs\(current,next,confirmation,requireCurrent=true\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(passwordValidator, 'Debe existir el validador puro de contraseña administrativa');
const context = vm.createContext({});
new vm.Script(passwordValidator).runInContext(context);
const validate = context.validateAdminPasswordInputs;

assert.equal(validate('old-password', 'NuevaClave-2026!', 'NuevaClave-2026!'), '', 'Acepta clave válida confirmada y con contraseña actual');
assert.match(validate('', 'NuevaClave-2026!', 'NuevaClave-2026!'), /actual/, 'Exige contraseña actual en cambio normal');
assert.equal(validate('', 'NuevaClave-2026!', 'NuevaClave-2026!', false), '', 'Permite modo recuperación sin contraseña actual');
assert.match(validate('old-password', 'short', 'short'), /12 caracteres/, 'Aplica mínimo local de 12 caracteres');
assert.match(validate('old-password', 'NuevaClave-2026!', 'distinta'), /no coincide/, 'Rechaza confirmación diferente');
assert.match(validate('old-password', 'old-password', 'old-password'), /diferente/, 'Rechaza reutilizar la contraseña actual');

assert.ok(admin.includes('sb.auth.resetPasswordForEmail(email,{redirectTo})'), 'Recuperación delega a Supabase Auth con destino explícito');
assert.ok(admin.includes('supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})'), 'La verificación usa un cliente temporal que no persiste ni renueva sesiones');
assert.ok(admin.includes('verifier.auth.signInWithPassword({email:user.email,password})'), 'Cambio normal verifica la clave actual en el cliente temporal');
assert.ok(admin.includes("verifier.auth.signOut({scope:'local'})"), 'La sesión temporal se cierra localmente después de verificar');
assert.ok(!/sb\.auth\.signInWithPassword\(\{email:user\.email/.test(admin), 'No degrada ni sustituye la sesión AAL2 del cliente principal');
assert.ok(admin.includes("assurance.data?.nextLevel==='aal2'&&assurance.data?.currentLevel!=='aal2'"), 'Falla cerrado si la sesión principal no conserva el nivel MFA requerido');
assert.ok(admin.includes("if(!mfa||typeof mfa.getAuthenticatorAssuranceLevel!=='function'||typeof mfa.listFactors!=='function')return true;"), 'Conserva compatibilidad si la API MFA no existe');
assert.ok(admin.includes("if(assurance.error){lockAdminPanel('No se pudo verificar el segundo factor."), 'La revalidación no mantiene abierto el panel si no logra comprobar MFA');
assert.ok(!/adminPasswordMfaPanel|adminPasswordMfaCode|adminSensitiveReauthBusy|adminPendingPasswordChange|finishAdminPasswordMfaStepUp|cancelAdminPasswordMfaStepUp/.test(admin), 'No conserva controles o estado huérfanos del step-up retirado');
const passwordChangeStart = admin.indexOf('async function changeAdminPassword()');
const passwordChangeEnd = admin.indexOf('async function closeAllAdminSessions()', passwordChangeStart);
const passwordChangeFlow = admin.slice(passwordChangeStart, passwordChangeEnd);
assert.ok(passwordChangeFlow.includes('sb.auth.getUser()') && passwordChangeFlow.includes("sb.rpc('is_store_admin')") && passwordChangeFlow.includes('if(!adminPasswordRecoveryMode)'), 'La recuperación omite la clave actual solo después de validar la misma sesión y permiso admin');
assert.ok(passwordChangeFlow.includes('actionAuthEpoch!==adminAuthEpoch') && passwordChangeFlow.includes('currentAdminCheck=await sb.rpc(\'is_store_admin\')'), 'Revalida la identidad/sesión administrativa antes de aplicar el cambio');
assert.ok(admin.includes('sb.auth.updateUser({password:next})'), 'La contraseña se cambia con la API Auth, no con tablas propias');
assert.ok(admin.includes("sb.auth.signOut({scope:'others'})") && admin.includes("sb.auth.signOut({scope:'global'})"), 'Permite cerrar otras sesiones o todas las sesiones');
assert.ok(admin.includes("sb.auth.mfa.enroll({factorType:'totp'") && admin.includes('sb.auth.mfa.challenge(') && admin.includes('sb.auth.mfa.verify(') && admin.includes('sb.auth.mfa.unenroll('), 'Implementa ciclo TOTP de alta, reto, verificación y baja protegida');
const adminCheckAt = admin.indexOf("if(isAdmin!==true){lockAdminPanel('Esta cuenta no está autorizada para entrar al panel administrativo.'");
const mfaGateAt = admin.indexOf('if(!await enforceAdminMfaBeforePanel())return;', adminCheckAt);
assert.ok(adminCheckAt >= 0 && mfaGateAt > adminCheckAt, 'La autorización de administrador ocurre antes del reto MFA y de mostrar el panel');
const disableStart = admin.indexOf('async function confirmDisableAdminMfa()');
const verifyAt = admin.indexOf('sb.auth.mfa.verify(', disableStart);
const unenrollAt = admin.indexOf('sb.auth.mfa.unenroll({factorId})', disableStart);
assert.ok(disableStart >= 0 && verifyAt > disableStart && unenrollAt > verifyAt, 'No permite desactivar TOTP sin verificar un código');
assert.ok(!/localStorage\.setItem\([^)]*(?:password|mfa|totp|secret)/i.test(admin), 'No persiste claves, códigos, factores ni secretos MFA en localStorage');
assert.ok(admin.includes("['currentAdminPassword','newAdminPassword','confirmAdminPassword','adminMfaCode','adminMfaDisableCode','adminMfaLoginCode']"), 'Limpia códigos y campos de clave al cerrar sesión');

const startSource=admin.match(/async function startApp\(\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(startSource,'Arranque del panel aislable para reproducir la carrera MFA');
let finishMfa;
const pendingMfa=new Promise(resolve=>{finishMfa=resolve;});
let panelOpened=false;
const race=vm.createContext({
  adminStartBusy:false,adminAuthEpoch:1,adminSessionAuthorized:false,adminSessionUserId:'',
  sb:{auth:{getUser:async()=>({data:{user:{id:'synthetic-admin'}},error:null})},rpc:async()=>({data:true,error:null})},
  enforceAdminMfaBeforePanel:()=>pendingMfa,
  $:id=>({classList:{add(){},remove(){if(id==='app')panelOpened=true;}}}),
  lockAdminPanel:()=>{throw new Error('Una continuación stale no debe modificar otra sesión.');},console
});
vm.runInContext(startSource,race);
const pendingStart=race.startApp();
await new Promise(resolve=>setImmediate(resolve));
race.adminAuthEpoch++; // Logout o cambio de sesión durante el await MFA.
finishMfa(true);
await pendingStart;
assert.equal(panelOpened,false,'Un gate MFA tardío no vuelve a mostrar el panel después de logout');
assert.equal(race.adminSessionAuthorized,false,'Una continuación stale no concede autorización');
assert.equal(race.adminSessionUserId,'');
const mfaGateSource=admin.match(/async function enforceAdminMfaBeforePanel\(\)\{[\s\S]*?\n\}/)?.[0];
let finishAssurance,challengeShown=false;
const assurancePromise=new Promise(resolve=>{finishAssurance=resolve;});
const gate=vm.createContext({adminAuthEpoch:1,sb:{auth:{mfa:{getAuthenticatorAssuranceLevel:()=>assurancePromise,listFactors:async()=>({data:{totp:[]}})}}},showAdminMfaLoginStep:()=>{challengeShown=true;}});
vm.runInContext(mfaGateSource,gate);
const pendingGate=gate.enforceAdminMfaBeforePanel();gate.adminAuthEpoch++;
finishAssurance({data:{currentLevel:'aal1',nextLevel:'aal2'}});
assert.equal(await pendingGate,false,'El gate descarta assurance de otra época');
assert.equal(challengeShown,false,'No revive un reto después de logout');

console.log('OK admin_account_security_regression: política de clave, recuperación Auth, MFA y privacidad local.');
