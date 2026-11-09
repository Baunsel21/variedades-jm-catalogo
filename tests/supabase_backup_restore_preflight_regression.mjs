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

console.log('supabase_backup_restore_preflight_regression: PASS');
