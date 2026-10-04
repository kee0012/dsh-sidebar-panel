# dsh-sidebar-panel 插件计划

> 本文件由 DSH 插件开发助手（`dsh-plugin-studio`）的流程规范生成，用于记录本插件在一次
> 「用 skill 优化 + 适配最新版 DSH」迭代中的决策、验证与**有意的规范偏离**。
> 阶段未通过不得进入下一阶段。

## 阶段 ①：需求捕获

- [x] 插件名：`dsh-sidebar-panel`
- [x] 一句话目标：在 DSH 内置右栏中提供一个**页签**（概览 / 文件 / 改动 / 工具），
      让用户在同一块右栏里看上下文与费用、浏览并引用工作区文件、追踪本会话改动的文件、
      查看工具调用明细。
- [x] 能力面清单：
  - Node 半边：`ctx.webServer.register` 注册同源 HTTP API（config / overview / files /
    file-content / file-raw / balance / reveal / changes）
  - Browser 半边：`ctx.sidebarRightTabs.register` 注册页签类型 + 槽位
    `sidebar.right.pane.tab` 注册正文；`conversation.session.header.utilities` 注册头部工具
  - 配置面：`fileBrowser` / `reference` / `changes` / `pricing` 四组（schemastery Schema）
  - 外部依赖面：DeepSeek 官方 `GET https://api.deepseek.com/user/balance`（key 取自
    `ctx.credentials`）
- [x] 目标 profile：web（DSH 桌面版与 `dsh web` 均可）

## 阶段 ②：形态与分发决策

- [x] 形态：`bundle` + `bundle-client`（Node 半边进宿主进程，Browser 半边进客户端 bundle）
- [x] 分发方式：git 源（`github:kee0012/dsh-sidebar-panel`）+ 本地目录（`link:`）两种并存
- [x] 包管理器：pnpm

## 阶段 ③：配方装配

- [x] Node 半边源码：`src/index.js`（导出 `name` / `Config` / `inject` / `apply`，
      `apply` 内注册一律包在 `ctx.effect()` 并返回 disposer）
- [x] Browser 半边源码：`client/client.js`（`window.__ModuleLoader__.load({ id, factory })`，
      React 走 external `require`）
- [x] `inject` 覆盖所有服务（`ctx.webServer` / `ctx.sessions` / `ctx.credentials`）
- [x] 构建产物：`lib/index.js` + `lib/client.js`（`pnpm run bundle`）
- [x] 未手改 `lib/`（`pnpm run gates` 逐字节校验产物 == 源码）

## 阶段 ④：本地验证

- [x] `pnpm install` 通过（`@deepseek-ai/schemastery 3.18.4` + `@deepseek-ai/dsh-credentials 0.2.0-rc.2`）
- [x] `pnpm run bundle` 通过
- [x] `pnpm run gates` 通过（11 道门禁）
- [x] `node test/unit.test.mjs` 通过（服务端行为 + 安全性回归）
- [x] `node test/smoke.client.mjs` 通过（客户端契约冒烟）
- [x] `python <skill>/scripts/verify_plugin.py .` —— **9/11 PASS**；余下 2 项是模板假设与
      既有 JS 项目形态的差异，逐条记在「备注 · 规范偏离」里

## 阶段 ⑤：安装与浏览器冒烟

- [x] 宿主路由冒烟：运行中的 DSH 实例 `GET /dsh-sidebar-panel/api/config` 与
      `/api/balance` 均 200
- [ ] 从副本重新安装并重启后复验（待用户确认采用哪种安装指向）

## 阶段 ⑥：发布

- [ ] git 仓库与 remote 就绪（`origin` = github.com/kee0012/dsh-sidebar-panel）
- [ ] README 使用真实安装 ref
- [x] 构建产物已入库（`lib/` 不被 `.gitignore` 忽略）
- [ ] 从目标 ref 重装验证通过

