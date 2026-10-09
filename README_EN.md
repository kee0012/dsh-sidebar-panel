# dsh-sidebar-panel

A **right-column tab plugin** for DSH (DeepSeek Harness). It registers a page type and its body through the shipped right column's tab registry (`ctx.sidebarRightTabs`), so it sits **beside** the built-in **Files / Document preview / Guide** tabs — it never takes the column over, never replaces a shipped tab and never writes a grid or width rule. A toggle at the **top-right of the session header** (styled like the built-in left fold button) opens or focuses the tab, and collapses the column when the plugin's tab is already in front.

> **Requirements**: DSH **0.2.0+** with the **Web profile** (verified on desktop **0.2.0-rc.2**). A desktop shell that boots this same web profile works too — the routes are served exactly as in a browser; a shell without the web server does not.

The panel itself has four tabs:

- **Overview**
  - a **DeepSeek account** card — official balance (fetched live from `GET https://api.deepseek.com/user/balance`, refreshed every 15 s), **used today** (estimated from token usage since Beijing midnight, totalled by a background scan of this machine's session logs; **DeepSeek-served models only**) and a **peak/valley indicator** (official schedule: weekdays 09:00–12:00 and 14:00–18:00 Beijing time are peak; nights, weekends and statutory holidays are valley — peak in red, valley in green, with a countdown to the next switch), plus a **Top Up** button (https://platform.deepseek.com/usage). Switching to the Overview tab paints immediately (the previous answer is restored, then refreshed in the background); while the server's first scan is still running the amount reads "Counting…" and fills in on its own.
  - context window (used/total/percent/distance-to-compaction), current turn's context budget (prompt/output budget, physical headroom, output-cap source), session metrics (hit rate / **session cost** / runtime / request count / total tokens), and usage analysis (by source / by type, with input-output and cache hit-miss breakdown). Server-side data refreshes every 5 s ("updated at HH:MM:SS" in the corner); projected data (tokens/context) reacts in real time.
- **Files**: a file tree of the current session's workspace. Files and folders carry per-type icons (colored letter chips plus inline SVG outlines — images, archives, fonts, lockfiles, configs and scripts each have their own shape; extensions outside the table fall back to a neutral chip), drawn entirely with CSS and inline SVG: no icon font, no image assets. **Click a file to preview** (md/txt/code inline; PDF, images and SVG embedded, with an Image/Source toggle on SVG; truncation notice for large files). **Right-click menu**: reveal in file manager, add file reference / add file content (file), add folder reference (folder), copy absolute path / copy relative path. Inserted content is written into the chat input box.
- **Changes**: files touched by write-like tools (write/edit/str-replace-editor, …) in the current session; **one row per file**, repeated edits collapse into `×N`, newest first.
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
      peakWindows: [[9, 12], [14, 18]]   # Beijing-time peak windows (official)
      peakMultiplier: 2                  # peak price = valley price × 2 (official)
      models:                            # anything unlisted falls back to the official table
        deepseek-v4-pro: { inputPerM: 4.5, cacheHitPerM: 0.15, cacheWritePerM: 4.5, outputPerM: 13.5 }
      defaultModel: { inputPerM: 1, cacheHitPerM: 0.02, cacheWritePerM: 1, outputPerM: 4 }
    usage:                               # background scan of the local session logs
      intervalMs: 30000                  # rescan cadence; a request never waits on one
      warmupDelayMs: 3000                # delay before the first scan after start-up
      maxLogBytes: 134217728             # per-log decode cap (larger logs count as skipped)
      sessionsRoot: ''                   # empty = <DSH_HOME>/sessions, follows the data root
```

> `models` entries are **valley** prices (CNY per million tokens); peak windows scale them by `peakMultiplier`. Leave it empty to use the built-in official table (`deepseek-v4-pro` / `deepseek-v4-flash` / `deepseek-flash`, prefix-matched, so ids like `deepseek-v4-pro-2026` resolve too). Peak/valley is decided in **Beijing time**: weekdays 09:00–12:00 and 14:00–18:00 are peak; every other hour, weekends, and the 2026 statutory holidays (New Year / Spring Festival / Qingming / Labour Day / Dragon Boat / Mid-Autumn / National Day) are valley all day.

> `usage` drives the **used today** scanner: one scan `warmupDelayMs` after start-up, then every `intervalMs`, with the result held in a memory snapshot. `GET /usage-today` only reads that snapshot and **never waits** for a scan — a cold snapshot answers `warming: true`, the card shows "Counting…" and re-asks 1.2 s later. The scanner reads the session logs directly (`<sessionsRoot>/<project>/<session id>/session.v4.jsonl.zstd`), fully decoupled from the host's session store — which is what lets it answer in a few hundred milliseconds.

> Cost is an **estimate**: per-request usage × price per million tokens (cache hits at the discounted rate), weighted by the Beijing-time peak/valley state of the request. Models absent from the table fall back to `pricing.defaultModel`. Adjust `pricing.models` to match your actual prices for exact bill matching.

## Server API (same-origin, consumed by the browser panel)

| Route | Description |
|---|---|
| `GET /dsh-sidebar-panel/api/config` | reference templates / content caps / pricing toggle |
| `GET /dsh-sidebar-panel/api/overview?sessionId=` | request count, cost, runtime, per-model usage |
| `GET /dsh-sidebar-panel/api/files?root=&path=` | one directory level (files + folders), confined to root |
| `POST /dsh-sidebar-panel/api/file-content` | read a file (configurable truncation cap) |
| `GET /dsh-sidebar-panel/api/file-raw?root=&path=` | raw bytes preview (PDF/images/SVG, content-type whitelist; SVG also carries `nosniff` + a sandbox CSP) |
| `GET /dsh-sidebar-panel/api/balance` | official DeepSeek balance (`user/balance`; key from DSH credentials, never sent to the browser) |
| `GET /dsh-sidebar-panel/api/usage-today` | used today (read from the warm snapshot, never blocking) + official peak/valley state and next switch |
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
├── scripts/gates/run.mjs    # gates: artifact freshness / entry points / name consistency / React external / deps + display metadata
├── locale/en.json           # display metadata: the Plugin Manager reads it even when the plugin is not activated (en.json required, zh.json is the translation)
├── icon.svg                 # display metadata: the plugin icon (original artwork, exported as "./icon")
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

> **Dependencies**: every `@deepseek-ai/*` package is a *shared instance* of the running host, so it belongs in `peerDependencies` + `devDependencies` only (`dependencies` stays empty) — a profile-local copy would silently shadow the runtime version. The peer ranges follow the official contract and cover every prerelease tuple (see `package.json`).
> **Display metadata**: `icon.svg` plus `locale/en.json` (`meta.title` / `meta.description`) are a hard delivery requirement of the Plugin Manager, which reads them even while the plugin is inactive; `pnpm run gates` checks them too.

## Known limitations

- **Coexists with the shipped tabs**: the plugin is one tab of the right column, and the built-in **Files / Document preview / Guide** tabs keep working; it does not take the column over or rewrite any grid or width rule.
- **The Tools tab is a self-built detail view**: the built-in right column's "tool details" seat belongs to its own registration and cannot be reused, so tool calls are drawn by this plugin; the Inspect button in chat goes through the built-in column and does not select this plugin's tab.
- **The column's open/closed state belongs to the shipped Sidebar**: whether the column is expanded and which tabs it holds are per-session store state owned by the shipped Sidebar, so each session restores its own tab strip; the plugin only remembers which of its own four tabs was selected, per session.
- **During the blank (new-session hero) state**: the host hides the whole conversation header, so the top-right toggle hides with it — the same behaviour the shipped tabs have. The tab can still be opened from the column's own guide page.
- **Cost matching**: costs are estimates driven by the pricing table; amounts are transmitted with 6 decimal places and displayed with adaptive precision.
- **Change tracking**: covers write-file-like tool calls only, and the **tool name gates it** — `read`/`grep`/`glob` take the same `file_path`/`path` arguments, so matching on argument names alone would file "looked at" as "changed". File changes made inside bash/pwsh cannot be captured reliably. The log stores tool arguments as a JSON **string**; an unparsable payload (a truncated log) is skipped without dropping the rest.
- **Overview counts**: request count/cost/runtime are folded server-side from the session event log (`request/header`, `assistant/message` usage). Pre-plugin history sessions are back-filled on first access; runtime = time since the first request (includes idle time).
- **Account data**: **balance** comes from the official DeepSeek endpoint (requires `DEEPSEEK_API_KEY` in DSH credentials/env, otherwise a "not configured" hint is shown). The official API exposes no public cumulative-spend/request-count endpoint, so the account card omits those; exact billing is available via the Top Up button at https://platform.deepseek.com/usage.
- **"Used today" is an estimate**: the official API has no per-day spend endpoint, so the plugin totals it itself — a background scan folds each `assistant/message` usage since Beijing midnight out of the local session logs and prices it with the official table × the peak/valley multiplier. It reads only logs modified today and only the **newest generation** per session (`session.v4` over an older `session.v2`). Because the card describes the **DeepSeek account**, requests served by **any other provider are skipped entirely** — neither priced nor counted — since pricing them would invent a charge the account never received. That is a token-based figure and can differ from a balance-delta observation or the final invoice. Scanning happens off the request path (at start-up and every 30 s), so the card always answers instantly; if the log directory is missing the row shows `¥0.00` with the reason in its tooltip, and the balance is unaffected.
- **Cross-origin fence**: every request requires `Host` to be a loopback name (`127.0.0.1` / `localhost` / `::1`) and rejects `Sec-Fetch-Site: cross-site` outright; a present `Origin` must be loopback too, which closes the **DNS rebinding** hole. Same-origin GETs carry no `Origin` header and are still let through; POSTs additionally rely on "never answer CORS preflights + JSON-only bodies" (same policy as the DSH host API).

## Feedback & contributing

- Report issues at [Issues](https://github.com/kee0012/dsh-sidebar-panel/issues) with DSH version, profile, repro steps, and logs.
- Pull requests are welcome.

## License

[MIT](./LICENSE) © dsh-sidebar-panel contributors
