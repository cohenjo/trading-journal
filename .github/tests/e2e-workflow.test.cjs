const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const root = path.resolve(__dirname, '../..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/playwright-e2e.yml'), 'utf8');

function validateAutomaticJobs(source) {
  for (const id of ['e2e-smoke', 'e2e-full']) {
    const job = source.split(`  ${id}:\n`)[1]?.split(/^  [a-z][\w-]*:\n/m)[0];
    assert.ok(job, `${id} must exist`);
    assert.match(job, /runs-on: ubuntu-24\.04/);
    assert.match(job, /uses: \.\/\.github\/actions\/e2e-stack/);
    assert.doesNotMatch(job, /secrets\.|SUPABASE_E2E_ALLOW_PROD|continue-on-error/);
    assert.match(job, /npx playwright test .*--project=chromium/);
    assert.match(job, /if: always\(\)[\s\S]*supabase stop --no-backup/);
  }
}

test('automatic browser gates use a supported runner and isolated credentials', () => {
  validateAutomaticJobs(workflow);
});

test('runner and secret regressions in the real workflow fail the gate', () => {
  assert.throws(() => validateAutomaticJobs(workflow.replaceAll('ubuntu-24.04', 'ubuntu-latest')));
  assert.throws(() => validateAutomaticJobs(workflow.replace(
    'uses: ./.github/actions/e2e-stack',
    'uses: ./.github/actions/e2e-stack\n        env: ${{ secrets.PRODUCTION }}',
  )));
});

test('stack environment export names exact credentials and rejects hosted or incomplete status', () => {
  const run = status => spawnSync(process.execPath, ['.github/scripts/e2e-env.cjs'], {
    cwd: root,
    input: JSON.stringify(status),
    encoding: 'utf8',
  });
  const local = { API_URL: 'http://127.0.0.1:54321', ANON_KEY: 'synthetic-anon', SERVICE_ROLE_KEY: 'synthetic-service' };
  assert.equal(run(local).stdout, [
    `NEXT_PUBLIC_SUPABASE_URL=${local.API_URL}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${local.ANON_KEY}`,
    `SUPABASE_SERVICE_ROLE_KEY=${local.SERVICE_ROLE_KEY}`,
    '',
  ].join('\n'));
  for (const status of [
    { ...local, API_URL: 'https://production.supabase.co' },
    { ...local, SERVICE_ROLE_KEY: '' },
    { ...local, ANON_KEY: 'invalid\nINJECTED=true' },
  ]) {
    const result = run(status);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
  }
});

test('validation-only frontend build has public synthetic config, never service credentials', () => {
  const source = fs.readFileSync(path.join(root, '.github/workflows/pr-frontend.yml'), 'utf8');
  const build = source.split('  build:\n')[1].split('  test:\n')[0];
  assert.match(build, /NEXT_PUBLIC_SUPABASE_URL: http:\/\/127\.0\.0\.1:54321/);
  assert.match(build, /NEXT_PUBLIC_SUPABASE_ANON_KEY: synthetic-ci-build-only/);
  assert.doesNotMatch(build, /secrets\.|SERVICE_ROLE|continue-on-error/);
});

test('fixture bootstrap restricts only the existing reset RPC, without weakening table guards', () => {
  const sql = fs.readFileSync(path.join(root, '.github/scripts/e2e-bootstrap.sql'), 'utf8');
  const action = fs.readFileSync(path.join(root, '.github/actions/e2e-stack/action.yml'), 'utf8');
  assert.match(action, /docker exec -i supabase_db_trading-journal/);
  assert.match(action, /--set ON_ERROR_STOP=1/);
  assert.match(action, /export PGPASSWORD="\$POSTGRES_PASSWORD"/);
  assert.match(action, /psql --no-password --username supabase_admin/);
  assert.match(sql, /owner to supabase_admin/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /p\.prosecdef and r\.rolsuper/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.e2e_reset_test_user\(text\) to service_role/);
  assert.doesNotMatch(sql, /disable\s+(trigger|row level security)|grant\s+set|set\s+session_replication_role/i);
});

test('missing container authentication fails the bootstrap contract', () => {
  const action = fs.readFileSync(path.join(root, '.github/actions/e2e-stack/action.yml'), 'utf8');
  const validate = source => {
    assert.match(source, /export PGPASSWORD="\$POSTGRES_PASSWORD"/);
    assert.match(source, /sh -eu -c/);
    assert.match(source, /--no-password/);
  };
  validate(action);
  assert.throws(() => validate(action.replace('export PGPASSWORD="$POSTGRES_PASSWORD"', '')));
  assert.throws(() => validate(action.replace('sh -eu -c', 'sh -c')));
});
