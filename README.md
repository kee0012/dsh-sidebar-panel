<img width="3084" height="1670" alt="image" src="https://github.com/user-attachments/assets/a8c1651d-6477-4b8a-8614-be53e062cf69" /># dsh-sidebar-panel

DSH（DeepSeek Harness，Web profile）**右侧栏的一个页签插件**：通过官方右栏的页签注册接口（`ctx.sidebarRightTabs`）注册一个页面类型与它的正文，与内置的**文件 / 文档预览 / 引导**页签**并存**——不接管右栏、不顶替任何内置页签、不写任何网格或宽度规则。会话头部右上角另有一个与左侧折叠按钮同款的开关，点击打开/聚焦本页签（已在前台则收起右栏）。面板自身包含四个页签：

- **概览**：
- **DeepSeek 账户**卡片——官方余额（经 `GET https://api.deepseek.com/user/balance` 实时查询，15 秒刷新）与 **充值按钮**（跳转 https://platform.deepseek.com/usage）；
- 下方为上下文窗口（已用/总量/百分比/距压缩）、本轮上下文预算（提示词/输出预算/物理剩余空间/上限来源）、会话指标（命中率/**本次会话费用**/运行时间/请求数/累计 tokens）、用量分析（按来源/按类型，含输入输出、命中未命中明细）。服务端数据每 5 秒自动刷新（右上角显示"更新于 HH:MM:SS"），投影数据（token/上下文）实时响应。
- **文件**：当前会话工作区的文件树。**单击文件预览**（md/txt/代码等文本内联显示，PDF 与图片内嵌预览，大文件截断提示）；**右键菜单**：在文件管理器中显示、添加文件引用 / 添加文件内容（文件）、添加文件夹引用（文件夹）、复制绝对路径 / 复制相对路径。插入内容会写入对话输入框。
- **改动**：本次会话中写文件类工具（write/edit/str-replace-editor 等）触碰过的文件列表。
- **工具**：本窗口内的工具调用列表与参数/结果详情（自建渲染）。

> **兼容性**：需 DSH **0.2.0+** 的 **Web profile**（已在桌面版 **0.2.0-rc.2** 上实测）。插件依赖所加载环境提供两样东西：宿主的 `ctx.webServer`（同源 HTTP 路由）与客户端右栏的页签注册表（`ctx.sidebarRightTabs`，0.1.5 起随右栏一起提供）。`package.json → dsh.client.inject` 声明的 6 个客户端包在 0.2.0-rc.2 中均已提供；服务端依赖已对齐宿主提供的版本（`@deepseek-ai/schemastery ^3.18.4`、`@deepseek-ai/dsh-credentials ^0.2.0-rc.2`）。启动的是同一套 Web profile 的桌面外壳同样可用（路由与浏览器中一致）；没有 web server 的外壳不可用。

## 目录结构

```
dsh-sidebar-panel/
├── package.json             # DSH bundle 清单 + client 注入声明 + 构建 / 门禁 / 测试脚本
├── cordis.patch.yml         # 把插件插入 DSH 组合层
├── src/index.js             # 服务端源码：同源 HTTP API + 会话事件增量折叠（用量/费用/改动）+ 文件浏览 + reveal
├── client/client.js         # 客户端源码：注册右栏页签（类型 + 正文）+ 头部开关 + 四页签 + 右键菜单
├── lib/                     # 构建产物：lib/index.js + lib/client.js（由 src/ 与 client/ 生成，勿手改）
├── scripts/build.mjs        # 构建：确定性拷贝 + 生成横幅（零构建工具链依赖）
├── scripts/gates/run.mjs    # 门禁：产物新鲜度 / 入口点 / 名称一致性 / React external / 依赖对齐
├── test/unit.test.mjs       # 服务端单元测试（mock ctx，无需 DSH 实例，不依赖具体路径）
├── test/smoke.client.mjs    # 客户端冒烟：桩运行时断言注册形状 / 导航行为 / chat 切片
├── tsconfig.json            # 仅编辑器 / 类型提示用（noEmit，构建流程不调用 tsc）
├── docs/plan.md             # 插件计划与决策记录
├── SECURITY.md              # 凭据与网络面说明（含扫描误报的逐条说明）
└── README.md / README_EN.md
```

