#!/usr/bin/env node
/**
 * dsh-sidebar-panel — build.
 *
 * Emits the distributable artifacts under `lib/` from the hand-written sources
 * (`src/index.js` for the Node half, `client/client.js` for the browser half).
 *
 * Both halves are plain JavaScript with no transpilation step, so "build" is a
 * deterministic copy plus a generated-file banner. That is deliberate: the repo
 * stays build-toolchain-free while still honouring the DSH plugin contract
 * (`main: lib/index.js`, `exports["./client"]: lib/client.js`) so that `lib/`
 * is unambiguously an artifact and `src/` unambiguously the source of truth.
 *
 *   node scripts/build.mjs
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TARGETS = [
  { from: 'src/index.js', to: 'lib/index.js' },
  { from: 'client/client.js', to: 'lib/client.js' },
];

/** Marker line the gates script uses to strip the banner again. */
export const BANNER_HEAD = '/* AUTO-GENERATED FILE — DO NOT EDIT.';

/**
 * Modules the browser half may pull in through the module loader — i.e. every
 * `require(...)` id inside the `window.__ModuleLoader__.load({ factory })`
 * wrapper must resolve to one of these. The build fails otherwise.
 *
 * This matters because React has to stay external: the DSH client ships one
 * React instance through the module loader, and a plugin that inlines its own
 * copy produces a second instance, which breaks hooks at runtime
 * ("Invalid hook call" / `useState` of null). `react`, `react/jsx-runtime`,
 * `react-dom` and `react-dom/client` are therefore allowed and expected, while
 * `@deepseek-ai/*` packages are supplied by the host at runtime.
 */
const CLIENT_EXTERNALS = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
]);

const CLIENT_EXTERNAL_PREFIXES = ['@deepseek-ai/'];

const REQUIRE_RE = /require\(\s*["']([^"']+)["']\s*\)/g;

/** Every module id the browser half requires, checked against the allow-list. */
function assertClientExternals(source) {
  const required = new Set();
  for (const match of source.matchAll(REQUIRE_RE)) required.add(match[1]);

  const rejected = [...required].filter(
    (id) => !CLIENT_EXTERNALS.has(id) && !CLIENT_EXTERNAL_PREFIXES.some((prefix) => id.startsWith(prefix)),
  );
  if (rejected.length > 0) {
    throw new Error(
      `client half requires non-external module(s): ${rejected.join(', ')} — ` +
        'React must stay external and only @deepseek-ai/* plus React may be required',
    );
  }
  console.log(`  externals checked — ${[...required].sort().join(', ') || '(none)'}`);
}

function banner(from) {
  return `${BANNER_HEAD}
 * Source:   ${from}
 * Rebuild:  pnpm run bundle
 * Gates:    pnpm run gates
 */
`;
}

/** Normalise CRLF so artifacts are byte-stable across platforms. */
function normalise(text) {
  return text.replace(/\r\n/g, '\n');
}

async function main() {
  for (const { from, to } of TARGETS) {
    const source = normalise(await readFile(path.join(ROOT, from), 'utf8'));
    if (from.startsWith('client/')) assertClientExternals(source);
    const target = path.join(ROOT, to);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, banner(from) + source, 'utf8');
    const bytes = Buffer.byteLength(source, 'utf8');
    console.log(`  built ${to}  <-  ${from}  (${bytes} B source)`);
  }
  console.log('\nbuild OK — lib/index.js + lib/client.js are up to date.');
}

main().catch((error) => {
  console.error('build FAILED:', error?.message ?? error);
  process.exitCode = 1;
});
