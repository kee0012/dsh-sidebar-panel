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
 *   D. css     — the stylesheet is published under the host's own ownership
 *                tags (`data-plugin` + `data-plugin-css`). The DSH module
 *                loader claims every UNTAGGED <style> for whichever plugin it
 *                materializes next and drops those tags on that plugin's next
 *                rebuild, so an untagged sheet is a sheet that silently
 *                disappears mid-session (and comes back on restart).
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

/* A DOM stub just rich enough for the stylesheet contract this bundle depends
 * on: attribute-aware `getElementById` / `querySelector(All)` over a real
 * parent/child tree. It has to be attribute-aware, because the host's module
 * loader claims every UNTAGGED `<style>` for whichever plugin materializes
 * next, then deletes it on that plugin's next rebuild — so this test must be
 * able to ask which attributes our sheet actually carries. Only the selector
 * shapes the bundle and that host contract actually use are supported. */
// `e.target instanceof Element` guards appear in the bundle's click handlers, so
// stub elements need a real prototype to match against.
class ElementStub {}
globalThis.Element = ElementStub;

function makeEl(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    attributes: new Map(),
    style: {}, dataset: {}, children: [], parentNode: null, isConnected: false,
    textContent: '', title: '', className: '',
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; },
    hasAttribute(name) { return this.attributes.has(name); },
    removeAttribute(name) { this.attributes.delete(name); },
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      child.isConnected = true;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const at = this.children.indexOf(child);
      if (at !== -1) this.children.splice(at, 1);
      child.parentNode = null;
      child.isConnected = false;
      return child;
    },
    addEventListener() {},
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    closest(selector) {
      for (let node = this; node; node = node.parentNode) {
        if (node.tagName && matchesSelector(node, selector)) return node;
      }
      return null;
    },
  };
  Object.setPrototypeOf(el, ElementStub.prototype);
  // As in a real DOM, `el.id = x` writes the `id` attribute, which is where
  // `getElementById` reads it back from.
  Object.defineProperty(el, 'id', {
    get() { return this.attributes.get('id') ?? ''; },
    set(value) { this.setAttribute('id', value); },
  });
  return el;
}

const ATTR_EQ = /^([a-zA-Z0-9]*)\[([a-zA-Z-]+)=("(?:[^"\\]|\\.)*")\]$/;
const ID_NOT_ATTR = /^([a-zA-Z0-9]*)#([A-Za-z0-9_-]+):not\(\[([a-zA-Z-]+)\]\)$/;
const TAG_NOT_ATTR = /^([a-zA-Z0-9]+):not\(\[([a-zA-Z-]+)\]\)$/;
const HAS_ATTR = /^([a-zA-Z0-9]*)\[([a-zA-Z-]+)\]$/;
const CLASS_SEL = /^\.([A-Za-z0-9_-]+)$/;

function matchesSelector(el, selector) {
  let m = ATTR_EQ.exec(selector);
  if (m) {
    const [, tag, name, rawValue] = m;
    return (!tag || el.tagName === tag.toUpperCase()) && el.getAttribute(name) === JSON.parse(rawValue);
  }
  m = ID_NOT_ATTR.exec(selector);
  if (m) {
    const [, tag, id, name] = m;
    return (!tag || el.tagName === tag.toUpperCase()) && el.getAttribute('id') === id && !el.hasAttribute(name);
  }
  m = TAG_NOT_ATTR.exec(selector);
  if (m) {
    const [, tag, name] = m;
    return el.tagName === tag.toUpperCase() && !el.hasAttribute(name);
  }
  m = HAS_ATTR.exec(selector);
  if (m) {
    const [, tag, name] = m;
    return (!tag || el.tagName === tag.toUpperCase()) && el.hasAttribute(name);
  }
  m = CLASS_SEL.exec(selector);
  if (m) return String(el.className ?? '').split(/\s+/).includes(m[1]);
  throw new Error('smoke DOM stub: unsupported selector ' + selector);
}

const docRoot = makeEl('html');
const docHead = makeEl('head');
const docBody = makeEl('body');
docRoot.appendChild(docHead);
docRoot.appendChild(docBody);
docRoot.isConnected = true;

function allElements() {
  const out = [];
  (function walk(node) {
    for (const child of node.children) { out.push(child); walk(child); }
  })(docRoot);
  return out;
}

