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
import { randomUUID } from 'node:crypto';
import { readdir, stat, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import Schema from '@deepseek-ai/schemastery';
import { credentialRef } from '@deepseek-ai/dsh-credentials';

export const name = 'dsh-sidebar-panel';

export const inject = ['webServer', 'sessions'];

const ROUTE_BASE = '/dsh-sidebar-panel/api';
const MAX_BODY_BYTES = 1 * 1024 * 1024;

export const Config = Schema.object({
  fileBrowser: Schema.object({
    maxEntries: Schema.number().default(500),
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
 */
function sameOrigin(request) {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  const host = request.headers.host;
  if (host === undefined) return false;
  try {
    return new URL(origin).host === host;
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

/** One folded request record: header + optional usage of the same step. */
function makeState() {
  return { consumed: 0, requests: [], changes: [] };
}

const sessionStates = new Map();

// Bound the fold-state cache: one entry accumulates per session and a
// long-running host would otherwise leak memory forever. Past this cap the
// oldest entry is evicted (Map preserves insertion order); a session whose
// state was evicted is simply re-folded from its durable event log if it
// is ever queried again.
const MAX_SESSION_STATES = 500;

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
  // dsh 0.1.3-alpha.1+: Session has no public `.events`; snapshotEvents() returns
  // an append-only snapshot, so the consumed-index incremental fold stays valid.
  const events = session.snapshotEvents();
  while (st.consumed < events.length) {
    const event = events[st.consumed];
    st.consumed += 1;
    switch (event.type) {
      case 'request/header': {
        // The epoch header nests the route: { config: { provider, model }, … }.
        // Reading provider/model off the header directly yielded "unknown" for
        // every request, which flattened the by-model table into one row and
        // priced every call with the default table.
        const header = event.data?.header ?? {};
        const route = header.config ?? {};
        st.requests.push({
          kind: 'request',
          time: eventTime(event),
          provider: typeof route.provider === 'string' ? route.provider : 'unknown',
          model: typeof route.model === 'string' ? route.model : 'unknown',
        });
        break;
      }
      case 'assistant/message': {
        const usage = event.data?.usage;
        if (usage && typeof usage.inputTokens === 'number') {
          st.requests.push({
            kind: 'usage',
            time: eventTime(event),
            usage: {
              inputTokens: usage.inputTokens,
              cacheReadTokens: usage.cacheReadTokens ?? 0,
              cacheWriteTokens: usage.cacheWriteTokens ?? 0,
              outputTokens: usage.outputTokens,
            },
          });
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
        const requests = st.requests;
        const requestRecords = requests.filter((r) => r.kind === 'request');
        const byModel = new Map();
        for (const r of requestRecords) {
          const key = `${r.provider}/${r.model}`;
          const entry = byModel.get(key) ?? { provider: r.provider, model: r.model, count: 0, input: 0, cacheHit: 0, cacheWrite: 0, output: 0, cost: 0 };
          entry.count += 1;
          byModel.set(key, entry);
        }
        // Attach each usage to the most recent preceding request of the same provider/model.
        let lastRequest = null;
        let totalCost = 0;
        let firstTime = null;
        for (const r of requests) {
          if (firstTime === null) firstTime = r.time;
          if (r.kind === 'request') {
            lastRequest = r;
          } else if (r.kind === 'usage' && lastRequest !== null) {
            const key = `${lastRequest.provider}/${lastRequest.model}`;
            const entry = byModel.get(key);
            if (entry) {
              entry.input += r.usage.inputTokens;
              entry.cacheHit += r.usage.cacheReadTokens;
              entry.cacheWrite += r.usage.cacheWriteTokens;
              entry.output += r.usage.outputTokens;
              const cost = priceRequest({ ...r, model: lastRequest.model }, config);
              entry.cost += cost;
              totalCost += cost;
            }
          }
        }
        sendJson(response, 200, {
          ok: true,
          overview: {
            requestCount: requestRecords.length,
            // 6 decimals keeps tiny per-request costs accurate (toFixed(4)
            // rounded ¥0.00209 up to ¥0.0021).
            cost: Number(totalCost.toFixed(6)),
            currency: config.pricing.currency,
            // Session runtime = time since the first request (keeps counting
            // while the session idles; the durable log preserves history).
            runtimeMs: firstTime !== null ? Math.max(0, Date.now() - firstTime) : 0,
            firstTime,
            byModel: [...byModel.values()].map((m) => ({
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
        // (https://api-docs.deepseek.com/api/get-user-balance/). The API key
        // never leaves the server: it is resolved per request from the DSH
        // credentials seam (reference DEEPSEEK_API_KEY) and the browser only
        // ever sees the balance payload. Failures are returned as 200 with
        // `balance: null` + an error object so the polling never paints a
        // hard error state.
        let apiKey = null;
        const creds = ctx.get('credentials');
        if (creds && typeof creds.resolve === 'function') {
          try {
            const resolved = await creds.resolve(credentialRef('DEEPSEEK_API_KEY'));
            if (resolved && typeof resolved.value === 'string' && resolved.value !== '') {
              apiKey = resolved.value;
            }
          } catch {
            // credential read failures fall through to NO_API_KEY
          }
        }
        if (apiKey === null) {
          sendJson(response, 200, {
            ok: true,
            balance: null,
            error: { code: 'NO_API_KEY', message: '未配置 DEEPSEEK_API_KEY（在 DSH 凭据/环境变量中配置）' },
          });
          return;
        }
        try {
          const upstream = await fetch('https://api.deepseek.com/user/balance', {
            headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
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
          const buffer = await readFile(target, { encoding: 'utf8' });
          const truncated = buffer.length > cap;
          const text = truncated ? buffer.slice(0, cap) + config.fileBrowser.contentTruncationSuffix : buffer;
          sendJson(response, 200, { ok: true, text, chars: buffer.length, truncated });
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
          const data = await readFile(target);
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
            'content-length': data.length,
          });
          response.end(data);
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
    try {
      foldSession(session, config);
    } catch (error) {
      // folding must never break the session event stream
      ctx.logger?.warn?.(`[dsh-sidebar-panel] fold failed for ${session.id}: ${error.message}`);
    }
  });
}
