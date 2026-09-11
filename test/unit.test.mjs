/**
 * Unit tests for the dsh-sidebar-panel server half.
 * Runs against the real src/index.js with a mocked ctx (no DSH instance).
 *   node test/unit.test.mjs
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, Config, name, inject } from '../src/index.js';

// Portable root for file-browser fixtures: the plugin's own directory
// (contains src/, client/, package.json …). No machine-specific paths.
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ */
/* Mocks                                                               */
/* ------------------------------------------------------------------ */

function makeCtx() {
  const routes = [];
  const listeners = {};
  const sessions = new Map();
  const ctx = {
    webServer: {
      register(route) {
        routes.push(route);
        return () => {};
      },
    },
    on(event, fn) {
      listeners[event] = fn;
    },
    effect(fn) {
      return fn();
    },
    logger: { warn() {}, error() {} },
    sessions: {
      get(id) {
        return sessions.get(id);
      },
    },
    get(name) {
      if (name === 'credentials') return ctx._credentials;
      return undefined;
    },
    _routes: routes,
    _listeners: listeners,
    _sessions: sessions,
    _credentials: undefined,
  };
  return ctx;
}

function makeRes() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(payload) {
      this.body = payload;
    },
  };
}

function makeReq(method, url, headers = {}, body = null) {
  const req = { method, url, headers };
  req[Symbol.asyncIterator] = async function* () {
    if (body !== null) yield Buffer.from(JSON.stringify(body));
  };
  return req;
}