## 适配最新版 DSH（本次迭代的核心）

目标宿主：**DSH 桌面版 0.2.0-rc.2**（`@deepseek-ai/dsh-desktop-runtime` 0.2.0-rc.2）。
宿主动态提供的包版本（取自 `app.asar`）：

| 包 | 宿主版本 | 插件旧声明 | 本次改为 |
| --- | --- | --- | --- |
| `@deepseek-ai/schemastery` | 3.18.4 | `3.18.2`（精确钉死） | `^3.18.4` |
| `@deepseek-ai/dsh-credentials` | 0.2.0-rc.2 | `0.1.5-rc.1`（精确钉死） | `^0.2.0-rc.2` |

兼容性不是靠"实例同一份包"保证的，已逐条实证：

1. schemastery 的标识是全局符号 `Symbol.for("schemastery")`，且宿主 loader 用鸭子类型判定
   （`cordis-plugin-loader/lib/index.js:251` → `schema?.["~standard"].vendor === "schemastery"`）。
2. Cordis 校验配置时调用的是**插件自己**的 `Config["~standard"].validate`
   （`cordis/lib/index.js:957`），不跨副本比较类。
3. `dsh-brand` 的 `brandString(value)` 是恒等函数（注释明写"independently installed copies
   produce interchangeable values"），所以 `credentialRef('DEEPSEEK_API_KEY')` 跨版本仍返回
   同一个普通字符串。

另核对：`package.json → dsh.client.inject` 的 6 个客户端包在宿主 0.2.0-rc.2 中**全部存在**；
`ctx.sidebarRightTabs.register` / `ctx.slots.register({ name: 'sidebar.right.pane.tab' })` /
`ctx.sidebarRight.*` 导航控制器的签名与宿主的
`@deepseek-ai/dsh-client-ui-sidebar-right` 0.2.0-rc.2 文档一致。

## 备注

### 规范偏离（有意为之，附依据）

1. **`dependencies` 保留 `@deepseek-ai/*`（skill 合同禁止声明）**
   `verify_plugin.py` 会因此报一条 FAIL。保留的理由：
   - 合同的前提是"插件装在 profile 的 `node_modules` 内，向上可解析到 profile 提升的包"。
     本插件在 desktop profile 里是 `link:D:/DSH/.dsh/plugins/dsh-sidebar-panel` 指向
     **workspace 之外**的目录；Node ESM 默认 realpath 后从实体目录向上查找，
     **够不到 profile 的 `node_modules`**，实测 `require.resolve('@deepseek-ai/schemastery')`
     命中的是插件自己 `.pnpm` 里的副本。
   - 宿主官方包装在 `app.asar` 内，插件用 Node 原生解析同样够不到，因此**不能**退化成
     `peerDependencies`（那只会把硬失败从"版本漂移"变成 `MODULE_NOT_FOUND`）。
   - 生态惯例旁证：同 profile 的 `dsh-mnemon*` 系列同样声明
     `@deepseek-ai/schemastery` / `@deepseek-ai/cosmokit`。
   结论：这条合同规则与"link 到工作区外的自包含部署"互斥，本插件选择**可运行性优先**，
   并把版本放宽为 caret 对齐宿主，避免精确钉死带来的漂移。

2. **不引入 TypeScript / esbuild**
   两半都是手写 JavaScript，没有转译需求。`scripts/build.mjs` 是**确定性拷贝 + 生成横幅**，
   让 `lib/` 明确是产物、`src/` 明确是唯一事实源，同时保持零构建工具链依赖。
   `tsconfig.json` 仅供编辑器与 `noEmit` 下的类型提示使用，构建流程不调用 `tsc`。

3. **客户端源码路径保持 `client/client.js`**
   skill 模板建议 `src/client/index.ts`。本插件沿用既有路径以免破坏对外引用与历史提交；
   `lib/client.js` 由构建生成，`exports["./client"]` 指向产物。

