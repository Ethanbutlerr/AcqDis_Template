// Real React/Radix with isolated SDK, auth and database mocks. No network calls.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
for (const key of Object.getOwnPropertyNames(dom.window)) {
  if (!(key in global)) Object.defineProperty(global, key, Object.getOwnPropertyDescriptor(dom.window, key));
}
global.window = dom.window;
global.document = dom.window.document;
global.getComputedStyle = dom.window.getComputedStyle;
global.Event = dom.window.Event;
global.CustomEvent = dom.window.CustomEvent;
global.IS_REACT_ACT_ENVIRONMENT = true;
window.PointerEvent = window.MouseEvent;
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = require('react-dom/test-utils');
const h = React.createElement;
const Auth = React.createContext(null);
let devices, tokens, updates, roots, activeNumber, tokenGate, registerError, historyRow, historyWrites, writeGate;
class MockCall extends EventEmitter {
  static Codec = { Opus: 'opus', PCMU: 'pcmu' };
  state = 'pending'; accepts = 0; rejects = 0; ignores = 0; disconnects = 0; muted = false;
  customParameters = new Map([['CallId', 'call-1'], ['CallerName', 'Ada Caller'], ['CallerNumber', '+15555550100']]);
  parameters = {};
  // The real Device also has an internal error listener.
  constructor() { super(); this.on('error', () => {}); }
  status() { return this.state; }
  accept() { this.accepts++; this.state = 'connecting'; }
  reject() { this.rejects++; this.remote('reject'); }
  ignore() { this.ignores++; this.state = 'closed'; }
  disconnect() { this.disconnects++; this.remote('disconnect'); }
  mute(value) { this.muted = value; }
  remote(event) { this.state = event === 'accept' ? 'open' : 'closed'; this.emit(event); }
}
class MockDevice extends EventEmitter {
  registers = 0; destroys = 0; refreshed = [];
  constructor(token) { super(); this.token = token; devices.push(this); }
  async register() { this.registers++; if (registerError) throw new Error('Mock registration failed'); this.emit('registered'); }
  destroy() { this.destroys++; this.removeAllListeners(); }
  updateToken(token) { this.refreshed.push(token); }
}
const supabase = {
  functions: { invoke: async (_name, { body }) => {
    tokens.push(body);
    if (tokenGate) return await tokenGate;
    return { data: { token: `${body.company_id}:${body.user_id}` } };
  } },
  from(table) {
    const filters = {};
    let mutation;
    const q = {
      select() { return q; }, eq(key, value) { filters[key] = value; return q; }, limit() { return q; }, maybeSingle() { return q; },
      is(key, value) { filters[key] = value; return q; },
      update(row) { mutation = row; updates.push({ table, row, filters }); return q; },
      then(resolve, reject) {
        return Promise.resolve(writeGate).then(() => {
          let written = false;
          if (table === 'calls' && mutation && Object.entries(filters).every(([key, value]) => historyRow[key] === value)) {
            Object.assign(historyRow, mutation); historyWrites.push(mutation); written = true;
          }
          return { data: mutation ? (written ? [{ id: historyRow.id }] : []) : table === 'phone_numbers' && activeNumber ? { id: 'number-1' } : null };
        }).then(resolve, reject);
      },
    };
    return q;
  },
};
const repo = path.resolve(__dirname, '../..');
const load = Module._load;
Module._load = function (id, parent, isMain) {
  if (id === '@twilio/voice-sdk') return { Device: MockDevice, Call: MockCall };
  if (id === '@/lib/supabase/client') return { supabase };
  if (id === '@/lib/auth/auth-context') return { useAuth: () => React.useContext(Auth) };
  return load.call(this, id.startsWith('@/') ? path.join(repo, id.slice(2)) : id, parent, isMain);
};
for (const extension of ['.ts', '.tsx']) Module._extensions[extension] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, filename);
};
const { IncomingCallListener } = require('../../components/incoming-call-listener.tsx');
const user = (id, allowed = true, company = 'company-1') => ({ profile: { id, company_id: company }, permissions: allowed ? ['receive_calls'] : ['view_calls'] });
async function flush() { await act(async () => new Promise((resolve) => setTimeout(resolve, 5))); }
function reset() {
  devices = []; tokens = []; updates = []; roots = []; activeNumber = true; tokenGate = null; registerError = false;
  historyRow = { id: 'call-1', company_id: 'company-1', direction: 'inbound', status: 'ringing', assigned_user_id: null };
  historyWrites = []; writeGate = null;
}
async function mount(auth = user('user-a'), strict = false) {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const render = async (value) => {
    const app = h(Auth.Provider, { value }, h(IncomingCallListener));
    await act(async () => root.render(strict ? h(React.StrictMode, null, app) : app)); await flush();
  };
  await render(auth); return { container, render };
}
function findButton(label, scope = document) {
  return [...scope.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent.trim() === label);
}
async function click(label, scope) {
  const button = findButton(label, scope); assert.ok(button, `Missing ${label}`);
  await act(async () => {
    button.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0 })); button.click();
  }); await flush();
}
async function incoming(device = devices[0], call = new MockCall()) {
  await act(async () => device.emit('incoming', call)); await flush(); return call;
}
afterEach(async () => {
  for (const root of roots ?? []) await act(async () => root.unmount());
  await flush(); document.body.innerHTML = '';
});

