import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/deploy-wompi-create-checkout.yml', import.meta.url), 'utf8');

assert.match(workflow, /^on:\n  workflow_dispatch:/m, 'workflow must be manual only');
assert.doesNotMatch(workflow, /^  (?:push|pull_request|schedule):/m, 'workflow must not deploy on push, PR, or schedule');
assert.match(workflow, /confirm_production:[\s\S]*?default: false/, 'production confirmation must default to false');
assert.match(workflow, /github\.ref == 'refs\/heads\/main'/, 'deploy must be restricted to main');
assert.match(workflow, /environment:\n\s+name: sirevya-supabase-production/, 'deploy must use the protected production environment');
assert.match(workflow, /permissions:\n  contents: read/, 'GITHUB_TOKEN permissions must be read-only');
assert.match(workflow, /secrets\.SUPABASE_ACCESS_TOKEN/, 'the Supabase access token is taken from GitHub Environment Secrets');
assert.match(workflow, /SUPABASE_PROJECT_REF: hnlbbtnfmbnbkcgegufa/, 'project ref must be fixed and non-secret');
assert.match(workflow, /supabase\/setup-cli@[0-9a-f]{40}/, 'official setup action must be pinned to a full commit SHA');
assert.match(workflow, /version: 3\.1\.0/, 'Supabase CLI version must be pinned');
assert.match(workflow, /function_slug="wompi-create-checkout"/, 'the target function must be fixed in the job');
assert.match(workflow, /supabase functions deploy "\$function_slug"[\s\S]*?--no-verify-jwt[\s\S]*?--use-api[\s\S]*?--yes/, 'deploy must target one slug with JWT verification off');
assert.match(workflow, /supabase functions download "\$function_slug"[\s\S]*?--use-api/, 'postdeploy verification must download the remote source');
assert.match(workflow, /cmp --silent/, 'postdeploy source must be compared byte for byte');
assert.match(workflow, /\.status == "ACTIVE" and \.verify_jwt == false/, 'Management API must verify ACTIVE and verify_jwt=false');
assert.match(workflow, /\.version > \$before/, 'postdeploy function version must advance');
assert.doesNotMatch(workflow, /^\s*supabase\s+(?:db\s+push|migration\s+up)\b/m, 'no database migrations may run');
assert.doesNotMatch(workflow, /^\s*supabase\s+functions\s+(?:delete|deploy)\s+(?:--|$)/m, 'no function-wide deployment, deletion, or prune command may run');
assert.doesNotMatch(workflow, /wompi-webhook|admin-wompi-legacy-recovery/, 'workflow must not reference or deploy other functions');

console.log('PASS: production deploy is manual, main-only, single-function, JWT-false, source-verified, and migration-free.');
