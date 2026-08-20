# dsh-sidebar-panel

A **right-side panel plugin** for DSH (DeepSeek Harness, Web profile). It adds a panel toggle button at the **top-right of the session header** (styled like the built-in left fold button) that expands/collapses the right `details` column. The panel **auto-opens after a DSH restart** (persisted preference, open by default). It has four tabs:

- **Overview**: a **DeepSeek account** card at the top — official balance (fetched live from `GET https://api.deepseek.com/user/balance`, refreshed every 15 s) and a **Top Up** button (https://platform.deepseek.com/usage). Below it: context window (used/total/percent/distance-to-compaction), current turn's context budget (prompt/output budget, physical headroom, output-cap source), session metrics (hit rate / **session cost** / runtime / request count / total tokens), and usage analysis (by source / by type, with input-output and cache hit-miss breakdown). Server-side data refreshes every 5 s ("updated at HH:MM:SS" in the corner); projected data (tokens/context) reacts in real time.
- **Files**: a file tree of the current session's workspace. **Click a file to preview** (md/txt/code inline; PDF and images embedded; truncation notice for large files). **Right-click menu**: reveal in file manager, add file reference / add file content (file), add folder reference (folder), copy absolute path / copy relative path. Inserted content is written into the chat input box.
- **Changes**: files touched by write-like tools (write/edit/str-replace-editor, …) in the current session.
- **Tools**: the tool calls in the current window with argument/result details (self-built view).

> **Compatibility**: Web profile only. Custom same-origin HTTP routes are not available in the desktop (Electron) build.

## Layout

```
dsh-sidebar-panel/
├── package.json          # DSH bundle manifest + client injection declaration
├── cordis.patch.yml      # inserts the plugin into the DSH composition layer
├── src/index.js          # server: same-origin HTTP API + session-event folding (usage/cost/changes) + file browsing + reveal
├── client/client.js      # browser: top-right toggle + details-column panel (auto-open) + four tabs + context menu
├── test/unit.test.mjs    # server unit tests (mocked ctx, no DSH instance, no machine-specific paths)
└── README.md / README_EN.md
```

> **Dependencies**: the server depends on `@deepseek-ai/schemastery` (config schema) and `@deepseek-ai/dsh-credentials` (resolves the `DEEPSEEK_API_KEY` credential); both are provided by the DSH runtime. `pnpm pack` output does not include `node_modules`; when developing from source, run `pnpm install` in the plugin directory to resolve dependencies.

## Install

Run in a terminal where DSH runs (Web profile):

```sh
# Option 1: from npm (published to the registry)
dsh plugin --profile web add dsh-sidebar-panel

# Option 2: from GitHub (if not yet published to npm)
dsh plugin --profile web add github:kee0012/dsh-sidebar-panel
```

Restart DSH and hard-refresh the browser (Ctrl+Shift+R). Verify the config layer picked it up:

```sh
dsh --profile web --dump-config | grep dsh-sidebar-panel
```

> **Local development**: code changes require a DSH restart. Install straight from the source directory (`dsh plugin --profile web add /path/to/dsh-sidebar-panel`) or from a packed tarball (`pnpm pack`, then `dsh plugin --profile web add ./dsh-sidebar-panel-0.1.0.tgz`).

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
# Syntax checks
node --check src/index.js && node --check client/client.js

# Server unit tests (mocked ctx: routes / same-origin / file tree / path-escape lock /
# overview folding / peak-valley pricing / change tracking)
node test/unit.test.mjs

# API smoke tests (GET sends no Origin header — same-origin browser GETs don't;
# POST smoke tests must carry an Origin header)
curl "http://127.0.0.1:3080/dsh-sidebar-panel/api/config"
curl -H "Origin: http://127.0.0.1:3080" -H "Content-Type: application/json" -X POST \
  -d '{"root":"<your-workspace>","path":"dsh-sidebar-panel/package.json"}' \
  "http://127.0.0.1:3080/dsh-sidebar-panel/api/file-content"
```

## Known limitations

- **Details-column replacement**: the plugin shadows the built-in DetailsPanel at `priority: -1` (a single slot allows one renderer). The built-in "tool details" seat (`conversation.details.tool`) is claimed by its own registration and cannot be reused, so the **Tools** tab renders a self-built detail view; the Inspect button in chat still opens the right column but does not auto-select a tool.
- **Auto-open preference**: panel open/collapsed state is stored in browser localStorage (`dsh-sidebar-panel:details-open`), default `open` — it auto-expands after a DSH restart; collapsing once records `closed` and stays collapsed on next launch. DSH itself collapses the details column when switching sessions (framework behavior).
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
