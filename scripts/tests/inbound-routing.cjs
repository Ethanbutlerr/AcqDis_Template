const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../../supabase/functions/voice-token/index.ts'), 'utf8').replace(/^import .*;\r?$/gm, '');
const code = ts.transpileModule(source + '\nglobalThis.routing = { getInboundRecipients, voiceIdentity };', {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(authId = 'user-a', options = {}) {
  const rows = {
    profiles: [
      { id: 'user-a', company_id: 'company-1', is_disabled: false },
      { id: 'user-b', company_id: 'company-1', is_disabled: false },
      { id: 'unauthorized', company_id: 'company-1', is_disabled: false },
      { id: 'disabled', company_id: 'company-1', is_disabled: true },
      { id: 'foreign', company_id: 'company-2', is_disabled: false },
    ],
    permissions: [{ id: 'receive', key: 'receive_calls' }, { id: 'view', key: 'view_calls' }],
    roles: [{ id: 'receiver', company_id: 'company-1', name: 'Acquisitions Manager', is_system: true }, { id: 'viewer', company_id: 'company-1' }, { id: 'foreign-role', company_id: 'company-2' }],
    role_permissions: [{ role_id: 'receiver', permission_id: 'receive' }, { role_id: 'viewer', permission_id: 'view' }, { role_id: 'foreign-role', permission_id: 'receive' }],
    user_roles: [
      { user_id: 'user-a', role_id: 'receiver' }, { user_id: 'user-b', role_id: 'receiver' },
      { user_id: 'disabled', role_id: 'receiver' }, { user_id: 'unauthorized', role_id: 'viewer' },
      { user_id: 'foreign', role_id: 'foreign-role' },
    ],
    teams: [{ id: 'team-1', company_id: 'company-1' }, { id: 'empty', company_id: 'company-1' }, { id: 'foreign-team', company_id: 'company-2' }],
    team_members: [{ team_id: 'team-1', user_id: 'user-a' }, { team_id: 'team-1', user_id: 'user-b' }, { team_id: 'team-1', user_id: 'unauthorized' }, { team_id: 'team-1', user_id: 'foreign' }],
    company_credentials: ['account_sid', 'auth_token', 'twiml_app_sid', 'api_key_sid', 'api_key_secret'].map((key) => ({ company_id: 'company-1', provider: 'twilio', credential_key: key, credential_value: 'mock-' + key })),
    phone_numbers: [{ id: 'number', company_id: 'company-1', number_type: 'shared_acquisition_automation', number: '+15555550100', provider: 'twilio', registration_status: 'registered', is_active: true, ...options }],
    contacts: [], conversations: [], calls: [], call_recordings: [],
  };
  const writes = [];
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: authId } } }) },
    from(table) {
      let filters = [], single = false, count = Infinity, inserted;
      const q = {
        select() { return q; }, eq(key, value) { filters.push((row) => row[key] === value); return q; },
        in(key, values) { filters.push((row) => values.includes(row[key])); return q; },
        not(key, _operator, value) { filters.push((row) => (row[key] ?? null) !== value); return q; },
        limit(value) { count = value; return q; }, maybeSingle() { single = true; return q; }, single() { single = true; return q; },
        insert(row) { inserted = { id: 'mock-created', ...row }; writes.push({ table, row }); return q; },
        then(resolve, reject) {
          const data = inserted ? [inserted] : (rows[table] ?? []).filter((row) => filters.every((filter) => filter(row))).slice(0, count);
          return Promise.resolve({ data: single ? data[0] ?? null : data, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  let handler, identity, grant;
  class AccessToken {
    static VoiceGrant = class { constructor(value) { grant = value; } };
    constructor(_a, _k, _s, value) { identity = value.identity; }
    addGrant() {}
    toJwt() { return 'mock-token'; }
  }
  const context = { Deno: { env: { get: () => 'https://mock.supabase.co' }, serve: (fn) => { handler = fn; } },
    createClient: () => db, twilio: { jwt: { AccessToken }, validateRequest: () => true }, Request, Response, URL, console, Set, Map };
  vm.runInNewContext(code, context);
  return { db, rows, writes, routing: context.routing, handler, token: () => ({ identity, grant }) };
}
for (const id of ['user-a', 'user-b']) test(`${id}: receive-only token identity matches the assigned-line recipient`, async () => {
  const f = fixture(id);
  const response = await f.handler(new Request('https://mock.supabase.co/functions/v1/voice-token', {
    method: 'POST', headers: { Authorization: 'Bearer mock', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'get_token', company_id: 'company-1', user_id: 'attempted-impersonation' }),
  }));
  assert.equal(response.status, 200);
  const recipients = await f.routing.getInboundRecipients(f.db, 'company-1', { assigned_user_id: id });
  assert.deepEqual([...recipients], [id]);
  assert.equal(f.token().identity, f.routing.voiceIdentity(id));
  assert.equal(f.token().grant.incomingAllow, true); assert.equal(f.token().grant.outgoingApplicationSid, undefined);
});
for (const id of ['unauthorized', 'disabled', 'foreign']) test(`${id}: cannot get company-1 token or receive assigned calls`, async () => {
  const f = fixture(id);
  const response = await f.handler(new Request('https://mock.supabase.co/functions/v1/voice-token', {
    method: 'POST', headers: { Authorization: 'Bearer mock', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'get_token', company_id: 'company-1' }),
  }));
  assert.equal(response.status, 403);
  assert.deepEqual([...await f.routing.getInboundRecipients(f.db, 'company-1', { assigned_user_id: id })], []);
});
test('shared Acquisition line includes eligible Acquisition members without assigned numbers', async () => {
  const f = fixture();
  assert.deepEqual([...await f.routing.getInboundRecipients(f.db, 'company-1', { number_type: 'shared_acquisition_automation' })].sort(), ['user-a', 'user-b']);
});
test('team line filters eligibility and never falls back outside an empty team', async () => {
  const f = fixture();
  assert.deepEqual([...await f.routing.getInboundRecipients(f.db, 'company-1', { assigned_team_id: 'team-1' })].sort(), ['user-a', 'user-b']);
  assert.deepEqual([...await f.routing.getInboundRecipients(f.db, 'company-1', { assigned_team_id: 'empty' })], []);
});
test('assigned user takes precedence over team; ineligible assignee does not broadcast', async () => {
  const f = fixture();
  assert.deepEqual([...await f.routing.getInboundRecipients(f.db, 'company-1', { assigned_user_id: 'user-a', assigned_team_id: 'team-1' })], ['user-a']);
  assert.deepEqual([...await f.routing.getInboundRecipients(f.db, 'company-1', { assigned_user_id: 'unauthorized', assigned_team_id: 'team-1' })], []);
});
test('inbound TwiML uses both eligible identities and preserves recording and history configuration', async () => {
  const f = fixture();
  const response = await f.handler(new Request('https://mock.supabase.co/functions/v1/voice-token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-twilio-signature': 'mock' },
    body: new URLSearchParams({ To: '+15555550100', From: '+15555550200', AccountSid: 'mock-account_sid', CallSid: 'mock-call' }),
  }));
  assert.equal(response.status, 200); const xml = await response.text();
  assert.match(xml, /<Identity>user_user_a<\/Identity>/); assert.match(xml, /<Identity>user_user_b<\/Identity>/);
  assert.doesNotMatch(xml, /unauthorized|foreign|disabled/);
  assert.match(xml, /record="record-from-answer-dual"/); assert.match(xml, /action=inbound-status/);
  assert.match(xml, /action=recording-callback/); assert.match(xml, /name="CallId"/);
  assert.equal(f.writes.filter((w) => w.table === 'calls').length, 1);
  assert.equal(f.writes.filter((w) => w.table === 'call_recordings').length, 1);
  assert.equal((xml.match(/<Dial /g) ?? []).length, 1);
  assert.equal((xml.match(/<Client>/g) ?? []).length, 2);
});

