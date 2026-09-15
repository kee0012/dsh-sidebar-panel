/**
 * Smoke test for the dsh-sidebar-panel browser bundle.
 *
 * Loads client/client.js under a stub of the DSH client runtime contract and
 * asserts the registrations the shipped right Sidebar's tab registry expects:
 *
 *   A. shape   — the bundle registers a `sidebarRightTabs` tab TYPE
 *                (id/kind/priority 'extension'/thunked title/guide) and its
 *                BODY in the keyed `sidebar.right.pane.tab` seat under the same
 *                id, plus the session header utility toggle. It must NOT touch
 *                `rightbar`, `details`, `dsh-sidebar-panel.session` or the
 *                shipped header corner — the whole point of the migration is
 *                that the shipped 文件 / 文档预览 / 引导 tabs keep working.
 *   B. nav     — the toggle only navigates: `openTab(kind)` when our tab is not
 *                the showing one, `toggleExpanded()` when it is.
 *   C. data    — the 工具 tab's call list comes from the CONVERSATION snapshot's
 *                `chat` view slice (never from the session snapshot), and it
 *                understands the tool-result node shape (head fields nested on
 *                `call`). The panel's close button closes its own tab through
 *                `useTabInfo().tab.actions.close()`.
 *
 *   node test/smoke.client.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// The bundle is a plain script that registers itself with
// `window.__ModuleLoader__`. It is compiled and run in this context on every
// `load()`, so each case gets a fresh factory — no module cache to fight.
const BUNDLE_SOURCE = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');

/* ---------------- runtime stubs ---------------- */

const loaded = [];
globalThis.window = { __ModuleLoader__: { load: m => loaded.push(m) } };

function makeEl() {
  return {
    style: {}, dataset: {}, children: [], isConnected: false,
    textContent: '', title: '', className: '',
    setAttribute() {}, appendChild(c) { this.children.push(c); },
    addEventListener() {}, remove() { this.isConnected = false; },
  };
}
globalThis.document = {
  documentElement: { lang: 'zh' },
  head: makeEl(),
  body: makeEl(),
  getElementById: () => null,
  createElement: makeEl,
  createElementNS: makeEl,
  querySelector: () => null,
};
globalThis.localStorage = { store: {}, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = String(v); } };
globalThis.MutationObserver = class { observe() {} disconnect() {} };
globalThis.fetch = () => new Promise(() => {}); // never settles: effects stay inert

/* Minimal hook runtime: a component can be re-rendered until its state
 * settles, so PanelRoot really reaches the tab the test selected. */
let hookScope = null;
let created = [];
const cleanups = [];
const noop = () => {};

function withHooks(fn, props, passes = 4) {
  const state = [];
  const ranEffects = new Set();
  let out = null;
  for (let pass = 0; pass < passes; pass++) {
    let cursor = 0;
    let effectIndex = 0;
    let dirty = false;
    hookScope = {
      useState(init) {
        const i = cursor++;
        if (!(i in state)) state[i] = typeof init === 'function' ? init() : init;
        return [state[i], next => { if (state[i] !== next) { state[i] = next; dirty = true; } }];
      },
      useEffect(effect) {
        const i = effectIndex++;
        if (ranEffects.has(i)) return;
        ranEffects.add(i);
        const cleanup = effect();
        if (typeof cleanup === 'function') cleanups.push(cleanup);
      },
    };
    cursor = 0;
    out = fn(props);
    if (!dirty) break;
  }
  hookScope = null;
  return out;
}

const React = {
  Fragment: Symbol('Fragment'),
  createElement: (type, props, ...children) => {
    const el = { type, props: props ?? {}, children };
    created.push(el);
    return el;
  },
  useState: init => hookScope.useState(init),
  useEffect: fn => hookScope.useEffect(fn),
  useMemo: fn => fn(),
  useCallback: fn => fn,
  useRef: v => ({ current: v }),
};

/* The Conversation snapshot's `chat` view slice: settled calls are tool-result
 * nodes whose head (name/argsRaw) is nested on `call`; in-flight calls are flat
 * RunningToolCall records; an assistant node carries the request config as
 * `requestConfig` (maxTokens). */
const CHAT = {
  legacy: {
    nodes: [
      { kind: 'tool-result', seq: 3, time: 2000, callId: 'c-settled', call: { name: 'read', argsRaw: '{"path":"a.ts"}' }, content: [{ type: 'text', text: 'ok' }], isError: false, subCalls: [] },
      { kind: 'assistant', seq: 4, time: 2100, requestConfig: { maxTokens: 8192 } },
    ],
    runningCalls: [
      { callId: 'c-running', name: 'exec', argsRaw: '{"cmd":"ls"}', time: 3000 },
    ],
  },
};

function textOf(node, out = []) {
  if (node === null || node === undefined || node === false) return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const child of node) textOf(child, out); return out; }
  if (typeof node === 'object') {
    if (node.children && node.children.length > 0) textOf(node.children, out);
    else if (node.props && node.props.children) textOf(node.props.children, out);
  }
  return out;
}