> **右栏契约**：0.1.5 起右栏由官方包 `@deepseek-ai/dsh-client-ui-sidebar-right` 占据，并对外提供页签注册接口。第三方类型的正式接入方式是两段式注册——`ctx.sidebarRightTabs.register({ id, kind, priority: 'extension', title, guide })` 定义类型，再把正文注册进按键位 `sidebar.right.pane.tab`（`key` 与 `id` 相同）。本插件走的就是这条路径（内置的 `files` / `documentpreview` / `guide` 也是），因此**不需要也不应该**去抢占 `rightbar` 插槽。

> **依赖**：服务端依赖 `@deepseek-ai/schemastery`（配置 schema）与 `@deepseek-ai/dsh-credentials`（读取 `DEEPSEEK_API_KEY` 凭据），版本已对齐 DSH 0.2.x 宿主提供的那两份（`^3.18.4` / `^0.2.0-rc.2`）。两者都按全局符号 / 鸭子类型识别，跨副本的版本差异不影响行为（依据见 `docs/plan.md`）。`pnpm pack` 产物不含 `node_modules`。**以 `link:` 方式装到 profile 之外的目录时**，Node 从插件实体目录向上解析不到 profile 的 `node_modules`，该目录必须自己执行 `pnpm install`；装在 profile 内（git / npm 源）时由 profile 提供。

## 安装

在 DSH 运行的终端中执行（Web profile）：

```sh
# 方式一：GitHub 安装（推荐）
dsh plugin --profile web add github:kee0012/dsh-sidebar-panel

# 方式二：npm 安装（暂未发布到 npm registry，不建议使用）
dsh plugin --profile web add dsh-sidebar-panel
```

安装后重启 DSH，并刷新浏览器（Ctrl+Shift+R）。验证配置层生效：

## 服务端 API（同源，供客户端面板使用）

| 路由 | 说明 |
|---|---|
| `GET /dsh-sidebar-panel/api/config` | 引用模板 / 内容上限 / 计价开关 |
| `GET /dsh-sidebar-panel/api/overview?sessionId=` | 请求数、费用、运行时间、按模型用量 |
| `GET /dsh-sidebar-panel/api/files?root=&path=` | 列目录（文件+文件夹），锁定在工作区内 |
| `POST /dsh-sidebar-panel/api/file-content` | 读取文件内容（截断上限可配置） |
| `GET /dsh-sidebar-panel/api/file-raw?root=&path=` | 原始字节预览（PDF/图片，content-type 白名单） |
| `GET /dsh-sidebar-panel/api/balance` | DeepSeek 官方余额（`user/balance`，key 来自 DSH 凭据，永不下发浏览器） |
| `POST /dsh-sidebar-panel/api/reveal` | 在文件管理器中显示（win32/darwin/linux 分发） |
| `GET /dsh-sidebar-panel/api/changes?sessionId=` | 本次会话写文件类工具改动列表 |

## 配置（cordis.yml / 插件配置）

在 DSH 组合配置中给该插件加 `config` 即可（未提供时全部使用默认值）：

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
      offPeakStartHour: 0.5      # 北京时间 00:30 起为低谷
      offPeakEndHour: 8.5        # 08:30 止
      offPeakMultiplier: 0.5
      models:
        deepseek-chat: { inputPerM: 2, cacheHitPerM: 0.5, cacheWritePerM: 2, outputPerM: 8 }
        deepseek-reasoner: { inputPerM: 4, cacheHitPerM: 1, cacheWritePerM: 4, outputPerM: 16 }
```

> 费用为**估算**：按每次请求的 usage × 每百万 tokens 单价（缓存命中按低价），并按请求时刻的北京时间峰/谷时段加权。你的模型若不在表中则用 `pricing.defaultModel`（默认与 deepseek-chat 相同）。如需精确匹配实际账单，请按你的模型实际价格调整 `pricing.models`。

## 开发与测试

```sh
pnpm install          # 解析 @deepseek-ai/schemastery 与 @deepseek-ai/dsh-credentials
pnpm run bundle       # 生成 lib/index.js + lib/client.js（入库产物；改源码后必跑）
pnpm run gates        # 结构门禁：产物新鲜度 / 入口点 / 名称一致性 / React external / 依赖对齐
pnpm run check        # 语法检查（client 与 server）
pnpm test             # 单元测试 + 客户端冒烟
pnpm run verify       # bundle + gates + 两项测试（一条命令跑全链路）
pnpm run test:unit    # node test/unit.test.mjs
pnpm run test:smoke   # node test/smoke.client.mjs

