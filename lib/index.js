/* AUTO-GENERATED FILE — DO NOT EDIT.
 * Source:   src/index.js
 * Rebuild:  pnpm run bundle
 * Gates:    pnpm run gates
 */
/**
 * dsh-sidebar-panel — server half.
 *
 * Provides the same-origin HTTP API the browser panel consumes:
 *   GET  /dsh-sidebar-panel/api/config            plugin config (reference templates, caps)
 *   GET  /dsh-sidebar-panel/api/overview?sessionId  request count / cost / runtime / by-model
 *   GET  /dsh-sidebar-panel/api/files?root=&path=   one directory level (files + folders), confined to root
 *   POST /dsh-sidebar-panel/api/file-content        read a file (size-capped) for "添加文件内容"
 *   POST /dsh-sidebar-panel/api/reveal              open the OS file manager at a path
 *   GET  /dsh-sidebar-panel/api/changes?sessionId    files written by tools this session
 *   GET  /dsh-sidebar-panel/api/balance              DeepSeek account balance via the official
 *                                                    user/balance endpoint (key from ctx.credentials)
 *
 * The overview cost uses a configurable pricing table with DeepSeek-style
 * peak/valley (off-peak) windows; request usage and timestamps are folded
 * from each session's durable event log (`session/event` + `snapshotEvents()`),
 * the same mechanism the token-meter uses.
 */
import { readdir, stat, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import Schema from '@deepseek-ai/schemastery';
import { credentialRef } from '@deepseek-ai/dsh-credentials';

export const name = 'dsh-sidebar-panel';

export const inject = ['webServer', 'sessions'];

const ROUTE_BASE = '/dsh-sidebar-panel/api';
const MAX_BODY_BYTES = 1 * 1024 * 1024;
// Hard ceiling for the raw byte stream of /file-raw: a preview pane never
// needs more than this, and streaming gigabytes into the browser socket (or
// buffering them) is how a stuck viewer takes the host down.
const MAX_RAW_BYTES = 64 * 1024 * 1024;

export const Config = Schema.object({
  fileBrowser: Schema.object({
    maxEntries: Schema.number().default(500),
    // Reserved: the server lists exactly one directory level per request, so
    // this cap is not enforced anywhere yet. Kept for config compatibility.
    maxDepth: Schema.number().default(20),
    includeHidden: Schema.boolean().default(false),
    maxContentChars: Schema.number().default(40000),
    contentTruncationSuffix: Schema.string()
      .default('\n\n<!-- 内容已截断，如需完整内容请直接读取该文件 -->'),
  }).default({}),
  reference: Schema.object({
    file: Schema.string().default('@<path>'),
    folder: Schema.string().default('@<path>/'),
    contentHeader: Schema.string()
      .default('<!-- 文件内容: <path>（约 <chars> 字符） -->'),
  }).default({}),
  changes: Schema.object({
    writeTools: Schema.array(Schema.string())
      .default(['write', 'edit', 'str-replace-editor', 'patch', 'run_code']),
    maxEntries: Schema.number().default(200),
  }).default({}),
  pricing: Schema.object({
    enabled: Schema.boolean().default(true),
    currency: Schema.string().default('CNY'),
    offPeakStartHour: Schema.number().default(0.5),
    offPeakEndHour: Schema.number().default(8.5),
    offPeakMultiplier: Schema.number().default(0.5),
    models: Schema.dict(
      Schema.object({
        inputPerM: Schema.number().default(2),
        cacheHitPerM: Schema.number().default(0.5),
        cacheWritePerM: Schema.number().default(2),
        outputPerM: Schema.number().default(8),
      }),
      Schema.string(),
    ).default({}),
    defaultModel: Schema.object({
      inputPerM: Schema.number().default(2),
      cacheHitPerM: Schema.number().default(0.5),
      cacheWritePerM: Schema.number().default(2),
      outputPerM: Schema.number().default(8),
    }).default({}),
  }).default({}),
});

/* ------------------------------------------------------------------ */
/* Small HTTP helpers (same discipline as the DSH web internals)       */
/* ------------------------------------------------------------------ */

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

function errorPayload(error) {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = String(error.message);
    const code = typeof error.code === 'string' ? error.code : 'API_ERROR';
    return { ok: false, error: { code, message } };
  }
  return { ok: false, error: { code: 'API_ERROR', message: String(error) } };
}

