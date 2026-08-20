<img width="3084" height="1670" alt="image" src="https://github.com/user-attachments/assets/a8c1651d-6477-4b8a-8614-be53e062cf69" /># dsh-sidebar-panel

DSH（DeepSeek Harness，Web profile）的**右侧面板插件**：在**会话头部右上角**新增一个面板折叠按钮（样式与左侧折叠按钮一致），点击展开/收起右侧 `details` 列；**重启 DSH 后自动展开**（记忆上次偏好，默认打开）。面板包含四个页签：

- **概览**：
- **DeepSeek 账户**卡片——官方余额（经 `GET https://api.deepseek.com/user/balance` 实时查询，15 秒刷新）与 **充值按钮**（跳转 https://platform.deepseek.com/usage）；
- 下方为上下文窗口（已用/总量/百分比/距压缩）、本轮上下文预算（提示词/输出预算/物理剩余空间/上限来源）、会话指标（命中率/**本次会话费用**/运行时间/请求数/累计 tokens）、用量分析（按来源/按类型，含输入输出、命中未命中明细）。服务端数据每 5 秒自动刷新（右上角显示"更新于 HH:MM:SS"），投影数据（token/上下文）实时响应。
- **文件**：当前会话工作区的文件树。**单击文件预览**（md/txt/代码等文本内联显示，PDF 与图片内嵌预览，大文件截断提示）；**右键菜单**：在文件管理器中显示、添加文件引用 / 添加文件内容（文件）、添加文件夹引用（文件夹）、复制绝对路径 / 复制相对路径。插入内容会写入对话输入框。
- **改动**：本次会话中写文件类工具（write/edit/str-replace-editor 等）触碰过的文件列表。
- **工具**：本窗口内的工具调用列表与参数/结果详情（自建渲染）。

> **兼容性**：仅支持 DSH 的 **Web profile**（HTTP 同源路由）；desktop（Electron）形态下自定义 HTTP 路由不可用。
<img width="3084" height="1670" alt="image" src="https://github.com/user-attachments/assets/94bedd76-781d-4203-b9b1-773fad5837f9" />


## 目录结构

```
dsh-sidebar-panel/
├── package.json          # DSH bundle 清单 + client 注入声明
├── cordis.patch.yml      # 把插件插入 DSH 组合层
├── src/index.js          # 服务端：同源 HTTP API + 会话事件折叠（用量/费用/改动）+ 文件浏览 + reveal
├── client/client.js      # 客户端：右上角折叠按钮 + details 列面板（自动展开）+ 四页签 + 右键菜单
├── test/unit.test.mjs    # 服务端单元测试（mock ctx，无需 DSH 实例，不依赖具体路径）
└── README.md / README_EN.md
```

> **依赖**：服务端依赖 `@deepseek-ai/schemastery`（配置 schema）与 `@deepseek-ai/dsh-credentials`（读取 `DEEPSEEK_API_KEY` 凭据），二者由 DSH 运行时提供。`pnpm pack` 产物不含 `node_modules`；以源码方式开发时，在插件目录执行 `pnpm install` 即可解析依赖。

## 安装

在 DSH 运行的终端中执行（Web profile）：

```sh
dsh plugin --profile web add dsh-sidebar-panel
```

安装后重启 DSH，并硬刷新浏览器

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
# 语法检查
node --check src/index.js && node --check client/client.js

# 服务端单元测试（mock ctx，覆盖路由/跨域/文件树/越界锁定/概览折叠/峰谷计价/改动追踪）
node test/unit.test.mjs

# API 冒烟测试（GET 无需 Origin 头，浏览器同源 GET 本就不带 Origin；POST 冒烟请带 Origin）
curl "http://127.0.0.1:3080/dsh-sidebar-panel/api/config"
curl -H "Origin: http://127.0.0.1:3080" -H "Content-Type: application/json" -X POST \
  -d '{"root":"<你的工作区>","path":"dsh-sidebar-panel/package.json"}' \
  "http://127.0.0.1:3080/dsh-sidebar-panel/api/file-content"
```

## 已知限制

- **details 列替换**：插件以 `priority: -1` 顶替内置 DetailsPanel（单槽位只能有一个渲染者）。内置面板的"工具详情"座（`conversation.details.tool`）属于其自身声明，插件无法复用，故"工具"页签为自建详情视图；聊天里的 Inspect 按钮仍会打开右侧列，但不会自动选中工具。
- **自动展开偏好**：面板开合状态存于浏览器 localStorage（`dsh-sidebar-panel:details-open`），默认 `open`——重启 DSH 后自动展开；用户主动收起后记为 `closed`，下次启动保持收起。切会话时 DSH 自身会收起 details 列（框架行为），不会自动重开。
- **费用匹配**：费用是估算值，取决于定价表配置；金额保留 6 位小数传输、按大小自适应显示精度。
- **改动追踪**：只覆盖写文件类工具调用；bash/pwsh 内部的文件改动无法可靠捕获。
- **概览请求数/费用/运行时间**：由服务端从会话事件日志折叠（`request/header`、`assistant/message` 的 usage），插件安装前的历史会话在首次访问时会一次性补算；运行时间 = 自首次请求至今（含空闲）。
- **账户数据口径**：**余额**来自 DeepSeek 官方接口（需在 DSH 凭据/环境变量中配置 `DEEPSEEK_API_KEY`，否则显示"未配置"提示）。官方仅提供余额查询接口，无公开的累计消费/请求次数接口，故账户卡片不再展示这两项；官方精确账单可通过"充值"按钮进入 https://platform.deepseek.com/usage 查看。
- **跨域防护**：GET 请求不做 Origin 校验（同源 GET 本就不带 Origin 头）；POST 依赖"不响应 CORS 预检 + 仅接受 JSON"防线（与 DSH 宿主 API 同策略）。

## 反馈与贡献

- 遇到问题请到 [Issues](https://github.com/kee0012/dsh-sidebar-panel/issues) 反馈，附上 DSH 版本、profile、复现步骤与日志。
- 欢迎提交 Pull Request。

## License

[MIT](./LICENSE) © dsh-sidebar-panel contributors
