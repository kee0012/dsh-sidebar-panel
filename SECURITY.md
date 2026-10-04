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
| `package.json` → `dependencies` | version ranges (`"@deepseek-ai/dsh-credentials": "^0.2.0-rc.2"`), not a secret |
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

- **Loopback-only `Host` gate on every request.** `sameOrigin()` accepts a
  request only when the `Host` header is a loopback name (`127.0.0.1`,
  `localhost`, `::1`), the request is not labelled `Sec-Fetch-Site: cross-site`,
  and — when an `Origin` is present — that origin is loopback too. The previous
  `Origin === Host` comparison was bypassable by **DNS rebinding**, where a
  hostile page's origin and the request's `Host` are the same attacker hostname.
- The server never answers a CORS preflight, so a hostile page cannot drive the
  side-effecting `POST` routes.
- Every filesystem path is resolved inside the session workspace root
  (`resolveInside`); a path that escapes it is rejected with
  `OUTSIDE_WORKSPACE`.
- `/file-content` reads a bounded UTF-8 prefix (`maxContentChars * 3` bytes,
  never the whole file) and never ends on a lone high surrogate, so a huge file
  cannot balloon memory or leak a replacement character.
- `/file-raw` refuses anything above `MAX_RAW_BYTES` (64 MiB) with
  `FILE_TOO_LARGE` and streams what is left instead of buffering it, with a
  strict content-type whitelist (`pdf`, `png`, `jpeg`, `gif`, `webp`) and
  `application/octet-stream` for everything else — a hostile file can never be
  embedded with an executable mime type.
- `/reveal` rejects UNC paths (`\\host\share`, `//host/share`) and relative
  paths with `INVALID_PATH`. A UNC path would make Windows open an SMB session
  to an attacker-controlled host and leak the current user's NTLM hash.
- `/reveal` spawns the platform file manager detached with `stdio: 'ignore'`;
  the path is passed as an argument, never through a shell.

## Reporting

Please open an issue at
<https://github.com/kee0012/dsh-sidebar-panel/issues>.
