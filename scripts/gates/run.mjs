#!/usr/bin/env node
/**
 * dsh-sidebar-panel — gates.
 *
 * Zero-dependency structural checks that must pass before anything is packed or
 * installed. Complements `python <dsh-plugin-studio>/scripts/verify_plugin.py .`
 * (the same DSH plugin contract, checked from the outside) and the unit / smoke
 * tests (which check behaviour).
 *
 *   node scripts/gates/run.mjs
 *
 * Exit code 0 = every gate passed.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BANNER_HEAD = '/* AUTO-GENERATED FILE — DO NOT EDIT.';

const NODE_ARTIFACT = 'lib/index.js';
const CLIENT_ARTIFACT = 'lib/client.js';

/* ---------------------------------------------------------------- inputs */

const normalise = (text) => text.replace(/\r\n/g, '\n');

async function readSource(relative) {
  return normalise(await readFile(path.join(ROOT, relative), 'utf8'));
}

async function readArtifact(relative) {
  try {
    return normalise(await readFile(path.join(ROOT, relative), 'utf8'));
  } catch {
    return null;
  }
}

/** Strip the generated banner so an artifact can be compared with its source. */
function stripBanner(text) {
  if (text === null || !text.startsWith(BANNER_HEAD)) return null;
  const end = text.indexOf('*/\n');
  return end === -1 ? null : text.slice(end + 3);
}