# 轻量结构校验（无需 node，由 dsh-plugin-studio skill 提供）
python <dsh-plugin-studio>/scripts/verify_plugin.py .

# 真实实例的 API 冒烟（端口按你的实例改；GET 同源不带 Origin，POST 冒烟请带 Origin）
curl "http://127.0.0.1:3080/dsh-sidebar-panel/api/config"
curl -H "Origin: http://127.0.0.1:3080" -H "Content-Type: application/json" -X POST \
  -d '{"root":"<你的工作区>","path":"dsh-sidebar-panel/package.json"}' \
  "http://127.0.0.1:3080/dsh-sidebar-panel/api/file-content"
```

> 源码改动一律改 `src/` 与 `client/`，然后跑 `pnpm run bundle`；`lib/` 是产物，`pnpm run gates` 会逐字节校验它与源码一致，手改 `lib/` 直接失败。
> `python verify_plugin.py` 对本插件会报一条 `禁止声明 @deepseek-ai/* 依赖` 的 FAIL —— 这是**有意的规范偏离**，理由见 `docs/plan.md`：`link:` 到 profile 之外的部署需要插件自带依赖，而宿主官方包在 `app.asar` 内、插件用 Node 原生解析够不到，改 `peerDependencies` 只会把"版本漂移"变成 `MODULE_NOT_FOUND`。

## 已知限制

- **与内置页签并存**：本插件是右栏的一个页签，内置的**文件 / 文档预览 / 引导**保持可用。它不再以 `priority: -1` 顶替右栏，因此也不再需要 corner 死按钮处理、blank 期网格 hack 或 `data-details-collapsed` DOM 探针。
- **「工具」页签为自建详情视图**：内置右栏的"工具详情"座属于其自身声明，插件无法复用，故工具调用由插件自绘；聊天里的 Inspect 按钮走内置右栏，不会自动选中本插件的页签。
- **开合状态由官方右栏掌管**：右栏是否展开、有哪些页签，都是官方右栏的 per-session store 状态，切会话各自恢复。插件不再写 `localStorage` 开合偏好，只按会话记住自己内部四个页签选到哪一个。
- **blank（新建会话 hero）期间**：宿主会隐藏整个会话 header，右上角开关随之隐藏——与内置页签行为一致；此时可从右栏自身的引导页打开本页签。
- **费用匹配**：费用是估算值，取决于定价表配置；金额保留 6 位小数传输、按大小自适应显示精度。
- **改动追踪**：只覆盖写文件类工具调用；bash/pwsh 内部的文件改动无法可靠捕获。
- **概览请求数/费用/运行时间**：由服务端从会话事件日志折叠（`request/header`、`assistant/message` 的 usage），插件安装前的历史会话在首次访问时会一次性补算；运行时间 = 自首次请求至今（含空闲）。
- **账户数据口径**：**余额**来自 DeepSeek 官方接口（需在 DSH 凭据/环境变量中配置 `DEEPSEEK_API_KEY`，否则显示"未配置"提示）。官方仅提供余额查询接口，无公开的累计消费/请求次数接口，故账户卡片不再展示这两项；官方精确账单可通过"充值"按钮进入 https://platform.deepseek.com/usage 查看。
- **跨域防护**：每个请求都要求 `Host` 是环回名（`127.0.0.1` / `localhost` / `::1`），并对 `Sec-Fetch-Site: cross-site` 直接拒绝；带 `Origin` 时必须也是环回。早先的「`Origin` 与 `Host` 相等」判断可被 **DNS rebinding** 绕过（恶意页面下二者同为攻击者域名），已修复。同源 GET 不带 `Origin` 头，因此仍照常放行；POST 另有「不响应 CORS 预检 + 仅接受 JSON」防线（与 DSH 宿主 API 同策略）。

## 反馈与贡献

- 遇到问题请到 [Issues](https://github.com/kee0012/dsh-sidebar-panel/issues) 反馈，附上 DSH 版本、profile、复现步骤与日志。
- 欢迎提交 Pull Request。

## License

[MIT](./LICENSE) © dsh-sidebar-panel contributors