for (const id of ['user-a', 'user-b']) {
  test(`${id}: icon opens empty panel without registering again or answering`, async () => {
    reset(); await mount(user(id));
    assert.equal(devices[0].token, `company-1:${id}`);
    for (let i = 0; i < 3; i++) { await click('Open incoming calls'); assert.match(document.body.textContent, /No incoming calls/); await click('Close'); }
    assert.equal(devices.length, 1); assert.equal(devices[0].registers, 1); assert.equal(tokens.length, 1);
    assert.equal(devices[0].listenerCount('incoming'), 1);
    const call = await incoming(); assert.equal(call.accepts, 0);
    assert.match(document.body.textContent, /Ada Caller/); assert.match(document.body.textContent, /15555550100/);
    await click('Answer call'); assert.equal(call.accepts, 1);
    await act(async () => { call.remote('accept'); call.emit('accept'); });
    assert.equal(updates.length, 1); assert.equal(updates[0].row.assigned_user_id, id);
    assert.equal(updates[0].filters.company_id, 'company-1');
    assert.equal(updates[0].filters.status, 'ringing');
    assert.equal(updates[0].filters.direction, 'inbound');
    assert.equal(updates[0].filters.assigned_user_id, null);
    await click('Mute'); await click('Close'); await click('Open incoming calls');
    assert.ok(findButton('Unmute')); assert.equal(call.disconnects, 0);
    await click('End call'); assert.equal(call.disconnects, 1);
    assert.match(document.body.textContent, /No incoming calls/);
  });
}
test('unauthorized user has no incoming UI, token, device or data access', async () => {
  reset(); await mount(user('unauthorized', false));
  assert.equal(document.querySelector('button'), null); assert.equal(devices.length, 0); assert.equal(tokens.length, 0);
});
for (const dismiss of ['Close', 'Escape', 'outside']) test(`${dismiss} dismisses without rejecting; ringing call can be reopened and declined`, async () => {
  reset(); await mount(); const call = await incoming();
  if (dismiss === 'Close') await click('Close');
  else {
    await act(async () => dismiss === 'Escape'
      ? document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      : document.body.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0 })));
    await flush();
  }
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(call.rejects, 0); assert.equal(call.disconnects, 0); assert.equal(call.accepts, 0);
  await click('Incoming call ringing — open incoming calls');
  assert.ok(findButton('Answer call')); await click('Decline call');
  assert.equal(call.ignores, 1); assert.equal(call.rejects, 0);
  assert.equal(findButton('Answer call'), undefined);
});
for (const terminal of ['cancel', 'disconnect', 'reject']) test(`${terminal} removes stale actions even when dismissed`, async () => {
  reset(); await mount(); const call = await incoming(); await click('Close');
  await act(async () => call.remote(terminal)); await click('Open incoming calls');
  assert.equal(findButton('Answer call'), undefined); assert.equal(findButton('End call'), undefined);
  assert.equal(call.listenerCount('accept'), 0); assert.equal(call.disconnects, 0); assert.equal(call.rejects, 0);
});
test('two authorized sessions: one answers; cancellation removes the other offer', async () => {
  reset(); const a = await mount(user('user-a')); const b = await mount(user('user-b'));
  const callA = await incoming(devices[0]); await click('Close');
  const callB = await incoming(devices[1]); await click('Answer call');
  await act(async () => { callB.remote('accept'); callA.remote('cancel'); }); await click('Close');
  await click('Open incoming calls', a.container); assert.equal(findButton('Answer call'), undefined); await click('Close');
  await click('Open incoming calls', b.container); assert.ok(findButton('End call'));
  assert.equal(updates.length, 1); assert.equal(updates[0].row.assigned_user_id, 'user-b');
});
test('StrictMode, rerenders, repeated incoming events and double Answer do not duplicate listeners or calls', async () => {
  reset(); const app = await mount(user('user-a'), true);
  await app.render(user('user-a')); assert.equal(devices.length, 1);
  const call = await incoming(); await incoming(devices[0], call);
  assert.equal(call.listenerCount('accept'), 1); assert.equal(call.rejects, 0);
  const answer = findButton('Answer call'); await act(async () => { answer.click(); answer.click(); });
  assert.equal(call.accepts, 1); assert.equal(devices[0].listenerCount('incoming'), 1);
});
test('disconnected/unavailable state differs from empty; retry is explicit and guarded', async () => {
  reset(); registerError = true; await mount(); await click('Open incoming calls');
  assert.match(document.body.textContent, /Calling disconnected/); assert.doesNotMatch(document.body.textContent, /No incoming calls/);
  await click('Close'); await click('Open incoming calls'); assert.equal(devices.length, 1);
  registerError = false; await click('Reconnect calling'); assert.equal(devices.length, 2); assert.equal(devices[0].destroys, 1);
  assert.equal(devices[0].listenerCount('incoming'), 0); await click('Open incoming calls'); assert.match(document.body.textContent, /No incoming calls/);
});
test('no configured number is unavailable, not empty', async () => {
  reset(); activeNumber = false; await mount(); await click('Open incoming calls');
  assert.match(document.body.textContent, /Incoming calling unavailable/); assert.equal(tokens.length, 0);
});
test('late token after permission revocation cannot register a device', async () => {
  reset(); let resolve; tokenGate = new Promise((r) => { resolve = r; });
  const app = await mount(); await app.render(user('user-a', false));
  await act(async () => resolve({ data: { token: 'stale' } })); await flush();
  assert.equal(devices.length, 0);
});
test('company switch cleans up old device and ignores its events and refresh result', async () => {
  reset(); const app = await mount(); const old = devices[0];
  let resolve; tokenGate = new Promise((r) => { resolve = r; });
  await act(async () => old.emit('tokenWillExpire'));
  tokenGate = null; await app.render(user('user-a', true, 'company-2'));
  await act(async () => resolve({ data: { token: 'stale-refresh' } }));
  assert.equal(old.destroys, 1); assert.equal(old.refreshed.length, 0); assert.equal(old.listenerCount('incoming'), 0);
  assert.equal(devices[1].token, 'company-2:user-a');
});
test('late old-call events cannot clear a subsequent offer; remote hangup clears connected controls', async () => {
  reset(); await mount(); const old = await incoming(); await act(async () => old.remote('disconnect'));
  const next = await incoming(); await act(async () => old.emit('cancel')); assert.ok(findButton('Answer call'));
  await click('Answer call'); await act(async () => next.remote('accept')); await act(async () => next.remote('disconnect'));
  assert.equal(findButton('End call'), undefined); assert.equal(updates.length, 1);
});