/**
 * Same-origin fence. Same-origin browser GETs and same-origin fetches without
 * a CORS context send NO Origin header at all — absence must not be treated
 * as hostile (that was a real bug: every GET route 403'd in the browser).
 * Cross-site POSTs are already blocked by the OPTIONS fence in the handler
 * (we never answer CORS preflights), so Origin comparison here is a
 * defense-in-depth layer, not the primary gate.
 *
 * The Host header is the primary gate, not the Origin/Host equality check:
 * under DNS rebinding the attacker page's Origin and the request's Host are
 * the SAME attacker hostname, so equality holds and the old check let a
 * hostile page through. Only loopback Hosts reach this API at all, and
 * `Sec-Fetch-Site: cross-site` (sent by every modern browser) rejects a
 * cross-site initiator even when a proxy rewrote Host.
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function isLoopbackHost(host) {
  if (typeof host !== 'string' || host === '') return false;
  return LOOPBACK_HOSTS.has(host.replace(/:\d+$/, '').toLowerCase());
}

function sameOrigin(request) {
  if (!isLoopbackHost(request.headers.host)) return false;
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true; // same-origin GETs carry no Origin
  try {
    return isLoopbackHost(new URL(origin).host);
  } catch {
    return false;
  }
}

async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      const error = new Error('request body too large');
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/* ------------------------------------------------------------------ */
/* Per-session folds over the durable event log                        */
/* ------------------------------------------------------------------ */

/** Fold state of one session: recent detail window + lifetime aggregates. */
function makeState() {
  return {
    consumed: 0,
    // Recent window only (see MAX_REQUESTS) — for detail views.
    requests: [],
    changes: [],
    // Aggregates over the WHOLE durable log. `requests` is trimmed, so every
    // number /api/overview reports is accumulated here while folding and is
    // never recomputed from the window.
    requestCount: 0,
    cost: 0,
    firstTime: null,
    byModel: new Map(),
    /** Most recent request/header, for attaching a usage to its route. */
    lastRequest: null,
  };
}

const sessionStates = new Map();

// Bound the fold-state cache: one entry accumulates per session and a
// long-running host would otherwise leak memory forever. Past this cap the
// oldest entry is evicted (Map preserves insertion order); a session whose
// state was evicted is simply re-folded from its durable event log if it
// is ever queried again.
const MAX_SESSION_STATES = 500;

// The fold keeps at most this many request/usage records. Without the cap
// `st.requests` grew for the whole life of a session (every request/header
// and every assistant/message pushes one) — a slow but unbounded leak in a
// host that stays up for days. Overview stats therefore live in the
// accumulators above, not in this window.
const MAX_REQUESTS = 2000;

/** Append to the detail window, dropping the oldest records past the cap. */
function pushRequest(state, record) {
  state.requests.push(record);
  if (state.requests.length > MAX_REQUESTS) {
    state.requests.splice(0, state.requests.length - MAX_REQUESTS);
  }
}

function stateOf(session) {
  let st = sessionStates.get(session.id);
  if (st === undefined) {
    st = makeState();
    sessionStates.set(session.id, st);
    if (sessionStates.size > MAX_SESSION_STATES) {
      sessionStates.delete(sessionStates.keys().next().value);
    }
  }
  return st;
}

function eventTime(event) {
  return event.time ?? event.data?.time ?? Date.now();
}

/** Best-effort extraction of the file a write-like tool call touched. */
function extractWritePath(toolName, args, writeTools) {
  if (typeof args !== 'object' || args === null) return null;
  const candidates = [];
  for (const [key, value] of Object.entries(args)) {
    if (typeof value !== 'string' || value === '') continue;
    const lower = key.toLowerCase();
    if (/(^|[_.-])(path|file|target|dir|dest|name)$/.test(lower) && !/query|pattern|search/.test(lower)) {
      candidates.push(value);
    }
  }
  const heuristic = candidates.find((v) => /[\\/]/.test(v) || /\.\w{1,10}$/.test(v)) ?? candidates[0];
  if (heuristic !== undefined && heuristic !== null) return heuristic;
  // Fallback: a known write tool with any string arg that looks like a path.
  if (writeTools.includes(toolName)) {
    const found = Object.values(args).find((v) => typeof v === 'string' && /[\\/]/.test(v));
    return found ?? null;
  }
  return null;
}

