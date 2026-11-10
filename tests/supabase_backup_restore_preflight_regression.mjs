import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const runbook = readFileSync(new URL('../docs/deployment/supabase-backup-restore-preflight.md', import.meta.url), 'utf8');
const exportSection = runbook.split('## 2. Exportar con Supabase CLI')[1]?.split('\n## ')[0];
assert.ok(exportSection, 'The backup export section must exist.');

assert.doesNotMatch(runbook, /test -f supabase\/config\.toml/);
assert.doesNotMatch(runbook, /Ejecuta desde el root del repositorio, donde está/);
assert.match(exportSection, /no requiere `supabase link` ni un `supabase\/config\.toml` del repositorio/);
assert.match(exportSection, /no ejecutes `db dump` sin el flag `--remote` explícito/);

const shellBlock = [...exportSection.matchAll(/```sh\n([\s\S]*?)\n```/g)].map((match) => match[1]).join('\n');
const dumpCommands = shellBlock.split(/\n(?=supabase db dump )/).filter((command) => command.startsWith('supabase db dump '));
assert.equal(dumpCommands.length, 3, 'The procedure must include the three explicit roles/schema/data dumps.');
for (const command of dumpCommands) {
  assert.ok(command.includes('--remote="$SIREVYA_DB_URL"'), 'Every dump must use the explicit production URI only as a read target.');
  assert.equal(command.includes('--db-url'), false, 'Use the current CLI v3 flag, not the deprecated flag.');
}

const windowsExport = runbook.split('### Windows PowerShell: exportar y validar los dumps')[1]?.split('\n## 3.')[0];
assert.ok(windowsExport, 'A complete Windows PowerShell export section must exist.');
assert.match(windowsExport, /Read-Host[\s\S]*-AsSecureString/, 'The production URI is entered through a masked prompt.');
assert.equal((windowsExport.match(/Invoke-CheckedNative -Executable 'supabase' -NativeArgs @\('db','dump',/g) || []).length, 3, 'Windows exports roles, schema and data with three explicit dumps.');
assert.match(windowsExport, /--remote=\$\(\$env:SIREVYA_DB_URL\)/, 'Every Windows dump targets the explicit private URI.');
assert.match(windowsExport, /Get-FileHash/, 'Windows computes SHA-256 locally.');
assert.match(windowsExport, /SHA256SUMS/, 'Windows records and rechecks the local hash manifest.');

const windowsRestore = runbook.split('### Windows PowerShell: restaurar solo en el stack local')[1]?.split('\nLa prueba solo pasa')[0];
assert.ok(windowsRestore, 'A Windows PowerShell restore section must exist.');
assert.match(windowsRestore, /major_version = 17/);
assert.match(windowsRestore, /\$LocalUri\.Host -notin @\('localhost','127\.0\.0\.1','::1'\)/, 'Windows stops unless the restore target is loopback.');
assert.match(windowsRestore, /session_replication_role = replica/);
assert.match(windowsRestore, /Compare-Object[\s\S]*SourceCounts[\s\S]*LocalCounts/, 'Windows compares only aggregated table counts locally.');
assert.match(windowsRestore, /no se escribieron datos de producción/i);

console.log('supabase_backup_restore_preflight_regression: PASS');
