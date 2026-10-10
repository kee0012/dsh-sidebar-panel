/**
 * dsh-sidebar-panel — browser half.
 *
 * The panel is one PAGE TAB of the shipped right column, not a column of its
 * own. The column belongs to `@deepseek-ai/dsh-client-ui-sidebar-right`, which
 * owns the frame geometry, the width, the rail, the split/floating kits and the
 * collapse affordance. This plugin contributes a tab type and its body through
 * that package's public two-stage registry API — exactly the path the shipped
 * `files`, `documentpreview` and `guide` types take. Nothing here reports a
 * column width or writes a grid rule, so the shipped 文件 / 文档预览 / 引导 tabs
 * keep working beside ours.
 *
 * Registrations:
 *  1. `ctx.sidebarRightTabs.register({ id, kind, priority: 'extension', … })`
 *     — stage one: the tab TYPE. A page type declares no `patterns` (it is
 *     opened by kind, never claimed by a resource address) and `extension` is
 *     the band reserved for a type that comes from outside the product. Its
 *     `guide` entry puts it on the column's guide page.
 *  2. `sidebar.right.pane.tab`, keyed by `PACKAGE_ID` — stage two: the BODY.
 *     The seat is session-scoped and keyed, so the framework hands the body the
 *     full Session standard kit (`sessionId`, `useSession`, `useProjection`
 *     merged by ui-session; `useConversation`, `useInput`, `inputActions`
 *     merged by ui-conversation), plus the global `useSessions`, the
 *     namespace-bound `t`, and `useTabInfo` — synthesized from this slot's
 *     `hooks.tabInfo` inject face. No local mirror of the column state is
 *     needed, because the body only mounts while its own tab is visible.
 *  3. `conversation.session.header.utilities` — the session header's
 *     right-aligned utility row, carrying a toggle styled like the sidebar fold
 *     button. It only NAVIGATES (`ctx.sidebarRight.openTab` /
 *     `toggleExpanded`); it never drives layout itself.
 *
 * The panel has four tabs: 概览 (context/token/cost), 文件 (workspace file tree
 * with a per-type icon per row + context menu), 改动 (files written this
 * session, drawn with the same icons), 工具 (tool calls in this window, one
 * glyph per state). Every icon is inline SVG or a CSS chip built by this file —
 * no icon font, no image asset, nothing to load.
 *
 * Persistence: which tabs exist and whether the column shows them is
 * per-session store state owned by the shipped Sidebar, so switching sessions
 * restores each session's own tab strip. This plugin therefore no longer keeps
 * a `localStorage` preference for the column; it remembers only its own inner
 * tab selection, keyed by session id.
 *
 * Data sources: the 概览 projections (`tokenUsage` / `contextPressure`), the
 * server-side folds, and the 文件/改动 tabs are unchanged — but the CHAT-derived
 * half (the 工具 tab's call list and the output-budget card) reads the
 * Conversation snapshot's `chat` view slice
 * (`useConversation(s => s.views.get('chat')).legacy`, registered by ui-chat).
 * No core generation has ever carried `chat`/`nodes` on the SESSION snapshot,
 * so the session-side reads remain only as a last-resort fallback; the
 * tool-call scan also accepts the tool-result shape whose head fields are
 * nested on `call` (which is null when the originating call is outside the
 * window).
 *
 * The 工具 tab renders a self-built detail view rather than reusing per-tool
 * renderers: the shipped detail seat belongs to the framework's own right
 * Sidebar registration (declaring is claiming), and that occupancy is exactly
 * what this plugin no longer contests.
 */