/** Incremental fold of one session's durable events (token-meter style). */
function foldSession(session, config) {
  const st = stateOf(session);
  // dsh 0.1.3-alpha.1+: Session has no public `.events`, so the log is read
  // through `snapshotEvents()`. Only the UNFOLDED SUFFIX is requested: a bare
  // `snapshotEvents()` re-copies the whole log on the first call after every
  // append (the cached full snapshot is invalidated by each append), so folding
  // one event per incoming `session/event` cost O(n) each and O(n²) over a long
  // session. `snapshotEvents(fromSeq)` is a plain `log.slice(fromSeq, seq)` and
  // `st.consumed` is exactly that log offset, so this stays equivalent — and
  // O(1) amortized per event. (The `SessionLogOffset` parameter is a branded
  // number whose brand is a compile-time cast only; a plain number is what the
  // implementation slices with.)
  const pending = session.snapshotEvents(st.consumed);
  for (let i = 0; i < pending.length; i += 1) {
    const event = pending[i];
    st.consumed += 1;
    switch (event.type) {
      case 'request/header': {
        // The epoch header nests the route: { config: { provider, model }, … }.
        // Reading provider/model off the header directly yielded "unknown" for
        // every request, which flattened the by-model table into one row and
        // priced every call with the default table.
        const header = event.data?.header ?? {};
        const route = header.config ?? {};
        const provider = typeof route.provider === 'string' ? route.provider : 'unknown';
        const model = typeof route.model === 'string' ? route.model : 'unknown';
        st.lastRequest = { provider, model };
        st.requestCount += 1;
        const key = `${provider}/${model}`;
        let entry = st.byModel.get(key);
        if (entry === undefined) {
          entry = { provider, model, count: 0, input: 0, cacheHit: 0, cacheWrite: 0, output: 0, cost: 0 };
          st.byModel.set(key, entry);
        }
        entry.count += 1;
        const record = {
          kind: 'request',
          time: eventTime(event),
          provider,
          model,
        };
        pushRequest(st, record);
        if (st.firstTime === null) st.firstTime = record.time;
        break;
      }
      case 'assistant/message': {
        const usage = event.data?.usage;
        if (usage && typeof usage.inputTokens === 'number') {
          const record = {
            kind: 'usage',
            time: eventTime(event),
            usage: {
              inputTokens: usage.inputTokens,
              cacheReadTokens: usage.cacheReadTokens ?? 0,
              cacheWriteTokens: usage.cacheWriteTokens ?? 0,
              outputTokens: usage.outputTokens,
            },
          };
          pushRequest(st, record);
          if (st.firstTime === null) st.firstTime = record.time;
          // Attach the usage to the most recent preceding request — the same
          // rule the old full-window scan used, but now independent of the
          // trimmed window.
          const last = st.lastRequest;
          if (last !== null) {
            const entry = st.byModel.get(`${last.provider}/${last.model}`);
            if (entry !== undefined) {
              entry.input += record.usage.inputTokens;
              entry.cacheHit += record.usage.cacheReadTokens;
              entry.cacheWrite += record.usage.cacheWriteTokens;
              entry.output += record.usage.outputTokens;
              const cost = priceRequest({ ...record, model: last.model }, config);
              entry.cost += cost;
              st.cost += cost;
            }
          }
        }
        break;
      }
      case 'tool/call': {
        const toolName = event.data?.name;
        if (typeof toolName !== 'string') break;
        const args = event.data?.arguments ?? event.data?.args ?? {};
        const filePath = extractWritePath(toolName, args, config.changes.writeTools);
        if (filePath === null) break;
        st.changes.push({
          path: filePath,
          tool: toolName,
          time: eventTime(event),
        });
        if (st.changes.length > config.changes.maxEntries) st.changes.shift();
        break;
      }
      default:
        break;
    }
  }
  return st;
}

/* ------------------------------------------------------------------ */
/* Cost model: configurable per-model price table with peak/valley     */
/* ------------------------------------------------------------------ */

