// Real React/Radix UI, mocked Twilio and Supabase. No network or real calls.
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
global.Event = window.Event;
global.CustomEvent = window.CustomEvent;
global.IS_REACT_ACT_ENVIRONMENT = true;
window.PointerEvent = window.MouseEvent;
global.PointerEvent = window.MouseEvent;
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = require('react-dom/test-utils');
const h = React.createElement;
const realSetTimeout = global.setTimeout;
const realClearTimeout = global.clearTimeout;
const realSetInterval = global.setInterval;
const realClearInterval = global.clearInterval;
let completions, intervals, devices, calls, inserts, updates, notes, tokenResult, connectResult, root;
let completionCount;

class MockCall extends EventEmitter {
  static Codec = { Opus: 'opus', PCMU: 'pcmu' };
  static State = { Open: 'open', Ringing: 'ringing', Closed: 'closed' };
  state = 'connecting';
  disconnects = 0;
  muted = false;
  constructor() { super(); calls.push(this); }
  status() { return this.state; }
  transition(event, error) {
    if (event === 'accept') this.state = 'open';
    if (event === 'ringing') this.state = 'ringing';
    if (event === 'disconnect' || event === 'cancel') this.state = 'closed';
    this.emit(event, error);
  }
  disconnect() { this.disconnects++; this.transition('disconnect'); }
  mute(value) { this.muted = value; }
}
class MockDevice extends EventEmitter {
  destroys = 0;
  connects = 0;
  constructor() { super(); devices.push(this); }
  async connect(options) {
    this.connects++;
    this.options = options;
    return connectResult ? await connectResult : new MockCall();
  }
  destroy() { this.destroys++; }
}
const supabase = {
  functions: { invoke: async () => tokenResult ? await tokenResult : { data: { token: 'mock-only' } } },
  from(table) {
    const query = {
      select() { return query; }, eq() { return query; }, neq() { return query; }, limit() { return query; }, in() { return query; },
      insert(row) {
        inserts.push({ table, row });
        if (table === 'notes') notes.push({ ...row, id: 'note-1', created_at: new Date().toISOString() });
        return query;
      },
      update(row) { updates.push({ table, row }); return query; },
      then(resolve, reject) { return Promise.resolve({ data: table === 'notes' ? [...notes] : [], error: null }).then(resolve, reject); },
    };
    return query;
  },
};
const repo = path.resolve(__dirname, '../..');
const originalLoad = Module._load;
Module._load = function (id, parent, isMain) {
  if (id === '@twilio/voice-sdk') return { Device: MockDevice, Call: MockCall };
  if (id === '@/lib/supabase/client') return { supabase };
  if (id === '@/lib/auth/auth-context') return { useAuth: () => ({
    profile: { id: 'user-1', company_id: 'company-1' }, user: { id: 'user-1' }, permissions: ['make_calls'],
  }) };
  return originalLoad.call(this, id.startsWith('@/') ? path.join(repo, id.slice(2)) : id, parent, isMain);
};
for (const extension of ['.ts', '.tsx']) Module._extensions[extension] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, filename);
};
const { OutboundCallProvider } = require('../../components/conversations/outbound-call-provider.tsx');
const { useOutboundCall } = require('../../components/conversations/outbound-call-context.tsx');
const { Sheet, SheetContent, SheetTitle } = require('../../components/ui/sheet.tsx');
const { NotesSection } = require('../../components/notes-section.tsx');
const target = { contactName: 'Ada Lead', contactPhone: '+15555550100', companyId: 'company-1', contactId: 'contact-1', conversationId: 'conversation-1', acquisitionId: 'lead-1', opportunityId: 'opportunity-1' };
function Launcher() {
  const { openCall } = useOutboundCall();
  return h('button', { onClick: () => openCall(target) }, 'Open call');
}
function Fixture({ drawer }) {
  const { openCall } = useOutboundCall();
  const [showDrawer, setShowDrawer] = React.useState(drawer);
  return h(React.Fragment, null,
    h('button', { onClick: () => setShowDrawer(true) }, 'Open lead'),
    h('button', { onClick: () => openCall({ ...target, contactName: 'Other lead', contactId: 'other' }) }, 'Call another lead'),
    !showDrawer && h(Launcher),
    showDrawer && h(Sheet, { open: true, onOpenChange: setShowDrawer },
      h(SheetContent, { 'aria-describedby': undefined }, h(SheetTitle, null, 'Lead details'), h(Launcher),
        h(NotesSection, { entityType: 'acquisition_record', entityId: 'lead-1', companyId: 'company-1' }))),
  );
}
async function flush() { await act(async () => { await new Promise((r) => realSetTimeout(r, 5)); }); }
async function mount(drawer = false) {
  completions = new Map(); intervals = new Map(); devices = []; calls = []; inserts = []; updates = []; notes = [];
  tokenResult = null; connectResult = null; completionCount = 0;
  global.setTimeout = (fn, ms, ...args) => {
    if (ms !== 1500) return realSetTimeout(fn, ms, ...args);
    const id = {}; completions.set(id, fn); completionCount++; return id;
  };
  global.clearTimeout = (id) => { completions.delete(id); realClearTimeout(id); };
  global.setInterval = (fn) => { const id = {}; intervals.set(id, fn); return id; };
  global.clearInterval = (id) => { intervals.delete(id); realClearInterval(id); };
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(h(OutboundCallProvider, null, h(Fixture, { drawer }))));
  await flush();
  await click('Open call');
}
function button(label, scope = document) {
  const result = [...scope.querySelectorAll('button')].find((el) => el.textContent.trim() === label || el.getAttribute('aria-label') === label);
  assert.ok(result, `Missing button: ${label}`); return result;
}
async function click(label, scope) {
  const target = button(label, scope);
  await act(async () => {
    target.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    target.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0 }));
    target.click();
  });
  await flush();
}
function bar() { return document.querySelector('section[aria-label="Current call"]'); }
function dialogCount() { return document.querySelectorAll('[role="dialog"]').length; }
function history() { return inserts.filter((entry) => entry.table === 'calls'); }
async function emit(event, error) { await act(async () => calls[0].transition(event, error)); }
async function runCompletion() {
  await act(async () => { for (const [id, fn] of [...completions]) { completions.delete(id); fn(); } });
  await flush();
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  await flush(); root = null; document.body.innerHTML = '';
  global.setTimeout = realSetTimeout; global.clearTimeout = realClearTimeout;
  global.setInterval = realSetInterval; global.clearInterval = realClearInterval;
});