window.__ModuleLoader__.load({ id: "dsh-sidebar-panel", factory: (require) => {
  var module = { exports: {} };
  var exports = module.exports;
  var React = require("react");

  /**
   * The host's icon set lives in `@deepseek-ai/dsh-client-ui-primitives`, which
   * the loader hands over through `dsh.client.inject`. Two things matter here:
   * the export names moved with the 0.2 line (`<Name>16` → `<Name>Regular` /
   * `<Name>Medium`), and an injected package may simply not carry the artwork a
   * future host stopped shipping. Reading a missing name yields `undefined`,
   * and `React.createElement(undefined)` throws — which would blank this whole
   * slot rather than just its button — so the lookup is guarded across every
   * spelling and falls back to artwork drawn here.
   */
  var primitives = require("@deepseek-ai/dsh-client-ui-primitives");
  var HostPanelLeftIcon =
    primitives.IconPanelLeftOutlineRegular ||
    primitives.IconPanelLeftOutlineMedium ||
    primitives.IconPanelLeftOutline16 ||
    null;

  function PanelLeftIcon(props) {
    var size = (props && props.size) || 16;
    if (HostPanelLeftIcon) return React.createElement(HostPanelLeftIcon, props);
    return React.createElement(
      "svg",
      {
        width: size,
        height: size,
        viewBox: "0 0 16 16",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1,
        "aria-hidden": "true",
        focusable: "false",
      },
      React.createElement("rect", { x: 1.5, y: 2.5, width: 13, height: 11, rx: 2.5 }),
      React.createElement("path", { d: "M6 2.5v11" })
    );
  }

  var PACKAGE_ID = "dsh-sidebar-panel";
  /**
   * Page type registered into the right column's tab registry. A page type is
   * opened by kind (`ctx.sidebarRight.openTab(kind)`) rather than by resource
   * address, so the definition carries no `patterns`; `PACKAGE_ID` is a
   * convenient unique value for both the registration `id` and this `kind`.
   */
  var PANEL_KIND = "dsh-sidebar-panel";
  var NS = "dshSidebarPanel";
  var API_BASE = "/dsh-sidebar-panel/api";
  var STYLE_ID = "dsh-sidebar-panel-styles";

  /* ------------------------------------------------------------------ */
  /* i18n                                                                */
  /* ------------------------------------------------------------------ */

  var zh = {
    "panel.title": "会话面板",
    "panel.close": "关闭面板",
    "guide.description": "上下文用量、会话费用、工作区文件、本次改动与工具调用",
    "toggle.label": "会话面板",
    "toggle.open": "打开面板",
    "toggle.collapse": "收起面板",
    "tab.overview": "概览",
    "tab.files": "文件",
    "tab.changes": "改动",
    "tab.tools": "工具",
    "overview.context.title": "上下文窗口",
    "overview.context.ok": "上下文充足",
    "overview.context.used": "已用",
    "overview.context.percent": "已用 {percent}",
    "overview.context.toCompaction": "距压缩",
    "overview.budget.title": "本轮上下文预算",
    "overview.budget.prompt": "提示词",
    "overview.budget.output": "输出预算",
    "overview.budget.physical": "物理剩余空间",
    "overview.budget.source": "输出上限来源",
    "overview.budget.official": "官方默认",
    "overview.metrics.title": "会话指标",
    "overview.metrics.hitRate": "平均命中",
    "overview.metrics.cost": "会话费用",
    "overview.metrics.runtime": "运行时间",
    "common.duration.hms": "{h}小时{m}分{s}秒",
    "common.duration.ms": "{m}分{s}秒",
    "common.duration.s": "{s}秒",
    "overview.metrics.requests": "请求数",
    "overview.metrics.totalTokens": "累计 tokens",
    "overview.usage.title": "用量分析",
    "overview.usage.bySource": "按来源",
    "overview.usage.byType": "按类型",
    "overview.usage.sourceShare": "来源占比",
    "overview.usage.mainModel": "主模型",
    "overview.usage.times": "{count} 次",
    "overview.usage.cache": "缓存",
    "overview.usage.detail": "明细",
    "overview.usage.input": "输入",
    "overview.usage.output": "输出",
    "overview.usage.hit": "命中",
    "overview.usage.miss": "未命中",
    "overview.empty": "暂无数据（会话尚无请求）",
    "account.title": "DeepSeek 账户",
    "account.balance": "余额",
    "account.topUp": "充值",
    "account.topUpUrl": "https://platform.deepseek.com/usage",
    "account.noKey": "未配置 DEEPSEEK_API_KEY（在 DSH 凭据/环境变量中配置）",
    "account.queryFailed": "余额查询失败：{message}",
    "account.loading": "查询余额中…",
    "account.today": "今日已用",
    "account.todayHint": "按本机 DSH 会话日志与 DeepSeek 官方价目估算，涵盖全部工作区；仅统计今日已完成的 DeepSeek 系列模型请求，其他厂商模型不计入。",
    "account.todayWarming": "统计中…",
    "account.todayMissingRoot": "未找到本机会话日志目录，今日用量按 0 计",
    "account.todayScanFailed": "今日用量统计失败",
    "account.peak": "峰",
    "account.valley": "谷",
    "account.peakTitle": "高峰：北京时间周一至周五 9:00–12:00、14:00–18:00；其余时段（夜间、周末、法定节假日）为空闲时段，价目按官方峰谷价。",
    "files.title": "工作区文件",
    "files.refresh": "刷新",
    "files.up": "上级目录",
    "files.root": "工作区",
    "files.empty": "空目录",
    "files.loading": "加载中…",
    "files.error": "加载失败：{message}",
    "files.menu.reveal": "在文件管理器中显示",
    "files.menu.addFileRef": "添加文件引用",
    "files.menu.addFileContent": "添加文件内容",
    "files.menu.addFolderRef": "添加文件夹引用",
    "files.menu.copyAbs": "复制绝对路径",
    "files.menu.copyRel": "复制相对路径",
    "files.inserted": "已插入到输入框",
    "files.insertFailed": "插入失败：输入框不可用",
    "files.copied": "已复制",
    "files.preview.close": "关闭预览",
    "files.preview.loading": "加载中…",
    "files.preview.truncated": "内容过长已截断；可右键『添加文件内容』，或直接让模型读取该文件",
    "files.preview.unsupported": "暂不支持预览该类型文件",
    "files.preview.unsupportedImage": "浏览器无法显示这种图片（TIFF / HEIC / ICNS），请用系统看图工具打开",
    "files.preview.dshHint": "用 DSH 文档预览打开",
    "files.preview.dshFailed": "DSH 文档预览无法打开该文件",
    "files.preview.source": "源码",
    "files.preview.image": "图像",
    "changes.title": "本次会话的改动",
    "changes.empty": "暂无记录（写文件类工具调用会记录在这里）",
    "changes.note": "bash/pwsh 等命令内部的改动可能未被捕获",
    "changes.refresh": "刷新",
    "tools.title": "工具调用",
    "tools.empty": "本窗口内暂无工具调用",
    "tools.args": "参数",
    "tools.result": "结果",
    "tools.error": "错误",
    "tools.running": "运行中…",
    "common.unknown": "—",
    "overview.updated": "更新于 {time}",
  };

  var en = {
    "panel.title": "Session Panel",
    "panel.close": "Close panel",
    "guide.description": "Context usage, session cost, workspace files, changes, and tool calls",
    "toggle.label": "Session Panel",
    "toggle.open": "Open panel",
    "toggle.collapse": "Collapse panel",
    "tab.overview": "Overview",
    "tab.files": "Files",
    "tab.changes": "Changes",
    "tab.tools": "Tools",
    "overview.context.title": "Context Window",
    "overview.context.ok": "Context healthy",
    "overview.context.used": "Used",
    "overview.context.percent": "{percent} used",
    "overview.context.toCompaction": "to compaction",
    "overview.budget.title": "Round Budget",
    "overview.budget.prompt": "Prompt",
    "overview.budget.output": "Output budget",
    "overview.budget.physical": "Physical remaining",
    "overview.budget.source": "Output limit source",
    "overview.budget.official": "Official default",
    "overview.metrics.title": "Session Metrics",
    "overview.metrics.hitRate": "Avg hit rate",
    "overview.metrics.cost": "Session cost",
    "overview.metrics.runtime": "Runtime",
    "common.duration.hms": "{h}h {m}m {s}s",
    "common.duration.ms": "{m}m {s}s",
    "common.duration.s": "{s}s",
    "overview.metrics.requests": "Requests",
    "overview.metrics.totalTokens": "Total tokens",
    "overview.usage.title": "Usage Analysis",
    "overview.usage.bySource": "By source",
    "overview.usage.byType": "By type",
    "overview.usage.sourceShare": "Source share",
    "overview.usage.mainModel": "Main model",
    "overview.usage.times": "{count} calls",
    "overview.usage.cache": "cache",
    "overview.usage.detail": "Detail",
    "overview.usage.input": "Input",
    "overview.usage.output": "Output",
    "overview.usage.hit": "Hit",
    "overview.usage.miss": "Miss",
    "overview.empty": "No data yet (no requests in this session)",
    "account.title": "DeepSeek Account",
    "account.balance": "Balance",
    "account.topUp": "Top up",
    "account.topUpUrl": "https://platform.deepseek.com/usage",
    "account.noKey": "DEEPSEEK_API_KEY is not configured (set it in DSH credentials/env)",
    "account.queryFailed": "Balance query failed: {message}",
    "account.loading": "Querying balance…",
    "account.today": "Used today",
    "account.todayHint": "Estimated from this machine's DSH session logs and DeepSeek's official price list, across every workspace; DeepSeek-served requests finished today only — other providers are not counted.",
    "account.todayWarming": "Counting…",
    "account.todayMissingRoot": "No local session log directory found; today's usage counts as 0",
    "account.todayScanFailed": "Failed to total today's usage",
    "account.peak": "Peak",
    "account.valley": "Valley",
    "account.peakTitle": "Peak: weekdays 09:00–12:00 and 14:00–18:00 Beijing time. Everything else — nights, weekends and Chinese statutory holidays — is off-peak, priced at the official valley rate.",
    "files.title": "Workspace Files",
    "files.refresh": "Refresh",
    "files.up": "Parent",
    "files.root": "Workspace",
    "files.empty": "Empty folder",
    "files.loading": "Loading…",
    "files.error": "Failed to load: {message}",
    "files.menu.reveal": "Show in file manager",
    "files.menu.addFileRef": "Add file reference",
    "files.menu.addFileContent": "Add file content",
    "files.menu.addFolderRef": "Add folder reference",
    "files.menu.copyAbs": "Copy absolute path",
    "files.menu.copyRel": "Copy relative path",
    "files.inserted": "Inserted into composer",
    "files.insertFailed": "Insert failed: composer unavailable",
    "files.copied": "Copied",
    "files.preview.close": "Close preview",
    "files.preview.loading": "Loading…",
    "files.preview.truncated": "Content truncated; use 'Add file content' or ask the model to read the file",
    "files.preview.unsupported": "Preview not supported for this file type",
    "files.preview.unsupportedImage": "No browser displays this image format (TIFF / HEIC / ICNS); open it with a system viewer",
    "files.preview.dshHint": "Open in DSH document preview",
    "files.preview.dshFailed": "DSH document preview could not open this file",
    "files.preview.source": "Source",
    "files.preview.image": "Image",
    "changes.title": "Changes in this session",
    "changes.empty": "No records yet (write-tool calls are tracked here)",
    "changes.note": "Changes made inside bash/pwsh commands may not be captured",
    "changes.refresh": "Refresh",
    "tools.title": "Tool Calls",
    "tools.empty": "No tool calls in this window",
    "tools.args": "Arguments",
    "tools.result": "Result",
    "tools.error": "Error",
    "tools.running": "Running…",
    "common.unknown": "—",
    "overview.updated": "Updated {time}",
  };

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * One JSON round trip to this plugin's own server routes.
   *
   * `fetch` rejects on a transport failure only: a 4xx/5xx resolves normally,
   * and so does a non-JSON body (the host gateway's HTML error page, a login
   * redirect). Reading the body as TEXT first keeps such a body from dying as
   * an unhandled SyntaxError inside `r.json()`, and the status check keeps a
   * failure from being mistaken for a successful read. Any failure is thrown
   * as an Error carrying `code` (the server's `error.code`, `HTTP_<status>`,
   * or `BAD_JSON`) and `status`.
   * @param path - path below API_BASE, e.g. "/overview?sessionId=…".
   * @param init - optional fetch init (method / body / headers).
   * @returns a promise of the parsed JSON body.
   */
  function apiFetch(path, init) {
    var options = Object.assign({}, init);
    options.headers = Object.assign({ accept: "application/json" }, init ? init.headers : null);
    return fetch(API_BASE + path, options).then(function (r) {
      return r.text().then(function (raw) {
        var data = null;
        var malformed = false;
        try { data = JSON.parse(raw); } catch (_) { malformed = true; }
        if (!r.ok) {
          var failure = new Error(
            (data && data.error && data.error.message) || ("HTTP " + r.status + " from " + path)
          );
          failure.code = (data && data.error && data.error.code) || ("HTTP_" + r.status);
          failure.status = r.status;
          throw failure;
        }
        if (malformed) {
          var broken = new Error("response from " + path + " is not JSON");
          broken.code = "BAD_JSON";
          broken.status = r.status;
          throw broken;
        }
        return data;
      });
    });
  }

  function apiGet(path, params) {
    var query = params === undefined ? "" : "?" + new URLSearchParams(params).toString();
    return apiFetch(path + query);
  }

  function apiPost(path, body) {
    return apiFetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /**
   * Readable text for anything a call can fail with: the Error `apiFetch`
   * throws (carrying `code` / `message` / `status`) or a `{ ok: false, error }`
   * body's `error` object. Both fields are shown when both are known, so an
   * out-of-range or over-limit read is identifiable from the message alone.
   */
  function errorText(err, fallback) {
    if (err === null || err === undefined) return fallback || "";
    if (typeof err === "string") return err;
    var prefix = err.code ? err.code + ": " : "";
    return prefix + (err.message || fallback || "");
  }

  /**
   * Poll guard for the tabs that refresh on an interval. The browser throttles
   * timers in a background window, but a tick that fires just before the page
   * is hidden still spends its request — and the panel is a tab body, so it can
   * stay mounted while the window is behind another one.
   */
  function isPageHidden() {
    return typeof document !== "undefined" && document.visibilityState === "hidden";
  }

  /**
   * Run `handler` every time the page becomes visible again, so a poller that
   * skipped its ticks while hidden refreshes at once instead of waiting out a
   * whole interval. Returns the remover — callers MUST call it from the same
   * cleanup that clears their interval, or the listener outlives the tab body.
   * Feature-probed: not every embedding host exposes `visibilitychange`.
   */
  function onBecameVisible(handler) {
    if (typeof document === "undefined" || typeof document.addEventListener !== "function") {
      return function () {};
    }
    var listener = function () { if (!isPageHidden()) handler(); };
    document.addEventListener("visibilitychange", listener);
    return function () {
      if (typeof document.removeEventListener === "function") {
        document.removeEventListener("visibilitychange", listener);
      }
    };
  }

  /**
   * Copy text to the clipboard from wherever the panel happens to run.
   *
   * `navigator.clipboard` only exists in a SECURE context, so on a plain-http
   * page it is not rejected — it is undefined, and calling into it throws a
   * TypeError that no `.catch` downstream can see, which is why "copy path" did
   * nothing at all. The legacy `<textarea>` + `execCommand('copy')` path still
   * works there, so it backs the async API up (and also covers a denied async
   * call).
   * @param text - the string to copy.
   * @returns a promise that rejects with a readable Error when both paths fail.
   */
  function copyText(text) {
    var value = text === null || text === undefined ? "" : String(text);
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(value).catch(function (err) {
        return legacyCopy(value, err);
      });
    }
    return legacyCopy(value, null);
  }

  /** The `<textarea>` fallback behind `copyText` (see it for why this exists). */
  function legacyCopy(value, cause) {
    return new Promise(function (resolve, reject) {
      var area = null;
      // Selecting the scratch node steals focus and the caret, so remember both
      // and put them back once the node is gone.
      var prevActive = typeof document !== "undefined" ? document.activeElement : null;
      var prevSelection = null;
      try {
        if (prevActive && typeof prevActive.selectionStart === "number") {
          prevSelection = [prevActive.selectionStart, prevActive.selectionEnd];
        }
        area = document.createElement("textarea");
        area.value = value;
        area.setAttribute("readonly", "readonly");
        area.style.position = "fixed";
        area.style.top = "-1000px";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        var done = typeof document.execCommand === "function" && document.execCommand("copy");
        if (!done) throw (cause || new Error("copy command was rejected"));
        resolve();
      } catch (err) {
        reject(err || cause || new Error("copy failed"));
      } finally {
        // The scratch node must never outlive the call.
        if (area !== null && area.parentNode) area.parentNode.removeChild(area);
        if (prevActive && typeof prevActive.focus === "function") {
          try {
            prevActive.focus();
            if (prevSelection !== null) prevActive.setSelectionRange(prevSelection[0], prevSelection[1]);
          } catch (_) {
            // Best effort: restoring focus must not mask the copy result.
          }
        }
      }
    });
  }

  function fmtCompact(n) {
    if (n === null || n === undefined) return "—";
    if (n < 1000) return String(Math.round(n));
    if (n < 1e6) return (n / 1e3).toFixed(1) + "K";
    return (n / 1e6).toFixed(1) + "M";
  }

  function fmtFull(n) {
    if (n === null || n === undefined) return "—";
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function fmtMoney(n, currency) {
    if (n === null || n === undefined) return "—";
    // Keep small amounts precise: below ¥0.01 show 4 decimals, otherwise 2.
    var digits = n > 0 && n < 0.01 ? 4 : 2;
    return (currency === "CNY" ? "¥" : "$") + n.toFixed(digits);
  }

  function fmtDuration(ms, t) {
    if (ms === null || ms === undefined || ms < 0) return "—";
    var total = Math.floor(ms / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    // Units come from the dictionary: an English UI must not show 小时/分/秒.
    // Substitution is done here rather than through the locale helper so the
    // format stays a plain string in both dictionaries.
    var fill = function (key) {
      return t(key).replace("{h}", String(h)).replace("{m}", String(m)).replace("{s}", String(s));
    };
    if (h > 0) return fill("common.duration.hms");
    if (m > 0) return fill("common.duration.ms");
    return fill("common.duration.s");
  }

  function fmtPercent(ratio) {
    if (ratio === null || ratio === undefined) return "—";
    return (ratio * 100).toFixed(2) + "%";
  }

  function fmtClock(ms) {
    if (ms === null || ms === undefined) return "";
    var d = new Date(ms);
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  /**
   * A remaining span as `HH:MM:SS`. Distinct from `fmtClock` (a wall-clock
   * stamp) and from `fmtDuration` (a prose "1小时2分3秒"), because the peak
   * countdown must tick in place: fixed-width digits, no unit words, so the row
   * never reflows as the seconds change.
   */
  function fmtCountdown(ms) {
    var total = Math.max(0, Math.floor((ms || 0) / 1000));
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(Math.floor(total / 3600)) + ":" + p(Math.floor((total % 3600) / 60)) + ":" + p(total % 60);
  }

  function prettyJson(raw) {
    if (typeof raw !== "string" || raw === "") return "";
    try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
  }

  /**
   * Most recent assistant request config's maxTokens (the newest message that
   * recorded a request config wins — walking backwards).
   * 0.1.5 exposes it as `requestConfig` on the assistant node; older shapes
   * carried a bare `config`, so both are accepted.
   */
  function walkNodesForMaxTokens(nodes) {
    for (var i = (nodes || []).length - 1; i >= 0; i--) {
      var n = nodes[i];
      var cfg = n ? (n.requestConfig || n.config) : null;
      if (cfg && typeof cfg.maxTokens === "number") return cfg.maxTokens;
    }
    return null;
  }

  /**
   * Open/closed probe over the frame's own marker attribute: cheap, and it
   * follows ANY source of the transition (our buttons, the panel close button,
   * a host-driven close), which is what the toggle icon must track.
   *  - 0.1.5+: AppFrame carries `data-rightbar-collapsed` exactly while the
   *    right column has no track (`cols.rightbar === 0`).
   *  - legacy: `data-details-collapsed` played the same role.
   */
  function isDetailsCollapsed() {
    if (document.querySelector("[data-rightbar-collapsed]") !== null) return true;
    if (document.querySelector("[data-details-collapsed]") !== null) return true;
    return false;
  }

  /* Right-column navigation --------------------------------------------- */

  /**
   * The plugin's one way in and out of the right column.
   *
   * The column itself belongs to the shipped right Sidebar
   * (`@deepseek-ai/dsh-client-ui-sidebar-right`), which owns the frame's
   * geometry through the occupant-report contract — this plugin no longer
   * reports any column width of its own, and never touches `ctx.layout`.
   * It only navigates:
   *
   *  - our tab is the active one and the column is showing  -> collapse the column
   *  - anything else (collapsed, another tab, no tab)       -> open (or focus)
   *    ours, which also expands the column, because content the user cannot
   *    see is not opened.
   *
   * `active()` and `isExpanded()` read the mounted seat's binding at click
   * time, so no local mirror of the column state has to be kept in sync.
   * @param ctx - plugin context carrying the `sidebarRight` service.
   */
  function togglePanel(ctx) {
    var sidebarRight = ctx.sidebarRight;
    if (!sidebarRight) return;
    var active = null;
    try { active = sidebarRight.active(); } catch (_) { active = null; }
    var showingOurs = active !== null && active !== undefined && active.kind === PANEL_KIND;
    try {
      if (showingOurs && sidebarRight.isExpanded()) sidebarRight.toggleExpanded();
      else sidebarRight.openTab(PANEL_KIND);
    } catch (_) {}
  }

  /* File preview vocabulary -------------------------------------------- */

  var TEXT_EXTS = {
    md: 1, markdown: 1, txt: 1, text: 1, json: 1, yaml: 1, yml: 1, xml: 1,
    html: 1, htm: 1, css: 1, js: 1, mjs: 1, cjs: 1, jsx: 1, ts: 1, tsx: 1,
    py: 1, java: 1, c: 1, h: 1, cpp: 1, hpp: 1, cc: 1, go: 1, rs: 1, rb: 1,
    php: 1, sh: 1, bash: 1, zsh: 1, ps1: 1, bat: 1, cmd: 1, toml: 1, ini: 1,
    cfg: 1, conf: 1, log: 1, csv: 1, sql: 1, diff: 1, patch: 1,
  };
  /**
   * Rendered by the browser instead of shown as code. `svg` belongs HERE even
   * though it is also text: an icon the user clicks is an image, and dumping
   * its markup was the whole complaint. It keeps a 源码 toggle in the preview
   * header, which reads it back through `/file-content`.
   *
   * `jpe`, `bmp`, `ico` and `avif` joined later: the file tree always drew an
   * image glyph for them and then opened a "no preview" pane, because only the
   * glyph table knew them. The host route serves each of the four a real
   * content-type now. TIFF / HEIC / ICNS stay OUT on purpose — see
   * `UNDECODABLE_IMAGE_EXTS`.
   */
  var ASSET_EXTS = {
    pdf: 1, png: 1, jpg: 1, jpeg: 1, jpe: 1, gif: 1, webp: 1, bmp: 1, ico: 1,
    avif: 1, svg: 1,
  };

  /**
   * Image formats the file tree recognizes but no browser engine decodes.
   * Handing these to an `<img>` shows a broken glyph, so the preview says what
   * is actually wrong (and what to open instead) rather than "unsupported".
   */
  var UNDECODABLE_IMAGE_EXTS = { tif: 1, tiff: 1, heic: 1, heif: 1, icns: 1 };

  /**
   * Office documents this panel does NOT decode. Clicking one navigates to the
   * shipped right Sidebar's document preview, which converts Word and
   * PowerPoint to PDF through the bundled LibreOffice and renders spreadsheets
   * in the browser. Keeping the list here — instead of trying to sniff the
   * format — is what makes the hand-off a one-line decision at click time.
   */
  var OFFICE_EXTS = { doc: 1, docx: 1, xls: 1, xlsx: 1, ppt: 1, pptx: 1 };

  function extOf(name) {
    var i = name.lastIndexOf(".");
    return i < 0 ? "" : name.slice(i + 1).toLowerCase();
  }

  /* Resource addresses ---------------------------------------------------
   * The shipped navigator hands its file rows to the document preview as
   * `dsh-resource://file/session/<sessionId>/<path>`; the encoding below is the
   * same one it uses — component-encode each segment but keep `:` literal, so a
   * Windows drive letter survives. `cwd` only decides whether an absolute path
   * can be shortened into the session's own workspace; a path outside it stays
   * absolute inside the same address, which the preview also accepts.
   */

  var FILE_ADDRESS_PREFIX = "dsh-resource://file/";

  function encodeAddressSegment(segment) {
    return encodeURIComponent(segment).replace(/%3A/gi, ":");
  }

  function sessionFileAddress(sessionId, path) {
    var normalized = String(path).replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
    return FILE_ADDRESS_PREFIX + "session/" + encodeAddressSegment(String(sessionId)) + "/" +
      normalized.split("/").map(encodeAddressSegment).join("/");
  }

  function isAbsolutePath(path) {
    return path.charAt(0) === "/" || /^[A-Za-z]:[/\\]/.test(path) || path.slice(0, 2) === "\\\\";
  }

  /** The address of `path` as this tab's session reads it (see the note above). */
  function fileAddressFor(sessionId, cwd, path) {
    var normalized = String(path).replace(/\\/g, "/");
    if (!isAbsolutePath(normalized)) return sessionFileAddress(sessionId, normalized);
    var root = typeof cwd === "string" ? cwd.replace(/\\/g, "/").replace(/\/+$/, "") : "";
    if (root !== "" && normalized === root) return sessionFileAddress(sessionId, "");
    if (root !== "" && normalized.indexOf(root + "/") === 0) {
      return sessionFileAddress(sessionId, normalized.slice(root.length + 1));
    }
    return sessionFileAddress(sessionId, normalized);
  }

  /**
   * Hand one file to the shipped document preview through the same navigation
   * the shipped file tree uses (`tab.actions.openResource`). Returns false when
   * the column's navigation face or the session id is missing, so the caller
   * falls back to its own pane instead of swallowing the click.
   */
  function openInDshPreview(tabActions, sessionId, cwd, path) {
    if (tabActions === null || tabActions === undefined) return false;
    if (typeof tabActions.openResource !== "function") return false;
    if (typeof sessionId !== "string" || sessionId === "") return false;
    try {
      tabActions.openResource(fileAddressFor(sessionId, cwd, path));
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Last path segment of a session-reported path (the 改动 tab reports full
   * paths, the 文件 tab reports names).
   */
  function baseName(p) {
    var text = String(p === null || p === undefined ? "" : p);
    var i = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
    return i < 0 ? text : text.slice(i + 1);
  }

  /* File-type icons ----------------------------------------------------- */

  /**
   * The file tree draws a per-type icon instead of one generic page for every
   * row: a lettered chip for the languages and data formats a workspace is
   * mostly made of (the yellow `JS` square is the familiar one), and a drawn
   * glyph for the families a letter cannot express (folder, image, archive,
   * configuration, lock, font). An extension nobody mapped still gets a chip
   * built from its own letters, so two rows only share an icon when they really
   * are the same kind of file.
   *
   * Chip palette, `[label, background, foreground]`. Labels stay at three
   * characters or fewer because a chip is 16px wide; the foreground is the one
   * that contrasts with its own background rather than a theme token, since the
   * chip is a colour swatch and must read the same in light and dark.
   */
  var FILE_CHIPS = {
    js: ["JS", "#e9c849", "#1b1b1b"],
    ts: ["TS", "#3178c6", "#ffffff"],
    py: ["PY", "#3c7fb0", "#ffffff"],
    rs: ["RS", "#c4703f", "#ffffff"],
    go: ["GO", "#2ba6c4", "#ffffff"],
    rb: ["RB", "#c0392b", "#ffffff"],
    php: ["PHP", "#6b76c4", "#ffffff"],
    java: ["JAV", "#c0392b", "#ffffff"],
    kt: ["KT", "#9b59d0", "#ffffff"],
    swift: ["SW", "#e0713a", "#ffffff"],
    dart: ["DA", "#2ba0c4", "#ffffff"],
    lua: ["LUA", "#2f4bc0", "#ffffff"],
    r: ["R", "#2b6cb0", "#ffffff"],
    pl: ["PL", "#3b6ea8", "#ffffff"],
    cs: ["C#", "#7a3fa8", "#ffffff"],
    c: ["C", "#5a86c4", "#ffffff"],
    cpp: ["C++", "#4b7bb5", "#ffffff"],
    h: ["H", "#5a86c4", "#ffffff"],
    html: ["<>", "#e06c3a", "#ffffff"],
    css: ["CSS", "#3b7fc4", "#ffffff"],
    vue: ["V", "#41b883", "#ffffff"],
    svelte: ["S", "#e04a2f", "#ffffff"],
    sql: ["SQL", "#d4763a", "#ffffff"],
    json: ["{}", "#d6a13a", "#1b1b1b"],
    yml: ["YML", "#8a6ec4", "#ffffff"],
    toml: ["TML", "#9a6b4a", "#ffffff"],
    xml: ["XML", "#8a9a4a", "#ffffff"],
    md: ["MD", "#4a7fbd", "#ffffff"],
    txt: ["TXT", "#8a8f98", "#ffffff"],
    csv: ["CSV", "#3f9a5a", "#ffffff"],
    sh: ["SH", "#4a9a4a", "#ffffff"],
    ps: ["PS", "#2f6fb5", "#ffffff"],
    bat: ["BAT", "#6a7f8f", "#ffffff"],
    env: ["ENV", "#b5a13a", "#1b1b1b"],
    patch: ["DF", "#5f9a5f", "#ffffff"],
    pdf: ["PDF", "#c0392b", "#ffffff"],
  };

  /** Aliases folded onto a chip above, so one entry covers a whole family. */
  var FILE_CHIP_ALIASES = {
    jsx: "js", mjs: "js", cjs: "js",
    tsx: "ts", mts: "ts", cts: "ts",
    pyw: "py", pyi: "py",
    rbw: "rb",
    kts: "kt",
    htm: "html", xhtml: "html",
    scss: "css", sass: "css", less: "css", styl: "css",
    markdown: "md", mdx: "md",
    yaml: "yml",
    text: "txt", log: "txt",
    tsv: "csv",
    jsonc: "json", json5: "json", jsonl: "json",
    cxx: "cpp", cc: "cpp", hpp: "cpp", hh: "cpp", hxx: "cpp", "c++": "cpp",
    bash: "sh", zsh: "sh", ksh: "sh", fish: "sh",
    ps1: "ps", psm1: "ps",
    cmd: "bat",
    diff: "patch",
  };

  /**
   * Extension families that read better drawn than lettered. Keys are glyph
   * names, values are space-separated extensions.
   */
  var FILE_GLYPH_EXTS = {
    image: "png jpg jpeg jpe gif webp bmp ico icns avif tif tiff heic svg",
    archive: "zip tar gz tgz bz2 xz 7z rar jar war whl egg",
    config: "ini cfg conf config properties editorconfig rc",
    lock: "lock",
    font: "ttf otf woff woff2 eot",
  };

  /**
   * Drawn glyphs: `[tag, attributes]` children of a 16x16 outline. Outline
   * rather than fill, so the tree speaks the same icon language as the host's
   * own primitives (`Icon…Outline16`). Geometry is deliberately simple —
   * rectangles, circles and straight paths — so it stays legible at 16px.
   */
  var FILE_GLYPHS = {
    folder: {
      color: "#c8a24a",
      parts: [["path", { d: "M1.5 4.2h4.3l1.4 1.7h7.3v7.4H1.5z" }]],
    },
    doc: {
      color: "#8a8f98",
      parts: [
        ["path", { d: "M3.5 1.8h6L13 5.3v8.9H3.5z" }],
        ["path", { d: "M9.5 1.8v3.5H13" }],
        ["path", { d: "M5.8 8.6h4.4M5.8 11h3.2" }],
      ],
    },
    image: {
      color: "#4a9a8a",
      parts: [
        ["rect", { x: 1.8, y: 3, width: 12.4, height: 10, rx: 1.4 }],
        ["circle", { cx: 5.6, cy: 6.4, r: 1.1 }],
        ["path", { d: "M2.8 12.2l3.4-3.3 2.6 2.5 1.9-1.8 2.5 2.4" }],
      ],
    },
    archive: {
      color: "#b08a4a",
      parts: [
        ["rect", { x: 2.2, y: 2.4, width: 11.6, height: 11.2, rx: 1.4 }],
        ["path", { d: "M8 2.4v2.6" }],
        ["path", { d: "M6.9 6.6h2.2v2.2H6.9z" }],
        ["path", { d: "M8 10.1v2.4" }],
      ],
    },
    config: {
      color: "#7f8a9a",
      parts: [
        ["path", { d: "M2.4 5.4h1.9M7.7 5.4h5.9" }],
        ["circle", { cx: 6, cy: 5.4, r: 1.7 }],
        ["path", { d: "M2.4 10.6h5.9M11.7 10.6h1.9" }],
        ["circle", { cx: 10, cy: 10.6, r: 1.7 }],
      ],
    },
    lock: {
      color: "#c8a24a",
      parts: [
        ["rect", { x: 3.4, y: 7, width: 9.2, height: 7.2, rx: 1.4 }],
        ["path", { d: "M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7" }],
      ],
    },
    font: {
      color: "#8a7fc4",
      parts: [
        ["path", { d: "M3 13.4L8 2.6l5 10.8" }],
        ["path", { d: "M5 10h6" }],
      ],
    },
    hourglass: {
      color: "#c8b04a",
      parts: [
        ["path", { d: "M4.2 2.2h7.6M4.2 13.8h7.6" }],
        ["path", { d: "M5.2 2.2v2.2L8 8l2.8-3.6V2.2" }],
        ["path", { d: "M5.2 13.8v-2.2L8 8l2.8 3.6v2.2" }],
      ],
    },
    terminal: {
      color: "#7f8a9a",
      parts: [
        ["rect", { x: 1.8, y: 2.6, width: 12.4, height: 10.8, rx: 1.6 }],
        ["path", { d: "M4.4 6.4l2 2-2 2" }],
        ["path", { d: "M8.4 10.6h3.4" }],
      ],
    },
  };

  /** Extension -> icon spec, resolved once as `{ kind: 'chip' | 'glyph', … }`. */
  var FILE_ICONS = (function () {
    var owns = function (bag, key) { return Object.prototype.hasOwnProperty.call(bag, key); };
    var table = {};
    for (var chip in FILE_CHIPS) {
      if (!owns(FILE_CHIPS, chip)) continue;
      var entry = FILE_CHIPS[chip];
      table[chip] = { kind: "chip", label: entry[0], bg: entry[1], fg: entry[2] };
    }
    for (var alias in FILE_CHIP_ALIASES) {
      if (!owns(FILE_CHIP_ALIASES, alias)) continue;
      var target = FILE_CHIP_ALIASES[alias];
      if (owns(table, target)) table[alias] = table[target];
    }
    for (var glyph in FILE_GLYPH_EXTS) {
      if (!owns(FILE_GLYPH_EXTS, glyph)) continue;
      var exts = FILE_GLYPH_EXTS[glyph].split(" ");
      for (var i = 0; i < exts.length; i++) table[exts[i]] = { kind: "glyph", glyph: glyph };
    }
    return table;
  })();

  /**
   * Icon spec for one row.
   *
   * A leading dot names a dotfile, not an extension (`.gitignore` is a plain
   * file), but a dotted name keeps its real extension (`.eslintrc.json` is
   * JSON). `hasOwnProperty` rather than a truthiness test, because a plain
   * object answers `constructor` and friends.
   *
   * @param name - the entry's file name (not a full path).
   * @param isDir - whether the entry is a directory.
   */
  function fileIconSpec(name, isDir) {
    if (isDir) return { kind: "glyph", glyph: "folder" };
    var lower = String(name === null || name === undefined ? "" : name).toLowerCase();
    var ext = extOf(lower);
    if (ext === "" || (lower.charAt(0) === "." && lower.indexOf(".", 1) === -1)) {
      return { kind: "glyph", glyph: "doc" };
    }
    if (Object.prototype.hasOwnProperty.call(FILE_ICONS, ext)) return FILE_ICONS[ext];
    // Unmapped extension: its own letters on neutral grey. Distinct by
    // construction, and honest about being unclassified.
    return { kind: "chip", label: ext.slice(0, 3).toUpperCase(), bg: "#5d6470", fg: "#ffffff" };
  }

  /**
   * The icon cell shared by the 文件 rows, the 改动 rows, the preview header and
   * the 工具 rows: pass `entry`, or `name` (+ optional `isDir`), or an explicit
   * `glyph` from `FILE_GLYPHS`.
   */
  function FileIcon(props) {
    var spec;
    if (props.glyph) {
      spec = { kind: "glyph", glyph: props.glyph };
    } else {
      // `entry` is the file-tree shape ({ path, name, isDir, size }); the 改动
      // rows only carry a path, so they pass `name` and are never directories.
      var entry = props.entry || null;
      var name = props.name !== undefined ? props.name : entry ? entry.name : "";
      var isDir = props.isDir !== undefined ? props.isDir : !!(entry && entry.isDir);
      spec = fileIconSpec(name, isDir);
    }
    if (spec.kind === "chip") {
      var size = spec.label.length > 3 ? 3 : spec.label.length;
      return React.createElement(
        "span",
        {
          className: "dsp__fileIcon dsp__fileIcon--chip dsp__fileIcon--chip" + size,
          style: { backgroundColor: spec.bg, color: spec.fg },
          "aria-hidden": "true",
        },
        spec.label
      );
    }
    var glyph = FILE_GLYPHS[spec.glyph] || FILE_GLYPHS.doc;
    var parts = glyph.parts.map(function (part, index) {
      var attrs = {
        key: index,
        fill: "none",
        stroke: glyph.color,
        strokeWidth: 1.25,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      };
      var own = part[1];
      for (var key in own) attrs[key] = own[key];
      return React.createElement(part[0], attrs);
    });
    return React.createElement(
      "svg",
      {
        className: "dsp__fileIcon dsp__fileIcon--glyph",
        viewBox: "0 0 16 16",
        width: 16,
        height: 16,
        "aria-hidden": "true",
        focusable: "false",
      },
      parts
    );
  }

  /**
   * The Chat view slice carrying settled tool calls and in-flight calls.
   *
   * It lives on the CONVERSATION snapshot (`views.get('chat')`, registered by
   * ui-chat with target `chat`), NOT on the session snapshot: a SessionSnapshot
   * holds lifecycle/queue state only on every core generation, so the earlier
   * `useSession(...).chat / .nodes` reads were always undefined and both the
   * 工具 tab and the output-budget card stayed empty. Both selectors are called
   * unconditionally so the hook order never changes; the session-side reads
   * stay as a last-resort fallback for unknown shapes.
   * @param props - the tab's composed props (session- and global kit).
   * @returns the Chat view's `legacy` slice, or null while unavailable.
   */
  function useChatSlice(props) {
    var pickAll = function (value) { return value; };
    var useConversation = typeof props.useConversation === "function" ? props.useConversation : pickAll;
    var useSession = typeof props.useSession === "function" ? props.useSession : pickAll;
    var conversation = useConversation(pickAll);
    var session = useSession(pickAll);
    var views = conversation ? conversation.views : null;
    var chat = views && typeof views.get === "function" ? views.get("chat") : null;
    if (chat && chat.legacy) return chat.legacy;
    if (session && session.chat && session.chat.legacy) return session.chat.legacy;
    if (session && Array.isArray(session.nodes)) return session;
    return null;
  }

  function collectToolCalls(slice) {
    var list = [];
    var seen = {};
    var nodes = slice && Array.isArray(slice.nodes) ? slice.nodes : [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n || typeof n.callId !== "string" || seen[n.callId]) continue;
      // A settled call is a `tool-result` node: its head (name / argsRaw) is
      // backfilled onto `call`, and that head is null when window truncation
      // left the originating tool/call outside the loaded window. Older shapes
      // carried the same fields flat on the node.
      var head = n.call && typeof n.call === "object" ? n.call : null;
      var name = typeof n.name === "string" ? n.name : (head && typeof head.name === "string" ? head.name : null);
      if (name === null) continue;
      var argsRaw = typeof n.argsRaw === "string" ? n.argsRaw : (head && typeof head.argsRaw === "string" ? head.argsRaw : "");
      seen[n.callId] = true;
      list.push({ callId: n.callId, name: name, argsRaw: argsRaw, block: n, time: n.time || 0, running: false });
    }
    var running = slice && Array.isArray(slice.runningCalls) ? slice.runningCalls : [];
    for (var j = 0; j < running.length; j++) {
      var c = running[j];
      if (c && typeof c.callId === "string" && !seen[c.callId]) {
        seen[c.callId] = true;
        list.push({ callId: c.callId, name: c.name, argsRaw: c.argsRaw, block: c, time: c.time || 0, running: true });
      }
    }
    list.sort(function (a, b) { return b.time - a.time; });
    return list;
  }

  function resultText(block) {
    if (!block) return "";
    var parts = [];
    var content = block.content;
    if (Array.isArray(content)) {
      for (var i = 0; i < content.length; i++) {
        var item = content[i];
        if (item && item.type === "text") parts.push(item.text);
        else if (item) parts.push(JSON.stringify(item, null, 2));
      }
    }
    if (block.error) parts.push("[error] " + (block.error.message || JSON.stringify(block.error)));
    return parts.join("\n");
  }

  /* ------------------------------------------------------------------ */
  /* Styles                                                              */
  /* ------------------------------------------------------------------ */

  var cssText = `
.dsp { box-sizing: border-box; display: flex; flex-direction: column; height: 100%; min-width: 0; font-size: 13px; line-height: 20px; }
.dsp__header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 12%)); }
.dsp__title { flex: 1; min-width: 0; font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsp__close { border: none; background: none; color: var(--dsw-alias-label-secondary, #666); cursor: pointer; font: inherit; font-size: 16px; line-height: 1; padding: 2px 6px; border-radius: 6px; }
.dsp__close:hover { background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 6%)); color: var(--dsw-alias-label-primary, #111); }
.dsp__tabs { display: flex; gap: 2px; padding: 6px 8px 0; border-bottom: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 12%)); }
.dsp__tab { border: none; background: none; color: var(--dsw-alias-label-secondary, #666); cursor: pointer; font: inherit; font-size: 13px; padding: 6px 10px; border-radius: 8px 8px 0 0; border-bottom: 2px solid transparent; }
.dsp__tab:hover { color: var(--dsw-alias-label-primary, #111); }
.dsp__tab[aria-selected="true"] { color: var(--dsw-alias-brand-primary, #4f6ef7); border-bottom-color: var(--dsw-alias-brand-primary, #4f6ef7); }
.dsp__body { flex: 1; min-height: 0; overflow: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }
.dsp__card { border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 12%)); border-radius: 10px; padding: 10px 12px; background: var(--dsw-alias-bg-layer-1, #fff); }
.dsp__cardTitle { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-tertiary, #888); margin: 0 0 8px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dsp__ok { color: var(--dsw-alias-state-success-primary, #2fa84f); font-size: 11px; }
.dsp__big { font-size: 20px; font-weight: 600; letter-spacing: -0.2px; }
.dsp__muted { color: var(--dsw-alias-label-tertiary, #888); font-size: 12px; }
.dsp__row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 3px 0; }
.dsp__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; }
.dsp__metric { display: flex; flex-direction: column; gap: 1px; }
.dsp__metricLabel { color: var(--dsw-alias-label-tertiary, #888); font-size: 11px; }
.dsp__metricValue { font-size: 14px; font-weight: 500; }
.dsp__bar { height: 6px; border-radius: 3px; background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 8%)); overflow: hidden; margin: 6px 0; }
.dsp__barFill { height: 100%; background: var(--dsw-alias-brand-primary, #4f6ef7); border-radius: 3px; }
.dsp__seg { display: flex; gap: 4px; }
.dsp__segBar { height: 100%; }
.dsp__toolbar { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.dsp__btn { border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 14%)); background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary, #222); border-radius: 8px; font: inherit; font-size: 12px; padding: 3px 10px; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; }
.dsp__btn:hover { border-color: var(--dsw-alias-brand-primary, #4f6ef7); }
.dsp__btn--primary { border-color: var(--dsw-alias-button-primary-fill, #4f6ef7); background: var(--dsw-alias-button-primary-fill, #4f6ef7); color: var(--dsw-alias-label-primary-inverted, #fff); }
.dsp__btn--primary:hover { border-color: var(--dsw-alias-button-primary-hover, #3b5de7); background: var(--dsw-alias-button-primary-hover, #3b5de7); color: var(--dsw-alias-label-primary-inverted, #fff); }
.dsp__accountBalance { font-size: 22px; font-weight: 600; letter-spacing: -0.2px; }
.dsp__accountToday { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-secondary, #c8c8c8); font-variant-numeric: tabular-nums; }
.dsp__peakRow { display: flex; align-items: center; gap: 8px; padding: 4px 0 1px; }
/* Peak is red, valley is green — the two states must be told apart at a glance,
   so the colour sits on the pill AND on the countdown that shares the row. */
.dsp__peakRow--peak { color: var(--dsw-alias-state-error-primary, #e05a5a); }
.dsp__peakRow--valley { color: var(--dsw-alias-state-success-primary, #3fae74); }
.dsp__peakPill { flex: none; min-width: 26px; padding: 1px 7px; border-radius: 7px; color: #fff; font-size: 11px; font-weight: 600; line-height: 16px; text-align: center; }
.dsp__peakRow--peak .dsp__peakPill { background: #c0392b; }
.dsp__peakRow--valley .dsp__peakPill { background: #2f9e63; }
.dsp__peakClock { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: 0.2px; }
.dsp__crumbs { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary, #666); font-size: 12px; }
.dsp__file { display: flex; align-items: center; gap: 6px; padding: 3px 6px; border-radius: 6px; cursor: default; }
.dsp__file:hover { background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 5%)); }
.dsp__fileIcon { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; }
/* Lettered chip: a coloured square carrying up to three characters (JS, PY,
   C++) — the thing that makes a source file recognisable at a glance. Short
   labels are allowed to grow, because one glyph in a 16px box is mostly box. */
.dsp__fileIcon--chip { border-radius: 3px; font-family: ui-monospace, Consolas, monospace; font-weight: 700; line-height: 1; letter-spacing: -0.02em; }
.dsp__fileIcon--chip1 { font-size: 9px; }
.dsp__fileIcon--chip2 { font-size: 8px; }
.dsp__fileIcon--chip3 { font-size: 7px; }
.dsp__fileIcon--glyph { color: var(--dsw-alias-label-tertiary, #888); }
.dsp__fileName { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsp__fileMeta { color: var(--dsw-alias-label-tertiary, #888); font-size: 11px; flex: none; }
.dsp__menu { position: fixed; z-index: 12000; min-width: 200px; padding: 4px; border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 16%)); border-radius: 10px; background: var(--dsw-alias-bg-layer-2, #fff); box-shadow: 0 10px 34px rgb(0 0 0 / 20%); }
.dsp__menuItem { display: block; width: 100%; text-align: left; border: none; background: none; font: inherit; font-size: 13px; color: var(--dsw-alias-label-primary, #222); padding: 6px 10px; border-radius: 6px; cursor: pointer; }
.dsp__menuItem:hover { background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 6%)); }
.dsp__menuSep { height: 1px; margin: 4px 6px; background: var(--dsw-alias-border-l2, rgb(0 0 0 / 10%)); }
.dsp__change { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 6px; }
.dsp__change:hover { background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 5%)); }
.dsp__change--open { cursor: pointer; }
.dsp__changePath { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
.dsp__changeMeta { color: var(--dsw-alias-label-tertiary, #888); font-size: 11px; flex: none; }
.dsp__toolRow { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 6px; cursor: pointer; }
.dsp__toolRow:hover { background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 5%)); }
.dsp__toolRow[aria-selected="true"] { background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 8%)); }
.dsp__code { font-family: ui-monospace, Consolas, monospace; font-size: 12px; white-space: pre-wrap; word-break: break-word; margin: 4px 0 0; }
.dsp__notice { color: var(--dsw-alias-label-tertiary, #888); font-size: 12px; }
.dsp__error { color: var(--dsw-alias-state-error-primary, #e43c3c); font-size: 12px; }
.dsp__empty { color: var(--dsw-alias-label-tertiary, #888); font-size: 13px; padding: 12px 4px; text-align: center; }
.dsp__updated { color: var(--dsw-alias-label-tertiary, #888); font-size: 11px; font-weight: 400; }
.dsp__preview { margin-top: 8px; }
.dsp__previewHeader { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.dsp__previewTitle { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; font-size: 12px; }
.dsp__previewBody { max-height: 420px; overflow: auto; margin: 0; }
.dsp__previewFrame { width: 100%; height: 420px; border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 12%)); border-radius: 6px; background: #fff; }
.dsp__previewImg { display: block; max-width: 100%; max-height: 420px; object-fit: contain; }
/* Top-right panel toggle: mirrors the sidebar's fold button (28px round
   icon button, secondary label color, hover fill). */
.dsp-toggle { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: none; border-radius: 50%; background: transparent; color: var(--dsw-alias-label-secondary, #666); cursor: pointer; flex: none; }
.dsp-toggle:hover { background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 6%)); }
.dsp-toggle svg { display: block; }
`;

  // The host's client-module loader attributes every UNTAGGED `<style>` in the
  // document to whichever plugin happens to be materializing at that instant
  // (`claimStyles` in @deepseek-ai/dsh-client-modules), then drops those tags
  // again when that plugin is rebuilt or pruned (`removeOwnedStyles`). An
  // untagged sheet is therefore a sheet on loan: it migrates to an unrelated
  // plugin and vanishes on that plugin's next HMR cycle — which is exactly how
  // this panel lost its styles while the app kept running. Tag the sheet with
  // the same `data-plugin` / `data-plugin-css` pair the host's own CSS emitter
  // writes, so ownership stays ours across rebuilds.
  var CSS_TAG_ID = PACKAGE_ID + "/client.css";
  var CSS_SELECTOR = "style[data-plugin-css=" + JSON.stringify(CSS_TAG_ID) + "]";

  function installStyles() {
    if (document.querySelector(CSS_SELECTOR) !== null) return;
    // Heal a sheet left behind by an untagged earlier release: while it stays
    // unowned it is a candidate for mis-claiming, and once claimed it outlives
    // our own cleanup. Drop the stale copy before publishing a tagged one.
    var stale = document.querySelectorAll("style#" + STYLE_ID + ":not([data-plugin])");
    for (var i = 0; i < stale.length; i++) stale[i].remove();
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.setAttribute("data-plugin", PACKAGE_ID);
    style.setAttribute("data-plugin-css", CSS_TAG_ID);
    style.textContent = cssText;
    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------------ */
  /* Top-right panel toggle (session header utilities row)              */
  /* ------------------------------------------------------------------ */

  function ToggleDetailsButton(props) {
    // The frame still carries its collapse marker (`data-rightbar-collapsed`
    // exactly while the right column has no track), but the column now belongs
    // to the shipped right Sidebar rather than to this plugin. So the probe is
    // used ONLY to pick the icon and label; the transition itself is delegated
    // to `sidebarRight` through `props.togglePanel()`.
    var [collapsed, setCollapsed] = React.useState(isDetailsCollapsed);
    var collapsedRef = React.useRef(collapsed);

    React.useEffect(function () {
      var observer = new MutationObserver(function (records) {
        // This callback fires while the chat streams, so it must stay cheap.
        // `attributeFilter` already narrows it to the two marker attributes,
        // and the marker is carried by the frame element ITSELF — so the node
        // that changed is normally the node that carries it, and the
        // document-wide probe can be skipped. Only a marker REMOVAL (expanding
        // the column) falls through to the authoritative probe, because a
        // legacy marker may still sit on another element.
        var marked = false;
        for (var i = 0; i < records.length; i++) {
          var el = records[i].target;
          if (el && typeof el.hasAttribute === "function" &&
            (el.hasAttribute("data-rightbar-collapsed") || el.hasAttribute("data-details-collapsed"))) {
            marked = true;
            break;
          }
        }
        var next = marked ? true : isDetailsCollapsed();
        // The marker is the single source of this state, so an unchanged value
        // never needs a render.
        if (next === collapsedRef.current) return;
        collapsedRef.current = next;
        setCollapsed(next);
      });
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["data-rightbar-collapsed", "data-details-collapsed"],
        subtree: true,
      });
      return function () { observer.disconnect(); };
    }, []);

    var label = collapsed ? props.t("toggle.open") : props.t("toggle.collapse");
    return React.createElement(
      "button",
      {
        type: "button",
        className: "dsp-toggle",
        title: label,
        "aria-label": label,
        "aria-pressed": collapsed ? "false" : "true",
        "data-plugin": PACKAGE_ID,
        onClick: function () { props.togglePanel(); },
      },
      React.createElement(PanelLeftIcon, { size: 16 })
    );
  }

  /* ------------------------------------------------------------------ */
  /* Peak/valley countdown                                               */
  /* ------------------------------------------------------------------ */

  /**
   * A self-ticking countdown to `props.to` (epoch ms). It owns its interval
   * rather than borrowing the overview poller: that poller runs at 15s, and a
   * clock that jumped 15 seconds at a time would read as broken. Ticks are
   * skipped while the page is hidden (`isPageHidden`), so a panel left in a
   * background window costs nothing; each render recomputes the span from
   * `Date.now()` instead of decrementing a counter, so a skipped tick (or a
   * laptop waking from sleep) re-syncs on the very next render.
   */
  function Countdown(props) {
    var bump = React.useReducer(function (n) { return n + 1; }, 0)[1];
    React.useEffect(function () {
      var id = window.setInterval(function () {
        if (!isPageHidden()) bump();
      }, 1000);
      return function () { window.clearInterval(id); };
    }, []);
    var text = props.to ? fmtCountdown(props.to - Date.now()) : "—";
    return React.createElement("span", { className: props.className, title: props.title }, text);
  }

  /**
   * Last good `/usage-today` answer, kept outside the component so it survives
   * unmounts. Switching to the Overview tab re-mounts this panel, and without
   * this the card would blink back to a placeholder while it re-asked the
   * server for numbers it had a moment ago. A peak window that has already
   * ended is dropped instead of restored: its countdown would freeze at zero.
   */
  var usageTodayCache = null;
  function cachedUsageToday() {
    var entry = usageTodayCache;
    if (!entry) return null;
    if (entry.peak && !(entry.peak.nextChangeAt > Date.now())) return null;
    return entry;
  }

  /* ------------------------------------------------------------------ */
  /* Overview tab                                                        */
  /* ------------------------------------------------------------------ */

  function OverviewTab(props) {
    var usage = props.useProjection("tokenUsage");
    var pressure = props.useProjection("contextPressure");
    var t = props.t;

    var [server, setServer] = React.useState(null);
    var [serverError, setServerError] = React.useState(null);
    var [lastUpdated, setLastUpdated] = React.useState(null);
    var [outputBudget, setOutputBudget] = React.useState(null);
    var [balance, setBalance] = React.useState(null);
    var [accountError, setAccountError] = React.useState(null);
    var remembered = cachedUsageToday();
    var [todayUsage, setTodayUsage] = React.useState(remembered ? remembered.today : null);
    var [todayError, setTodayError] = React.useState(null);
    var [todayWarming, setTodayWarming] = React.useState(remembered ? remembered.warming : false);
    var [peak, setPeak] = React.useState(remembered ? remembered.peak : null);
    var slice = useChatSlice(props);
    var nodes = slice ? slice.nodes : null;

    // Live server-side figures (requests / cost / runtime / by-model): refetch
    // every 5s so the overview tracks the session in near-real time. Projection
    // data (tokenUsage / contextPressure) already updates reactively via
    // useProjection, so only the server-derived half needs polling.
    // `seq` drops an out-of-order reply: a slow request issued for the previous
    // session must never land on top of a newer one's figures.
    var overviewSeq = React.useRef(0);

    React.useEffect(function () {
      var cancelled = false;
      var timer = null;
      function refresh() {
        if (isPageHidden()) return;
        var seq = ++overviewSeq.current;
        apiGet("/overview", { sessionId: props.sessionId })
          .then(function (data) {
            if (cancelled || seq !== overviewSeq.current) return;
            if (data && data.ok) {
              setServer(data.overview);
              setServerError(null);
              setLastUpdated(Date.now());
            } else {
              setServerError(data && data.error ? errorText(data.error, "overview failed") : "overview failed");
            }
          })
          .catch(function (err) {
            if (cancelled || seq !== overviewSeq.current) return;
            setServerError(errorText(err, "overview failed"));
          });
      }
      refresh();
      timer = window.setInterval(refresh, 5000);
      // A hidden page skips its ticks, so becoming visible again refreshes at
      // once rather than waiting out the interval. The remover belongs to the
      // same cleanup as the timer: switching tabs unmounts this body.
      var offVisible = onBecameVisible(refresh);
      return function () {
        cancelled = true;
        if (timer !== null) window.clearInterval(timer);
        offVisible();
      };
    }, [props.sessionId]);

    React.useEffect(function () {
      setOutputBudget(walkNodesForMaxTokens(nodes));
    }, [nodes]);

    // DeepSeek account balance — official user/balance endpoint via the
    // server route (the API key never reaches the browser). Polled every 15s:
    // balances change slowly, unlike the 5s session figures above. The same
    // tick carries today's spend and the peak/valley window (also server-side:
    // the price table and the official schedule both live there), so the whole
    // account card refreshes in one pass.
    //
    // Neither figure makes this request wait: the peak/valley state is pure
    // clock arithmetic and today's spend comes from a snapshot the server keeps
    // warm in the background, so the answer is immediate even on the first
    // paint. The only "not yet" case is a cold snapshot, which is answered with
    // `warming: true` — then we retry quickly instead of showing a dash for a
    // whole poll interval.
    React.useEffect(function () {
      var cancelled = false;
      var timer = null;
      var soon = null;
      function refresh() {
        if (isPageHidden()) return;
        apiGet("/balance").then(function (data) {
          if (cancelled) return;
          if (data && data.ok) {
            setBalance(data.balance);
            setAccountError(data.balance ? null : (data.error || null));
          }
        }).catch(function (err) {
          if (cancelled) return;
          setAccountError({
            code: (err && err.code) || "CLIENT",
            message: (err && err.message) || String(err),
          });
        });
        // Kept in its own state (and its own error slot): a usage scan that
        // fails must not blank out a balance that arrived fine, and vice versa.
        apiGet("/usage-today").then(function (data) {
          if (cancelled) return;
          if (data && data.ok) {
            setPeak(data.peak || null);
            setTodayUsage(data.today || null);
            setTodayError(data.today ? null : (data.error || null));
            setTodayWarming(!!data.warming);
            usageTodayCache = { peak: data.peak || null, today: data.today || null, warming: !!data.warming };
            if (data.warming && soon === null) {
              soon = window.setTimeout(function () {
                soon = null;
                refresh();
              }, 1200);
            }
          }
        }).catch(function (err) {
          if (cancelled) return;
          setTodayWarming(false);
          setTodayError({
            code: (err && err.code) || "CLIENT",
            message: (err && err.message) || String(err),
          });
        });
      }
      refresh();
      timer = window.setInterval(refresh, 15000);
      var offVisible = onBecameVisible(refresh);
      return function () {
        cancelled = true;
        if (timer !== null) window.clearInterval(timer);
        if (soon !== null) window.clearTimeout(soon);
        offVisible();
      };
    }, []);

    var used = pressure ? (pressure.projectedTokens ?? pressure.pressureTokens ?? 0) : 0;
    var total = pressure ? pressure.contextWindow : undefined;
    var percent = total ? Math.min(100, Math.round((used / total) * 100)) : null;
    var remaining = total ? Math.max(0, total - used) : null;
    var promptTokens = pressure ? pressure.pressureTokens : undefined;
    var physicalRemaining = total && promptTokens !== undefined ? Math.max(0, total - promptTokens) : null;

    var hitTokens = usage ? usage.cacheReadTokens : 0;
    var missTokens = usage ? usage.uncachedInputTokens : 0;
    var hitRate = usage && (hitTokens + missTokens) > 0 ? hitTokens / (hitTokens + missTokens) : null;
    var totalTokens = usage ? usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens + usage.outputTokens : 0;
    var inputTokens = usage ? usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens : 0;
    var outputTokens = usage ? usage.outputTokens : 0;

    var cost = server ? server.cost : null;
    var currency = server ? server.currency : "CNY";
    var runtimeMs = server ? server.runtimeMs : null;
    var requestCount = server ? server.requestCount : null;
    var byModel = server ? server.byModel : [];

    var [usageView, setUsageView] = React.useState("source");

    var hasAny = usage !== undefined || pressure !== undefined || (server && server.requestCount > 0);

    // DeepSeek account card: always visible (even with no requests yet).
    // Today's spend and the peak/valley window sit directly under the balance,
    // inside the same card. They render even when the balance does not — an
    // unconfigured API key must not hide a figure that only needs local session
    // logs — and a failure is carried as a tooltip on the label rather than as
    // another warning line, so the card keeps the balance's prominence.
    var todayHintText = todayError
      ? t("account.todayScanFailed") + " · " + todayError.message
      : todayUsage && todayUsage.missingRoot
        ? t("account.todayMissingRoot")
        : t("account.todayHint");
    var todayRow = React.createElement("div", { className: "dsp__row", title: todayHintText },
      React.createElement("span", { className: "dsp__muted" }, t("account.today")),
      React.createElement("span", { className: "dsp__accountToday" },
        todayUsage
          ? fmtMoney(Number(todayUsage.cost), todayUsage.currency || "CNY")
          : todayWarming ? t("account.todayWarming") : "—"));
    var peakRow = peak
      ? React.createElement("div", {
          className: "dsp__peakRow dsp__peakRow--" + (peak.active ? "peak" : "valley"),
          title: t("account.peakTitle"),
        },
        React.createElement("span", { className: "dsp__peakPill" }, peak.active ? t("account.peak") : t("account.valley")),
        React.createElement(Countdown, { className: "dsp__peakClock", to: peak.nextChangeAt }))
      : null;
    var accountCard = React.createElement(
      "div",
      { className: "dsp__card" },
      React.createElement("h4", { className: "dsp__cardTitle" },
        t("account.title"),
        React.createElement("a", {
          className: "dsp__btn dsp__btn--primary",
          href: t("account.topUpUrl"),
          target: "_blank",
          rel: "noopener noreferrer",
        }, t("account.topUp"))),
      balance && balance.infos && balance.infos.length > 0
        ? React.createElement("div", { className: "dsp__row" },
            React.createElement("span", { className: "dsp__muted" }, t("account.balance")),
            React.createElement("span", { className: "dsp__accountBalance" }, fmtMoney(Number(balance.infos[0].totalBalance), balance.infos[0].currency)))
        : accountError
          ? React.createElement("div", { className: "dsp__notice" },
              accountError.code === "NO_API_KEY" ? t("account.noKey") : t("account.queryFailed", { message: accountError.message }))
          : React.createElement("div", { className: "dsp__notice" }, t("account.loading")),
      todayRow,
      peakRow
    );

    return React.createElement(
      React.Fragment,
      null,
      accountCard,
      hasAny
        ? React.createElement(
            React.Fragment,
            null,
      // Context window
      React.createElement(
        "div",
        { className: "dsp__card" },
        React.createElement("h4", { className: "dsp__cardTitle" },
          t("overview.context.title"),
          total ? React.createElement("span", { className: "dsp__ok" }, t("overview.context.ok")) : null),
        React.createElement("div", { className: "dsp__row" },
          React.createElement("span", { className: "dsp__big" }, fmtCompact(used) + " / " + fmtCompact(total)),
          React.createElement("span", { className: "dsp__muted" }, t("overview.context.percent", { percent: percent === null ? "—" : percent + "%" }))),
        React.createElement("div", { className: "dsp__bar" },
          React.createElement("div", { className: "dsp__barFill", style: { width: (percent ?? 0) + "%" } })),
        React.createElement("div", { className: "dsp__row" },
          React.createElement("span", { className: "dsp__muted" }, t("overview.context.used") + " " + (percent ?? "—") + "%"),
          React.createElement("span", { className: "dsp__muted" }, t("overview.context.toCompaction") + " " + fmtCompact(remaining)))
      ),
      // Round budget
      React.createElement(
        "div",
        { className: "dsp__card" },
        React.createElement("h4", { className: "dsp__cardTitle" }, t("overview.budget.title")),
        React.createElement("div", { className: "dsp__row" },
          React.createElement("span", { className: "dsp__muted" }, t("overview.budget.prompt")),
          React.createElement("span", null, fmtCompact(promptTokens))),
        React.createElement("div", { className: "dsp__row" },
          React.createElement("span", { className: "dsp__muted" }, t("overview.budget.output")),
          React.createElement("span", null, outputBudget !== null ? fmtCompact(outputBudget) : t("common.unknown"))),
        React.createElement("div", { className: "dsp__row" },
          React.createElement("span", { className: "dsp__muted" }, t("overview.budget.physical")),
          React.createElement("span", null, fmtCompact(physicalRemaining))),
        React.createElement("div", { className: "dsp__row" },
          React.createElement("span", { className: "dsp__muted" }, t("overview.budget.source")),
          React.createElement("span", null, t("overview.budget.official")))
      ),
      // Session metrics
      React.createElement(
        "div",
        { className: "dsp__card" },
        React.createElement("h4", { className: "dsp__cardTitle" },
          t("overview.metrics.title"),
          lastUpdated ? React.createElement("span", { className: "dsp__updated" }, t("overview.updated", { time: fmtClock(lastUpdated) })) : null),
        React.createElement("div", { className: "dsp__grid" },
          React.createElement("div", { className: "dsp__metric" },
            React.createElement("span", { className: "dsp__metricLabel" }, t("overview.metrics.hitRate")),
            React.createElement("span", { className: "dsp__metricValue" }, fmtPercent(hitRate))),
          React.createElement("div", { className: "dsp__metric" },
            React.createElement("span", { className: "dsp__metricLabel" }, t("overview.metrics.cost")),
            React.createElement("span", { className: "dsp__metricValue" }, fmtMoney(cost, currency))),
          React.createElement("div", { className: "dsp__metric" },
            React.createElement("span", { className: "dsp__metricLabel" }, t("overview.metrics.runtime")),
            React.createElement("span", { className: "dsp__metricValue" }, fmtDuration(runtimeMs, t))),
          React.createElement("div", { className: "dsp__metric" },
            React.createElement("span", { className: "dsp__metricLabel" }, t("overview.metrics.requests")),
            React.createElement("span", { className: "dsp__metricValue" }, requestCount !== null ? String(requestCount) : "—")),
          React.createElement("div", { className: "dsp__metric" },
            React.createElement("span", { className: "dsp__metricLabel" }, t("overview.metrics.totalTokens")),
            React.createElement("span", { className: "dsp__metricValue" }, fmtFull(totalTokens))))
      ),
      // Usage analysis
      React.createElement(
        "div",
        { className: "dsp__card" },
        React.createElement("h4", { className: "dsp__cardTitle" }, t("overview.usage.title")),
        React.createElement(
          "div",
          { className: "dsp__tabs", style: { padding: 0, borderBottom: "none" } },
          React.createElement("button", { type: "button", className: "dsp__tab", "aria-selected": usageView === "source" ? "true" : "false", onClick: function () { setUsageView("source"); } }, t("overview.usage.bySource")),
          React.createElement("button", { type: "button", className: "dsp__tab", "aria-selected": usageView === "type" ? "true" : "false", onClick: function () { setUsageView("type"); } }, t("overview.usage.byType"))
        ),
        usageView === "source"
          ? React.createElement(
              React.Fragment,
              null,
              byModel.map(function (m) {
                var cacheRate = m.total > 0 ? (m.hit / m.total) : 0;
                return React.createElement(
                  "div",
                  { key: m.provider + "/" + m.model, className: "dsp__card", style: { padding: "8px 10px", marginTop: 6 } },
                  React.createElement("div", { className: "dsp__row" },
                    React.createElement("span", null, m.model || m.provider),
                    React.createElement("span", { className: "dsp__muted" }, t("overview.usage.times", { count: m.count }))),
                  React.createElement("div", { className: "dsp__row" },
                    React.createElement("span", { className: "dsp__muted" }, t("overview.usage.sourceShare")),
                    React.createElement("span", null, "100%")),
                  React.createElement("div", { className: "dsp__row" },
                    React.createElement("span", { className: "dsp__muted" }, t("overview.metrics.totalTokens")),
                    React.createElement("span", null, fmtFull(m.total))),
                  React.createElement("div", { className: "dsp__row" },
                    React.createElement("span", { className: "dsp__muted" }, t("overview.usage.cache")),
                    React.createElement("span", null, fmtPercent(cacheRate))),
                  React.createElement("div", { className: "dsp__row" },
                    React.createElement("span", { className: "dsp__muted" }, t("overview.metrics.cost")),
                    React.createElement("span", null, fmtMoney(m.cost, currency)))
                );
              })
            )
          : React.createElement(
              "div",
              { className: "dsp__grid", style: { marginTop: 6 } },
              React.createElement("div", { className: "dsp__metric" },
                React.createElement("span", { className: "dsp__metricLabel" }, t("overview.usage.detail") + " · " + t("overview.usage.input")),
                React.createElement("span", { className: "dsp__metricValue" }, fmtFull(inputTokens))),
              React.createElement("div", { className: "dsp__metric" },
                React.createElement("span", { className: "dsp__metricLabel" }, t("overview.usage.detail") + " · " + t("overview.usage.output")),
                React.createElement("span", { className: "dsp__metricValue" }, fmtFull(outputTokens))),
              React.createElement("div", { className: "dsp__metric" },
                React.createElement("span", { className: "dsp__metricLabel" }, t("overview.usage.detail") + " · " + t("overview.usage.hit")),
                React.createElement("span", { className: "dsp__metricValue" }, fmtFull(hitTokens))),
              React.createElement("div", { className: "dsp__metric" },
                React.createElement("span", { className: "dsp__metricLabel" }, t("overview.usage.detail") + " · " + t("overview.usage.miss")),
                React.createElement("span", { className: "dsp__metricValue" }, fmtFull(missTokens)))
            )
      ),
      serverError ? React.createElement("div", { className: "dsp__error" }, serverError) : null
            )
        : React.createElement("div", { className: "dsp__empty" }, t("overview.empty"))
    );
  }

  /* ------------------------------------------------------------------ */
  /* Files tab                                                           */
  /* ------------------------------------------------------------------ */

  function ContextMenu(props) {
    // Hooks MUST run unconditionally — a conditional `return null` before a
    // hook used to make React report "rendered fewer hooks than expected"
    // the moment the menu opened (menu: null → non-null), which crashed the
    // render and hid the menu entirely. The listeners are also only attached
    // while the menu is open (the effect's dependency drives that), and the
    // document-level `contextmenu` handler ignores events whose target is
    // INSIDE the menu — otherwise the very right-click that opened the menu
    // would bubble to `document` and close it before it could paint.
    React.useEffect(function () {
      if (!props.menu) return;
      function close() { props.onClose(); }
      function onDocContext(e) {
        if (props.menu && e.target instanceof Element && e.target.closest(".dsp__menu")) return;
        close();
      }
      document.addEventListener("click", close);
      document.addEventListener("contextmenu", onDocContext);
      window.addEventListener("blur", close);
      return function () {
        document.removeEventListener("click", close);
        document.removeEventListener("contextmenu", onDocContext);
        window.removeEventListener("blur", close);
      };
    }, [props.menu, props.onClose]);

    if (!props.menu) return null;
    var item = props.menu.item;
    var isDir = item.isDir;
    var items = [];
    items.push({ label: props.t("files.menu.reveal"), action: "reveal" });
    items.push({ sep: true });
    if (isDir) {
      items.push({ label: props.t("files.menu.addFolderRef"), action: "addRef" });
    } else {
      items.push({ label: props.t("files.menu.addFileRef"), action: "addRef" });
      items.push({ label: props.t("files.menu.addFileContent"), action: "addContent" });
    }
    items.push({ sep: true });
    items.push({ label: props.t("files.menu.copyAbs"), action: "copyAbs" });
    items.push({ label: props.t("files.menu.copyRel"), action: "copyRel" });

    return React.createElement(
      "div",
      { className: "dsp__menu", style: { left: props.menu.x, top: props.menu.y }, role: "menu" },
      items.map(function (it, idx) {
        if (it.sep) return React.createElement("div", { key: "sep" + idx, className: "dsp__menuSep" });
        return React.createElement("button", {
          key: it.action,
          type: "button",
          className: "dsp__menuItem",
          role: "menuitem",
          onClick: function (e) {
            e.stopPropagation();
            props.onClose();
            props.onAction(item, it.action);
          },
        }, it.label);
      })
    );
  }

  /**
   * The 文件 tab. `props.tabActions` is the shipped column's navigation face for
   * the pane this body lives in: clicking an Office document hands the file to
   * the shipped document preview through it (see `openInDshPreview`) instead of
   * opening a pane this plugin cannot fill.
   */
  function FilesTab(props) {
    var t = props.t;
    var root = props.cwd || null;
    var [current, setCurrent] = React.useState(root);
    var [dirs, setDirs] = React.useState({});
    var [loading, setLoading] = React.useState(false);
    var [error, setError] = React.useState(null);
    var [menu, setMenu] = React.useState(null);
    var [preview, setPreview] = React.useState(null);
    var [notice, setNotice] = React.useState(null);
    var [config, setConfig] = React.useState(null);
    // The file list and the preview each race their own successor: a fast
    // second click (another directory, another file) must never be overwritten
    // by the slower first reply, or the pane would show — and the 引用/复制
    // actions would hand over — a path the user has already navigated away from.
    var listSeq = React.useRef(0);
    var previewSeq = React.useRef(0);
    // The details seat is strict session scope, so the standard kit always
    // provides useInput; calling it unconditionally keeps hook order stable.
    var draft = props.useInput(function (s) { return s.draft; });

    /** One visible feedback line. `tone` 'error' paints it with the error
     *  style; every action reports its failure here rather than swallowing it. */
    function showNotice(text, tone) {
      setNotice({ text: text, tone: tone === "error" ? "error" : "info" });
    }

    React.useEffect(function () {
      apiGet("/config").then(function (data) {
        if (data && data.ok) setConfig(data.config);
        // Without the config the 引用 templates fall back to their built-in
        // defaults, so this is a notice — not a broken tab — but it must be
        // visible instead of an empty catch.
        else showNotice(errorText(data && data.error, "config unavailable"), "error");
      }).catch(function (err) {
        showNotice(errorText(err, "config unavailable"), "error");
      });
    }, []);

    function load(dirPath) {
      if (dirPath === null || dirPath === undefined) return;
      var seq = ++listSeq.current;
      setLoading(true);
      setError(null);
      var rel = dirPath === root ? "" : dirPath;
      apiGet("/files", { root: root, path: rel })
        .then(function (data) {
          if (seq !== listSeq.current) return;
          if (data && data.ok) {
            setDirs(function (prev) {
              var next = {};
              for (var k in prev) next[k] = prev[k];
              next[data.path] = data.entries;
              return next;
            });
            setCurrent(data.path);
          } else {
            setError(errorText(data && data.error, "load failed"));
          }
        })
        .catch(function (err) {
          if (seq !== listSeq.current) return;
          setError(errorText(err, "load failed"));
        })
        .finally(function () {
          if (seq === listSeq.current) setLoading(false);
        });
    }

    React.useEffect(function () {
      if (root) load(root);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [root]);

    function insertSnippet(snippet) {
      if (props.inputActions && typeof props.inputActions.setDraft === "function") {
        props.inputActions.setDraft((draft ? draft + "\n" : "") + snippet);
        showNotice(t("files.inserted"));
        return true;
      }
      showNotice(t("files.insertFailed"), "error");
      return false;
    }

    function onMenuAction(item, action) {
      var abs = item.path;
      var rel = root ? (abs.startsWith(root + "\\") || abs.startsWith(root + "/") ? abs.slice(root.length + 1) : abs) : abs;
      if (action === "reveal") {
        apiPost("/reveal", { path: abs }).catch(function (err) {
          // A rejected reveal (UNC path, relative path, no handler) used to be
          // swallowed, which made the menu item look like it did nothing.
          showNotice(errorText(err, t("files.menu.reveal")), "error");
        });
      } else if (action === "addRef") {
        var template = item.isDir ? (config ? config.reference.folder : "@<path>/") : (config ? config.reference.file : "@<path>");
        insertSnippet(template.replace("<path>", abs));
      } else if (action === "addContent") {
        apiPost("/file-content", { root: root, path: abs }).then(function (data) {
          if (data && data.ok) {
            var header = (config ? config.reference.contentHeader : "<!-- 文件内容: <path> -->")
              .replace("<path>", abs).replace("<chars>", String(data.chars));
            insertSnippet(header + "\n" + data.text);
          } else {
            // Out of range / over the size limit / unreadable: say so, rather
            // than inserting nothing and leaving the composer untouched.
            showNotice(errorText(data && data.error, "read failed"), "error");
          }
        }).catch(function (err) { showNotice(errorText(err, "read failed"), "error"); });
      } else if (action === "copyAbs") {
        copyText(abs)
          .then(function () { showNotice(t("files.copied")); })
          .catch(function (err) { showNotice(errorText(err, "copy failed"), "error"); });
      } else if (action === "copyRel") {
        copyText(rel)
          .then(function () { showNotice(t("files.copied")); })
          .catch(function (err) { showNotice(errorText(err, "copy failed"), "error"); });
      }
    }

    /** Raw-bytes URL of a previewable asset (served by /file-raw). */
    function assetUrl(entry) {
      return API_BASE + "/file-raw?root=" + encodeURIComponent(root) + "&path=" + encodeURIComponent(entry.path);
    }

    /** The inline text body: the default for source files, svg's 源码 view. */
    function loadText(entry, seq) {
      setPreview({ entry: entry, kind: "text", text: null, truncated: false, error: null, loading: true });
      apiPost("/file-content", { root: root, path: entry.path }).then(function (data) {
        if (seq !== previewSeq.current) return;
        if (data && data.ok) {
          setPreview({ entry: entry, kind: "text", text: data.text, truncated: data.truncated, error: null, loading: false });
        } else {
          // Out of range / over the size limit / unreadable: show the failure
          // (code + message) instead of a blank preview pane.
          setPreview({ entry: entry, kind: "text", text: null, truncated: false, error: errorText(data && data.error, "read failed"), loading: false });
        }
      }).catch(function (err) {
        if (seq !== previewSeq.current) return;
        setPreview({ entry: entry, kind: "text", text: null, truncated: false, error: errorText(err, "read failed"), loading: false });
      });
    }

    /** Clicking a file opens a preview: text files inline, pdf/images/svg via
     *  the file-raw route (served with a safe content-type). */
    function openPreview(entry) {
      // Bumped for every preview, including the asset/unsupported kinds whose
      // body renders synchronously: that is what invalidates a text fetch the
      // user has already clicked past.
      var seq = ++previewSeq.current;
      var ext = extOf(entry.name);
      // Office documents are not decoded here at all: the shipped document
      // preview does it properly (LibreOffice → PDF, spreadsheets in the
      // browser), so the click navigates there and this pane closes. When that
      // hand-off is unavailable — no navigation face, no session id — the pane
      // below still explains itself instead of swallowing the click.
      if (OFFICE_EXTS[ext] &&
          openInDshPreview(props.tabActions, props.sessionId, root, entry.path)) {
        setPreview(null);
        return;
      }
      if (TEXT_EXTS[ext]) {
        loadText(entry, seq);
      } else if (ASSET_EXTS[ext]) {
        setPreview({ entry: entry, kind: "asset", url: assetUrl(entry), error: null });
      } else {
        setPreview({ entry: entry, kind: "unsupported", error: null });
      }
    }

    /** svg only: the same file, as the rendered image or as its source. */
    function toggleSvgSource() {
      if (preview === null) return;
      var seq = ++previewSeq.current;
      if (preview.kind === "asset") loadText(preview.entry, seq);
      else setPreview({ entry: preview.entry, kind: "asset", url: assetUrl(preview.entry), error: null });
    }

    if (root === null) {
      return React.createElement("div", { className: "dsp__empty" }, t("files.root"));
    }

    var entries = dirs[current] || [];
    var isRoot = current === root;

    return React.createElement(
      React.Fragment,
      null,
      React.createElement("h4", { className: "dsp__cardTitle" },
        t("files.title"),
        React.createElement("button", { type: "button", className: "dsp__btn", onClick: function () { load(current); } }, t("files.refresh"))),
      React.createElement(
        "div",
        { className: "dsp__card" },
        React.createElement("div", { className: "dsp__toolbar" },
          !isRoot ? React.createElement("button", { type: "button", className: "dsp__btn", onClick: function () {
            var parent = current.replace(/[\\/][^\\/]*$/, "");
            if (parent && parent !== current) load(parent);
          } }, "↑ " + t("files.up")) : null,
          React.createElement("span", { className: "dsp__crumbs" }, current)),
        loading ? React.createElement("div", { className: "dsp__notice" }, t("files.loading")) : null,
        error ? React.createElement("div", { className: "dsp__error" }, t("files.error", { message: error })) : null,
        entries.length === 0 && !loading && !error
          ? React.createElement("div", { className: "dsp__empty" }, t("files.empty"))
          : null,
        entries.map(function (entry) {
          return React.createElement(
            "div",
            { key: entry.path },
            React.createElement(
              "div",
              {
                className: "dsp__file",
                onContextMenu: function (e) {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenu({ x: e.clientX, y: e.clientY, item: entry });
                },
                onClick: function () {
                  if (entry.isDir) load(entry.path);
                  else openPreview(entry);
                },
              },
              React.createElement(FileIcon, { entry: entry }),
              React.createElement("span", { className: "dsp__fileName" }, entry.name),
              React.createElement("span", { className: "dsp__fileMeta" }, entry.isDir ? "" : fmtCompact(entry.size) + "B")
            )
          );
        })
      ),
      preview
        ? React.createElement(
            "div",
            { className: "dsp__card dsp__preview" },
            React.createElement(
              "div",
              { className: "dsp__previewHeader" },
              React.createElement(FileIcon, { entry: preview.entry }),
              React.createElement("span", { className: "dsp__previewTitle" }, preview.entry.name),
              extOf(preview.entry.name) === "svg"
                ? React.createElement("button", {
                    type: "button",
                    className: "dsp__btn",
                    onClick: toggleSvgSource,
                  }, preview.kind === "asset" ? t("files.preview.source") : t("files.preview.image"))
                : null,
              React.createElement("button", {
                type: "button",
                className: "dsp__close",
                "aria-label": t("files.preview.close"),
                title: t("files.preview.close"),
                onClick: function () { setPreview(null); },
              }, "✕")
            ),
            preview.kind === "text"
              ? preview.loading
                ? React.createElement("div", { className: "dsp__notice" }, t("files.preview.loading"))
                : preview.error
                  ? React.createElement("div", { className: "dsp__error" }, preview.error)
                  : React.createElement(
                      React.Fragment,
                      null,
                      React.createElement("pre", { className: "dsp__code dsp__previewBody" }, preview.text),
                      preview.truncated
                        ? React.createElement("div", { className: "dsp__notice" }, t("files.preview.truncated"))
                        : null
                    )
              : preview.kind === "asset"
                ? extOf(preview.entry.name) === "pdf"
                  ? React.createElement("iframe", { className: "dsp__previewFrame", src: preview.url, title: preview.entry.name })
                  : React.createElement("img", { className: "dsp__previewImg", src: preview.url, alt: preview.entry.name })
                : React.createElement("div", { className: "dsp__empty" },
                    UNDECODABLE_IMAGE_EXTS[extOf(preview.entry.name)]
                      ? t("files.preview.unsupportedImage")
                      : t("files.preview.unsupported"))
          )
        : null,
      notice
        ? React.createElement("div", { className: notice.tone === "error" ? "dsp__error" : "dsp__notice" }, notice.text)
        : null,
      React.createElement(ContextMenu, {
        menu: menu,
        t: t,
        onClose: function () { setMenu(null); },
        onAction: onMenuAction,
      })
    );
  }

  /* ------------------------------------------------------------------ */
  /* Changes tab                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * One row per FILE, not per call. A session that edits the same file twenty
   * times should read as one line with a ×20 rather than twenty identical
   * lines; the newest touch supplies the row's tool and its position. The host
   * already returns the list newest-first, so the first hit for a path wins.
   */
  function mergeChanges(changes) {
    var byPath = new Map();
    var order = [];
    for (var i = 0; i < changes.length; i += 1) {
      var c = changes[i];
      var prev = byPath.get(c.path);
      if (prev === undefined) {
        byPath.set(c.path, { path: c.path, tool: c.tool, time: c.time, count: 1 });
        order.push(c.path);
      } else {
        prev.count += 1;
      }
    }
    return order.map(function (p) { return byPath.get(p); });
  }

  function ChangesTab(props) {
    var t = props.t;
    var [changes, setChanges] = React.useState([]);
    var [error, setError] = React.useState(null);
    // Same guard as the other tabs: a slow response for an older session must
    // not overwrite a newer one.
    var seq = React.useRef(0);

    function load() {
      var current = ++seq.current;
      apiGet("/changes", { sessionId: props.sessionId })
        .then(function (data) {
          if (current !== seq.current) return;
          if (data && data.ok) setChanges(data.changes);
          else setError(data && data.error ? data.error.message : "load failed");
        })
        .catch(function (err) {
          if (current !== seq.current) return;
          setError(String(err && err.message || err));
        });
    }

    React.useEffect(function () {
      load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.sessionId]);

    return React.createElement(
      React.Fragment,
      null,
      React.createElement("h4", { className: "dsp__cardTitle" },
        t("changes.title"),
        React.createElement("button", { type: "button", className: "dsp__btn", onClick: load }, t("changes.refresh"))),
      error ? React.createElement("div", { className: "dsp__error" }, error) : null,
      changes.length === 0 && !error
        ? React.createElement("div", { className: "dsp__empty" }, t("changes.empty"))
        : null,
      React.createElement(
        "div",
        { className: "dsp__card" },
        mergeChanges(changes).map(function (c, idx) {
          // A row for an Office document is a way IN, not just a path: the same
          // hand-off the 文件 tab performs, so a spreadsheet this session wrote
          // is one click from the preview that can actually render it.
          var office = c.path !== "" && OFFICE_EXTS[extOf(baseName(c.path))] === 1;
          return React.createElement(
            "div",
            {
              key: c.path + "-" + idx,
              className: "dsp__change" + (office ? " dsp__change--open" : ""),
              title: office ? c.path + " — " + t("files.preview.dshHint") : c.path,
              onClick: office
                ? function () {
                    if (!openInDshPreview(props.tabActions, props.sessionId, props.cwd, c.path)) {
                      setError(t("files.preview.dshFailed"));
                    }
                  }
                : undefined,
            },
            React.createElement(FileIcon, { name: baseName(c.path) }),
            React.createElement("span", { className: "dsp__changePath" }, c.path),
            React.createElement("span", { className: "dsp__changeMeta" }, c.count > 1 ? c.tool + " ×" + c.count : c.tool)
          );
        })
      ),
      React.createElement("div", { className: "dsp__notice" }, t("changes.note"))
    );
  }

  /* ------------------------------------------------------------------ */
  /* Tools tab                                                           */
  /* ------------------------------------------------------------------ */

  function ToolsTab(props) {
    var t = props.t;
    var slice = useChatSlice(props);
    var calls = React.useMemo(function () { return collectToolCalls(slice); }, [slice]);
    var [selected, setSelected] = React.useState(null);

    React.useEffect(function () {
      if (selected === null && calls.length > 0) setSelected(calls[0].callId);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [calls.length]);

    var active = null;
    for (var i = 0; i < calls.length; i++) if (calls[i].callId === selected) active = calls[i];

    return React.createElement(
      React.Fragment,
      null,
      React.createElement("h4", { className: "dsp__cardTitle" }, t("tools.title")),
      calls.length === 0
        ? React.createElement("div", { className: "dsp__empty" }, t("tools.empty"))
        : React.createElement(
            React.Fragment,
            null,
            React.createElement(
              "div",
              { className: "dsp__card" },
              calls.map(function (c) {
                return React.createElement(
                  "div",
                  {
                    key: c.callId,
                    className: "dsp__toolRow",
                    role: "option",
                    "aria-selected": c.callId === selected ? "true" : "false",
                    onClick: function () { setSelected(c.callId); },
                  },
                  React.createElement(FileIcon, { glyph: c.running ? "hourglass" : "terminal" }),
                  React.createElement("span", { className: "dsp__fileName" }, c.name),
                  React.createElement("span", { className: "dsp__fileMeta" }, c.callId.slice(0, 8))
                );
              })
            ),
            active
              ? React.createElement(
                  "div",
                  { className: "dsp__card" },
                  React.createElement("div", { className: "dsp__cardTitle" }, active.name + (active.running ? " · " + t("tools.running") : "")),
                  React.createElement("div", { className: "dsp__muted" }, t("tools.args")),
                  React.createElement("div", { className: "dsp__code" }, prettyJson(active.argsRaw) || "—"),
                  React.createElement("div", { className: "dsp__muted", style: { marginTop: 8 } }, t("tools.result")),
                  React.createElement("div", { className: "dsp__code" }, resultText(active.block) || "—")
                )
              : null
          )
    );
  }

  /* ------------------------------------------------------------------ */
  /* Panel root                                                          */
  /* ------------------------------------------------------------------ */

  var TABS = ["overview", "files", "changes", "tools"];

  /**
   * Body of the plugin's right-column tab (the keyed `sidebar.right.pane.tab`
   * seat, registered under `PACKAGE_ID`).
   *
   * A keyed session-scope seat delivers the whole framework Session kit to the
   * component — `sessionId`, `useSession`, `useProjection` (merged by
   * ui-session), `useConversation`, `useInput`, `inputActions` (merged by
   * ui-conversation) — plus the global `useSessions`, the namespace-bound `t`
   * (declared with `locale: NS`), and `useTabInfo`: the hook the framework
   * synthesizes from this slot's `hooks.tabInfo` inject face.
   *
   * No local mirror of the column state is kept. The shipped right Sidebar
   * owns the frame's geometry and only mounts this body while the tab is
   * visible, so "is the column open" is never this component's business.
   */
  function PanelRoot(props) {
    var t = props.t;
    var [tab, setTab] = React.useState("overview");
    var tabInfo = props.useTabInfo();
    var tabActions = tabInfo !== null && tabInfo !== undefined && tabInfo.tab !== undefined
      ? tabInfo.tab.actions
      : null;

    // The workspace root of THIS tab's session: a tab is bound to its own
    // session, so `props.sessionId` — not the current selection — is what the
    // file tree must follow.
    var cwd = props.useSessions(function (s) {
      var entry = s.byId[props.sessionId];
      return entry !== undefined && entry !== null ? entry.cwd || null : null;
    }) || null;

    React.useEffect(function () {
      try {
        var saved = localStorage.getItem(NS + ":tab:" + props.sessionId);
        if (saved && TABS.indexOf(saved) !== -1) setTab(saved);
      } catch (_) {}
    }, [props.sessionId]);

    function switchTab(next) {
      setTab(next);
      try { localStorage.setItem(NS + ":tab:" + props.sessionId, next); } catch (_) {}
    }

    var body = null;
    if (tab === "overview") {
      body = React.createElement(OverviewTab, {
        sessionId: props.sessionId,
        useProjection: props.useProjection,
        useSession: props.useSession,
        useConversation: props.useConversation,
        t: t,
      });
    } else if (tab === "files") {
      body = React.createElement(FilesTab, {
        cwd: cwd,
        // The pane's own navigation face: Office documents are handed to the
        // shipped document preview through it, with this session as the scope.
        sessionId: props.sessionId,
        tabActions: tabActions,
        useInput: props.useInput,
        inputActions: props.inputActions,
        t: t,
      });
    } else if (tab === "changes") {
      body = React.createElement(ChangesTab, {
        sessionId: props.sessionId,
        cwd: cwd,
        tabActions: tabActions,
        t: t,
      });
    } else {
      body = React.createElement(ToolsTab, {
        useSession: props.useSession,
        useConversation: props.useConversation,
        t: t,
      });
    }

    return React.createElement(
      "div",
      { className: "dsp", "data-plugin": PACKAGE_ID },
      React.createElement(
        "div",
        { className: "dsp__header" },
        React.createElement("span", { className: "dsp__title" }, t("panel.title")),
        React.createElement("button", {
          type: "button",
          className: "dsp__close",
          "aria-label": t("panel.close"),
          title: t("panel.close"),
          onClick: function () {
            // Closing the tab is the column's own operation: the shipped
            // Sidebar removes this tab from its pane and keeps the rest.
            if (tabActions !== null) tabActions.close();
          },
        }, "✕")
      ),
      React.createElement(
        "div",
        { className: "dsp__tabs", role: "tablist" },
        TABS.map(function (key) {
          return React.createElement("button", {
            key: key,
            type: "button",
            role: "tab",
            className: "dsp__tab",
            "aria-selected": tab === key ? "true" : "false",
            onClick: function () { switchTab(key); },
          }, t("tab." + key));
        })
      ),
      React.createElement("div", { className: "dsp__body", role: "tabpanel" }, body)
    );
  }

  /* ------------------------------------------------------------------ */
  /* Plugin body                                                         */
  /* ------------------------------------------------------------------ */

  function apply(ctx) {
    // Namespace-bound translate, read fresh on every label call (the tab
    // registry thunks `title`/`guide` so a language change needs no
    // re-registration).
    var t = ctx.locale.bind(NS);

    ctx.effect(function () {
      installStyles();
      return function () {
        var style = document.getElementById(STYLE_ID);
        if (style) style.remove();
      };
    }, "dsh-sidebar-panel: styles");

    ctx.effect(function () {
      return ctx.locale.register(NS, { zh: zh, en: en });
    }, "dsh-sidebar-panel: dictionaries");

    // Stage one: the tab type itself. A page type declares no `patterns` — it
    // is opened by kind, never claimed by a resource address — and
    // `priority: 'extension'` is the band reserved for a type shipped from
    // outside the product. The `guide` entry lists it on the column's guide
    // page beside the shipped file and document-preview types, which is the
    // sanctioned discovery surface: the shipped guide type registers through
    // exactly these same two stages.
    ctx.effect(function () {
      return ctx.sidebarRightTabs.register({
        id: PACKAGE_ID,
        kind: PANEL_KIND,
        priority: "extension",
        title: function () { return t("panel.title"); },
        guide: [{
          order: 30,
          title: function () { return t("panel.title"); },
          description: function () { return t("guide.description"); },
          icon: PanelLeftIcon,
        }],
      });
    }, "dsh-sidebar-panel: tab type");

    // Stage two: the body, in the keyed seat under the same `id`.
    ctx.effect(function () {
      return ctx.slots.inject("sidebar.right.pane.tab", function () {
        return ctx.slots.register({
          name: "sidebar.right.pane.tab",
          key: PACKAGE_ID,
          locale: NS,
        }, PanelRoot);
      });
    }, "dsh-sidebar-panel: tab body");

    // The conversation header's own way in. It only navigates the shipped
    // column (see `togglePanel`); geometry, width and the collapse affordance
    // all stay the right Sidebar's.
    ctx.slots.inject("conversation.session.header.utilities", function () {
      return ctx.slots.register({
        name: "conversation.session.header.utilities",
        id: "dsh-sidebar-panel-toggle",
        order: 0,
        label: function () { return t("panel.title"); },
        locale: NS,
        inject: function () {
          return { togglePanel: function () { togglePanel(ctx); } };
        },
      }, ToggleDetailsButton);
    });

  }

  exports.name = PACKAGE_ID;
  // The shipped right Sidebar's registry and navigation face are the only two
  // services this plugin cannot work without; `slots` and `locale` are the
  // generic framework seats. `sessions` is no longer required — the file tree
  // reads the workspace root through the standard `useSessions` prop instead of
  // `ctx.get('sessions')` — and `layout` is gone entirely, because the column
  // geometry now belongs to the shipped Sidebar.
  exports.inject = ["slots", "locale", "sidebarRight", "sidebarRightTabs"];
  exports.apply = apply;
  return module.exports;
}});