test('shared Acquisition excludes assigned agents, unrelated authorized roles, and agency admins outside that role', async () => {
  const f = fixture();
  f.rows.phone_numbers.push({ id: 'dedicated', company_id: 'company-1', assigned_user_id: 'user-a', is_active: false });
  f.rows.profiles.push({ id: 'manager', company_id: 'company-1', is_disabled: false, is_agency_admin: true });
  f.rows.role_permissions.push({ role_id: 'viewer', permission_id: 'receive' });
  assert.deepEqual([...await f.routing.getInboundRecipients(f.db, 'company-1', { number_type: 'shared_acquisition_automation' })], ['user-b']);
});
test('assignment removal automatically includes the Acquisition user; assignment addition removes them', async () => {
  const f = fixture(); const number = { number_type: 'shared_acquisition_automation' };
  f.rows.phone_numbers.push({ id: 'personal', company_id: 'company-1', assigned_user_id: 'user-a' });
  assert.deepEqual([...await f.routing.getInboundRecipients(f.db, 'company-1', number)], ['user-b']);
  f.rows.phone_numbers.pop();
  assert.deepEqual([...await f.routing.getInboundRecipients(f.db, 'company-1', number)].sort(), ['user-a', 'user-b']);
});
test('blank or unrelated number type never implies company-wide membership; dedicated numbers never use team fallback', async () => {
  const f = fixture();
  for (const number of [{}, { number_type: 'shared_disposition' }, { number_type: 'dedicated', assigned_team_id: 'team-1' }]) {
    assert.deepEqual([...await f.routing.getInboundRecipients(f.db, 'company-1', number)], []);
  }
  assert.deepEqual([...await f.routing.getInboundRecipients(f.db, 'company-1', { assigned_team_id: 'foreign-team' })], []);
});
test('Acquisition membership still requires receive_calls; another company role cannot establish membership', async () => {
  const f = fixture(); f.rows.role_permissions = [];
  assert.deepEqual([...await f.routing.getInboundRecipients(f.db, 'company-1', { number_type: 'shared_acquisition_automation' })], []);
  const other = fixture(); other.rows.roles[0].company_id = 'company-2';
  assert.deepEqual([...await other.routing.getInboundRecipients(other.db, 'company-1', { number_type: 'shared_acquisition_automation' })], []);
});
test('more than ten eligible members fails explicitly instead of silently excluding recipients', async () => {
  const f = fixture();
  for (let i = 0; i < 9; i++) {
    f.rows.profiles.push({ id: 'extra-' + i, company_id: 'company-1', is_disabled: false });
    f.rows.user_roles.push({ user_id: 'extra-' + i, role_id: 'receiver' });
  }
  await assert.rejects(() => f.routing.getInboundRecipients(f.db, 'company-1', { number_type: 'shared_acquisition_automation' }), /ten-recipient/);
});