// Contract double for one Twilio Dial with several Client legs. Twilio chooses
// the first answer; this does not claim to verify Twilio's live implementation.
function sharedDial(offers) {
  const attempts = [];
  let winner = null;
  let canceled = false;
  for (const call of offers) call.accept = () => {
    if (canceled || call.state === 'closed') return;
    call.accepts++; call.state = 'connecting'; attempts.push(call);
  };
  return {
    settle() {
      if (winner || canceled) return;
      winner = attempts.find((call) => call.state !== 'closed');
      if (!winner) return;
      for (const call of offers) if (call !== winner && call.state !== 'closed') call.remote('cancel');
      winner.remote('accept');
    },
    cancel() { canceled = true; for (const call of offers) if (call.state !== 'closed') call.remote('cancel'); },
    get winner() { return winner; },
  };
}
for (const first of [0, 1]) test(`simultaneous answers: recipient ${first + 1} wins; loser closes and cannot overwrite history`, async () => {
  reset(); await mount(user('user-a')); await mount(user('user-b'));
  const a = await incoming(devices[0]); const answerA = findButton('Answer call');
  const b = await incoming(devices[1]);
  const answerB = [...document.querySelectorAll('button[aria-label="Answer call"]')].find((button) => button !== answerA);
  const dial = sharedDial([a, b]); const buttons = [answerA, answerB];
  await act(async () => { buttons[first].click(); buttons[1 - first].click(); dial.settle(); }); await flush();
  assert.equal(a.accepts + b.accepts, 2);
  assert.equal([a, b].filter((call) => call.status() === 'open').length, 1);
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 1);
  assert.ok(findButton('End call')); assert.equal(findButton('Answer call'), undefined);
  assert.equal(updates.length, 1); assert.equal(historyWrites.length, 1);
  assert.equal(historyRow.assigned_user_id, first === 0 ? 'user-a' : 'user-b');
  const loser = [a, b][1 - first];
  await act(async () => { loser.emit('accept'); buttons[1 - first].click(); });
  assert.equal(updates.length, 1); assert.equal(loser.listenerCount('accept'), 0);
});
test('one recipient declines locally while the other stays ringing and can answer', async () => {
  reset(); await mount(user('user-a')); await mount(user('user-b'));
  const a = await incoming(devices[0]); const declineA = findButton('Decline call');
  const b = await incoming(devices[1]); const dial = sharedDial([a, b]);
  await act(async () => declineA.click()); await flush();
  assert.equal(a.ignores, 1); assert.equal(a.rejects, 0); assert.equal(a.disconnects, 0);
  assert.equal(b.status(), 'pending'); assert.equal(b.ignores + b.rejects + b.disconnects, 0);
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 1);
  await click('Answer call'); await act(async () => dial.settle());
  assert.equal(dial.winner, b); assert.equal(historyWrites.length, 1); assert.equal(historyRow.assigned_user_id, 'user-b');
});
test('caller cancellation clears every panel and ringing alert; stale Answer cannot accept', async () => {
  reset(); const sessionA = await mount(user('user-a')); await mount(user('user-b'));
  const a = await incoming(devices[0]); const staleAnswer = findButton('Answer call');
  const b = await incoming(devices[1]); const dial = sharedDial([a, b]);
  await act(async () => dial.cancel()); await flush();
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 0);
  assert.equal(findButton('Incoming call ringing — open incoming calls'), undefined);
  await act(async () => { staleAnswer.click(); a.emit('accept'); b.emit('accept'); });
  assert.equal(a.accepts + b.accepts, 0); assert.equal(historyWrites.length, 0);
  await click('Open incoming calls', sessionA.container);
  assert.match(document.body.textContent, /No incoming calls/); assert.equal(findButton('Answer call'), undefined);
});
test('delayed accept history records the winner without reopening a call completed by the server', async () => {
  reset(); await mount(); const call = await incoming();
  let release; writeGate = new Promise((resolve) => { release = resolve; });
  await click('Answer call'); await act(async () => call.remote('accept'));
  historyRow.status = 'completed';
  await act(async () => { call.remote('disconnect'); release(); });
  assert.equal(historyRow.status, 'completed'); assert.equal(historyWrites.length, 1);
  assert.equal(historyRow.assigned_user_id, 'user-a');
  assert.equal(historyWrites[0].status, undefined);
});

test('an existing recorded winner cannot be overwritten by a late browser accept', async () => {
  reset(); await mount(); const call = await incoming();
  historyRow.status = 'completed'; historyRow.assigned_user_id = 'user-b';
  await click('Answer call'); await act(async () => call.remote('accept')); await flush();
  assert.equal(historyRow.assigned_user_id, 'user-b'); assert.equal(historyRow.status, 'completed');
  assert.equal(historyWrites.length, 0);
});