const OK_HEADERS = { origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080' };
const parse = (res) => JSON.parse(res.body);

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

const ctx = makeCtx();
const config = Config({}); // validated defaults
apply(ctx, config);
const handler = ctx._routes[0].handler;

// 1. module contract + route registration
assert.equal(name, 'dsh-sidebar-panel');
assert.deepEqual(inject, ['webServer', 'sessions']);
assert.equal(ctx._routes.length, 1);
assert.equal(ctx._routes[0].kind, 'prefix');
assert.equal(ctx._routes[0].path, '/dsh-sidebar-panel/api');
console.log('✓ module contract + route registration');

// 2. same-origin rejection (hostile Origin still rejected)
{
  const res = makeRes();
  await handler(makeReq('GET', '/dsh-sidebar-panel/api/config', { origin: 'http://evil.example', host: '127.0.0.1:3080' }), res);
  assert.equal(res.status, 403);
  assert.equal(parse(res).ok, false);
  console.log('✓ cross-origin rejected (403)');
}

// 2b. NO Origin header must NOT be rejected — same-origin browser GETs carry
// no Origin at all; this was the bug that blanked the files/changes tabs.
{
  const res = makeRes();
  await handler(makeReq('GET', '/dsh-sidebar-panel/api/config', { host: '127.0.0.1:3080' }), res);
  assert.equal(res.status, 200);
  assert.equal(parse(res).ok, true);
  console.log('✓ Origin-less GET accepted (same-origin fix)');
}

// 2c. OPTIONS preflights are never answered (cross-site POST fence)
{
  const res = makeRes();
  await handler(makeReq('OPTIONS', '/dsh-sidebar-panel/api/file-content', { origin: 'http://evil.example', host: '127.0.0.1:3080' }), res);
  assert.equal(res.status, 405);
  assert.equal(res.headers['access-control-allow-origin'], undefined);
  console.log('✓ OPTIONS preflight not answered (405, no CORS headers)');
}

// 3. config route returns defaults
{
  const res = makeRes();
  await handler(makeReq('GET', '/dsh-sidebar-panel/api/config', OK_HEADERS), res);
  assert.equal(res.status, 200);
  const data = parse(res);
  assert.equal(data.ok, true);
  assert.equal(data.config.reference.file, '@<path>');
  assert.equal(data.config.fileBrowser.maxContentChars, 40000);
  console.log('✓ config route');
}

// 4. files listing + workspace confinement
{
  const res = makeRes();
  const url = '/dsh-sidebar-panel/api/files?root=' + encodeURIComponent(PROJECT_ROOT)
    + '&path=' + encodeURIComponent('.');
  await handler(makeReq('GET', url, OK_HEADERS), res);
  assert.equal(res.status, 200);
  const data = parse(res);
  assert.equal(data.ok, true);
  assert.ok(data.entries.some((e) => e.name === 'src' && e.isDir), 'src dir listed');
  assert.ok(data.entries.some((e) => e.name === 'package.json' && !e.isDir), 'package.json listed');
  console.log('✓ files listing (dirs + files)');
}
{
  const res = makeRes();
  const url = '/dsh-sidebar-panel/api/files?root=' + encodeURIComponent(PROJECT_ROOT)
    + '&path=' + encodeURIComponent('../../Windows');
  await handler(makeReq('GET', url, OK_HEADERS), res);
  assert.equal(res.status, 400);
  assert.equal(parse(res).error.code, 'OUTSIDE_WORKSPACE');
  console.log('✓ path escape rejected (OUTSIDE_WORKSPACE)');
}

// 5. file-content read
{
  const res = makeRes();
  await handler(makeReq('POST', '/dsh-sidebar-panel/api/file-content', OK_HEADERS, {
    root: PROJECT_ROOT,
    path: 'package.json',
  }), res);
  assert.equal(res.status, 200);
  const data = parse(res);
  assert.equal(data.ok, true);
  assert.ok(data.text.includes('dsh-sidebar-panel'));
  assert.equal(data.truncated, false);
  console.log('✓ file-content read');
}
{
  const res = makeRes();
  await handler(makeReq('POST', '/dsh-sidebar-panel/api/file-content', OK_HEADERS, {
    root: PROJECT_ROOT,
    path: '../../Windows/win.ini', // escape attempt
  }), res);
  assert.equal(res.status, 400);
  console.log('✓ file-content escape rejected');
}

// 6. overview fold + pricing (peak/valley) + changes
{
  const sessionId = 's-test-1';
  // UTC 02:00 == Beijing 10:00 → on-peak (off-peak is 00:30–08:30 Beijing).
  const base = Date.UTC(2026, 7, 19, 2, 0, 0);
  const session = {
    id: sessionId,
    // dsh 0.1.3-alpha.1+: the Session exposes snapshots, not a public `.events`.
    snapshotEvents: () => [
      // The epoch header nests the route under `config` (EpochHeader.config).
      { type: 'request/header', seq: 0, time: base, data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-chat' } } } },
      { type: 'step/start', seq: 1, time: base + 1, data: { turn: 0, step: 0 } },
      { type: 'assistant/message', seq: 2, time: base + 1000, data: { turn: 0, step: 0, usage: { inputTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 0, outputTokens: 50 } } },
      { type: 'request/header', seq: 3, time: base + 2000, data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-chat' } } } },
      { type: 'step/start', seq: 4, time: base + 2001, data: { turn: 1, step: 0 } },
      { type: 'assistant/message', seq: 5, time: base + 3000, data: { turn: 1, step: 0, usage: { inputTokens: 200, cacheReadTokens: 800, cacheWriteTokens: 0, outputTokens: 30 } } },
      { type: 'tool/call', seq: 6, time: base + 4000, data: { name: 'write', arguments: { filePath: 'D:/x/a.ts' } } },
    ],
  };
  ctx._sessions.set(sessionId, session);
  ctx._listeners['session/event'](session);

  const res = makeRes();
  await handler(makeReq('GET', '/dsh-sidebar-panel/api/overview?sessionId=' + sessionId, OK_HEADERS), res);
  assert.equal(res.status, 200);
  const data = parse(res);
  assert.equal(data.ok, true);
  assert.equal(data.overview.requestCount, 2);
  assert.equal(data.overview.byModel.length, 1);
  const m = data.overview.byModel[0];
  // Route attribution must survive the header fold: reading provider/model off
  // the header instead of header.config flattened every call into one
  // "unknown/unknown" row and priced it with the default table.
  assert.equal(m.provider, 'deepseek-official');
  assert.equal(m.model, 'deepseek-chat');
  assert.equal(m.input, 100 + 900 + 200 + 800, 'input = uncached + cacheHit + cacheWrite');
  assert.equal(m.hit, 900 + 800);
  assert.equal(m.miss, 100 + 200);
  assert.equal(m.output, 50 + 30);
  assert.equal(m.total, 2080);
  // on-peak cost: (100*2 + 900*0.5 + 50*8)/1e6 + (200*2 + 800*0.5 + 30*8)/1e6
  // = 0.00209 (6-decimal precision now, no rounding to 0.0021)
  assert.ok(Math.abs(data.overview.cost - 0.00209) < 1e-9, `cost=${data.overview.cost} expected=0.00209`);
  assert.ok(Math.abs(m.cost - 0.00209) < 1e-9, `byModel cost=${m.cost}`);
  assert.equal(data.overview.currency, 'CNY');
  assert.ok(data.overview.runtimeMs > 0);
  console.log('✓ overview fold: requests/tokens/cost/runtime');

  const res2 = makeRes();
  await handler(makeReq('GET', '/dsh-sidebar-panel/api/changes?sessionId=' + sessionId, OK_HEADERS), res2);
  const cdata = parse(res2);
  assert.equal(cdata.ok, true);
  assert.equal(cdata.changes.length, 1);
  assert.equal(cdata.changes[0].path, 'D:/x/a.ts');
  assert.equal(cdata.changes[0].tool, 'write');
  console.log('✓ changes tracking (tool/call → write path)');
}

// 7. unknown session
{
  const res = makeRes();
  await handler(makeReq('GET', '/dsh-sidebar-panel/api/overview?sessionId=missing', OK_HEADERS), res);
  assert.equal(res.status, 404);
  console.log('✓ unknown session → 404');
}

// 8. unknown route
{
  const res = makeRes();
  await handler(makeReq('GET', '/dsh-sidebar-panel/api/nope', OK_HEADERS), res);
  assert.equal(res.status, 404);
  console.log('✓ unknown route → 404');
}

// 9. reveal validation (only the error path — the success path spawns the OS)
{
  const res = makeRes();
  await handler(makeReq('POST', '/dsh-sidebar-panel/api/reveal', OK_HEADERS, { path: '' }), res);
  assert.equal(res.status, 400);
  console.log('✓ reveal empty path → 400');
}

// 10. file-raw preview route (content-type whitelist + confinement)
{
  const res = makeRes();
  const url = '/dsh-sidebar-panel/api/file-raw?root=' + encodeURIComponent(PROJECT_ROOT)
    + '&path=' + encodeURIComponent('package.json');
  await handler(makeReq('GET', url, OK_HEADERS), res);
  assert.equal(res.status, 200);
  // .json is not in the embed whitelist → octet-stream (never executable mime)
  assert.equal(res.headers['content-type'], 'application/octet-stream');
  assert.ok(res.body.length > 0, 'raw bytes returned');
  console.log('✓ file-raw non-whitelist ext → octet-stream');
}
{
  const res = makeRes();
  const url = '/dsh-sidebar-panel/api/file-raw?root=' + encodeURIComponent(PROJECT_ROOT)
    + '&path=' + encodeURIComponent('../../Windows/win.ini');
  await handler(makeReq('GET', url, OK_HEADERS), res);
  assert.equal(res.status, 400);
  assert.equal(parse(res).error.code, 'OUTSIDE_WORKSPACE');
  console.log('✓ file-raw escape rejected');
}

// 11. balance route (official DeepSeek user/balance, key from credentials)
{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => new Response(JSON.stringify({
    is_available: true,
    balance_infos: [
      { currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' },
    ],
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    ctx._credentials = { resolve: async () => ({ value: 'sk-test-xxxx', source: 'file' }) };
    const res = makeRes();
    await handler(makeReq('GET', '/dsh-sidebar-panel/api/balance', OK_HEADERS), res);
    assert.equal(res.status, 200);
    const data = parse(res);
    assert.equal(data.ok, true);
    assert.equal(data.balance.infos[0].currency, 'CNY');
    assert.equal(data.balance.infos[0].totalBalance, '110.00');
    console.log('✓ balance route (credentials + official endpoint)');
  } finally {
    ctx._credentials = undefined;
    globalThis.fetch = originalFetch;
  }
}
{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401 });
  try {
    ctx._credentials = { resolve: async () => ({ value: 'sk-bad', source: 'env' }) };
    const res = makeRes();
    await handler(makeReq('GET', '/dsh-sidebar-panel/api/balance', OK_HEADERS), res);
    const data = parse(res);
    assert.equal(data.ok, true);
    assert.equal(data.balance, null);
    assert.equal(data.error.code, 'API_ERROR');
    console.log('✓ balance route (upstream 401 → API_ERROR, key never leaked)');
  } finally {
    ctx._credentials = undefined;
    globalThis.fetch = originalFetch;
  }
}
{
  const res = makeRes();
  await handler(makeReq('GET', '/dsh-sidebar-panel/api/balance', OK_HEADERS), res);
  const data = parse(res);
  assert.equal(data.ok, true);
  assert.equal(data.balance, null);
  assert.equal(data.error.code, 'NO_API_KEY');
  console.log('✓ balance route (no credentials → NO_API_KEY)');
}

console.log('\nALL UNIT TESTS PASSED');