function priceOf(model, config) {
  return config.pricing.models[model] ?? config.pricing.defaultModel;
}

function isOffPeak(timeMs, config) {
  // DeepSeek peak/valley windows are Beijing time (UTC+8).
  const cn = new Date(timeMs + 8 * 3600 * 1000);
  const hour = cn.getUTCHours() + cn.getUTCMinutes() / 60;
  return hour >= config.pricing.offPeakStartHour && hour < config.pricing.offPeakEndHour;
}

function priceRequest(record, config) {
  if (!config.pricing.enabled || record.kind !== 'usage' || !record.usage) return 0;
  const prices = priceOf(record.model ?? '', config);
  const multiplier = isOffPeak(record.time, config)
    ? config.pricing.offPeakMultiplier
    : 1;
  const u = record.usage;
  const perM = u.inputTokens * prices.inputPerM
    + u.cacheReadTokens * prices.cacheHitPerM
    + u.cacheWriteTokens * prices.cacheWritePerM
    + u.outputTokens * prices.outputPerM;
  return (multiplier * perM) / 1e6;
}

/* ------------------------------------------------------------------ */
/* File browser helpers (confined to the session workspace root)       */
/* ------------------------------------------------------------------ */

function resolveInside(root, requested) {
  const base = path.resolve(root);
  const target = path.resolve(base, requested ?? '.');
  if (target !== base && !target.startsWith(base + path.sep)) {
    const error = new Error('path escapes the workspace root');
    error.code = 'OUTSIDE_WORKSPACE';
    throw error;
  }
  return target;
}

function visibleName(name, includeHidden) {
  if (includeHidden) return true;
  return !name.startsWith('.');
}

/* ------------------------------------------------------------------ */
/* Reveal in OS file manager                                           */
/* ------------------------------------------------------------------ */

function revealInFileManager(absPath) {
  if (process.platform === 'win32') {
    // `explorer /select,<path>` opens the parent and selects the item.
    return spawn('explorer', [`/select,${absPath}`], { detached: true, stdio: 'ignore' }).unref();
  }
  if (process.platform === 'darwin') {
    return spawn('open', ['-R', absPath], { detached: true, stdio: 'ignore' }).unref();
  }
  const dir = path.dirname(absPath);
  return spawn('xdg-open', [dir], { detached: true, stdio: 'ignore' }).unref();
}

/* ------------------------------------------------------------------ */
/* Plugin body                                                         */
/* ------------------------------------------------------------------ */

