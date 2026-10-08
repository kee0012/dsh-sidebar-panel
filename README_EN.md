# dsh-sidebar-panel

A **right-column tab plugin** for DSH (DeepSeek Harness). It registers a page type and its body through the shipped right column's tab registry (`ctx.sidebarRightTabs`), so it sits **beside** the built-in **Files / Document preview / Guide** tabs — it never takes the column over, never replaces a shipped tab and never writes a grid or width rule. A toggle at the **top-right of the session header** (styled like the built-in left fold button) opens or focuses the tab, and collapses the column when the plugin's tab is already in front.

> **Requirements**: DSH **0.2.0+** with the **Web profile** (verified on desktop **0.2.0-rc.2**). A desktop shell that boots this same web profile works too — the routes are served exactly as in a browser; a shell without the web server does not.

The panel itself has four tabs:

- **Overview**
  - a **DeepSeek account** card — official balance (fetched live from `GET https://api.deepseek.com/user/balance`, refreshed every 15 s) and a **Top Up** button (https://platform.deepseek.com/usage).
  - context window (used/total/percent/distance-to-compaction), current turn's context budget (prompt/output budget, physical headroom, output-cap source), session metrics (hit rate / **session cost** / runtime / request count / total tokens), and usage analysis (by source / by type, with input-output and cache hit-miss breakdown). Server-side data refreshes every 5 s ("updated at HH:MM:SS" in the corner); projected data (tokens/context) reacts in real time.
- **Files**: a file tree of the current session's workspace. **Click a file to preview** (md/txt/code inline; PDF and images embedded; truncation notice for large files). **Right-click menu**: reveal in file manager, add file reference / add file content (file), add folder reference (folder), copy absolute path / copy relative path. Inserted content is written into the chat input box.
- **Changes**: files touched by write-like tools (write/edit/str-replace-editor, …) in the current session.
- **Tools**: the tool calls in the current window with argument/result details (self-built view).

## Install

The plugin is hosted on GitHub (`kee0012/dsh-sidebar-panel`, not published to npm), and DSH can install it directly as a git dependency:

```sh
# Install from GitHub (recommended for everyday use; tracks the latest commit on the default branch)
dsh plugin --profile desktop add github:kee0012/dsh-sidebar-panel
```

> DSH must be **restarted** after installation so the new server code and client bundle take effect.

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

## Layout

```
dsh-sidebar-panel/
├── package.json             # DSH bundle manifest + client injection declaration + build / gate / test scripts
├── cordis.patch.yml         # inserts the plugin into the DSH composition layer
├── src/index.js             # server source: same-origin HTTP API + incremental session-event folding (usage/cost/changes) + file browsing + reveal
├── client/client.js         # client source: right-column tab (type + body) + header toggle + four tabs + context menu
├── lib/                     # build output: lib/index.js + lib/client.js (generated from src/ and client/ — do not hand-edit)
├── scripts/build.mjs        # build: deterministic copy + banner generation (zero build-toolchain dependencies)
├── scripts/gates/run.mjs    # gates: artifact freshness / entry points / name consistency / React external / dependency alignment
├── test/unit.test.mjs       # server unit tests (mocked ctx, no DSH instance)
├── test/smoke.client.mjs    # client smoke: stub runtime asserting registration shape / navigation / chat slice
├── tsconfig.json            # editor / type hints only (noEmit; the build never calls tsc)
├── SECURITY.md              # credential and network-surface notes
└── README.md / README_EN.md
```

## Development & testing

```sh
pnpm install          # install dependencies
pnpm run bundle       # generates lib/index.js + lib/client.js (committed artifacts; always rerun after source changes)
pnpm run gates        # structural gates: artifact freshness / entry points / name consistency / React external / dependency alignment
pnpm run check        # syntax checks (client + server)
pnpm test             # unit tests + client smoke
pnpm run verify       # bundle + gates + both test suites (the whole chain in one command)
pnpm run test:unit    # node test/unit.test.mjs
pnpm run test:smoke   # node test/smoke.client.mjs

# API smoke tests against a live instance (<port> is your instance's port; GET sends no
# Origin header — same-origin browser GETs don't; POST smoke tests must carry Origin)
curl "http://127.0.0.1:<port>/dsh-sidebar-panel/api/config"
curl -H "Origin: http://127.0.0.1:<port>" -H "Content-Type: application/json" -X POST \
  -d '{"root":"<your-workspace>","path":"dsh-sidebar-panel/package.json"}' \
  "http://127.0.0.1:<port>/dsh-sidebar-panel/api/file-content"
```

> Source changes always go into `src/` and `client/`, and then `pnpm run bundle`. `lib/` is build output; `pnpm run gates` byte-compares it against the sources, so hand-editing `lib/` fails outright.

## Known limitations

- **Coexists with the shipped tabs**: the plugin is one tab of the right column, and the built-in **Files / Document preview / Guide** tabs keep working; it does not take the column over or rewrite any grid or width rule.
- **The Tools tab is a self-built detail view**: the built-in right column's "tool details" seat belongs to its own registration and cannot be reused, so tool calls are drawn by this plugin; the Inspect button in chat goes through the built-in column and does not select this plugin's tab.
- **The column's open/closed state belongs to the shipped Sidebar**: whether the column is expanded and which tabs it holds are per-session store state owned by the shipped Sidebar, so each session restores its own tab strip; the plugin only remembers which of its own four tabs was selected, per session.
- **During the blank (new-session hero) state**: the host hides the whole conversation header, so the top-right toggle hides with it — the same behaviour the shipped tabs have. The tab can still be opened from the column's own guide page.
- **Cost matching**: costs are estimates driven by the pricing table; amounts are transmitted with 6 decimal places and displayed with adaptive precision.
- **Change tracking**: covers write-file-like tool calls only; file changes made inside bash/pwsh cannot be captured reliably.
- **Overview counts**: request count/cost/runtime are folded server-side from the session event log (`request/header`, `assistant/message` usage). Pre-plugin history sessions are back-filled on first access; runtime = time since the first request (includes idle time).
- **Account data**: **balance** comes from the official DeepSeek endpoint (requires `DEEPSEEK_API_KEY` in DSH credentials/env, otherwise a "not configured" hint is shown). The official API exposes no public cumulative-spend/request-count endpoint, so the account card omits those; exact billing is available via the Top Up button at https://platform.deepseek.com/usage.
- **Cross-origin fence**: every request requires `Host` to be a loopback name (`127.0.0.1` / `localhost` / `::1`) and rejects `Sec-Fetch-Site: cross-site` outright; a present `Origin` must be loopback too, which closes the **DNS rebinding** hole. Same-origin GETs carry no `Origin` header and are still let through; POSTs additionally rely on "never answer CORS preflights + JSON-only bodies" (same policy as the DSH host API).

## Feedback & contributing

- Report issues at [Issues](https://github.com/kee0012/dsh-sidebar-panel/issues) with DSH version, profile, repro steps, and logs.
- Pull requests are welcome.

## License

[MIT](./LICENSE) © dsh-sidebar-panel contributors
