<img width="3084" height="1670" alt="image" src="https://github.com/user-attachments/assets/a8c1651d-6477-4b8a-8614-be53e062cf69" />

# dsh-sidebar-panel

DSH（DeepSeek Harness）**右侧栏的一个页签插件**：通过官方右栏的页签注册接口（`ctx.sidebarRightTabs`）注册一个页面类型与它的正文，与内置的**文件 / 文档预览 / 引导**页签**并存**——不接管右栏、不顶替任何内置页签、不写任何网格或宽度规则。会话头部右上角另有一个与左侧折叠按钮同款的开关，点击打开/聚焦本页签（已在前台则收起右栏）。

> **环境要求**：DSH **0.2.0+** 的 **Web profile**（已在桌面版 **0.2.0-rc.2** 实测）。启动同一套 Web profile 的桌面外壳同样可用（路由与浏览器中一致）；不带 web server 的外壳不可用。

面板自身包含四个页签：

- **概览**
  - **DeepSeek 账户**卡片——官方余额（经 `GET https://api.deepseek.com/user/balance` 实时查询，15 秒刷新）与**充值按钮**（跳转 https://platform.deepseek.com/usage）。
  - 上下文窗口（已用/总量/百分比/距压缩）、本轮上下文预算（提示词/输出预算/物理剩余空间/上限来源）、会话指标（命中率/**本次会话费用**/运行时间/请求数/累计 tokens）、用量分析（按来源/按类型，含输入输出、命中未命中明细）。服务端数据每 5 秒自动刷新（右上角显示"更新于 HH:MM:SS"），投影数据（token/上下文）实时响应。
- **文件**：当前会话工作区的文件树。文件与文件夹按类型显示各自的图标（彩色字母章 + 内联 SVG 轮廓：图片 / 压缩包 / 字体 / 锁文件 / 配置 / 脚本等各有其形，未收录的扩展名回退为中性字母章），图形全部由 CSS 与内联 SVG 绘制，不依赖图标字体或图片资源。**单击文件预览**（md/txt/代码等文本内联显示，PDF 与图片内嵌预览，大文件截断提示）；**右键菜单**：在文件管理器中显示、添加文件引用 / 添加文件内容（文件）、添加文件夹引用（文件夹）、复制绝对路径 / 复制相对路径。插入内容会写入对话输入框。
- **改动**：本次会话中写文件类工具（write/edit/str-replace-editor 等）触碰过的文件列表。
- **工具**：本窗口内的工具调用列表与参数/结果详情（自建渲染）。

## 安装

插件托管在 GitHub（`kee0012/dsh-sidebar-panel`，未发布到 npm），DSH 支持以 git 依赖方式直接安装：

```sh
# 从 GitHub 安装（推荐，日常使用；拉取默认分支最新提交）
dsh plugin --profile desktop add github:kee0012/dsh-sidebar-panel
```

> 安装后需要**重启 DSH**，新的服务端代码与 client bundle 才会生效。

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
├── test/unit.test.mjs       # 服务端单元测试（mock ctx，无需 DSH 实例）
├── test/smoke.client.mjs    # 客户端冒烟：桩运行时断言注册形状 / 导航行为 / chat 切片
├── tsconfig.json            # 仅编辑器 / 类型提示用（noEmit，构建流程不调用 tsc）
├── SECURITY.md              # 凭据与网络面说明
└── README.md / README_EN.md
```

## 开发与测试

```sh
pnpm install          # 安装依赖
pnpm run bundle       # 生成 lib/index.js + lib/client.js（入库产物；改源码后必跑）
pnpm run gates        # 结构门禁：产物新鲜度 / 入口点 / 名称一致性 / React external / 依赖对齐
pnpm run check        # 语法检查（client 与 server）
pnpm test             # 单元测试 + 客户端冒烟
pnpm run verify       # bundle + gates + 两项测试（一条命令跑全链路）
pnpm run test:unit    # node test/unit.test.mjs
pnpm run test:smoke   # node test/smoke.client.mjs

# 真实实例的 API 冒烟（<port> 换成你的实例端口；GET 同源不带 Origin，POST 冒烟请带 Origin）
curl "http://127.0.0.1:<port>/dsh-sidebar-panel/api/config"
curl -H "Origin: http://127.0.0.1:<port>" -H "Content-Type: application/json" -X POST \
  -d '{"root":"<你的工作区>","path":"dsh-sidebar-panel/package.json"}' \
  "http://127.0.0.1:<port>/dsh-sidebar-panel/api/file-content"
```

> 源码改动一律改 `src/` 与 `client/`，然后跑 `pnpm run bundle`；`lib/` 是产物，`pnpm run gates` 会逐字节校验它与源码一致，手改 `lib/` 直接失败。

## 已知限制

- **与内置页签并存**：本插件是右栏的一个页签，内置的**文件 / 文档预览 / 引导**保持可用，插件不接管右栏，也不改写网格或宽度规则。
- **「工具」页签为自建详情视图**：内置右栏的"工具详情"座属于其自身声明，插件无法复用，故工具调用由插件自绘；聊天里的 Inspect 按钮走内置右栏，不会自动选中本插件的页签。
- **开合状态由官方右栏掌管**：右栏是否展开、有哪些页签，都是官方右栏的 per-session store 状态，切会话各自恢复；插件只按会话记住自己内部四个页签选到哪一个。
- **blank（新建会话 hero）期间**：宿主会隐藏整个会话 header，右上角开关随之隐藏，与内置页签行为一致；此时可从右栏自身的引导页打开本页签。
- **费用匹配**：费用是估算值，取决于定价表配置；金额保留 6 位小数传输、按大小自适应显示精度。
- **改动追踪**：只覆盖写文件类工具调用；bash/pwsh 内部的文件改动无法可靠捕获。
- **概览请求数/费用/运行时间**：由服务端从会话事件日志折叠（`request/header`、`assistant/message` 的 usage），插件安装前的历史会话在首次访问时会一次性补算；运行时间 = 自首次请求至今（含空闲）。
- **账户数据口径**：**余额**来自 DeepSeek 官方接口（需在 DSH 凭据/环境变量中配置 `DEEPSEEK_API_KEY`，否则显示"未配置"提示）。官方仅提供余额查询接口，无公开的累计消费/请求次数接口，故账户卡片不展示这两项；精确账单可通过"充值"按钮进入 https://platform.deepseek.com/usage 查看。
- **跨域防护**：每个请求都要求 `Host` 是环回名（`127.0.0.1` / `localhost` / `::1`），并拒绝 `Sec-Fetch-Site: cross-site`；带 `Origin` 时必须也是环回，以防止 **DNS rebinding**。同源 GET 不带 `Origin` 头，照常放行；POST 另有「不响应 CORS 预检 + 仅接受 JSON」防线（与 DSH 宿主 API 同策略）。

## 反馈与贡献

- 遇到问题请到 [Issues](https://github.com/kee0012/dsh-sidebar-panel/issues) 反馈，附上 DSH 版本、profile、复现步骤与日志。
- 欢迎提交 Pull Request。

## License

[MIT](./LICENSE) © dsh-sidebar-panel contributors
