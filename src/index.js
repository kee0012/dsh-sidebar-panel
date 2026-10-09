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
 *   GET  /dsh-sidebar-panel/api/usage-today          today's spend from the background scan of the
 *                                                    stored session logs, plus the live peak/valley state
 *
 * The today spend counts DeepSeek-served requests only (`isDeepSeekModel`): the
 * card reports the DeepSeek account, so a session run on any other provider is
 * not part of it. The overview cost uses the official DeepSeek price table with
 * the official
 * peak/valley schedule (weekday 09:00-12:00 / 14:00-18:00 Beijing time is peak;
 * nights, weekends and statutory holidays are valley); request usage and
 * timestamps are folded from each session's durable event log (`session/event`
 * + `snapshotEvents()`), the same mechanism the token-meter uses.
 */
import { readdir, readFile, stat, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { zstdDecompressSync } from 'node:zlib';
import os from 'node:os';
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
    // Peak windows in Beijing time, as [startHour, endHour) pairs. DeepSeek
    // bills peak rates on weekdays 09:00-12:00 and 14:00-18:00; every other
    // instant — nights, weekends and statutory holidays — is a valley rate.
    peakWindows: Schema.array(Schema.array(Schema.number()))
      .default([[9, 12], [14, 18]]),
    // Peak price = valley price × this ratio (DeepSeek's official ratio is 2).
    peakMultiplier: Schema.number().default(2),
    // Per-model VALLEY prices, in `currency` per million tokens. Keys are
    // matched exactly first, then as substrings (longest wins), so a partial
    // family name is enough.
    models: Schema.dict(
      Schema.object({
        inputPerM: Schema.number().default(1),
        cacheHitPerM: Schema.number().default(0.02),
        cacheWritePerM: Schema.number().default(1),
        outputPerM: Schema.number().default(4),
      }),
      Schema.string(),
    ).default({}),
    // Fallback for a model that neither `models` nor the built-in official
    // table (see OFFICIAL_PRICES) knows about.
    defaultModel: Schema.object({
      inputPerM: Schema.number().default(1),
      cacheHitPerM: Schema.number().default(0.02),
      cacheWritePerM: Schema.number().default(1),
      outputPerM: Schema.number().default(4),
    }).default({}),
  }).default({}),
  usage: Schema.object({
    // Where DSH keeps its durable session logs. Empty means $DSH_HOME/sessions,
    // falling back to ~/.dsh/sessions.
    sessionsRoot: Schema.string().default(''),
    // The background scan refreshes today's total on this cadence. The HTTP
    // route never scans — it answers from the snapshot this timer produces, so
    // the account card paints immediately instead of waiting for the corpus.
    intervalMs: Schema.number().default(30000),
    // First scan starts this long after boot, so plugin startup does not race
    // with the rest of the host coming up.
    warmupDelayMs: Schema.number().default(3000),
    // One session log above this size is skipped instead of decoded whole.
    maxLogBytes: Schema.number().default(128 * 1024 * 1024),
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

/**
 * Best-effort extraction of the file a write-like tool call touched.
 *
 * Two shapes have to be honoured. A LIVE session stores a tool call's
 * arguments as a JSON **string** (`data.arguments: "{\"file_path\":…}"`) —
 * reading only the already-parsed object shape is what left the 改动 tab
 * empty for every real session while the object-shaped unit tests stayed
 * green. The `writeTools` gate also comes FIRST now: `read`, `grep` and
 * `glob` all carry a `path`/`file_path` argument, and a name-blind scan
 * listed every file the model had merely looked at as if it had written it.
 */
function extractWritePath(toolName, args, writeTools) {
  if (!writeTools.includes(toolName)) return null;
  let params = args;
  if (typeof params === 'string') {
    try {
      params = JSON.parse(params);
    } catch {
      return null;
    }
  }
  if (typeof params !== 'object' || params === null) return null;
  const candidates = [];
  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== 'string' || value === '') continue;
    const lower = key.toLowerCase();
    if (/(^|[_.-])(path|file|target|dir|dest|name)$/.test(lower) && !/query|pattern|search/.test(lower)) {
      candidates.push(value);
    }
  }
  const heuristic = candidates.find((v) => /[\\/]/.test(v) || /\.\w{1,10}$/.test(v)) ?? candidates[0];
  if (heuristic !== undefined && heuristic !== null) return heuristic;
  // Fallback: a known write tool with any string arg that looks like a path.
  const found = Object.values(params).find((v) => typeof v === 'string' && /[\\/]/.test(v));
  return found ?? null;
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
/* Cost model: official price table + peak/valley schedule             */
/* ------------------------------------------------------------------ */

// Official DeepSeek CNY VALLEY prices per million tokens, as published on the
// pricing page (the 2026-09-10 cut refreshed the Flash line). Peak rates are
// valley × `pricing.peakMultiplier` — the published ratio is 2 — which is why
// only the valley column is tabulated here.
const OFFICIAL_PRICES = {
  'deepseek-v4-pro': { inputPerM: 4.5, cacheHitPerM: 0.15, cacheWritePerM: 4.5, outputPerM: 13.5 },
  'deepseek-v4-flash': { inputPerM: 1, cacheHitPerM: 0.02, cacheWritePerM: 1, outputPerM: 4 },
  'deepseek-flash': { inputPerM: 1, cacheHitPerM: 0.02, cacheWritePerM: 1, outputPerM: 4 },
};

/**
 * Whether a request was served by DeepSeek itself. The account card reports
 * DeepSeek's own money — balance, today's spend, the peak/valley schedule — so a
 * request answered by any other provider is NOT part of `今日已用`: pricing it
 * would invent a charge the account never received (and the fallback row is
 * DeepSeek's own rate anyway). Ids drift (`deepseek-v4-flash-vision-exp`, or a
 * routed `deepseek/deepseek-chat`), so the vendor substring decides rather than
 * a fixed list.
 */
function isDeepSeekModel(model) {
  return String(model ?? '').toLowerCase().includes('deepseek');
}

/** Longest-key substring match over a price table; `null` when nothing fits. */
function matchPrice(table, id) {
  let best = null;
  let bestLength = 0;
  for (const key of Object.keys(table)) {
    if (key === '' || key.length <= bestLength) continue;
    if (!id.includes(key.toLowerCase())) continue;
    best = table[key];
    bestLength = key.length;
  }
  return best;
}

/**
 * Price entry for a model id: an exact entry in the user's table wins, then a
 * substring match there, then the built-in official table, then the fallback
 * row (DeepSeek's own rate, for a DeepSeek id the table does not know yet).
 * Substring matching exists because model ids drift between releases
 * (`deepseek-v4-flash-vision-exp` is served by the Flash line), and longest
 * first so `flash` can never swallow a longer, pricier id.
 *
 * This function prices whatever id it is given; excluding other vendors is the
 * caller's job, and only the today scan does it.
 */
function priceOf(model, config) {
  const id = String(model ?? '').toLowerCase();
  if (id !== '') {
    const configured = config.pricing.models;
    if (configured[id] !== undefined) return configured[id];
    const override = matchPrice(configured, id);
    if (override !== null) return override;
    const official = matchPrice(OFFICIAL_PRICES, id);
    if (official !== null) return official;
  }
  return config.pricing.defaultModel;
}

/* Official peak/valley schedule, in Beijing time (UTC+8): peak is weekdays
   09:00-12:00 and 14:00-18:00, and every other instant — nights, weekends and
   Chinese statutory holidays — is valley. This is the single source of truth
   for BOTH the cost numbers and the panel's 峰/谷 indicator, so the two can
   never disagree. */
const BEIJING_OFFSET_MS = 8 * 3600 * 1000;
const DAY_MS = 86400000;
// Whole-day valley started on these Beijing instants; earlier timestamps are
// priced by the plain weekday rule alone.
const WEEKEND_VALLEY_FROM = Date.UTC(2026, 7, 22, 16, 0, 0); // = 2026-08-23 00:00 +08
const HOLIDAY_VALLEY_FROM = Date.UTC(2026, 8, 18, 16, 0, 0); // = 2026-09-19 00:00 +08
// Statutory holidays, 2026. Only days OFF are listed: every make-up working day
// falls on a weekend, which the weekend rule already prices as valley.
// NOTE: refresh this each November, when the State Council publishes the next
// year's arrangement.
const HOLIDAY_VALLEY = new Set([
  '2026-01-01', '2026-01-02', '2026-01-03',
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
  '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  '2026-06-19', '2026-06-20', '2026-06-21',
  '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
  '2026-10-05', '2026-10-06', '2026-10-07',
]);
// Beijing hour boundaries at which the peak state can flip.
const PEAK_EDGE_HOURS = [0, 9, 12, 14, 18];

/** Start of the Beijing calendar day containing `timeMs`, as epoch ms. */
function beijingDayStart(timeMs) {
  return Math.floor((timeMs + BEIJING_OFFSET_MS) / DAY_MS) * DAY_MS - BEIJING_OFFSET_MS;
}

/** `YYYY-MM-DD` of the Beijing calendar day containing `timeMs`. */
function beijingDayKey(timeMs) {
  return new Date(timeMs + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

/** Whether `timeMs` falls inside an official peak window. */
function isPeakTime(timeMs, config) {
  // Shifting by +8h and reading the UTC getters IS the Beijing calendar.
  const bj = new Date(timeMs + BEIJING_OFFSET_MS);
  if (timeMs >= WEEKEND_VALLEY_FROM) {
    const dow = bj.getUTCDay();
    if (dow === 0 || dow === 6) return false;
  }
  if (timeMs >= HOLIDAY_VALLEY_FROM && HOLIDAY_VALLEY.has(bj.toISOString().slice(0, 10))) return false;
  const hour = bj.getUTCHours();
  return config.pricing.peakWindows.some((w) => hour >= w[0] && hour < w[1]);
}

/**
 * Epoch ms of the next peak↔valley flip at or after `timeMs`, or `null` when
 * none happens within 12 days. Only Beijing hour boundaries can flip the state,
 * so those are the only candidates scanned.
 */
function nextPeakChangeAt(timeMs, config) {
  const current = isPeakTime(timeMs, config);
  const day0 = beijingDayStart(timeMs);
  // The longest holiday run is 9 days; 12 days leaves headroom.
  for (let day = 0; day <= 12; day += 1) {
    for (const hour of PEAK_EDGE_HOURS) {
      const candidate = day0 + day * DAY_MS + hour * 3600000;
      if (candidate <= timeMs + 1) continue;
      if (isPeakTime(candidate, config) !== current) return candidate;
    }
  }
  return null;
}

function priceRequest(record, config) {
  if (!config.pricing.enabled || record.kind !== 'usage' || !record.usage) return 0;
  const prices = priceOf(record.model ?? '', config);
  const multiplier = isPeakTime(record.time, config) ? config.pricing.peakMultiplier : 1;
  const u = record.usage;
  const perM = u.inputTokens * prices.inputPerM
    + u.cacheReadTokens * prices.cacheHitPerM
    + u.cacheWriteTokens * prices.cacheWritePerM
    + u.outputTokens * prices.outputPerM;
  return (multiplier * perM) / 1e6;
}

/**
 * Price every billed message inside `[fromMs, toMs)` of ONE already-decoded
 * event stream, with the same table and peak rule the per-session overview
 * uses. `/usage-today` needs this because it reads COLD session logs, which
 * `foldSession` cannot touch (it requires a live Session object).
 *
 * `request/header` events carry the route for the usage events that follow, so
 * the whole stream is walked even when the window starts later. Requests whose
 * route is not DeepSeek are skipped entirely — they are neither priced nor
 * counted, they merely do not belong to the account this card describes.
 */
function scanUsage(events, config, fromMs, toMs) {
  let cost = 0;
  let requests = 0;
  let model = 'unknown';
  const byModel = new Map();
  for (const event of events) {
    if (event.type === 'request/header') {
      const route = event.data?.header?.config ?? {};
      model = typeof route.model === 'string' ? route.model : 'unknown';
      continue;
    }
    if (event.type !== 'assistant/message') continue;
    const usage = event.data?.usage;
    if (!usage || typeof usage.inputTokens !== 'number') continue;
    // Only the account's own vendor is counted; see `isDeepSeekModel`.
    if (!isDeepSeekModel(model)) continue;
    const time = eventTime(event);
    if (time < fromMs || time >= toMs) continue;
    const value = priceRequest({
      kind: 'usage',
      time,
      model,
      usage: {
        inputTokens: usage.inputTokens,
        cacheReadTokens: usage.cacheReadTokens ?? 0,
        cacheWriteTokens: usage.cacheWriteTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
      },
    }, config);
    cost += value;
    requests += 1;
    byModel.set(model, (byModel.get(model) ?? 0) + value);
  }
  return { cost, requests, byModel };
}

// Today's total comes from a BACKGROUND scan and is served from this snapshot;
// the HTTP route itself never scans. A poll has to answer in microseconds, and
// the scan must never run twice at once.
const usageSnapshot = {
  day: null,
  computedAt: 0,
  value: null,
  error: null,
  running: null,
};

// Session logs, by generation. A session directory holds one generation and the
// highest version wins. Legacy names are listed too, so a machine that never
// migrated an old session still gets read — but the bytes are decoded HERE,
// never through the host's `sessionPersistence` service: opening a legacy
// generation there starts its migration machinery (decode + re-publish under a
// lease), which is expensive, side-effecting, and — with hundreds of legacy logs
// in a real corpus — did not return at all: `/usage-today` hung forever while
// the host kept working on migrations the panel never asked for.
const SESSION_LOG_RE = /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/;
const ZSTD_FRAME_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** $DSH_HOME/sessions, with the plain-home fallback the rest of DSH uses. */
function defaultSessionsRoot() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(home, 'sessions');
}

/**
 * Decode one stored session log. DSH appends a separate zstd frame per flush,
 * so the file is a multi-frame stream and decompressing the whole buffer would
 * return only the first frame: split on the frame magic, decode each frame.
 */
function decodeSessionLog(buffer) {
  const parts = [];
  let start = buffer.indexOf(ZSTD_FRAME_MAGIC, 0);
  if (start < 0) throw new Error('not a zstd frame stream');
  while (start >= 0) {
    const next = buffer.indexOf(ZSTD_FRAME_MAGIC, start + ZSTD_FRAME_MAGIC.length);
    const end = next < 0 ? buffer.length : next;
    parts.push(zstdDecompressSync(buffer.subarray(start, end)));
    start = next;
  }
  return Buffer.concat(parts).toString('utf8');
}

/** One JSON event per line; a torn tail or an unknown line is skipped. */
function parseSessionEvents(text) {
  const events = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // A half-written last line is normal while a session is still running.
    }
  }
  return events;
}