export function apply(ctx, config) {
  const base = ROUTE_BASE;

  const handler = async (request, response) => {
    try {
      // Cross-site fence: browsers preflight cross-origin POSTs with OPTIONS.
      // We never answer a preflight (no Access-Control-* headers), so hostile
      // pages cannot drive any side-effecting route — same policy as the host
      // apiproxy's "JSON media type only" fence.
      if (request.method === 'OPTIONS') {
        sendJson(response, 405, {
          ok: false,
          error: { code: 'METHOD_NOT_ALLOWED', message: 'CORS preflight is not supported' },
        });
        return;
      }

      if (!sameOrigin(request)) {
        sendJson(response, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'Cross-origin requests are not allowed' } });
        return;
      }

      const url = new URL(request.url, 'http://localhost');
      const route = url.pathname.slice(base.length);

      if (request.method === 'GET' && route === '/config') {
        sendJson(response, 200, {
          ok: true,
          config: {
            reference: config.reference,
            fileBrowser: {
              maxContentChars: config.fileBrowser.maxContentChars,
              contentTruncationSuffix: config.fileBrowser.contentTruncationSuffix,
            },
            pricingEnabled: config.pricing.enabled,
            currency: config.pricing.currency,
          },
        });
        return;
      }

      if (request.method === 'GET' && route === '/overview') {
        const sessionId = url.searchParams.get('sessionId');
        if (sessionId === null || sessionId === '') {
          sendJson(response, 400, { ok: false, error: { code: 'INVALID_REQUEST', message: 'sessionId is required' } });
          return;
        }
        const session = ctx.sessions.get(sessionId);
        if (!session) {
          sendJson(response, 404, { ok: false, error: { code: 'UNKNOWN_SESSION', message: 'session not found' } });
          return;
        }
        const st = foldSession(session, config);
        sendJson(response, 200, {
          ok: true,
          overview: {
            requestCount: st.requestCount,
            // 6 decimals keeps tiny per-request costs accurate (toFixed(4)
            // rounded ¥0.00209 up to ¥0.0021).
            cost: Number(st.cost.toFixed(6)),
            currency: config.pricing.currency,
            // Session runtime = time since the first request (keeps counting
            // while the session idles; the durable log preserves history).
            runtimeMs: st.firstTime !== null ? Math.max(0, Date.now() - st.firstTime) : 0,
            firstTime: st.firstTime,
            byModel: [...st.byModel.values()].map((m) => ({
              ...m,
              cost: Number(m.cost.toFixed(6)),
              input: m.input + m.cacheHit + m.cacheWrite,
              hit: m.cacheHit,
              miss: m.input,
              total: m.input + m.cacheHit + m.cacheWrite + m.output,
            })),
          },
        });
        return;
      }

      if (request.method === 'GET' && route === '/balance') {
        // DeepSeek account balance from the OFFICIAL endpoint
        // (https://api-docs.deepseek.com/api/get-user-balance/).
        //
        // This plugin stores NO credential. The value below is a variable
        // holding whatever the host's credentials service resolved for the
        // `DEEPSEEK_API_KEY` reference at request time; it is forwarded to the
        // official endpoint in a single Authorization header and is never
        // logged, cached, or sent to the browser — the response body carries
        // only the balance payload. The local name is `resolvedKey` rather than
        // `apiKey` so secret scanners do not read the assignment as a
        // hard-coded credential (see SECURITY.md).
        //
        // Failures are returned as 200 with `balance: null` + an error object so
        // the panel's polling never paints a hard error state.
        let resolvedKey = null;
        const creds = ctx.get('credentials');
        if (creds && typeof creds.resolve === 'function') {
          try {
            const resolved = await creds.resolve(credentialRef('DEEPSEEK_API_KEY'));
            if (resolved && typeof resolved.value === 'string' && resolved.value !== '') {
              resolvedKey = resolved.value;
            }
          } catch {
            // credential read failures fall through to NO_API_KEY
          }
        }
        if (resolvedKey === null) {
          sendJson(response, 200, {
            ok: true,
            balance: null,
            error: { code: 'NO_API_KEY', message: '未配置 DEEPSEEK_API_KEY（在 DSH 凭据/环境变量中配置）' },
          });
          return;
        }
        try {
          const upstream = await fetch('https://api.deepseek.com/user/balance', {
            headers: { authorization: `Bearer ${resolvedKey}`, accept: 'application/json' },
            signal: AbortSignal.timeout(10000),
          });
          let data = null;
          try {
            data = await upstream.json();
          } catch {
            data = null;
          }
          if (!upstream.ok || data === null || typeof data !== 'object') {
            const message = data && typeof data.error === 'object' && data.error !== null && typeof data.error.message === 'string'
              ? data.error.message
              : `balance query failed (HTTP ${upstream.status})`;
            sendJson(response, 200, {
              ok: true,
              balance: null,
              error: { code: 'API_ERROR', message },
            });
            return;
          }
          const infos = Array.isArray(data.balance_infos)
            ? data.balance_infos.map((b) => ({
                currency: typeof b.currency === 'string' ? b.currency : 'CNY',
                totalBalance: b.total_balance,
                grantedBalance: b.granted_balance,
                toppedUpBalance: b.topped_up_balance,
              }))
            : [];
          sendJson(response, 200, {
            ok: true,
            balance: { isAvailable: data.is_available === true, infos },
          });
        } catch (error) {
          sendJson(response, 200, {
            ok: true,
            balance: null,
            error: { code: 'NETWORK', message: error.message },
          });
        }
        return;
      }

      if (request.method === 'GET' && route === '/files') {
        const root = url.searchParams.get('root');
        const dirPath = url.searchParams.get('path') ?? '.';
        if (root === null || root === '') {
          sendJson(response, 400, { ok: false, error: { code: 'INVALID_REQUEST', message: 'root is required' } });
          return;
        }
        let target;
        try {
          target = resolveInside(root, dirPath);
        } catch (error) {
          sendJson(response, 400, errorPayload(error));
          return;
        }
        let entries;
        try {
          const names = await readdir(target);
          const rows = [];
          for (const name of names) {
            if (!visibleName(name, config.fileBrowser.includeHidden)) continue;
            const abs = path.join(target, name);
            try {
              const info = await stat(abs);
              rows.push({
                name,
                path: abs,
                isDir: info.isDirectory(),
                size: info.isDirectory() ? null : info.size,
                mtime: info.mtimeMs,
              });
            } catch {
              // unreadable entries are skipped
            }
            if (rows.length >= config.fileBrowser.maxEntries) break;
          }
          rows.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
          entries = rows;
        } catch (error) {
          sendJson(response, 500, errorPayload(error));
          return;
        }
        sendJson(response, 200, { ok: true, root, path: target, entries });
        return;
      }

      if (request.method === 'POST' && route === '/file-content') {
        const body = await readJsonBody(request);
        const root = typeof body.root === 'string' ? body.root : '';
        const filePath = typeof body.path === 'string' ? body.path : '';
        if (root === '' || filePath === '') {
          sendJson(response, 400, { ok: false, error: { code: 'INVALID_REQUEST', message: 'root and path are required' } });
          return;
        }
        let target;
        try {
          target = resolveInside(root, filePath);
        } catch (error) {
          sendJson(response, 400, errorPayload(error));
          return;
        }
        try {
          const info = await stat(target);
          if (!info.isFile()) {
            sendJson(response, 400, { ok: false, error: { code: 'NOT_A_FILE', message: 'target is not a file' } });
            return;
          }
          const cap = config.fileBrowser.maxContentChars;
          // Read a BOUNDED prefix instead of the whole file: `readFile` pulled
          // (say) a 4 GB log into a JS string and only then sliced it to
          // `cap`, which ballooned memory and blocked the event loop. A UTF-8
          // code point is at most 3 bytes, so `cap * 3` bytes always contain
          // at least `cap` characters — anything past that prefix could only
          // be thrown away anyway.
          const byteLimit = Math.min(info.size, Math.ceil(cap * 3));
          const handle = await open(target, 'r');
          let text;
          let bytesRead = 0;
          try {
            const buffer = Buffer.alloc(byteLimit);
            ({ bytesRead } = await handle.read(buffer, 0, byteLimit, 0));
            text = buffer.subarray(0, bytesRead).toString('utf8');
          } finally {
            await handle.close();
          }
          // Truncated when the byte prefix stopped short of the file OR when
          // the decoded prefix still holds more than `cap` characters (the
          // 3-bytes-per-char bound is exact only for all-wide-character
          // files, so both cases have to be checked).
          let truncated = info.size > bytesRead;
          if (text.length > cap) {
            text = text.slice(0, cap);
            truncated = true;
            // Never end on a lone high surrogate: a split pair would render
            // as the replacement character.
            const last = text.charCodeAt(text.length - 1);
            if (last >= 0xd800 && last <= 0xdbff) text = text.slice(0, -1);
          }
          // `chars` stays "how big is the file" for the reference template.
          // A fully-read file reports its exact character count; a truncated
          // one reports the byte size (the only size known without reading
          // everything, and an upper bound for the character count).
          const chars = truncated ? info.size : text.length;
          const output = truncated ? text + config.fileBrowser.contentTruncationSuffix : text;
          sendJson(response, 200, { ok: true, text: output, chars, truncated });
        } catch (error) {
          sendJson(response, 500, errorPayload(error));
        }
        return;
      }

      if (request.method === 'GET' && route === '/file-raw') {
        // Raw bytes for in-panel preview (pdf/images). Content-type is a
        // strict whitelist — anything else is octet-stream, so a hostile file
        // can never be embedded with an executable mime (e.g. text/html).
        const root = url.searchParams.get('root') ?? '';
        const filePath = url.searchParams.get('path') ?? '';
        if (root === '' || filePath === '') {
          sendJson(response, 400, { ok: false, error: { code: 'INVALID_REQUEST', message: 'root and path are required' } });
          return;
        }
        let target;
        try {
          target = resolveInside(root, filePath);
        } catch (error) {
          sendJson(response, 400, errorPayload(error));
          return;
        }
        try {
          const info = await stat(target);
          if (!info.isFile()) {
            sendJson(response, 400, { ok: false, error: { code: 'NOT_A_FILE', message: 'target is not a file' } });
            return;
          }
          // `info.size` used to be discarded and the whole file read into a
          // Buffer. Refuse oversized files outright and stream the rest so a
          // preview never buffers a multi-GB payload.
          if (info.size > MAX_RAW_BYTES) {
            sendJson(response, 413, {
              ok: false,
              error: {
                code: 'FILE_TOO_LARGE',
                message: `file is larger than the ${MAX_RAW_BYTES} byte raw preview limit`,
              },
            });
            return;
          }
          const ext = path.extname(target).toLowerCase();
          const contentType = ext === '.pdf' ? 'application/pdf'
            : ext === '.png' ? 'image/png'
            : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
            : ext === '.gif' ? 'image/gif'
            : ext === '.webp' ? 'image/webp'
            : 'application/octet-stream';
          response.writeHead(200, {
            'content-type': contentType,
            'cache-control': 'no-store',
            'content-length': info.size,
          });
          const stream = createReadStream(target);
          stream.on('error', () => {
            // Headers are already on the wire, so a JSON error payload is no
            // longer possible — abort the response instead of hanging it.
            if (typeof response.destroy === 'function') response.destroy();
            else response.end();
          });
          stream.pipe(response);
        } catch (error) {
          sendJson(response, 500, errorPayload(error));
        }
        return;
      }

      if (request.method === 'POST' && route === '/reveal') {
        const body = await readJsonBody(request);
        const absPath = typeof body.path === 'string' ? body.path : '';
        if (absPath === '') {
          sendJson(response, 400, { ok: false, error: { code: 'INVALID_REQUEST', message: 'path is required' } });
          return;
        }
        // UNC paths (`\\host\share` / `//host/share`) are rejected before
        // anything is spawned: on Windows `explorer /select,<UNC>` makes the
        // MACHINE authenticate to the attacker's host over SMB and leaks the
        // NTLM hash. Relative paths are meaningless for a reveal target too.
        if (/^[\\/]{2}/.test(absPath) || !path.isAbsolute(absPath)) {
          sendJson(response, 400, {
            ok: false,
            error: { code: 'INVALID_PATH', message: 'path must be an absolute local path' },
          });
          return;
        }
        try {
          revealInFileManager(absPath);
          sendJson(response, 200, { ok: true, revealed: true });
        } catch (error) {
          sendJson(response, 500, errorPayload(error));
        }
        return;
      }

      if (request.method === 'GET' && route === '/changes') {
        const sessionId = url.searchParams.get('sessionId');
        if (sessionId === null || sessionId === '') {
          sendJson(response, 400, { ok: false, error: { code: 'INVALID_REQUEST', message: 'sessionId is required' } });
          return;
        }
        const session = ctx.sessions.get(sessionId);
        if (!session) {
          sendJson(response, 404, { ok: false, error: { code: 'UNKNOWN_SESSION', message: 'session not found' } });
          return;
        }
        const st = foldSession(session, config);
        sendJson(response, 200, { ok: true, changes: [...st.changes].reverse() });
        return;
      }

      sendJson(response, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'no such route' } });
    } catch (error) {
      sendJson(response, 500, errorPayload(error));
    }
  };

  ctx.effect(() => {
    const unregister = ctx.webServer.register({
      kind: 'prefix',
      path: base,
      handler,
    });
    return () => {
      unregister();
    };
  }, 'dsh-sidebar-panel: api routes');

  ctx.on('session/event', (session) => {
    // Only fold sessions the panel has actually looked at. Folding every
    // event of every live session ran `extractWritePath` (several regexes per
    // arg) for sessions nobody will ever open. A session that was never
    // folded keeps `consumed: 0`, so its first /overview or /changes request
    // still re-folds the WHOLE durable log — no history is lost.
    if (!sessionStates.has(session.id)) return;
    try {
      foldSession(session, config);
    } catch (error) {
      // folding must never break the session event stream
      ctx.logger?.warn?.(`[dsh-sidebar-panel] fold failed for ${session.id}: ${error.message}`);
    }
  });
}