const pkg = JSON.parse(await readSource('package.json'));
const patch = await readSource('cordis.patch.yml');
const localeEn = JSON.parse(await readSource('locale/en.json'));
const sources = {
  'src/index.js': await readSource('src/index.js'),
  'client/client.js': await readSource('client/client.js'),
};
const artifacts = {
  [NODE_ARTIFACT]: await readArtifact(NODE_ARTIFACT),
  [CLIENT_ARTIFACT]: await readArtifact(CLIENT_ARTIFACT),
};
const clientBodies = stripBanner(artifacts[CLIENT_ARTIFACT]);
const loaderId =
  clientBodies?.match(/__ModuleLoader__\s*\.\s*load\(\s*\{\s*id\s*:\s*["']([^"']+)["']/)?.[1] ?? null;

/* ----------------------------------------------------------------- gates */

const GATES = [
  [
    '产物存在：lib/index.js + lib/client.js',
    () => {
      const missing = [NODE_ARTIFACT, CLIENT_ARTIFACT].filter((f) => artifacts[f] === null);
      if (missing.length) throw new Error(`缺少 ${missing.join(', ')}，请先跑 pnpm run bundle`);
      return 'both present';
    },
  ],
  [
    '产物与源码一致（无人手改 lib/）',
    () => {
      return [
        ['src/index.js', NODE_ARTIFACT],
        ['client/client.js', CLIENT_ARTIFACT],
      ]
        .map(([source, artifact]) => {
          const body = stripBanner(artifacts[artifact]);
          if (body === null) throw new Error(`${artifact} 缺少生成横幅，疑似被手改`);
          if (body !== sources[source]) throw new Error(`${artifact} 与 ${source} 不一致，请重跑 pnpm run bundle`);
          return `${artifact} = ${source}`;
        })
        .join('; ');
    },
  ],
  [
    '入口点：main / exports 指向 lib/',
    () => {
      const expect = [
        [pkg.main, 'lib/index.js', 'main'],
        [pkg.exports?.['.'], './lib/index.js', 'exports["."]'],
        [pkg.exports?.['./client'], './lib/client.js', 'exports["./client"]'],
        [pkg.exports?.['./cordis.patch.yml'], './cordis.patch.yml', 'exports["./cordis.patch.yml"]'],
        [pkg.exports?.['./package.json'], './package.json', 'exports["./package.json"]'],
      ];
      const bad = expect.filter(([actual, want]) => actual !== want);
      if (bad.length) throw new Error(bad.map(([a, w, k]) => `${k}: ${a} != ${w}`).join('; '));
      return 'all entry points ok';
    },
  ],
  [
    'bundle 合同：dsh.bundle.patch = ./cordis.patch.yml',
    () => {
      if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('dsh.bundle.patch 应为 ./cordis.patch.yml');
      if (!/-\s*insert:/.test(patch)) throw new Error('cordis.patch.yml 缺少 insert 段');
      return 'patch declared + insert present';
    },
  ],
  [
    'client 合同：platform web + inject 非空',
    () => {
      if (pkg.dsh?.client?.platform !== 'web') throw new Error('dsh.client.platform 应为 web');
      const inject = pkg.dsh?.client?.inject;
      if (!Array.isArray(inject) || inject.length === 0) throw new Error('dsh.client.inject 不能为空');
      return `platform web, ${inject.length} injected packages`;
    },
  ],
  [
    '名称一致性：package / patch id / patch name / ModuleLoader id',
    () => {
      const id = patch.match(/^\s*-\s*id:\s*(\S+)\s*$/m)?.[1];
      const patchName = patch.match(/^\s*name:\s*(\S+)\s*$/m)?.[1];
      const bad = [];
      if (id !== pkg.name) bad.push(`patch id "${id}" != "${pkg.name}"`);
      if (patchName !== pkg.name) bad.push(`patch name "${patchName}" != "${pkg.name}"`);
      if (loaderId !== pkg.name) bad.push(`ModuleLoader id "${loaderId}" != "${pkg.name}"`);
      if (bad.length) throw new Error(bad.join('; '));
      return `${pkg.name} everywhere`;
    },
  ],
  [
    'client 形态：window.__ModuleLoader__.load({ id, factory })',
    () => {
      if (clientBodies === null) throw new Error('无法读取 client 产物正文');
      if (!/window\.__ModuleLoader__\.load\(\s*\{/.test(clientBodies)) {
        throw new Error('缺少 window.__ModuleLoader__.load({ ... }) 包裹');
      }
      if (loaderId === null) throw new Error('无法解析 ModuleLoader id');
      return `id = ${loaderId}`;
    },
  ],
  [
    'client 保持 React external（未内联 React）',
    () => {
      if (clientBodies === null) throw new Error('无法读取 client 产物正文');
      if (!/require\(\s*["']react["']\s*\)/.test(clientBodies)) {
        throw new Error('未发现 require("react")，React 可能被内联');
      }
      if (/__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED/.test(clientBodies)) {
        throw new Error('疑似内联 React 实现（发现 React 内部标记）');
      }
      return 'react resolved through the module loader';
    },
  ],
  [
    'files 字段：包含分发所需条目',
    () => {
      if (!Array.isArray(pkg.files)) throw new Error('package.json 缺少 files 字段');
      const required = ['lib', 'cordis.patch.yml', 'README.md', 'locale/*.json', 'icon.svg'];
      const missing = required.filter((f) => !pkg.files.includes(f));
      if (missing.length) throw new Error(`files 缺少: ${missing.join(', ')}`);
      return pkg.files.join(', ');
    },
  ],
  [
    '共享实例包只放 peer + dev（绝不进 dependencies）',
    () => {
      const deps = Object.keys(pkg.dependencies ?? {});
      if (deps.length) {
        throw new Error(`dependencies 必须为空（profile 内副本会静默遮蔽宿主运行时版本）: ${deps.join(', ')}`);
      }
      return 'no runtime dependencies';
    },
  ],
  [
    'peer / dev 依赖与宿主契约对齐（schemastery ^3.18.2 + dsh-credentials 全 prerelease 区间）',
    () => {
      const DSH_PEER_RANGE =
        '>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0 || >=0.1.6-0 <0.2.0 || >=0.1.7-0 <0.2.0 || >=0.2.0-0 <0.3.0 || >=0.2.1-0 <0.3.0';
      const peers = pkg.peerDependencies ?? {};
      const dev = pkg.devDependencies ?? {};
      if (peers['@deepseek-ai/schemastery'] !== '^3.18.2') {
        throw new Error(`schemastery peer 应为 ^3.18.2，实际 ${peers['@deepseek-ai/schemastery']}`);
      }
      if (peers['@deepseek-ai/dsh-credentials'] !== DSH_PEER_RANGE) {
        throw new Error(`dsh-credentials peer 范围与官方契约不一致，实际 ${peers['@deepseek-ai/dsh-credentials']}`);
      }
      for (const name of Object.keys(peers)) {
        if (!dev[name]) throw new Error(`devDependencies 缺少 ${name}：本 checkout 将无法本地解析`);
      }
      return `${Object.keys(peers).join(', ')}（peer = dev）`;
    },
  ],
  [
    '宿主版本与包管理器固定（engines.node 覆盖 22 + 24，packageManager = pnpm@11.7.0）',
    () => {
      const node = pkg.engines?.node;
      if (typeof node !== 'string' || !/\b22\b/.test(node) || !/\b24\b/.test(node)) {
        throw new Error(`engines.node 必须同时允许 Node 22 与 24，实际 ${node}`);
      }
      if (pkg.packageManager !== 'pnpm@11.7.0') {
        throw new Error(`packageManager 应为 pnpm@11.7.0，实际 ${pkg.packageManager}`);
      }
      return `${node}; ${pkg.packageManager}`;
    },
  ],
  [
    '展示元数据：locale meta + 导出图标（Plugin Manager 不激活插件也要读）',
    () => {
      if (pkg.exports?.['./locale/*.json'] !== './locale/*.json') throw new Error('exports 缺少 "./locale/*.json"');
      if (typeof pkg.exports?.['./icon'] !== 'string') throw new Error('exports 缺少 "./icon"');
      if (typeof pkg.icon !== 'string' || pkg.icon === '') throw new Error('package.json 顶层 icon 缺失');
      if (pkg.dsh?.manifestVersion !== 1) throw new Error(`dsh.manifestVersion 应为 1，实际 ${pkg.dsh?.manifestVersion}`);
      const title = localeEn?.meta?.title;
      const description = localeEn?.meta?.description;
      if (typeof title !== 'string' || title.trim() === '') throw new Error('locale/en.json 缺少 meta.title');
      if (typeof description !== 'string' || description.trim() === '') throw new Error('locale/en.json 缺少 meta.description');
      return `${title} — ${description}`;
    },
  ],
];

/* ---------------------------------------------------------------- report */

let failed = 0;
for (const [name, fn] of GATES) {
  try {
    const detail = fn();
    console.log(`  [PASS] ${name} — ${detail}`);
  } catch (error) {
    failed += 1;
    console.log(`  [FAIL] ${name} — ${error?.message ?? error}`);
  }
}
console.log(`\n[gates] ${failed === 0 ? 'PASSED' : `FAILED: ${failed}/${GATES.length} 未通过`}`);
if (failed > 0) process.exitCode = 1;