/* ---------------- fake plugin context ---------------- */

const PACKAGE_ID = 'dsh-sidebar-panel';

function makeCtx() {
  const declarations = new Set();
  const waiters = new Map();
  const registrations = [];
  const injections = [];
  const tabTypes = [];
  const navCalls = [];
  const closeCalls = [];

  // The shipped right Sidebar's navigation face, modelled only as far as this
  // plugin may rely on it.
  let activeTab = null;
  let expanded = false;
  const sidebarRight = {
    active: () => activeTab,
    isExpanded: () => expanded,
    openTab(kind) {
      navCalls.push(['openTab', kind]);
      expanded = true;
      activeTab = { id: 'tab-ours', kind, contentId: 'dsh-sidebar-panel', title: 'panel' };
    },
    toggleExpanded() {
      navCalls.push(['toggleExpanded']);
      expanded = !expanded;
    },
    /** Test-only knob: pretend another tab is in front / the column is hidden. */
    _set(tab, isExpanded) { activeTab = tab; expanded = isExpanded; },
  };

  const ctx = {
    // `effect` runs the body and keeps its disposer, like the real context.
    effect: fn => { const disposer = fn(); return typeof disposer === 'function' ? disposer : noop; },
    on: noop,
    locale: { register: () => noop, bind: () => key => key },
    sidebarRight,
    sidebarRightTabs: { register: definition => { tabTypes.push(definition); return noop; } },
    slots: {
      inject(name, cb) {
        injections.push(name);
        if (waiters.has(name)) throw new Error('duplicate inject waiter for ' + name);
        if (declarations.has(name)) { cb(); return noop; } // already declared: fires now
        waiters.set(name, cb);
        return noop;
      },
      register(options, component) {
        registrations.push({ options, component });
        return noop;
      },
    },
    logger: { warn: noop },
  };

  // Slots the shipped core owns (inject only fires for a declared slot).
  declarations.add('conversation.session.header.utilities');
  declarations.add('sidebar.right.pane.tab');
  declarations.add('sidebar.right.pane.tab.title');

  return { ctx, registrations, injections, tabTypes, navCalls, closeCalls, sidebarRight };
}

function load() {
  loaded.length = 0;
  vm.runInThisContext(BUNDLE_SOURCE, { filename: 'client/client.js' });
  const mod = loaded.pop();
  assert.ok(mod, 'bundle did not call __ModuleLoader__.load');
  return mod.factory(id => {
    if (id === 'react') return React;
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return { IconPanelLeftOutline16: () => null };
    throw new Error('unexpected require: ' + id);
  });
}

function panelProps(extra = {}) {
  return {
    t: key => key,
    sessionId: 's1',
    // The slot framework synthesizes this from the `hooks.tabInfo` inject face.
    useTabInfo: () => ({
      sidebar: { expanded: true, fullscreen: false },
      panel: { id: 'p1' },
      tab: {
        id: 'tab-ours', kind: PACKAGE_ID, contentId: 'dsh-sidebar-panel', title: 'panel',
        visible: true, navigation: { address: 'dsh-tab://dsh-sidebar-panel', params: undefined, revision: 0 },
        signal: new AbortController().signal,
        actions: { close: () => closeCallsRef.push('close'), openResource: noop, openTab: noop },
      },
    }),
    // Global standard prop (ui-session's GlobalStandardProps merge).
    useSessions: selector => selector({ byId: { s1: { cwd: '/workspace', blank: false } } }),
    // Session standard kit (ui-session + ui-conversation merges).
    useProjection: () => ({}),
    useSession: selector => selector({}),
    useInput: selector => selector({ draft: '' }),
    inputActions: { setDraft: noop },
    useConversation: selector => selector({
      views: { get: target => (target === 'chat' ? CHAT : undefined) },
    }),
    ...extra,
  };
}

let closeCallsRef = [];

/* ---------------- A. registration shape ---------------- */

