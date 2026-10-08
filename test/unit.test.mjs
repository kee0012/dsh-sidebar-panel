/**
 * Unit tests for the dsh-sidebar-panel server half.
 * Runs against the real src/index.js with a mocked ctx (no DSH instance).
 *   node test/unit.test.mjs
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { Writable } from 'node:stream';
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
      if (name === 'sessionPersistence') return ctx._persistence;
      return undefined;
    },
    _routes: routes,
    _listeners: listeners,
    _sessions: sessions,
    _credentials: undefined,
    _persistence: undefined,
  };
  return ctx;
}

// The mock response is a REAL Writable: /file-raw now streams the file into
// the response (`createReadStream(...).pipe(response)`), which needs a proper
// stream destination, not an object with an `end()` method.
class MockRes extends Writable {
  constructor() {
    super();
    this.status = 0;
    this.headers = {};
    this.chunks = [];
  }

  writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
  }

  _write(chunk, encoding, callback) {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    callback();
  }

  get body() {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

function makeRes() {
  return new MockRes();
}

/** Resolves once the response is fully written (streaming routes). */
function finished(res) {
  if (res.writableFinished) return Promise.resolve();
  return new Promise((resolve, reject) => {
    res.on('finish', resolve);
    res.on('error', reject);
  });
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
  // The durable log is modelled as a REAL array so the fold's incremental
  // contract is actually exercised: `snapshotEvents(fromSeq)` must slice, exactly
  // as the core's `log.slice(fromSeq, seq)` does. A fixture that ignored the
  // argument (returning the whole log every time) would re-fold every event on
  // each call and silently hide double counting.
  const events = [
    // The epoch header nests the route under `config` (EpochHeader.config).
    { type: 'request/header', seq: 0, time: base, data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-chat' } } } },
    { type: 'step/start', seq: 1, time: base + 1, data: { turn: 0, step: 0 } },
    { type: 'assistant/message', seq: 2, time: base + 1000, data: { turn: 0, step: 0, usage: { inputTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 0, outputTokens: 50 } } },
    { type: 'request/header', seq: 3, time: base + 2000, data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-chat' } } } },
    { type: 'step/start', seq: 4, time: base + 2001, data: { turn: 1, step: 0 } },
    { type: 'assistant/message', seq: 5, time: base + 3000, data: { turn: 1, step: 0, usage: { inputTokens: 200, cacheReadTokens: 800, cacheWriteTokens: 0, outputTokens: 30 } } },
    { type: 'tool/call', seq: 6, time: base + 4000, data: { name: 'write', arguments: { filePath: 'D:/x/a.ts' } } },
  ];
  const session = {
    id: sessionId,
    // dsh 0.1.3-alpha.1+: the Session exposes a sliced snapshot, not a public
    // `.events`. Honouring `fromSeq` is what keeps the fold incremental — the
    // plugin asks only for the suffix it has not folded yet.
    snapshotEvents: (fromSeq = 0) => events.slice(fromSeq),
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
  // Cost with the default (official) table — valley 1 / hit 0.02 / write 1 /
  // out 4 CNY per million tokens, doubled at peak. `base` is 10:00 Beijing on a
  // weekday, so both calls are peak:
  //   2 × (100*1 + 900*0.02 + 50*4)/1e6 = 0.000636
  // + 2 × (200*1 + 800*0.02 + 30*4)/1e6 = 0.000672
  // = 0.001308 (6-decimal precision, no rounding to 0.0013)
  assert.ok(Math.abs(data.overview.cost - 0.001308) < 1e-9, `cost=${data.overview.cost} expected=0.001308`);
  assert.ok(Math.abs(m.cost - 0.001308) < 1e-9, `byModel cost=${m.cost}`);
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

  // Regression: the fold must consume only the UNFOLDED SUFFIX. Asking for a
  // bare `snapshotEvents()` re-reads and re-folds the whole log on every call —
  // that double-counted usage and made the per-`session/event` fold O(n²). The
  // real core slices (`log.slice(fromSeq, seq)`), so the fixture does too, and
  // this block asserts the requested offset is exactly the folded cursor.
  {
    const asked = [];
    const original = session.snapshotEvents;
    session.snapshotEvents = (fromSeq = 0) => {
      asked.push(fromSeq);
      return original(fromSeq);
    };

    events.push(
      { type: 'request/header', seq: 7, time: base + 5000, data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-chat' } } } },
      { type: 'assistant/message', seq: 8, time: base + 6000, data: { turn: 2, step: 0, usage: { inputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 5 } } },
    );
    ctx._listeners['session/event'](session);

    assert.deepEqual(asked, [7], `fold must read only the unfolded suffix, asked=${JSON.stringify(asked)}`);

    const res3 = makeRes();
    await handler(makeReq('GET', '/dsh-sidebar-panel/api/overview?sessionId=' + sessionId, OK_HEADERS), res3);
    const d3 = parse(res3);
    // Three requests in the log — not three plus two re-folded copies.
    assert.equal(d3.overview.requestCount, 3, 'no re-folded requests');
    assert.equal(d3.overview.byModel[0].input, 100 + 900 + 200 + 800 + 10, 'no duplicated usage');
    console.log('✓ incremental fold: only the unfolded suffix is read (no O(n²), no double count)');
  }
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

// 10. file-raw preview route (content-type whitelist + confinement + streaming)
{
  const res = makeRes();
  const done = finished(res);
  const url = '/dsh-sidebar-panel/api/file-raw?root=' + encodeURIComponent(PROJECT_ROOT)
    + '&path=' + encodeURIComponent('package.json');
  await handler(makeReq('GET', url, OK_HEADERS), res);
  await done;
  assert.equal(res.status, 200);
  // .json is not in the embed whitelist → octet-stream (never executable mime)
  assert.equal(res.headers['content-type'], 'application/octet-stream');
  assert.equal(Number(res.headers['content-length']), (await fs.stat(path.join(PROJECT_ROOT, 'package.json'))).size);
  assert.ok(res.body.length > 0, 'raw bytes returned');
  assert.ok(res.body.includes('dsh-sidebar-panel'), 'streamed body is the real file content');
  console.log('✓ file-raw non-whitelist ext → octet-stream (streamed)');
}
{
  const res = makeRes();
  const done = finished(res);
  const url = '/dsh-sidebar-panel/api/file-raw?root=' + encodeURIComponent(PROJECT_ROOT)
    + '&path=' + encodeURIComponent('../../Windows/win.ini');
  await handler(makeReq('GET', url, OK_HEADERS), res);
  await done;
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

// 12. DNS-rebinding fence: Host is the primary gate, not Origin/Host equality
{
  // A rebinding attack page IS the origin host: Origin and Host are both the
  // attacker name, so the old equality check accepted it.
  const res = makeRes();
  await handler(makeReq('GET', '/dsh-sidebar-panel/api/config', {
    host: 'evil.example:19387',
    origin: 'http://evil.example:19387',
  }), res);
  assert.equal(res.status, 403);
  assert.equal(parse(res).error.code, 'FORBIDDEN');
  console.log('✓ DNS rebinding (attacker Host == attacker Origin) rejected (403)');
}
{
  const res = makeRes();
  await handler(makeReq('GET', '/dsh-sidebar-panel/api/config', { host: 'evil.example:19387' }), res);
  assert.equal(res.status, 403);
  console.log('✓ non-loopback Host rejected (403)');
}
{
  const res = makeRes();
  await handler(makeReq('GET', '/dsh-sidebar-panel/api/config', {
    host: '127.0.0.1:19387',
    'sec-fetch-site': 'cross-site',
  }), res);
  assert.equal(res.status, 403);
  console.log('✓ Sec-Fetch-Site: cross-site rejected (403)');
}
{
  // No regression: a loopback Host with a loopback (or absent) Origin passes.
  const res = makeRes();
  await handler(makeReq('GET', '/dsh-sidebar-panel/api/config', {
    host: 'localhost:19387',
    origin: 'http://localhost:19387',
  }), res);
  assert.equal(res.status, 200);
  console.log('✓ loopback Host + loopback Origin accepted');
}

// 13. reveal path validation (UNC → SMB/NTLM leak, and relative paths)
{
  const res = makeRes();
  await handler(makeReq('POST', '/dsh-sidebar-panel/api/reveal', OK_HEADERS, {
    path: '\\\\evil.example\\share\\x',
  }), res);
  assert.equal(res.status, 400);
  assert.equal(parse(res).error.code, 'INVALID_PATH');
  console.log('✓ reveal UNC path → 400 INVALID_PATH');
}
{
  const res = makeRes();
  await handler(makeReq('POST', '/dsh-sidebar-panel/api/reveal', OK_HEADERS, {
    path: 'relative/x.txt',
  }), res);
  assert.equal(res.status, 400);
  assert.equal(parse(res).error.code, 'INVALID_PATH');
  console.log('✓ reveal relative path → 400 INVALID_PATH');
}

// 14. bounded file reads: /file-content byte cap + /file-raw size ceiling
{
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsp-unit-'));
  try {
    const cap = config.fileBrowser.maxContentChars; // 40000 by default
    const suffix = config.fileBrowser.contentTruncationSuffix;

    const ascii = path.join(dir, 'ascii.txt');
    await fs.writeFile(ascii, 'a'.repeat(cap + 5000));
    const res = makeRes();
    await handler(makeReq('POST', '/dsh-sidebar-panel/api/file-content', OK_HEADERS, {
      root: dir,
      path: 'ascii.txt',
    }), res);
    assert.equal(res.status, 200);
    const data = parse(res);
    assert.equal(data.truncated, true);
    assert.ok(data.text.endsWith(suffix), 'truncation suffix appended');
    assert.equal(data.text.length, cap + suffix.length);
    // `chars` still describes the FILE, not the shortened preview.
    assert.equal(data.chars, cap + 5000);
    console.log('✓ file-content truncates at maxContentChars (byte-capped read)');

    // Wide characters are 3 bytes each: the byte cap must still yield `cap`
    // intact characters, never a half-decoded one.
    const wide = path.join(dir, 'wide.txt');
    await fs.writeFile(wide, '中'.repeat(cap + 1000));
    const res2 = makeRes();
    await handler(makeReq('POST', '/dsh-sidebar-panel/api/file-content', OK_HEADERS, {
      root: dir,
      path: 'wide.txt',
    }), res2);
    const d2 = parse(res2);
    assert.equal(d2.truncated, true);
    assert.equal(d2.text.slice(0, -suffix.length).length, cap, 'cap characters delivered');
    assert.ok(!d2.text.includes('\uFFFD'), 'no replacement char from a split UTF-8 sequence');
    assert.equal(d2.chars, (cap + 1000) * 3);
    console.log('✓ file-content UTF-8 prefix intact (no split code point)');

    const huge = path.join(dir, 'huge.bin');
    await fs.writeFile(huge, 'x');
    await fs.truncate(huge, 64 * 1024 * 1024 + 1); // sparse: costs no disk I/O
    const res3 = makeRes();
    const done3 = finished(res3);
    const url = '/dsh-sidebar-panel/api/file-raw?root=' + encodeURIComponent(dir)
      + '&path=' + encodeURIComponent('huge.bin');
    await handler(makeReq('GET', url, OK_HEADERS), res3);
    await done3;
    assert.equal(res3.status, 413);
    assert.equal(parse(res3).error.code, 'FILE_TOO_LARGE');
    assert.equal(res3.body.length < 4096, true, 'oversized file is not streamed');
    console.log('✓ file-raw over 64 MiB → 413 FILE_TOO_LARGE (nothing streamed)');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// 15. the request window is trimmed past MAX_REQUESTS without losing stats
{
  const sessionId = 's-test-trim';
  const base = Date.UTC(2026, 7, 19, 2, 0, 0); // Beijing 10:00 → on-peak
  const COUNT = 2100; // > the plugin's 2000-record window
  const events = [];
  for (let i = 0; i < COUNT; i += 1) {
    events.push({
      type: 'request/header',
      seq: events.length,
      time: base + i * 2,
      data: { header: { config: { provider: 'p', model: 'm' } } },
    });
    events.push({
      type: 'assistant/message',
      seq: events.length,
      time: base + i * 2 + 1,
      data: { usage: { inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1 } },
    });
  }
  const session = { id: sessionId, snapshotEvents: (fromSeq = 0) => events.slice(fromSeq) };
  ctx._sessions.set(sessionId, session);

  const res = makeRes();
  await handler(makeReq('GET', '/dsh-sidebar-panel/api/overview?sessionId=' + sessionId, OK_HEADERS), res);
  const data = parse(res);
  assert.equal(data.overview.requestCount, COUNT, 'every request counted despite the trimmed window');
  assert.equal(data.overview.byModel.length, 1);
  assert.equal(data.overview.byModel[0].count, COUNT);
  assert.equal(data.overview.byModel[0].miss, COUNT);
  assert.equal(data.overview.byModel[0].output, COUNT);
  assert.equal(data.overview.firstTime, base, 'first request time survives trimming');
  // 2100 × (1 × 2 + 1 × 8) / 1e6 = 0.021
  assert.ok(Math.abs(data.overview.cost - 0.021) < 1e-9, `cost=${data.overview.cost}`);
  console.log('✓ request window trimmed past 2000 without losing overview stats');
}

// 16. sessions the panel never looked at are not folded at all
{
  const sessionId = 's-test-lazy';
  const asked = [];
  const base = Date.UTC(2026, 7, 19, 2, 0, 0);
  const events = [
    { type: 'request/header', seq: 0, time: base, data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-chat' } } } },
    { type: 'tool/call', seq: 1, time: base + 1, data: { name: 'write', arguments: { filePath: 'D:/x/lazy.ts' } } },
  ];
  const session = {
    id: sessionId,
    snapshotEvents: (fromSeq = 0) => {
      asked.push(fromSeq);
      return events.slice(fromSeq);
    },
  };
  ctx._sessions.set(sessionId, session);

  ctx._listeners['session/event'](session);
  assert.deepEqual(asked, [], 'an unfolded session costs nothing per event');

  const res = makeRes();
  await handler(makeReq('GET', '/dsh-sidebar-panel/api/changes?sessionId=' + sessionId, OK_HEADERS), res);
  const data = parse(res);
  assert.equal(data.changes.length, 1, 'first access still back-fills the whole history');
  assert.equal(data.changes[0].path, 'D:/x/lazy.ts');
  assert.deepEqual(asked, [0], 'the first fold reads from the very beginning');
  console.log('✓ unvisited session skipped; first access back-fills full history');
}

/* ------------------------------------------------------------------ */
/* Official peak/valley schedule + /usage-today                        */
/* ------------------------------------------------------------------ */

// Beijing wall-clock instant → epoch ms.
const BJ = (y, m, d, h) => Date.UTC(y, m - 1, d, h) - 8 * 3600 * 1000;

const realNow = Date.now;
const atInstant = (ms) => {
  Date.now = () => ms;
};
const restoreNow = () => {
  Date.now = realNow;
};

/** One million input tokens on a model, at `time`, as a session event pair. */
function usageEvents(model, time, inputTokens) {
  return [
    { type: 'request/header', seq: 0, time, data: { header: { config: { provider: 'deepseek-official', model } } } },
    { type: 'assistant/message', seq: 1, time, data: { usage: { inputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 } } },
  ];
}

/** A fake persistence backend over a map of id → { path, events }. */
function fakePersistence(entries) {
  const store = new Map(entries);
  return {
    store,
    async list() {
      return [...store.entries()].map(([id, entry]) => ({
        header: { id, cwd: 'D:/ws' },
        revision: 1,
        sizeBytes: entry.events.length * 512,
      }));
    },
    locate(header) {
      return { kind: 'jsonl', path: store.get(header.id).path };
    },
    async open(id) {
      const entry = store.get(id);
      return {
        header: { id, cwd: 'D:/ws' },
        async read() {
          return { eventState: 'current', events: entry.events };
        },
        async close() {},
      };
    },
  };
}

// 12. The schedule itself, read off the route (no store needed: `peak` is
// computed before the scan, so these assertions never touch a session log).
{
  const cases = [
    // [instant, peak?, next flip, why]
    [BJ(2026, 10, 8, 10), true, BJ(2026, 10, 8, 12), 'Thursday 10:00 inside 09-12'],
    [BJ(2026, 10, 8, 13), false, BJ(2026, 10, 8, 14), 'Thursday 13:00 is the lunch valley'],
    [BJ(2026, 10, 8, 15), true, BJ(2026, 10, 8, 18), 'Thursday 15:00 inside 14-18'],
    [BJ(2026, 10, 8, 20), false, BJ(2026, 10, 9, 9), 'Thursday night waits for Friday 09:00'],
    [BJ(2026, 10, 10, 10), false, BJ(2026, 10, 12, 9), 'Saturday is valley all day'],
    [BJ(2026, 10, 1, 10), false, BJ(2026, 10, 8, 9), 'National Day holiday is valley all day'],
  ];
  ctx._persistence = undefined;
  for (const [instant, expectedPeak, expectedNext, why] of cases) {
    atInstant(instant);
    const res = makeRes();
    await handler(makeReq('GET', '/dsh-sidebar-panel/api/usage-today', OK_HEADERS), res);
    const data = parse(res);
    restoreNow();
    assert.equal(data.peak.active, expectedPeak, why);
    assert.equal(data.peak.nextChangeAt, expectedNext, `next flip after: ${why}`);
    // No store is the documented degradation: the indicator still works.
    assert.equal(data.today, null);
    assert.equal(data.error.code, 'NO_SESSION_STORE');
  }
  console.log('✓ official peak/valley schedule (weekday windows, weekends, holidays)');
}

// 13. Today's spend: peak and valley priced from the official table, and a log
// untouched since midnight skipped without being decoded.
{
  const day = Date.UTC(2026, 9, 8, 12); // 2026-10-08 20:00 +08
  const dayStart = Date.UTC(2026, 9, 7, 16); // 2026-10-08 00:00 +08
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsp-usage-'));
  const freshPath = path.join(dir, 'fresh.jsonl');
  const stalePath = path.join(dir, 'stale.jsonl');
  await fs.writeFile(freshPath, '');
  await fs.writeFile(stalePath, '');
  await fs.utimes(freshPath, new Date(day), new Date(day));
  await fs.utimes(stalePath, new Date(dayStart - 86400000), new Date(dayStart - 86400000));

  // Flash valley = 1 CNY/M input, peak = ×2. 10:00 +08 is peak, 13:00 is valley.
  const fresh = [
    ...usageEvents('deepseek-v4-flash', Date.UTC(2026, 9, 8, 2), 1000000),
    ...usageEvents('deepseek-v4-flash', Date.UTC(2026, 9, 8, 5), 1000000),
  ];
  const stale = usageEvents('deepseek-v4-flash', Date.UTC(2026, 9, 8, 5), 1000000);
  ctx._persistence = fakePersistence([['sess-fresh', { path: freshPath, events: fresh }], ['sess-stale', { path: stalePath, events: stale }]]);

  atInstant(day);
  const res = makeRes();
  await handler(makeReq('GET', '/dsh-sidebar-panel/api/usage-today', OK_HEADERS), res);
  restoreNow();
  const data = parse(res);
  assert.equal(data.ok, true);
  assert.equal(data.today.day, '2026-10-08');
  assert.equal(data.today.requests, 2, 'one billed message per usage event');
  assert.equal(data.today.sessions, 1, 'the untouched log is filtered out before decode');
  assert.equal(data.today.skipped, 0);
  assert.equal(data.today.cost, 3, '2 (peak) + 1 (valley) CNY');
  assert.equal(data.today.currency, 'CNY');
  assert.equal(data.peak.active, false, '20:00 Beijing is valley');
  assert.equal(data.today.byModel[0].model, 'deepseek-v4-flash');
  console.log("✓ /usage-today prices today's peak+valley usage and skips stale logs");
}

// 14. A Pro model prices at its own (3×) official rate — the built-in table is
// matched by substring, so a variant id still lands on the right row.
{
  const day = Date.UTC(2026, 9, 9, 12); // 2026-10-09 20:00 +08
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsp-usage-pro-'));
  const logPath = path.join(dir, 'pro.jsonl');
  await fs.writeFile(logPath, '');
  await fs.utimes(logPath, new Date(day), new Date(day));
  ctx._persistence = fakePersistence([['sess-pro', {
    path: logPath,
    events: usageEvents('deepseek-v4-pro-2026', Date.UTC(2026, 9, 9, 5), 1000000),
  }]]);

  atInstant(day);
  const res = makeRes();
  await handler(makeReq('GET', '/dsh-sidebar-panel/api/usage-today', OK_HEADERS), res);
  restoreNow();
  const data = parse(res);
  assert.equal(data.today.cost, 4.5, 'Pro valley input price is 4.5 CNY/M');
  console.log('✓ /usage-today resolves the built-in official table by model id substring');
}

console.log('\nALL UNIT TESTS PASSED');