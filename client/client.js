/**
 * dsh-sidebar-panel — browser half.
 *
 * Slot registrations:
 *  1. `conversation.session.header.utilities` — the right-aligned session
 *     header utility row: a panel toggle styled like the sidebar fold button
 *     (open / collapse the right details column from the top-right).
 *  2. `details` — the right column itself, shadowing ui-conversation's
 *     DetailsPanel at a lower priority. The panel has four tabs:
 *     概览 (context/token/cost), 文件 (workspace file tree + context menu),
 *     改动 (files written this session), 工具 (tool calls in this window).
 *     It auto-opens on load (persisted preference, default open) so a DSH
 *     restart does not require a manual click.
 *
 * The `conversation.details.tool` seat belongs to the shipped DetailsPanel
 * registration (declaring is claiming), so the 工具 tab renders a self-built
 * detail view instead of reusing the per-tool renderers.
 */
window.__ModuleLoader__.load({ id: "dsh-sidebar-panel", factory: (require) => {
  var module = { exports: {} };
  var exports = module.exports;
  var React = require("react");
  var IconPanelLeftOutline16 = require("@deepseek-ai/dsh-client-ui-primitives").IconPanelLeftOutline16;

  var PACKAGE_ID = "dsh-sidebar-panel";
  var NS = "dshSidebarPanel";
  var API_BASE = "/dsh-sidebar-panel/api";
  var STYLE_ID = "dsh-sidebar-panel-styles";

  /* ------------------------------------------------------------------ */
  /* i18n                                                                */
  /* ------------------------------------------------------------------ */

  var zh = {
    "panel.title": "会话面板",
    "panel.close": "关闭面板",
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
    "files.title": "工作区文件",
    "files.refresh": "刷新",
    "files.up": "上级目录",
    "files.root": "工作区",
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
    "files.title": "Workspace Files",
    "files.refresh": "Refresh",
    "files.up": "Parent",
    "files.root": "Workspace",
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

  function apiGet(path, params) {
    var query = params === undefined ? "" : "?" + new URLSearchParams(params).toString();
    return fetch(API_BASE + path + query, {
      headers: { accept: "application/json" },
    }).then(function (r) { return r.json(); });
  }

  function apiPost(path, body) {
    return fetch(API_BASE + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); });
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

  function fmtDuration(ms) {
    if (ms === null || ms === undefined || ms < 0) return "—";
    var total = Math.floor(ms / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    if (h > 0) return h + "小时" + m + "分" + s + "秒";
    if (m > 0) return m + "分" + s + "秒";
    return s + "秒";
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

  function prettyJson(raw) {
    if (typeof raw !== "string" || raw === "") return "";
    try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
  }

  /**
   * Most recent assistant request config's maxTokens (the newest message that
   * recorded a request config wins — walking backwards).
   */
  function walkNodesForMaxTokens(nodes) {
    for (var i = (nodes || []).length - 1; i >= 0; i--) {
      var n = nodes[i];
      if (n && n.config && typeof n.config.maxTokens === "number") return n.config.maxTokens;
    }
    return null;
  }

  /**
   * The AppFrame root carries `data-details-collapsed` exactly while the
   * right details column is closed (width 0). Presence of the attribute is
   * the cheapest reliable open/closed probe without the layout store handle.
   */
  function isDetailsCollapsed() {
    return document.querySelector("[data-details-collapsed]") !== null;
  }

  /* File preview vocabulary -------------------------------------------- */

  var TEXT_EXTS = {
    md: 1, markdown: 1, txt: 1, text: 1, json: 1, yaml: 1, yml: 1, xml: 1,
    html: 1, htm: 1, css: 1, js: 1, mjs: 1, cjs: 1, jsx: 1, ts: 1, tsx: 1,
    py: 1, java: 1, c: 1, h: 1, cpp: 1, hpp: 1, cc: 1, go: 1, rs: 1, rb: 1,
    php: 1, sh: 1, bash: 1, zsh: 1, ps1: 1, bat: 1, cmd: 1, toml: 1, ini: 1,
    cfg: 1, conf: 1, log: 1, csv: 1, sql: 1, svg: 1, diff: 1, patch: 1,
  };
  var ASSET_EXTS = { pdf: 1, png: 1, jpg: 1, jpeg: 1, gif: 1, webp: 1 };

  function extOf(name) {
    var i = name.lastIndexOf(".");
    return i < 0 ? "" : name.slice(i + 1).toLowerCase();
  }

  function collectToolCalls(snapshot) {
    var list = [];
    var seen = {};
    var nodes = snapshot && snapshot.chat ? snapshot.chat.legacy.nodes : (snapshot ? snapshot.nodes : []);
    for (var i = 0; i < (nodes || []).length; i++) {
      var n = nodes[i];
      if (n && typeof n.callId === "string" && typeof n.name === "string" && typeof n.argsRaw === "string" && !seen[n.callId]) {
        seen[n.callId] = true;
        list.push({ callId: n.callId, name: n.name, argsRaw: n.argsRaw, block: n, time: n.time || 0, running: false });
      }
    }
    var running = snapshot && snapshot.chat ? snapshot.chat.legacy.runningCalls : [];
    for (var j = 0; j < (running || []).length; j++) {
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
.dsp__crumbs { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary, #666); font-size: 12px; }
.dsp__file { display: flex; align-items: center; gap: 6px; padding: 3px 6px; border-radius: 6px; cursor: default; }
.dsp__file:hover { background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 5%)); }
.dsp__fileIcon { flex: none; width: 16px; text-align: center; color: var(--dsw-alias-label-tertiary, #888); }
.dsp__fileName { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsp__fileMeta { color: var(--dsw-alias-label-tertiary, #888); font-size: 11px; flex: none; }
.dsp__menu { position: fixed; z-index: 12000; min-width: 200px; padding: 4px; border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 16%)); border-radius: 10px; background: var(--dsw-alias-bg-layer-2, #fff); box-shadow: 0 10px 34px rgb(0 0 0 / 20%); }
.dsp__menuItem { display: block; width: 100%; text-align: left; border: none; background: none; font: inherit; font-size: 13px; color: var(--dsw-alias-label-primary, #222); padding: 6px 10px; border-radius: 6px; cursor: pointer; }
.dsp__menuItem:hover { background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 6%)); }
.dsp__menuSep { height: 1px; margin: 4px 6px; background: var(--dsw-alias-border-l2, rgb(0 0 0 / 10%)); }
.dsp__change { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 6px; }
.dsp__change:hover { background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 5%)); }
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

  function installStyles() {
    if (document.getElementById(STYLE_ID) !== null) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = cssText;
    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------------ */
  /* Top-right panel toggle (session header utilities row)              */
  /* ------------------------------------------------------------------ */

  function ToggleDetailsButton(props) {
    // The AppFrame root carries data-details-collapsed while the details
    // column is closed; observe it so the icon/label track any open/close
    // source (our button, the chat Inspect flow, the panel close button).
    var [collapsed, setCollapsed] = React.useState(isDetailsCollapsed);

    React.useEffect(function () {
      var observer = new MutationObserver(function () {
        setCollapsed(isDetailsCollapsed());
      });
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["data-details-collapsed"],
        subtree: true,
      });
      return function () { observer.disconnect(); };
    }, []);

    function toggle() {
      if (isDetailsCollapsed()) {
        props.openPanel();
      } else {
        props.closePanel();
      }
    }

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
        onClick: toggle,
      },
      React.createElement(IconPanelLeftOutline16, { size: 16 })
    );
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
    var snapshot = props.useSession(function (s) { return s; });
    var nodes = snapshot && snapshot.chat ? snapshot.chat.legacy.nodes : (snapshot ? snapshot.nodes : []);

    // Live server-side figures (requests / cost / runtime / by-model): refetch
    // every 5s so the overview tracks the session in near-real time. Projection
    // data (tokenUsage / contextPressure) already updates reactively via
    // useProjection, so only the server-derived half needs polling.
    React.useEffect(function () {
      var cancelled = false;
      var timer = null;
      function refresh() {
        apiGet("/overview", { sessionId: props.sessionId })
          .then(function (data) {
            if (cancelled) return;
            if (data && data.ok) {
              setServer(data.overview);
              setServerError(null);
              setLastUpdated(Date.now());
            } else {
              setServerError(data && data.error ? data.error.message : "overview failed");
            }
          })
          .catch(function (err) { if (!cancelled) setServerError(String(err && err.message || err)); });
      }
      refresh();
      timer = window.setInterval(refresh, 5000);
      return function () {
        cancelled = true;
        if (timer !== null) window.clearInterval(timer);
      };
    }, [props.sessionId]);

    React.useEffect(function () {
      setOutputBudget(walkNodesForMaxTokens(nodes));
    }, [nodes]);

    // DeepSeek account balance — official user/balance endpoint via the
    // server route (the API key never reaches the browser). Polled every 15s:
    // balances change slowly, unlike the 5s session figures above.
    React.useEffect(function () {
      var cancelled = false;
      var timer = null;
      function refresh() {
        apiGet("/balance").then(function (data) {
          if (cancelled) return;
          if (data && data.ok) {
            setBalance(data.balance);
            setAccountError(data.balance ? null : (data.error || null));
          }
        }).catch(function (err) {
          if (!cancelled) setAccountError({ code: "CLIENT", message: String(err && err.message || err) });
        });
      }
      refresh();
      timer = window.setInterval(refresh, 15000);
      return function () {
        cancelled = true;
        if (timer !== null) window.clearInterval(timer);
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
          : React.createElement("div", { className: "dsp__notice" }, t("account.loading"))
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
          React.createElement("span", { className: "dsp__muted" }, t("overview.context.percent", { percent: percent + "%" }))),
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
          React.createElement("span", null, outputBudget !== null ? t("overview.budget.official") : t("overview.budget.official")))
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
            React.createElement("span", { className: "dsp__metricValue" }, fmtDuration(runtimeMs))),
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
    // The details seat is strict session scope, so the standard kit always
    // provides useInput; calling it unconditionally keeps hook order stable.
    var draft = props.useInput(function (s) { return s.draft; });

    React.useEffect(function () {
      apiGet("/config").then(function (data) {
        if (data && data.ok) setConfig(data.config);
      }).catch(function () {});
    }, []);

    function load(dirPath) {
      if (dirPath === null || dirPath === undefined) return;
      setLoading(true);
      setError(null);
      var rel = dirPath === root ? "" : dirPath;
      apiGet("/files", { root: root, path: rel })
        .then(function (data) {
          if (data && data.ok) {
            setDirs(function (prev) {
              var next = {};
              for (var k in prev) next[k] = prev[k];
              next[data.path] = data.entries;
              return next;
            });
            setCurrent(data.path);
          } else {
            setError(data && data.error ? data.error.message : "load failed");
          }
        })
        .catch(function (err) { setError(String(err && err.message || err)); })
        .finally(function () { setLoading(false); });
    }

    React.useEffect(function () {
      if (root) load(root);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [root]);

    function insertSnippet(snippet) {
      if (props.inputActions && typeof props.inputActions.setDraft === "function") {
        props.inputActions.setDraft((draft ? draft + "\n" : "") + snippet);
        setNotice(t("files.inserted"));
        return true;
      }
      setNotice(t("files.insertFailed"));
      return false;
    }

    function onMenuAction(item, action) {
      var abs = item.path;
      var rel = root ? (abs.startsWith(root + "\\") || abs.startsWith(root + "/") ? abs.slice(root.length + 1) : abs) : abs;
      if (action === "reveal") {
        apiPost("/reveal", { path: abs }).catch(function () {});
      } else if (action === "addRef") {
        var template = item.isDir ? (config ? config.reference.folder : "@<path>/") : (config ? config.reference.file : "@<path>");
        insertSnippet(template.replace("<path>", abs));
      } else if (action === "addContent") {
        apiPost("/file-content", { root: root, path: abs }).then(function (data) {
          if (data && data.ok) {
            var header = (config ? config.reference.contentHeader : "<!-- 文件内容: <path> -->")
              .replace("<path>", abs).replace("<chars>", String(data.chars));
            insertSnippet(header + "\n" + data.text);
          }
        }).catch(function (err) { setNotice(String(err && err.message || err)); });
      } else if (action === "copyAbs") {
        navigator.clipboard.writeText(abs).then(function () { setNotice(t("files.copied")); }).catch(function () {});
      } else if (action === "copyRel") {
        navigator.clipboard.writeText(rel).then(function () { setNotice(t("files.copied")); }).catch(function () {});
      }
    }

    /** Clicking a file opens a preview: text files inline, pdf/images via the
     *  file-raw route (served with a safe content-type). */
    function openPreview(entry) {
      var ext = extOf(entry.name);
      if (TEXT_EXTS[ext]) {
        setPreview({ entry: entry, kind: "text", text: null, truncated: false, error: null, loading: true });
        apiPost("/file-content", { root: root, path: entry.path }).then(function (data) {
          if (data && data.ok) {
            setPreview({ entry: entry, kind: "text", text: data.text, truncated: data.truncated, error: null, loading: false });
          } else {
            setPreview({ entry: entry, kind: "text", text: null, truncated: false, error: data && data.error ? data.error.message : "read failed", loading: false });
          }
        }).catch(function (err) {
          setPreview({ entry: entry, kind: "text", text: null, truncated: false, error: String(err && err.message || err), loading: false });
        });
      } else if (ASSET_EXTS[ext]) {
        setPreview({
          entry: entry,
          kind: "asset",
          url: API_BASE + "/file-raw?root=" + encodeURIComponent(root) + "&path=" + encodeURIComponent(entry.path),
          error: null,
        });
      } else {
        setPreview({ entry: entry, kind: "unsupported", error: null });
      }
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
          ? React.createElement("div", { className: "dsp__empty" }, t("files.root"))
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
              React.createElement("span", { className: "dsp__fileIcon" }, entry.isDir ? "📁" : "📄"),
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
              React.createElement("span", { className: "dsp__previewTitle" }, preview.entry.name),
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
                : React.createElement("div", { className: "dsp__empty" }, t("files.preview.unsupported"))
          )
        : null,
      notice ? React.createElement("div", { className: "dsp__notice" }, notice) : null,
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

  function ChangesTab(props) {
    var t = props.t;
    var [changes, setChanges] = React.useState([]);
    var [error, setError] = React.useState(null);

    function load() {
      apiGet("/changes", { sessionId: props.sessionId })
        .then(function (data) {
          if (data && data.ok) setChanges(data.changes);
          else setError(data && data.error ? data.error.message : "load failed");
        })
        .catch(function (err) { setError(String(err && err.message || err)); });
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
        changes.map(function (c, idx) {
          return React.createElement(
            "div",
            { key: c.time + "-" + idx, className: "dsp__change", title: c.path },
            React.createElement("span", { className: "dsp__changePath" }, c.path),
            React.createElement("span", { className: "dsp__changeMeta" }, c.tool)
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
    var snapshot = props.useSession(function (s) { return s; });
    var calls = React.useMemo(function () { return collectToolCalls(snapshot); }, [snapshot]);
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
                  React.createElement("span", { className: "dsp__fileIcon" }, c.running ? "⏳" : "🔧"),
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

  function PanelRoot(props) {
    var t = props.t;
    var [tab, setTab] = React.useState("overview");
    var cwd = props.cwd || null;

    React.useEffect(function () {
      try {
        var saved = localStorage.getItem(NS + ":tab:" + props.sessionId);
        if (saved && TABS.indexOf(saved) !== -1) setTab(saved);
      } catch (_) {}
    }, [props.sessionId]);

    // Auto-expand on every (re)load — the panel opens by default whenever DSH
    // starts, with no manual click required. The details seat stays mounted at
    // width 0, so this effect runs on every page load with the layout service
    // already attached; a previous manual close is deliberately NOT remembered
    // across restarts (the user asked for unconditional auto-expand).
    React.useEffect(function () {
      if (typeof props.openPanel === "function") {
        try { props.openPanel(); } catch (_) {}
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
        t: t,
      });
    } else if (tab === "files") {
      body = React.createElement(FilesTab, {
        cwd: cwd,
        useInput: props.useInput,
        inputActions: props.inputActions,
        t: t,
      });
    } else if (tab === "changes") {
      body = React.createElement(ChangesTab, { sessionId: props.sessionId, t: t });
    } else {
      body = React.createElement(ToolsTab, { useSession: props.useSession, t: t });
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
          onClick: props.closePanel,
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

    ctx.slots.inject("conversation.session.header.utilities", function () {
      return ctx.slots.register({
        name: "conversation.session.header.utilities",
        id: "dsh-sidebar-panel-toggle",
        order: 0,
        label: function () { return "会话面板"; },
        locale: NS,
        inject: function () {
          return {
            openPanel: function () { ctx.layout.openDetails(); },
            closePanel: function () { ctx.layout.closeDetails(); },
          };
        },
      }, ToggleDetailsButton);
    });

    ctx.slots.inject("details", function () {
      return ctx.slots.register({
        name: "details",
        id: "dsh-sidebar-panel",
        priority: -1,
        locale: NS,
        inject: function (sessionId) {
          var sessions = ctx.get("sessions");
          var cwd = null;
          if (sessions) {
            var byId = sessions.list.getSnapshot().byId;
            if (byId && byId[sessionId]) cwd = byId[sessionId].cwd || null;
          }
          return {
            cwd: cwd,
            openPanel: function () { ctx.layout.openDetails(); },
            closePanel: function () { ctx.layout.closeDetails(); },
          };
        },
      }, PanelRoot);
    });
  }

  exports.name = PACKAGE_ID;
  exports.inject = ["slots", "layout", "locale"];
  exports.apply = apply;
  return module.exports;
}});