for (const phase of ['initializing', 'connecting', 'ringing', 'connected']) {
  for (const dismissal of ['outside', 'Escape', 'Minimize', 'Close']) {
    test(`${phase}: ${dismissal} and Restore preserve the connection`, async () => {
      await mount();
      let resolveToken;
      if (phase === 'initializing') tokenResult = new Promise((resolve) => { resolveToken = resolve; });
      await click('Call Now');
      if (phase === 'ringing') await emit('ringing');
      if (phase === 'connected') await emit('accept');
      if (dismissal === 'outside') {
        await act(async () => document.body.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0 })));
        await flush();
      } else if (dismissal === 'Escape') {
        await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        await flush();
      } else await click(dismissal);
      assert.ok(bar()); assert.equal(dialogCount(), 0);
      assert.equal(document.body.style.pointerEvents, '');
      assert.ok(bar().textContent.includes({ initializing: 'Initializing...', connecting: 'Connecting...', ringing: 'Ringing...', connected: 'Connected' }[phase]));
      assert.equal(document.activeElement, button('Restore'));
      if (phase === 'connected') {
        await act(async () => { for (const tick of intervals.values()) tick(); });
        assert.match(bar().textContent, /0:01/);
      }
      await click('Restore'); assert.equal(bar(), null); assert.equal(dialogCount(), 1);
      if (phase === 'initializing') {
        await act(async () => resolveToken({ data: { token: 'mock-only' } })); await flush();
      }
      assert.equal(devices.length, 1); assert.equal(devices[0].connects, 1);
      assert.equal(calls[0].disconnects, 0); assert.equal(devices[0].destroys, 0);
      for (const event of ['accept', 'ringing', 'disconnect', 'cancel', 'error']) assert.equal(calls[0].listenerCount(event), 1);
      assert.equal(history().length, 0);
      await click('End Call'); assert.equal(calls[0].disconnects, 1); assert.equal(history().length, 1);
    });
  }
}