4. **源码保持 JavaScript（`.js`），不改名成 TypeScript**
   `verify_plugin.py` 的「必需文件齐备」一项要求 `src/index.ts` 与 `src/client/index.ts`。
   本插件两半都是手写 JavaScript，把文件后缀改成 `.ts` 而不写类型注解只是为通过检查而换壳，
   对运行时零收益，却要连带改 `test/unit.test.mjs` 的导入路径与 `node --check` 的调用方式。
   因此保留 `.js`，另用 `tsconfig.json`（`allowJs: true` + `noEmit: true`）给编辑器提供提示；
   构建不调用 `tsc`，`scripts/build.mjs` 只做确定性拷贝。

   顺带说明两处**已按 skill 要求改掉**的差异（它们曾是 FAIL）：
   - `main` 写成了 svg 校验器要求的 `lib/index.js`（不带 `./` 前缀；Node 两种写法等价）。
   - `scripts/build.mjs` 里显式声明了浏览器半边的 external 白名单
     （`react` / `react/jsx-runtime` / `react-dom` / `react-dom/client` / `@deepseek-ai/*`），
     并在构建时扫描 `client/client.js` 的全部 `require(...)`：出现白名单之外的模块直接失败。
     这条不是形式主义——DSH 客户端只发一份 React，插件若内联自己的副本会导致
     "Invalid hook call"，门禁就是拦这个。

### 决策变更记录

- 初始方向（v0.2.0 时代）：插件**接管**右栏、自己管开合与网格宽度，需要用
  `installBlankSessionController` 之类的 DOM 保活。宿主 0.1.5 起提供官方右栏与
  `ctx.sidebarRightTabs`，插件在 v0.3.0 已改为**与内置页签并存的页签**，不再写网格、
  不再抢 `rightbar` 插槽 —— 本次迭代延续该方向，只做安全/健壮性/版本适配。
- 本次迭代顺带修掉一批静默失败与安全边界问题（详见 `SECURITY.md` 与提交记录），
  这些是代码质量问题，不改变插件对外的路由契约与 UI 结构。

### 验收回合（独立复核 + 收尾修复）

代码改动落地后另起一个**只读复核**子代理逐项核对改动清单，结论是「7 项中 6 项完成，
另有 4 处低危残留」。以下 4 项已全部修掉：

1. `fmtDuration` 硬编码「小时/分/秒」 —— 英文界面会冒出中文。单位改为字典键
   `common.duration.hms` / `common.duration.ms` / `common.duration.s`（zh 与 en 各一套），
   签名改为 `fmtDuration(ms, t)`，占位符替换就地进行（不依赖 locale 助手的插值实现）。
2. `legacyCopy`（非安全上下文的剪贴板回退）会夺走焦点与光标且不还原 —— 进入前记住
   `document.activeElement` 与选区，`finally` 里 `focus()` + `setSelectionRange()`，
   失败不影响复制结果。
3. `POST /reveal` 的失败被空 `catch` 吞掉，菜单项看起来「点了没反应」—— 改为
   `showNotice(errorText(err, …), "error")`，服务端的 `INVALID_PATH` 现在能显示出来。
4. 「改动」页签的 `load()` 缺序号守卫（与文件列表 / 预览 / 概览同型问题）—— 补
   `React.useRef` 序号，过期响应直接丢弃。

复核同时确认：`lib/client.js` 与 `client/client.js` 逐行一致（产物没有错位）；两份源码
无 `TODO` / `FIXME` / `console.log` 残留；括号配平；无「定义未调用」；XSS 面依旧干净
（全目录 0 命中 `innerHTML` / `eval` / `new Function`，一切走 React 文本节点）。

复核列出但**本次有意不改**的项（备案）：`save()` 无 `AbortController`（序号丢弃已足够）、
`FilesTab` 的目录缓存无淘汰（长会话中随访问量增长）、`used` 在两次刷新间可能取到不同
基准（既有行为）。