/**
 * Every session log that can hold an event from today — one entry per session,
 * its newest generation. A log last written before midnight cannot, so a single
 * `stat` per session keeps the read set to the handful that can matter.
 *
 * Both layouts are recognised: `<project>/<id>/session[.vN].jsonl[.zstd]` and
 * the legacy flat `<project>/<id>.jsonl[.zstd]`, the newest generation winning
 * so a migrated session is never counted twice.
 */
async function findTodaysSessionLogs(root, dayStart, maxBytes) {
  const found = [];
  let skipped = 0;
  let projects;
  try {
    projects = await readdir(root, { withFileTypes: true });
  } catch {
    return { found, skipped, missing: true };
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const candidates = new Map();
    const projectPath = path.join(root, project.name);
    let entries;
    try {
      entries = await readdir(projectPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile()) {
        const flat = SESSION_LOG_RE.exec(entry.name);
        if (flat !== null) {
          candidates.set(entry.name, {
            path: path.join(projectPath, entry.name),
            version: flat[1] === undefined ? 1 : Number(flat[1]),
          });
        }
        continue;
      }
      if (!entry.isDirectory()) continue;
      const sessionPath = path.join(projectPath, entry.name);
      let logs;
      try {
        logs = await readdir(sessionPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const log of logs) {
        if (!log.isFile()) continue;
        const match = SESSION_LOG_RE.exec(log.name);
        if (match === null) continue;
        const version = match[1] === undefined ? 1 : Number(match[1]);
        const seen = candidates.get(entry.name);
        if (seen === undefined || version > seen.version) {
          candidates.set(entry.name, { path: path.join(sessionPath, log.name), version });
        }
      }
    }
    for (const candidate of candidates.values()) {
      let info;
      try {
        info = await stat(candidate.path);
      } catch {
        continue;
      }
      if (info.mtimeMs < dayStart) continue;
      if (info.size > maxBytes) {
        skipped += 1;
        continue;
      }
      found.push(candidate.path);
    }
  }
  return { found, skipped, missing: false };
}

/**
 * Cost of every session that logged a billed message today (Beijing calendar
 * day), summed over ALL stored sessions — not only this process's live ones, so
 * a restart does not reset the number. Only the files are read: `/overview` can
 * fold live sessions, but nothing in this process can fold a session it never
 * opened, which is exactly what makes the account card agree with the day.
 */
async function scanStoredUsage(config, now, logger) {
  const root = config.usage.sessionsRoot || defaultSessionsRoot();
  const dayStart = beijingDayStart(now);
  const { found, skipped, missing } = await findTodaysSessionLogs(root, dayStart, config.usage.maxLogBytes);
  let cost = 0;
  let requests = 0;
  let sessions = 0;
  let unreadable = skipped;
  const byModel = new Map();
  for (const filePath of found) {
    let events;
    try {
      const raw = await readFile(filePath);
      const text = filePath.endsWith('.zstd') ? decodeSessionLog(raw) : raw.toString('utf8');
      events = parseSessionEvents(text);
    } catch (error) {
      unreadable += 1;
      logger?.warn?.(`[dsh-sidebar-panel] usage scan could not read ${filePath}: ${error.message}`);
      continue;
    }
    const part = scanUsage(events, config, dayStart, now + 1);
    if (part.requests === 0) continue;
    sessions += 1;
    cost += part.cost;
    requests += part.requests;
    for (const [model, value] of part.byModel) {
      byModel.set(model, (byModel.get(model) ?? 0) + value);
    }
  }
  return {
    day: beijingDayKey(now),
    dayStart,
    cost: Number(cost.toFixed(6)),
    currency: config.pricing.currency,
    requests,
    sessions,
    scanned: found.length,
    skipped: unreadable,
    byModel: [...byModel.entries()].map(([model, amount]) => ({
      model,
      cost: Number(amount.toFixed(6)),
    })),
    root,
    ...(missing ? { missingRoot: true } : {}),
  };
}

/**
 * Refresh the snapshot, single-flight. Failures are recorded rather than
 * thrown: the route reports them, and the next tick tries again.
 */
function warmUsage(config, logger, now = Date.now()) {
  if (usageSnapshot.running !== null) return usageSnapshot.running;
  const promise = scanStoredUsage(config, now, logger).then((value) => {
    usageSnapshot.value = value;
    usageSnapshot.day = value.dayStart;
    usageSnapshot.computedAt = Date.now();
    usageSnapshot.error = null;
    usageSnapshot.running = null;
    return value;
  }, (error) => {
    usageSnapshot.error = {
      code: 'SCAN_FAILED',
      message: (error && error.message) || String(error),
    };
    usageSnapshot.running = null;
    logger?.warn?.(`[dsh-sidebar-panel] usage scan failed: ${usageSnapshot.error.message}`);
    return null;
  });
  usageSnapshot.running = promise;
  return promise;
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

/**
 * Fail-soft entry point.
 *
 * A throwing `apply` is reported by the host as a failed plugin, and under
 * `dsh web` that failure has no visible sink: the routes and listeners are
 * simply missing, with nothing in the log to explain why. Registration already
 * goes through `ctx.effect` (so unloading stays automatic and leak-free), and
 * the request handler and the session listener each guard themselves; this
 * wrapper exists only so that an unexpected throw on the way in cannot escape
 * into the host.
 */
export function apply(ctx, config) {
  try {
    applyPlugin(ctx, config);
  } catch (error) {
    ctx.logger?.error?.(`[dsh-sidebar-panel] apply failed: ${error?.stack ?? error}`);
  }
}

function applyPlugin(ctx, config) {
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

      if (request.method === 'GET' && route === '/usage-today') {
        // "今日已用" + the official peak/valley state, both for the account
        // card. The amount is summed over EVERY stored session that logged a
        // billed message since Beijing midnight — other workspaces and
        // pre-restart sessions included — priced exactly like /overview.
        //
        // It estimates THIS harness's spend, not the account's: the balance
        // above also moves for usage from any other client, so the two numbers
        // are deliberately not made to agree.
        //
        // The peak state is computed here, not in the browser, so the official
        // schedule lives in exactly one place.
        const now = Date.now();
        const peak = {
          active: isPeakTime(now, config),
          nextChangeAt: nextPeakChangeAt(now, config),
          multiplier: config.pricing.peakMultiplier,
        };
        // Answered from the warmed snapshot: the scan itself runs on a timer,
        // off the request path, so this route never waits on the corpus.
        const today = usageSnapshot.value !== null && usageSnapshot.day === beijingDayStart(now)
          ? usageSnapshot.value
          : null;
        if (today === null) {
          // Nothing warm yet (the first scan starts a few seconds after boot and
          // the panel can open before it lands) — start one and let the panel
          // show "counting…" rather than a card that never fills in.
          warmUsage(config, ctx.logger, now);
        }
        sendJson(response, 200, {
          ok: true,
          currency: config.pricing.currency,
          peak,
          today,
          ageMs: today === null ? null : Math.max(0, now - usageSnapshot.computedAt),
          warming: today === null,
          error: today === null ? usageSnapshot.error : null,
        });
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
            : ext === '.svg' ? 'image/svg+xml'
            : 'application/octet-stream';
          const headers = {
            'content-type': contentType,
            'cache-control': 'no-store',
            'content-length': info.size,
            // Keeps a mislabelled file from being sniffed back into HTML.
            'x-content-type-options': 'nosniff',
          };
          if (ext === '.svg') {
            // SVG is the one preview type that is both an image and a
            // document: inside `<img>` its scripts never run, but opening the
            // route directly renders it as a same-origin document. The
            // sandbox directive removes scripts from that top-level case.
            headers['content-security-policy'] =
              "default-src 'none'; style-src 'unsafe-inline'; sandbox";
          }
          response.writeHead(200, headers);
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

  ctx.effect(() => {
    // The today-scan lives here, never in a request handler: the account card
    // has to paint the instant it mounts, and a background refresh keeps that
    // true however long reading the corpus takes.
    const warmup = setTimeout(() => {
      warmUsage(config, ctx.logger);
    }, Math.max(0, config.usage.warmupDelayMs));
    const timer = setInterval(() => {
      warmUsage(config, ctx.logger);
    }, Math.max(5000, config.usage.intervalMs));
    return () => {
      clearTimeout(warmup);
      clearInterval(timer);
    };
  }, 'dsh-sidebar-panel: usage warmer');

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

/**
 * Test seam. The today-scan is deliberately off the request path (a timer feeds
 * a snapshot the route reads), so the unit tests must be able to drive one scan
 * deterministically instead of sleeping and hoping.
 */
export const __test = {
  warmUsage,
  scanStoredUsage,
  findTodaysSessionLogs,
  decodeSessionLog,
  usageSnapshot,
  // The 改动 path extractor is the half of the fold that a real session log
  // exercises differently from the fixtures (arguments arrive as a JSON
  // string), so it is exported to be replayed against real logs.
  extractWritePath,
};
