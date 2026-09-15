# Security

## Credentials

**This plugin stores no credentials.** It never writes a secret to disk, to a
log, or into any response body.

There is exactly one place where a secret is touched: the optional
`GET /dsh-sidebar-panel/api/balance` route (`src/index.js`, the `/balance`
handler). It resolves the `DEEPSEEK_API_KEY` reference **per request** through
the host's credentials service:

```js
const creds = ctx.get('credentials');
const resolved = await creds.resolve(credentialRef('DEEPSEEK_API_KEY'));
```

The resolved value lives in a local variable for the duration of that request
only. It is placed in a single `Authorization: Bearer …` header sent to the
official endpoint `https://api.deepseek.com/user/balance`, and then goes out of
scope. The browser receives only the balance payload:

```json
{ "ok": true, "balance": { "isAvailable": true, "infos": [ … ] } }
```

The key is never returned to the browser, never included in an error message,
and never logged. When no credential is configured the route answers
`200` with `{ ok: true, balance: null, error: { code: "NO_API_KEY" } }`.

Nothing in this repository contains a real credential, and no credential has
ever been committed. If a scanner flags one, it is a false positive — the only
candidates are:

| Location | What it actually is |
| --- | --- |
| `package.json` → `dependencies` | version ranges (`"@deepseek-ai/dsh-credentials": "0.1.5-rc.1"`), not a secret |
| `src/index.js`, `/balance` handler | `resolvedKey = resolved.value` — an assignment of a runtime value into a local variable |
| `src/index.js`, `/balance` handler | `` `Bearer ${resolvedKey}` `` — string interpolation of that variable |
| `test/unit.test.mjs` | a stub credentials service returning a literal such as `test-key`, used only inside the test process |

## Network surface

All HTTP routes are served under the same-origin prefix
`/dsh-sidebar-panel/api`:

| Route | Method | Notes |
| --- | --- | --- |
| `/config` | GET | static config echo |
| `/overview` | GET | folds the session's own durable event log |
| `/balance` | GET | the one outbound call (official DeepSeek endpoint) |
| `/files` | GET | one directory level, confined to the session workspace root |
| `/file-content` | POST | size-capped text read, confined to the workspace root |
| `/file-raw` | GET | raw bytes with a strict content-type whitelist (never `text/html`) |
| `/reveal` | POST | opens the OS file manager at a path |
| `/changes` | GET | folds the session's own durable event log |

Fences:

- Same-origin check on every request; the server never answers a CORS
  preflight, so a hostile page cannot drive the side-effecting `POST` routes.
- Every filesystem path is resolved inside the session workspace root
  (`resolveInside`); a path that escapes it is rejected with
  `OUTSIDE_WORKSPACE`.
- `/file-raw` serves a strict content-type whitelist (`pdf`, `png`, `jpeg`,
  `gif`, `webp`) and falls back to `application/octet-stream` for everything
  else, so a hostile file can never be embedded with an executable mime type.
- `/reveal` spawns the platform file manager detached with `stdio: 'ignore'`;
  the path is passed as an argument, never through a shell.

## Reporting

Please open an issue at
<https://github.com/kee0012/dsh-sidebar-panel/issues>.
