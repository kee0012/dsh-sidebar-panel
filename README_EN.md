# dsh-sidebar-panel

A **right-column tab plugin** for DSH (DeepSeek Harness, Web profile). It registers a page type and its body through the shipped right column's tab registry (`ctx.sidebarRightTabs`), so it sits **beside** the built-in **Files / Document preview / Guide** tabs — it never takes the column over, never replaces a shipped tab and never writes a grid or width rule. A toggle at the **top-right of the session header** (styled like the built-in left fold button) opens or focuses the tab, and collapses the column when the plugin's tab is already in front. The panel itself has four tabs:

- **Overview**: a **DeepSeek account** card at the top — official balance (fetched live from `GET https://api.deepseek.com/user/balance`, refreshed every 15 s) and a **Top Up** button (https://platform.deepseek.com/usage). Below it: context window (used/total/percent/distance-to-compaction), current turn's context budget (prompt/output budget, physical headroom, output-cap source), session metrics (hit rate / **session cost** / runtime / request count / total tokens), and usage analysis (by source / by type, with input-output and cache hit-miss breakdown). Server-side data refreshes every 5 s ("updated at HH:MM:SS" in the corner); projected data (tokens/context) reacts in real time.
- **Files**: a file tree of the current session's workspace. **Click a file to preview** (md/txt/code inline; PDF and images embedded; truncation notice for large files). **Right-click menu**: reveal in file manager, add file reference / add file content (file), add folder reference (folder), copy absolute path / copy relative path. Inserted content is written into the chat input box.
- **Changes**: files touched by write-like tools (write/edit/str-replace-editor, …) in the current session.
- **Tools**: the tool calls in the current window with argument/result details (self-built view).

> **Compatibility**: 0.1.5 or newer, **Web profile**. The plugin needs two things from the tree it is loaded into: the host's `ctx.webServer` (same-origin HTTP routes) and the client-side right-column tab registry (`ctx.sidebarRightTabs`, shipped in 0.1.5). A desktop shell that boots this same web profile works — the routes are served exactly as in a browser; a shell without the web server does not.

## Layout

```
dsh-sidebar-panel/
├── package.json             # DSH bundle manifest + client injection declaration + test scripts
├── cordis.patch.yml         # inserts the plugin into the DSH composition layer
├── src/index.js             # server: same-origin HTTP API + incremental session-event folding (usage/cost/changes) + file browsing + reveal
├── client/client.js         # browser: right-column tab (type + body) + header toggle + four tabs + context menu
├── test/unit.test.mjs       # server unit tests (mocked ctx, no DSH instance, no machine-specific paths)
├── test/smoke.client.mjs    # client smoke: stub runtime asserting registration shape / navigation / chat slice
├── SECURITY.md              # credential and network-surface notes (incl. the scanner false positives)
└── README.md / README_EN.md
```

> **Right-column contract**: since 0.1.5 the column is owned by the shipped `@deepseek-ai/dsh-client-ui-sidebar-right`, which exposes a tab registry. A type from outside the product registers in **two stages** — `ctx.sidebarRightTabs.register({ id, kind, priority: 'extension', title, guide })` defines the type, then its body goes into the keyed `sidebar.right.pane.tab` seat under the same `id`. This plugin takes exactly that path (as do the shipped `files`, `documentpreview` and `guide` types), so it neither needs nor wants to shadow the `rightbar` slot.

> **Dependencies**: the server depends on `@deepseek-ai/schemastery` (config schema) and `@deepseek-ai/dsh-credentials` (resolves the `DEEPSEEK_API_KEY` credential); both are provided by the DSH runtime. `pnpm pack` output does not include `node_modules`; when developing from source, run `pnpm install` in the plugin directory to resolve dependencies.

## Install

Run in a terminal where DSH runs (Web profile):

```sh
# Option 1: from GitHub (Recommend)
dsh plugin --profile web add github:kee0012/dsh-sidebar-panel

# Option 2: from npm (Not yet published to the npm registry)
dsh plugin --profile web add dsh-sidebar-panel

```

Restart DSH and hard-refresh the browser (Ctrl+Shift+R). Verify the config layer picked it up.

## Server API (same-origin, consumed by the browser panel)

| Route | Description |
|---|---|
| `GET /dsh-sidebar-panel/api/config` | reference templates / content caps / pricing toggle |
| `GET /dsh-sidebar-panel/api/overview?sessionId=` | request count, cost, runtime, per-model usage |
| `GET /dsh-sidebar-panel/api/files?root=&path=` | one directory level (files + folders), confined to root |
| `POST /dsh-sidebar-panel/api/file-content` | read a file (configurable truncation cap) |
| `GET /dsh-sidebar-panel/api/file-raw?root=&path=` | raw bytes preview (PDF/images, content-type whitelist) |
| `GET /dsh-sidebar-panel/api/balance` | official DeepSeek balance (`user/balance`; key from DSH credentials, never sent to the browser) |
| `POST /dsh-sidebar-panel/api/reveal` | reveal in OS file manager (win32/darwin/linux) |
| `GET /dsh-sidebar-panel/api/changes?sessionId=` | files written by tools this session |

## Configuration (cordis.yml / plugin config)

Add a `config` block to the plugin entry in the DSH composition config (all defaults apply when omitted):

```yaml
- id: dsh-sidebar-panel
  name: dsh-sidebar-panel
  config:
    fileBrowser:
      maxEntries: 500
      maxContentChars: 40000
      includeHidden: false
    reference:
      file: '@<path>'
      folder: '@<path>/'
    changes:
      writeTools: ['write', 'edit', 'str-replace-editor', 'patch', 'run_code']
    pricing:
      enabled: true
      currency: CNY
      offPeakStartHour: 0.5      # Beijing time 00:30 → off-peak starts
      offPeakEndHour: 8.5        # 08:30 → off-peak ends
      offPeakMultiplier: 0.5
      models:
        deepseek-chat: { inputPerM: 2, cacheHitPerM: 0.5, cacheWritePerM: 2, outputPerM: 8 }
        deepseek-reasoner: { inputPerM: 4, cacheHitPerM: 1, cacheWritePerM: 4, outputPerM: 16 }
```

> Cost is an **estimate**: per-request usage × price per million tokens (cache hits at the discounted rate), weighted by the Beijing-time peak/valley window of the request. Models absent from the table fall back to `pricing.defaultModel` (same as deepseek-chat by default). Adjust `pricing.models` to match your actual prices for exact bill matching.

## Development & testing

```sh
pnpm install          # resolves @deepseek-ai/schemastery and @deepseek-ai/dsh-credentials
npm run check         # syntax checks (client + server)
npm test              # unit tests + client smoke
npm run test:unit     # node test/unit.test.mjs
npm run test:smoke    # node test/smoke.client.mjs

# API smoke tests against a live instance (adjust the port; GET sends no Origin
# header — same-origin browser GETs don't; POST smoke tests must carry Origin)
curl "http://127.0.0.1:3080/dsh-sidebar-panel/api/config"
curl -H "Origin: http://127.0.0.1:3080" -H "Content-Type: application/json" -X POST \
  -d '{"root":"<your-workspace>","path":"dsh-sidebar-panel/package.json"}' \
  "http://127.0.0.1:3080/dsh-sidebar-panel/api/file-content"
```

## Known limitations

- **Coexists with the shipped tabs**: the plugin is one tab of the right column, and the built-in **Files / Document preview / Guide** tabs keep working. Because it no longer shadows `rightbar` at `priority: -1`, it also no longer needs the corner dead-button handling, the blank-state grid hack or the `data-details-collapsed` DOM probe.
- **The Tools tab is a self-built detail view**: the built-in right column's "tool details" seat belongs to its own registration and cannot be reused, so tool calls are drawn by this plugin; the Inspect button in chat goes through the built-in column and does not select this plugin's tab.
- **The column's open/closed state belongs to the shipped Sidebar**: whether the column is expanded and which tabs it holds are per-session store state owned by the shipped Sidebar, so each session restores its own tab strip. The plugin no longer writes a `localStorage` open/collapsed preference; it only remembers which of its own four tabs was selected, per session.
- **During the blank (new-session hero) state**: the host hides the whole conversation header, so the top-right toggle hides with it — the same behaviour the shipped tabs have. The tab can still be opened from the column's own guide page.
- **Cost matching**: costs are estimates driven by the pricing table; amounts are transmitted with 6 decimal places and displayed with adaptive precision.
- **Change tracking**: covers write-file-like tool calls only; file changes made inside bash/pwsh cannot be captured reliably.
- **Overview counts**: request count/cost/runtime are folded server-side from the session event log (`request/header`, `assistant/message` usage). Pre-plugin history sessions are back-filled on first access; runtime = time since the first request (includes idle time).
- **Account data**: **balance** comes from the official DeepSeek endpoint (requires `DEEPSEEK_API_KEY` in DSH credentials/env, otherwise a "not configured" hint is shown). The official API exposes no public cumulative-spend/request-count endpoint, so the account card omits those; exact billing is available via the Top Up button at https://platform.deepseek.com/usage.
- **Cross-origin fence**: GET requests are not Origin-checked (same-origin GETs carry no Origin header); POSTs rely on "never answer CORS preflights + JSON-only bodies" (same policy as the DSH host API).

## Feedback & contributing

- Report issues at [Issues](https://github.com/kee0012/dsh-sidebar-panel/issues) with DSH version, profile, repro steps, and logs.
- Pull requests are welcome.

## License

[MIT](./LICENSE) © dsh-sidebar-panel contributors