globalThis.document = {
  documentElement: docRoot,
  head: docHead,
  body: docBody,
  createElement: makeEl,
  createElementNS: (ns, tag) => makeEl(tag),
  getElementById: id => allElements().find(el => el.getAttribute('id') === id) ?? null,
  querySelector: selector => allElements().find(el => matchesSelector(el, selector)) ?? null,
  querySelectorAll: selector => allElements().filter(el => matchesSelector(el, selector)),
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

function load(primitives = { IconPanelLeftOutlineRegular: () => null }) {
  loaded.length = 0;
  vm.runInThisContext(BUNDLE_SOURCE, { filename: 'client/client.js' });
  const mod = loaded.pop();
  assert.ok(mod, 'bundle did not call __ModuleLoader__.load');
  return mod.factory(id => {
    if (id === 'react') return React;
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
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
  // The button itself renders a real element and never touches ctx.layout. The
  // stub runtime keeps children as a positional array (`el.children`) and does
  // not render them, so the glyph here is the child ELEMENT; B2 renders it to
  // exercise the guard inside it.
  assert.equal(button.children.length, 1, 'the toggle must carry exactly one child');
  const glyph = button.children[0];
  assert.equal(typeof glyph.type, 'function',
    'the toggle glyph must be a real component, never an undefined export');
  assert.equal(glyph.props.size, 16);
  navCalls.length = 0;
  sidebarRight._set(null, false);
  button.props.onClick();
  assert.deepEqual(navCalls, [['openTab', PACKAGE_ID]], 'the button click must go through the navigation face');

  console.log('✓ toggle navigates through sidebarRight (open / focus / collapse), no layout writes');
}

/* ---------------- B2. a host icon that is no longer shipped ---------------- */

{
  // The icon set moved from `<Name>16` to `<Name>Regular`/`<Name>Medium` with the
  // 0.2 line, and the injected package is host-owned: reading a name it no longer
  // exports yields `undefined`, and `React.createElement(undefined)` throws —
  // which blanks the whole slot instead of just the button. The guard must fall
  // back to artwork of our own, and it must still honour the old spelling.
  const renameCases = [
    [{ IconPanelLeftOutlineRegular: 'host-regular' }, 'host-regular', 'the current export name'],
    [{ IconPanelLeftOutlineMedium: 'host-medium' }, 'host-medium', 'the medium variant'],
    [{ IconPanelLeftOutline16: 'host-16' }, 'host-16', 'the pre-0.2 spelling, in case a host still ships only that'],
  ];
  for (const [primitives, expected, why] of renameCases) {
    const exports = load(primitives);
    const { ctx, registrations } = makeCtx();
    exports.apply(ctx);
    const header = registrations.find(r => r.options.name === 'conversation.session.header.utilities');
    created = [];
    const button = withHooks(header.component, { t: key => key, togglePanel: noop, ...panelProps() });
    const glyph = withHooks(button.children[0].type, button.children[0].props);
    assert.equal(glyph.type, expected, `the glyph must come from ${why}`);
  }

  const bare = load({});
  const { ctx: bareCtx, registrations: bareRegistrations, tabTypes: bareTabTypes } = makeCtx();
  bare.apply(bareCtx);
  const bareHeader = bareRegistrations.find(r => r.options.name === 'conversation.session.header.utilities');
  created = [];
  const bareButton = withHooks(bareHeader.component, { t: key => key, togglePanel: noop, ...panelProps() });
  const bareGlyph = withHooks(bareButton.children[0].type, bareButton.children[0].props);
  assert.equal(bareGlyph.type, 'svg',
    'a host that ships no matching icon must degrade to the bundled artwork, never to undefined');
  assert.equal(bareGlyph.props.viewBox, '0 0 16 16');
  assert.deepEqual(bareGlyph.children.map(child => child.type), ['rect', 'path']);
  assert.equal(bareGlyph.props.stroke, 'currentColor', 'the fallback must inherit the host text colour');

  // The guide capsule registered on the tab type points at the same glyph.
  const guideIcon = bareTabTypes[0].guide[0].icon;
  assert.equal(typeof guideIcon, 'function');
  assert.equal(withHooks(guideIcon, { size: 16 }).type, 'svg');

  console.log('✓ host icon guard: Regular / Medium / 16 spellings honoured, own glyph as fallback');
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

/* ---------------- D. stylesheet ownership ---------------- */

{
  // The host's module loader hands every UNTAGGED <style> to whichever plugin
  // materializes next, then deletes it again when that plugin is rebuilt or
  // pruned. That is how this panel used to lose its styles mid-session while
  // the app kept running. This case pins the fix.
  for (const el of docHead.children.slice()) el.remove();

  const exports = load();
  exports.apply(makeCtx().ctx);

  const ours = docHead.children.filter(el => el.getAttribute('data-plugin') === PACKAGE_ID);
  assert.equal(ours.length, 1, 'exactly one tagged sheet must be published');
  assert.equal(ours[0].getAttribute('data-plugin-css'), PACKAGE_ID + '/client.css',
    'the sheet needs the same idempotence key the host CSS emitter writes');
  assert.ok(ours[0].textContent.includes('.dsp'), 'the sheet must carry the real stylesheet');

  assert.deepEqual(document.querySelectorAll('style:not([data-plugin])'), [],
    'an untagged sheet is one the host will hand to an unrelated plugin and delete on its next rebuild');

  // A second apply must reuse the sheet instead of stacking another copy.
  const before = docHead.children.length;
  exports.apply(makeCtx().ctx);
  assert.equal(docHead.children.length, before, 'installStyles must be idempotent');
  assert.equal(document.querySelectorAll('style[data-plugin-css="dsh-sidebar-panel/client.css"]').length, 1);

  // A leftover from an untagged earlier release is evicted, not left claimable.
  for (const el of docHead.children.slice()) el.remove();
  const legacy = makeEl('style');
  legacy.id = PACKAGE_ID + '-styles';
  legacy.textContent = '/* legacy */';
  docHead.appendChild(legacy);
  assert.equal(document.querySelectorAll('style:not([data-plugin])').length, 1, 'precondition: one untagged sheet');

  exports.apply(makeCtx().ctx);
  assert.equal(document.querySelectorAll('style#dsh-sidebar-panel-styles:not([data-plugin])').length, 0,
    'the untagged leftover must be evicted');
  assert.equal(docHead.children.filter(el => el.getAttribute('data-plugin') === PACKAGE_ID).length, 1,
    'and replaced by exactly one tagged sheet');

  console.log('✓ stylesheet ownership: tagged, idempotent, untagged leftovers evicted');
}

for (const cleanup of cleanups) cleanup();

console.log('SMOKE OK — tab type + keyed body + navigation-only toggle, and the chat-slice tool list');