{
  const exports = load();
  assert.equal(exports.name, PACKAGE_ID);
  assert.deepEqual(exports.inject, ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs'],
    'the plugin must require the shipped right Sidebar registry + navigation face');

  const { ctx, registrations, injections, tabTypes } = makeCtx();
  exports.apply(ctx);

  // Stage one: the tab TYPE.
  assert.equal(tabTypes.length, 1, 'exactly one tab type must be registered');
  const def = tabTypes[0];
  assert.equal(def.id, PACKAGE_ID);
  assert.equal(def.kind, PACKAGE_ID);
  assert.equal(def.priority, 'extension', 'a type from outside the product is the `extension` band');
  assert.equal(typeof def.title, 'function', 'title must be thunked for language changes');
  assert.equal(def.title(), 'panel.title');
  assert.ok(Array.isArray(def.guide) && def.guide.length === 1, 'one guide entry');
  assert.equal(def.guide[0].title(), 'panel.title');
  assert.equal(def.guide[0].description(), 'guide.description');
  assert.equal(typeof def.guide[0].icon, 'function', 'the guide capsule needs a glyph');
  assert.equal(def.patterns, undefined, 'a page type is opened by kind, so it claims no address');

  // Stage two: the BODY, keyed by the same id.
  const body = registrations.find(r => r.options.name === 'sidebar.right.pane.tab');
  assert.ok(body, 'the keyed tab body must be registered');
  assert.equal(body.options.key, PACKAGE_ID);
  assert.equal(body.options.locale, 'dshSidebarPanel');
  assert.equal(typeof body.component, 'function');

  // The header toggle.
  const header = registrations.find(r => r.options.name === 'conversation.session.header.utilities');
  assert.ok(header, 'header utilities registration missing');
  assert.equal(header.options.id, 'dsh-sidebar-panel-toggle');

  // The whole point: the shipped column is NOT contested any more.
  for (const gone of ['rightbar', 'details', 'dsh-sidebar-panel.session', 'conversation.session.header.corner']) {
    assert.ok(!registrations.some(r => r.options.name === gone),
      `${gone} must no longer be registered — the shipped Sidebar owns the column`);
    assert.ok(!injections.includes(gone), `${gone} must no longer be injected`);
  }
  assert.ok(!injections.includes('conversation.session.header.corner'));

  console.log('✓ registration shape: tab type + keyed body + header toggle, column uncontested');
}

/* ---------------- B. the toggle only navigates ---------------- */

{
  const exports = load();
  const { ctx, registrations, navCalls, sidebarRight } = makeCtx();
  exports.apply(ctx);

  const header = registrations.find(r => r.options.name === 'conversation.session.header.utilities');
  const injected = header.options.inject('s1');
  assert.equal(typeof injected.togglePanel, 'function', 'the toggle must be handed the navigation action');

  // Collapsed column -> open (and focus) our tab.
  sidebarRight._set(null, false);
  injected.togglePanel();
  assert.deepEqual(navCalls, [['openTab', PACKAGE_ID]], 'collapsed column must open our tab');

  // Another tab in front -> focus ours, never a bare collapse.
  navCalls.length = 0;
  sidebarRight._set({ id: 'other', kind: 'files', contentId: 'x', title: 'Files' }, true);
  injected.togglePanel();
  assert.deepEqual(navCalls, [['openTab', PACKAGE_ID]], 'another tab in front must focus ours');

  // Ours showing and expanded -> collapse.
  navCalls.length = 0;
  sidebarRight._set({ id: 'tab-ours', kind: PACKAGE_ID, contentId: 'c', title: 'panel' }, true);
  injected.togglePanel();
  assert.deepEqual(navCalls, [['toggleExpanded']], 'our tab showing must collapse the column');

  // The button itself renders a real element and never touches ctx.layout.
  const button = withHooks(header.component, { t: key => key, togglePanel: injected.togglePanel, ...panelProps() });
  assert.equal(button.type, 'button');
  assert.equal(button.props.className, 'dsp-toggle');
  navCalls.length = 0;
  sidebarRight._set(null, false);
  button.props.onClick();
  assert.deepEqual(navCalls, [['openTab', PACKAGE_ID]], 'the button click must go through the navigation face');

  console.log('✓ toggle navigates through sidebarRight (open / focus / collapse), no layout writes');
}

/* ---------------- C. panel body: chat data + close ---------------- */

{
  const exports = load();
  const { ctx, registrations } = makeCtx();
  exports.apply(ctx);

  const body = registrations.find(r => r.options.name === 'sidebar.right.pane.tab');
  const tree = withHooks(body.component, panelProps());
  assert.equal(tree.type, 'div', 'PanelRoot must render its root div');

  // The close button closes this tab through the injected tab info.
  closeCallsRef = [];
  const closeButton = created.find(el => el.props && el.props.className === 'dsp__close');
  assert.ok(closeButton, 'the panel must render its close button');
  closeButton.props.onClick();
  assert.deepEqual(closeCallsRef, ['close'], 'close must call tab.actions.close()');

  // The 工具 tab reads the CONVERSATION snapshot's chat slice.
  localStorage.setItem('dshSidebarPanel:tab:s1', 'tools'); // PanelRoot restores this tab
  created = [];
  const toolsTree = withHooks(body.component, panelProps());
  const toolsEl = created.find(el => typeof el.type === 'function' && el.type.name === 'ToolsTab');
  assert.ok(toolsEl, 'the 工具 tab element must be created once the tab preference is tools');
  assert.equal(typeof toolsEl.props.useConversation, 'function', 'the tools tab needs the conversation selector');
  const toolsText = textOf(withHooks(toolsEl.type, toolsEl.props)).join(' ');
  assert.ok(toolsText.includes('read'), 'settled tool call (head nested on `call`) must be listed: ' + toolsText.slice(0, 200));
  assert.ok(toolsText.includes('exec'), 'in-flight tool call must be listed as well');

  localStorage.store = {};
  console.log('✓ tab body: chat-slice tool list + tab.actions.close()');
}

for (const cleanup of cleanups) cleanup();

console.log('SMOKE OK — tab type + keyed body + navigation-only toggle, and the chat-slice tool list');
