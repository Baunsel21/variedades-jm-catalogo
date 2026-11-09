import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const runbook = readFileSync(new URL('../docs/deployment/telegram-automatic-outbox-runbook.md', import.meta.url), 'utf8');
const functionConfig = new URL('../supabase/config.toml', import.meta.url);
const shellBlocks = [...runbook.matchAll(/^[ \t]*```sh[ \t]*\n([\s\S]*?)\n[ \t]*```/gm)].map((match) => match[1]);
const deployCommands = shellBlocks.flatMap((block) => block.split(/\r?\n/).map((line) => line.trim())).filter((line) => line.startsWith('supabase functions deploy '));

assert.equal(existsSync(functionConfig), false, 'If supabase/config.toml is added, update this regression and document the source of verify_jwt=false.');
assert.equal(deployCommands.length, 1, 'The runbook must contain one narrowly-scoped dispatcher deploy command.');
assert.match(
  deployCommands[0],
  /^supabase functions deploy telegram-dispatch --no-verify-jwt --remote="\$SUPABASE_PROJECT_REF" --yes$/,
  'CLI v3 deployment must explicitly disable JWT only for telegram-dispatch and explicitly target the project.'
);
assert.equal(deployCommands[0].includes('TELEGRAM_BOT_TOKEN'), false, 'The deploy command must never embed Telegram secrets.');
assert.ok(runbook.includes('rechazar secreto ausente/incorrecto antes de cualquier RPC'), 'The runbook must require internal-secret validation before any RPC.');

console.log('telegram_dispatch_deploy_config_regression: PASS');