test('notes save in the real drawer while minimized; closing/reopening the drawer retains the call and mute', async () => {
  await mount(true); await click('Call Now'); await emit('accept'); await click('Mute'); await click('Minimize');
  assert.equal(dialogCount(), 1); // Only the lead drawer remains modal.
  const drawer = document.querySelector('[role="dialog"]');
  assert.ok(drawer.contains(bar()));
  assert.equal(bar().closest('[aria-hidden="true"]'), null);
  const textarea = drawer.querySelector('textarea'); assert.ok(textarea);
  await act(async () => {
    textarea.focus();
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'Reviewed during call');
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  assert.equal(document.activeElement, textarea);
  const saveNote = textarea.parentElement.querySelector('button');
  assert.ok(saveNote); assert.equal(saveNote.disabled, false);
  await act(async () => saveNote.click()); await flush();
  assert.equal(inserts.filter((entry) => entry.table === 'notes').length, 1);
  assert.equal(notes[0].body, 'Reviewed during call');
  await click('Close', drawer); assert.equal(dialogCount(), 0); assert.ok(bar());
  await click('Open lead'); assert.ok(document.querySelector('[role="dialog"]').contains(bar()));
  await click('Restore'); assert.equal(button('Unmute').getAttribute('aria-pressed'), 'true');
  assert.equal(calls[0].muted, true); assert.equal(calls[0].disconnects, 0);
  assert.equal(devices.length, 1); assert.equal(devices[0].destroys, 0);
  assert.equal(devices[0].options.params.Record, 'true');
});

for (const minimized of [false, true]) for (const terminal of ['disconnect', 'cancel', 'error', 'End Call']) {
  test(`${terminal}: completion is handled once (${minimized ? 'minimized' : 'expanded'})`, async () => {
    await mount(); await click('Call Now');
    if (terminal !== 'cancel') await emit('accept');
    if (minimized) await click('Minimize');
    if (terminal === 'End Call') await click('End Call');
    else if (terminal === 'error') {
      calls[0].state = 'closed'; await emit('error', new Error('Mock failure'));
    } else await emit(terminal);
    await emit('disconnect'); await emit('cancel'); await emit('error', new Error('Late duplicate'));
    assert.equal(history().length, 1); assert.equal(updates.length, 1); assert.equal(intervals.size, 0);
    assert.equal(history()[0].row.contact_id, target.contactId);
    assert.equal(history()[0].row.acquisition_record_id, target.acquisitionId);
    assert.equal(history()[0].row.opportunity_id, target.opportunityId);
    assert.equal(history()[0].row.status, terminal === 'error' ? 'failed' : terminal === 'cancel' ? 'missed' : 'answered');
    assert.equal([...document.querySelectorAll('button')].some((el) => el.textContent.includes('End Call')), false);
    assert.equal(calls[0].disconnects, terminal === 'End Call' ? 1 : 0);
    assert.equal(completionCount, terminal === 'error' ? 0 : 1);
    if (terminal !== 'error') { await runCompletion(); assert.equal(bar(), null); assert.equal(dialogCount(), 0); }
    else { if (minimized) await click('Restore'); assert.ok(button('Call Now')); }
  });
}

test('another launcher restores the original target without a second call', async () => {
  await mount(); await click('Call Now'); await emit('accept'); await click('Minimize');
  await click('Call another lead');
  assert.match(document.querySelector('[role="dialog"]').textContent, /Ada Lead/);
  assert.equal(devices.length, 1); assert.equal(calls.length, 1); assert.equal(calls[0].disconnects, 0);
});

test('End Call during token retrieval cancels the attempt and ignores its late result', async () => {
  await mount(); let resolveToken;
  tokenResult = new Promise((resolve) => { resolveToken = resolve; });
  await click('Call Now'); await click('Minimize'); await click('End Call');
  await act(async () => resolveToken({ data: { token: 'mock-only' } }));
  assert.equal(devices.length, 0); assert.equal(history().length, 1); assert.equal(completionCount, 1);
  await runCompletion(); assert.equal(bar(), null);
});

test('End Call during device.connect disconnects a late call without resurrecting the UI', async () => {
  await mount(); let resolveConnect;
  connectResult = new Promise((resolve) => { resolveConnect = resolve; });
  await click('Call Now'); await click('Minimize'); await click('End Call');
  const lateCall = new MockCall(); await act(async () => resolveConnect(lateCall));
  assert.equal(lateCall.disconnects, 1); assert.equal(history().length, 1); assert.equal(completionCount, 1);
  await runCompletion(); assert.equal(bar(), null);
});

test('duplicate accepts do not duplicate timers; recoverable errors keep End Call available', async () => {
  await mount(); await click('Call Now'); await emit('accept'); await emit('accept');
  assert.equal(intervals.size, 1);
  await emit('error', new Error('Temporary media warning'));
  assert.equal(history().length, 0); assert.equal(calls[0].disconnects, 0); assert.ok(button('End Call'));
  await click('End Call'); assert.equal(history().length, 1);
});

test('rapid start clicks and retry after failure do not duplicate calls or retain old listeners', async () => {
  await mount();
  const start = button('Call Now');
  await act(async () => { start.click(); start.click(); }); await flush();
  assert.equal(devices.length, 1); assert.equal(calls.length, 1);
  const oldCall = calls[0];
  oldCall.state = 'closed'; await emit('error', new Error('Terminal failure'));
  await click('Call Now');
  assert.equal(devices.length, 2); assert.equal(calls.length, 2);
  for (const event of ['accept', 'ringing', 'disconnect', 'cancel', 'error']) assert.equal(oldCall.listenerCount(event), 0);
  await act(async () => { oldCall.transition('accept'); oldCall.transition('disconnect'); calls[1].transition('accept'); });
  assert.equal(history().length, 1); assert.equal(intervals.size, 1);
  await click('End Call'); assert.equal(calls[1].disconnects, 1); assert.equal(history().length, 2);
});

test('remote completion in the drawer removes only the call UI and leaves notes usable', async () => {
  await mount(true); await click('Call Now'); await emit('accept'); await click('Minimize');
  await emit('disconnect'); await runCompletion();
  assert.equal(bar(), null); assert.equal(dialogCount(), 1);
  const textarea = document.querySelector('textarea');
  await act(async () => textarea.focus()); assert.equal(document.activeElement, textarea);
  assert.equal(history().length, 1); assert.equal(completionCount, 1);
});
