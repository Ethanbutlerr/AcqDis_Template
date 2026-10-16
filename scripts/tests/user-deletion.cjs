const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../../supabase/functions/user-management/index.ts'), 'utf8')
  .replace(/^import .*;\r?$/gm, '');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(options = {}) {
  const rows = {
    profiles: [
      { id: 'admin', company_id: 'company-a', is_disabled: !!options.disabled, deleted_at: options.removedCaller ? '2026-10-16' : null },
      { id: 'target', company_id: 'company-a', is_disabled: false, deleted_at: options.alreadyRemoved ? '2026-10-16' : null, full_name: 'Former Teammate' },
      { id: 'foreign', company_id: 'company-b' },
    ],
    user_roles: [{ user_id: 'admin', role_id: 'manager' }],
    role_permissions: [{ role_id: 'manager', permission_id: 'manage' }],
    permissions: options.noPermission ? [] : [{ id: 'manage', key: 'manage_users' }],
    audit_logs: [],
  };
  const authDeletes = [];
  const db = {
    auth: {
      getUser: async () => ({ data: { user: options.unauthorized ? null : { id: 'admin' } } }),
      admin: {
        deleteUser: async (id, softDelete) => {
          assert.equal(softDelete, true, 'Must preserve the Auth row and all profile relationships');
          authDeletes.push(id);
          if (options.authError) return { error: { message: options.authError } };
          return { error: null };
        },
      },
    },
    from(table) {
      let filters = [], single = false, inserted, updated;
      const q = {
        select() { return q; },
        eq(key, value) { filters.push((row) => row[key] === value); return q; },
        in(key, values) { filters.push((row) => values.includes(row[key])); return q; },
        single() { single = true; return q; },
        maybeSingle() { single = true; return q; },
        delete() { assert.fail('Profile must only be removed by the Auth cascade'); },
        insert(row) { inserted = row; return q; },
        update(row) { updated = row; return q; },
        then(resolve, reject) {
          if (inserted) rows[table].push(inserted);
          const data = rows[table].filter((row) => filters.every((filter) => filter(row)));
          const error = table === 'profiles' && (
            (options.lookupError && !updated && data[0]?.id === 'target') ||
            (options.disableError && updated && !updated.deleted_at) ||
            (options.archiveError && updated?.deleted_at)
          ) ? { message: 'database error' } : null;
          if (updated && !error) data.forEach((row) => Object.assign(row, updated));
          return Promise.resolve({ data: single ? data[0] ?? null : data, error }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  let handler;
  vm.runInNewContext(code, {
    Deno: { env: { get: () => 'mock' }, serve: (fn) => { handler = fn; } },
    createClient: () => db, Request, Response, URL, console: { error() {} },
  });
  const request = (id = 'target') => handler(new Request('https://example.test/functions/v1/user-management/delete', {
    method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: id }),
  }));
  return { rows, authDeletes, request };
}

test('removes credentials but preserves the profile identity and records a company-scoped audit', async () => {
  const f = fixture();
  const response = await f.request();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  assert.deepEqual(f.authDeletes, ['target']);
  const target = f.rows.profiles.find((row) => row.id === 'target');
  assert.equal(target.full_name, 'Former Teammate');
  assert.equal(target.is_disabled, true);
  assert.ok(target.deleted_at);
  assert.equal(f.rows.audit_logs[0].company_id, 'company-a');
  assert.equal(f.rows.audit_logs[0].entity_id, 'target');
});

test('an Auth failure leaves a disabled, visible account available for retry', async () => {
  const f = fixture({ authError: 'Database error deleting user' });
  const response = await f.request();
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /disabled.*retry/);
  assert.equal(f.rows.profiles.find((row) => row.id === 'target').is_disabled, true);
  assert.equal(f.rows.profiles.find((row) => row.id === 'target').deleted_at, null);
  assert.equal(f.rows.audit_logs.length, 0);
});

for (const [label, options, id, status] of [
  ['self deletion', {}, 'admin', 400],
  ['another company', {}, 'foreign', 404],
  ['missing user', {}, 'missing', 404],
  ['missing user ID', {}, '', 400],
  ['missing permission', { noPermission: true }, 'target', 403],
  ['disabled caller', { disabled: true }, 'target', 403],
  ['removed caller', { removedCaller: true }, 'target', 403],
  ['invalid session', { unauthorized: true }, 'target', 401],
  ['failed profile lookup', { lookupError: true }, 'target', 500],
  ['failed access revocation', { disableError: true }, 'target', 500],
]) {
  test(`blocks deletion for ${label}`, async () => {
    const f = fixture(options);
    assert.equal((await f.request(id)).status, status);
    assert.deepEqual(f.authDeletes, []);
    assert.equal(f.rows.audit_logs.length, 0);
  });
}

test('a failed archive stays disabled and visible for retry', async () => {
  const f = fixture({ archiveError: true });
  assert.equal((await f.request()).status, 500);
  assert.deepEqual(f.authDeletes, ['target']);
  const target = f.rows.profiles.find((row) => row.id === 'target');
  assert.equal(target.is_disabled, true);
  assert.equal(target.deleted_at, null);
});

test('repeating an already completed removal is safe', async () => {
  const f = fixture({ alreadyRemoved: true });
  assert.equal((await f.request()).status, 200);
  assert.deepEqual(f.authDeletes, []);
});
