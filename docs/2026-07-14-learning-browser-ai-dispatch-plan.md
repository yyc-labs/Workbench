# 学习中心浏览器 AI 调度计划（2026-07-14）

## 文档状态

- 状态：代码实现完成，待用户登录态本机验收。
- 依赖：已加入 `playwright-core`，只连接本机 Edge CDP，不下载 Chromium。
- 执行记录：P1-P4 已落地；P0 已确认 Edge 路径可用，真实网页 AI 登录和问答 smoke test 需用户手动完成；当前提供通用网页 adapter，并保留 ChatGPT Web 专用 adapter，设置页支持站点名称、地址、adapter 类型列表 CRUD 和当前站点切换；通用 adapter 面向常见网页对话界面，非标准页面需要后续增加专用 adapter；P5 的断线重连暂不在本次实现范围内。
- 目标：从学习中心选择 skill、学习笔记和个人上下文，组装成一次明确的 AI 任务，通过用户自己的 Microsoft Edge 登录态完成网页交互，再把回答返回到学习中心。
- 默认适配策略：通用网页 AI adapter；ChatGPT Web 作为当前提供的专用 adapter 示例。
- 第一浏览器：Microsoft Edge，默认可执行文件：`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`。

## 一、背景与目标

当前学习中心已经能够保存和编辑本地 Markdown 笔记。下一步希望把这些本地资料作为上下文发送给浏览器中的 AI，例如：

```text
skill 文档 + 个人信息 + 选中的学习笔记 + 当前问题
                         |
                         v
              Edge 中配置的网页 AI 站点
                         |
                         v
                 回答文本返回学习中心
```

本方案不实现新的模型服务，也不读取或复制第三方 AI 站点的 Cookie、Token、LocalStorage 或 IndexedDB。Electron 只通过 CDP 控制 Edge 页面，让 Edge 自己携带已有登录态访问用户配置的网页 AI 站点。

### 目标

1. 用户可以在学习中心明确选择输入资料，并在发送前预览最终上下文。
2. Electron 可以启动或连接一个启用了 CDP 的 Edge 实例。
3. 调度器可以在独立的新标签页中打开配置的网页 AI 站点、发送一次任务并读取完整文本回答。
4. 浏览器未登录、页面结构变化、超时、断开和额度/站点错误都能返回明确状态。
5. 回答默认只返回预览，不自动覆盖原笔记；用户确认后再保存为新笔记或追加到当前笔记。
6. 后续可以在不改动学习存储和 IPC 边界的情况下增加其他网页 AI 适配器。

### 非目标

- 不绕过登录、验证码、风控、免费额度或站点限制。
- 不提取或持久化第三方站点的 Cookie、Token、会话数据库。
- 不通过第三方 AI 站点内部 API、私有接口或网络请求绕过网页交互。
- 不在第一阶段实现多账号、自动轮换账号或批量并发；站点配置列表用于用户选择目标，不代表任务并发。
- 不让 AI 直接修改文件、执行终端命令、发送消息或提交代码。
- 不把浏览器自动化逻辑塞进 `LearningService`、`Runtime` 或现有 `ai-gateway`。

## 二、关键技术判断

### 1. `connectOverCDP` 是连接，不是启动

Playwright 的 `connectOverCDP` 只能连接已经开放调试端口的 Edge：

```text
Electron main
    |
    v
Playwright connectOverCDP
    |
    v
Edge --remote-debugging-port=<port>
    |
    v
配置的网页 AI 站点
```

普通启动的 Edge 不会因为调用 `connectOverCDP` 自动获得调试端口。正在运行的普通 Edge 也不能可靠地在进程外追加启动参数，因此需要由应用启动一个受控实例，或要求用户预先以 CDP 参数启动 Edge。

另外，Chromium 系浏览器对默认用户目录、进程锁和远程调试有版本相关限制。不能假设日常 Edge 的默认 profile 可以直接被另一个进程安全复用。

### 2. 推荐 MVP：应用管理的独立 Edge profile

推荐由 Electron 使用用户提供的 Edge 可执行文件启动一个独立 profile：

```text
C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe
  --remote-debugging-address=127.0.0.1
  --remote-debugging-port=<动态端口>
  --user-data-dir=<Electron userData>\browser-ai\edge-profile
```

第一次运行时用户在这个独立 profile 中登录配置的网页 AI 站点。以后继续复用该 profile，登录态由 Edge 自己维护。

这样可以达到“只登录一次、后续由应用调度”的效果，同时避免：

- 锁住用户日常 Edge 的 Default profile。
- 调度任务误关用户正在使用的标签页。
- 用户手动操作和自动化操作互相切换页面。
- 将日常浏览记录、扩展和其他站点会话暴露给调度器。

这不是复用日常 Edge profile，而是复用应用专属 Edge profile 中的登录态。计划必须在 UI 中明确显示这一点，避免用户误以为可以自动继承当前 Edge 的登录状态。

### 3. 外部 Edge 连接模式作为高级能力

后续可支持用户自行启动 Edge：

```powershell
& 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' `
  --remote-debugging-address=127.0.0.1 `
  --remote-debugging-port=9222 `
  --user-data-dir="$env:LOCALAPPDATA\IDE Electron\edge-cdp-profile"
```

Electron 只连接 `http://127.0.0.1:9222`，不负责该 Edge 的生命周期。该模式适合调试和用户已有启动脚本，不作为默认模式，因为它不能保证端口、profile、进程和标签页始终可用。

### 4. Playwright 依赖需要单独确认

当前 `package.json` 没有 Playwright。推荐使用 `playwright-core`：

- 只提供浏览器控制 API，不下载或捆绑 Chromium。
- 直接连接用户机器上的 Edge。
- 依赖体积和发布行为更容易控制。

这仍然是新增第三方依赖，实施前需要用户确认。若不增加依赖，也可以使用 Edge CDP 的原始 WebSocket 协议，但需要自行实现页面、DOM、输入、等待和断线处理，维护成本明显更高，不建议作为第一实现。

## 三、推荐架构

### 1. 新增独立 main domain

建议新增：

```text
src/core/electron/main/browser-ai/
  browserAiService.ts          # 任务编排、生命周期、并发锁
  browserAiConfig.ts           # Edge/CDP/站点配置规范化
  browserAiRepository.ts       # 持久化非敏感配置与任务记录
  edgeLauncher.ts              # Edge 可执行文件探测、启动、停止
  cdpConnection.ts             # CDP 连接、端口探测、断线状态
  contextComposer.ts           # skill/笔记/个人信息/问题组装
  taskState.ts                 # 状态机和错误分类
  site-adapters/
    browserAiSiteAdapter.ts    # 站点适配器接口
    genericWebAiAdapter.ts     # 常见网页 AI 对话界面的通用交互
    chatgptAdapter.ts          # ChatGPT Web 专用交互
```

不要修改 `src/core/electron/main/learning/learningService.ts` 来承接 Edge 调度。Learning service 继续负责分类和笔记的 CRUD；`browserAiService` 通过注入的 `LearningService` 读取选中的笔记内容。

### 2. IPC 链路

按仓库现有 domain 结构接入：

```text
src/core/shared/types.ts
        |
        v
src/core/electron/main/browser-ai/*
        |
        v
registerBrowserAiIpcHandlers.ts
        |
        v
invokeApi.browserAi.ts
        |
        v
appStore.browserAiSlice.ts / 学习中心组件
```

新增 `registerBrowserAiIpcHandlers.ts`，由 `registerIpcHandlers.ts` 只做装配。`preload/index.ts` 只合并 `createBrowserAiInvokeApi()`，不写浏览器业务逻辑。

建议第一阶段 IPC：

| IPC | 用途 |
| --- | --- |
| `browser-ai:get-config` | 读取脱敏后的配置和当前连接状态 |
| `browser-ai:save-config` | 保存 Edge 路径、模式、端口和目标站点配置 |
| `browser-ai:start` | 启动受控 Edge 或连接外部 CDP |
| `browser-ai:stop` | 断开连接并停止由应用启动的 Edge |
| `browser-ai:test-connection` | 检查 CDP、目标站点和登录状态 |
| `browser-ai:run-task` | 执行一次浏览器 AI 任务 |
| `browser-ai:cancel-task` | 中止当前任务并关闭应用创建的标签页 |
| `browser-ai:open-login` | 打开应用 profile 的登录页 |
| `browser-ai:save-result` | 用户确认后将回答保存为学习笔记 |

任务进度和状态通过现有 `preload/subscriptions.ts` 订阅事件回传，至少包含：`starting`、`connecting`、`needs-login`、`opening-page`、`sending`、`waiting-response`、`completed`、`failed`、`cancelled`。

### 3. Shared 类型草案

以下是计划中的契约方向，实施时再根据最终 UI 收敛字段：

```ts
export type BrowserAiMode = 'managed-edge' | 'external-cdp'

export type BrowserAiSite = 'generic-web' | 'chatgpt-web'

export type BrowserAiTaskStatus =
  | 'idle'
  | 'starting'
  | 'connecting'
  | 'needs-login'
  | 'opening-page'
  | 'sending'
  | 'waiting-response'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface BrowserAiConfig {
  enabled: boolean
  mode: BrowserAiMode
  edgeExecutablePath?: string
  cdpHost: '127.0.0.1'
  cdpPort?: number
  site: BrowserAiSite
  siteUrl: string
  sites: BrowserAiSiteProfile[]
  activeSiteId: string
  keepBrowserRunning: boolean
  headless: boolean
}

export interface BrowserAiSiteProfile {
  id: string
  name: string
  url: string
  site: BrowserAiSite
}

export interface BrowserAiContextSource {
  kind: 'skill' | 'learning-note' | 'personal-context' | 'task'
  label: string
  content: string
  included: boolean
}

export interface BrowserAiRunTaskPayload {
  site: BrowserAiSite
  task: string
  sources: BrowserAiContextSource[]
  responseFormat?: string
  saveAsNote?: boolean
}

export interface BrowserAiTaskResult {
  taskId: string
  status: 'completed' | 'failed' | 'cancelled'
  answer?: string
  sourceLabels: string[]
  startedAt: number
  completedAt: number
  errorCode?: string
  errorMessage?: string
}
```

共享类型只描述跨层数据，不放 Playwright 类型、DOM selector 或 Electron `ChildProcess` 类型。

## 四、上下文与提示词设计

### 1. 输入来源

MVP 只发送用户明确勾选的内容：

1. 当前编辑器中的 skill Markdown。
2. 一个或多个学习中心笔记。
3. 一个独立的个人上下文。
4. 当前任务问题。
5. 可选的输出格式要求。

“个人上下文”不建议默认为所有学习笔记。建议在设置中维护一个独立的 `personal-context.md`，或者先以一个明确标记为个人上下文的学习笔记实现。这样用户能清楚看到哪些信息会被发送。

### 2. 发送前预览

在真正点击发送前，UI 显示最终拼接后的内容和字符数：

```text
<skill>
用户提供的 skill 指令
</skill>

<personal_context>
用户选中的个人信息
</personal_context>

<learning_notes>
用户选中的学习笔记
</learning_notes>

<task>
用户当前问题
</task>

<response_format>
可选的输出格式
</response_format>
```

skill 是用户明确提供的执行指令；个人信息和学习笔记是上下文资料。调度器不自动扫描整个学习中心，也不自动把未勾选的项目文件发送出去。

### 3. 长度与敏感信息控制

必须在 `contextComposer` 中统一处理：

- 每个来源的最大字符数。
- 所有来源的总字符数。
- 超限时按来源分段或明确报错，不静默截断关键内容。
- 移除不必要的二进制内容、超长重复空白和明显的本地绝对路径。
- 在发送前显示来源列表、字符数和目标站点。
- 个人上下文单独显示“包含敏感信息”的标记。

个人上下文如需持久化，优先使用 Electron `safeStorage` 加密存储；普通学习笔记仍按现有 Learning repository 保存。任何情况下都不把个人上下文写入调试日志、错误详情或截图。

### 4. 结果处理

回答返回后进入结果预览：

- 默认不写入原笔记。
- 支持复制回答。
- 支持新建学习笔记。
- 支持追加到当前笔记，但必须显示将要追加的内容。
- 保存时复用现有 `createLearningNote` / `updateLearningNote`，不让浏览器自动执行保存。

## 五、浏览器调度状态机

### 1. 一次任务流程

```text
校验配置与输入
    |
    v
获取任务锁，拒绝并发任务
    |
    v
启动/连接 Edge
    |
    v
连接 CDP 并检测目标站点
    |
    +--> 未登录：needs-login，打开登录页并等待用户确认
    |
    v
创建应用专属新标签页
    |
    v
进入新对话并填入提示词
    |
    v
点击发送，等待回答稳定
    |
    +--> 超时/断线/站点错误：failed，保留诊断状态
    |
    v
读取最后一条 assistant 文本
    |
    v
关闭应用创建的标签页，断开 CDP
    |
    v
返回 completed 结果
```

### 2. 任务隔离

- 同一浏览器 profile 同时只允许一个调度任务。
- 每次任务优先创建新标签页和新对话，不复用用户正在编辑的会话。
- 只关闭本次任务创建的标签页。
- 不调用 `context.pages()[0].close()` 这类不区分归属的操作。
- 用户手动关闭标签页时，任务进入 `failed` 或 `cancelled`，不能继续对其他页面盲操作。

### 3. 登录态检测

适配器通过页面可见状态检测登录：

- 出现登录按钮或登录表单：返回 `needs-login`。
- 出现网页 AI 对话输入框且没有登录拦截：认为已登录。
- 不读取 Cookie 内容来判断登录。
- 登录页面交给用户完成，Electron 不代填账号、密码或验证码。

## 六、网页 AI 站点适配器

### 1. 适配器接口

```ts
interface BrowserAiSiteAdapter {
  site: BrowserAiSite
  matchesPage(url: string, configuredUrl?: string): boolean
  detectLoginState(page: BrowserPage): Promise<'logged-in' | 'needs-login' | 'unknown'>
  openNewConversation(page: BrowserPage, siteUrl: string): Promise<void>
  submitPrompt(page: BrowserPage, prompt: string): Promise<void>
  waitForCompletion(page: BrowserPage, timeoutMs: number): Promise<void>
  readAnswer(page: BrowserPage): Promise<string>
}
```

实际实现可以使用 Playwright 的 `Page`，但接口不向 shared、renderer 或 Learning domain 暴露。

### 2. 选择器策略

网页 DOM 会变化，不能依赖随机 class 名或当前某一个 CSS selector。选择器优先级：

1. `getByRole`、`getByLabel`、可访问名称。
2. 稳定的 `data-*` 属性或语义化元素。
3. 少量经过测试的备用 selector。
4. 页面 URL、标题和可见文本作为诊断信息，而不是唯一成功条件。

等待回答结束不能只等待一个固定时间。需要组合判断：

- assistant 消息节点出现。
- 生成按钮消失或发送按钮恢复可用。
- 连续两次文本采样在稳定窗口内不再变化。
- 出现站点错误、登录拦截或额度提示时立即失败。

通用选择器和完成判断集中在 `genericWebAiAdapter.ts`；站点有稳定结构时可以增加类似 `chatgptAdapter.ts` 的专用 adapter。每次 selector 变更都应补充 fixture 或 mock 页面测试。

### 3. 站点错误分类

至少区分：

- `BROWSER_NOT_FOUND`：Edge 路径不存在或不可执行。
- `CDP_UNAVAILABLE`：端口未开放、连接被拒绝或返回格式错误。
- `LOGIN_REQUIRED`：未登录。
- `SITE_NOT_RECOGNIZED`：当前页面不是预期站点。
- `COMPOSER_NOT_FOUND`：找不到输入框。
- `SUBMIT_FAILED`：无法发送。
- `RESPONSE_TIMEOUT`：超过等待时间。
- `RESPONSE_EMPTY`：页面完成但没有可读文本。
- `BROWSER_DISCONNECTED`：Edge 或 CDP 连接中断。
- `SITE_LIMIT_OR_ERROR`：额度、风控、网络或站点错误。

renderer 看到的是稳定的错误码和本地化文案，不能直接把 DOM 异常堆栈展示给用户。

## 七、配置与安全边界

### 1. 配置

默认配置建议：

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| 浏览器可执行文件 | 自动探测的 Edge 路径 | 设置页显示默认路径，也支持用户修改；启动前检查存在性 |
| 模式 | `managed-edge` | 应用负责启动和停止 Edge |
| CDP host | `127.0.0.1` | 固定回环地址，不允许默认监听公网 |
| CDP port | 动态空闲端口 | 避免固定 9222 与其他工具冲突 |
| profile | `<app userData>\browser-ai\edge-profile` | 与日常 Edge profile 隔离 |
| 目标站点 | `generic-web` + 用户配置的 HTTPS AI 站点地址 | 通用 adapter 支持常见网页对话界面；选择专用 adapter 时必须使用其匹配的站点地址 |
| 保持浏览器运行 | `true` | 便于复用登录态；停止时只断开或按配置退出 |
| headless | `false` | 首次登录和故障诊断更可靠；隐藏模式作为后续实验项 |

Edge 路径不要只硬编码一个位置，探测顺序可以是：用户配置、`Program Files (x86)`、`Program Files`，最终让用户选择。计划中的默认值保留用户当前路径。

### 2. CDP 安全

- 只绑定 `127.0.0.1`。
- 使用动态端口，并只在 main 进程内保存当前端口。
- 不使用 `--remote-debugging-address=0.0.0.0`。
- 不把 CDP URL 暴露给 renderer、日志、IPC 返回值或远程接口。
- 不使用宽泛的远程调试 origin 配置。
- 服务退出时释放子进程、端口检测器、Playwright browser 引用和任务锁。

### 3. 浏览器权限

MVP 只允许：

- 导航到配置中的目标站点。
- 新建和关闭本次任务标签页。
- 填写对话框并读取可见回答文本。

禁止：

- 访问其他站点的页面内容。
- 读取浏览器 cookie、密码、扩展数据或历史记录。
- 自动点击账号设置、付款、发送邮件、发布内容等非 AI 对话操作。
- 自动确认购买、授权、删除或不可逆操作。

## 八、Renderer 与学习中心 UI

### 1. 入口位置

学习中心入口页 `src/core/renderer/pages/LearningCenterPage.tsx` 继续只做页面级状态和区域装配。新增 UI 放到：

```text
src/core/renderer/pages/learning/
  LearningBrowserAiButton.tsx
  LearningBrowserAiDialog.tsx
  LearningBrowserAiContextPreview.tsx
  LearningBrowserAiResultPanel.tsx
```

设置页增加浏览器 AI 配置区，负责：

- 浏览器默认路径显示、检查和修改。
- managed/external 模式切换。
- CDP 连接、登录检测和停止。
- 目标站点名称/地址列表 CRUD、当前站点切换和状态。
- profile 路径说明和清理入口。

学习中心负责：

- 选择 skill 来源。
- 选择学习笔记和个人上下文。
- 输入当前任务。
- 预览最终提示词。
- 展示进度、错误和回答。
- 用户确认后保存结果。

### 2. 全局状态

浏览器连接和任务状态可能在设置页与学习中心之间共享，建议新增：

```text
src/core/renderer/stores/appStore.browserAiSlice.ts
```

其中只保存脱敏状态、任务进度和当前结果，不保存个人上下文原文、Cookie、CDP URL 或密码。

### 3. 国际化与主题

新增文案接入 `src/core/renderer/i18n/messages/`，至少覆盖：

- 浏览器未配置。
- Edge 未找到。
- 需要登录。
- 正在连接/发送/等待回答。
- 站点结构变化。
- 结果为空。
- 个人信息发送确认。
- 外部 CDP 模式风险说明。

复用现有 token 和 `quiet-control` / `surface-card` 体系，保持深浅色主题一致，不在学习中心页面散落硬编码颜色或英文错误文本。

## 九、分阶段实施

### P0：Edge/CDP 可行性验证

不改产品 UI，先完成一次本机验证：

1. 确认 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` 存在并可启动。
2. 用独立 profile 和回环 CDP 端口启动 Edge。
3. 手动登录用户配置的网页 AI 站点。
4. 使用 Playwright 连接 CDP，列出页面 URL 和标题，不读取 Cookie。
5. 验证新建标签页、找到输入框、发送短消息、读取文本回答。
6. 记录当前 Edge 版本、目标站点页面结构、完成信号和失败页面。
7. 评估 headed 与 `headless=new` 两种模式，默认保留 headed。

交付物：一份本地联调记录、依赖选择结论、通用网页 adapter 最小 selector 样例和已知限制清单。

### P1：browser-ai main domain

1. 新增配置规范化、Edge 路径检查和 profile 路径解析。
2. 新增 Edge 启动/停止和 CDP 端口探测。
3. 新增任务锁、超时、取消、断线清理。
4. 新增 `BrowserAiService` 接口和稳定错误码。
5. 新增 shared 类型、IPC handler、preload API 和状态订阅。
6. 完成单元测试，不需要真实登录态即可运行。

交付物：可以启动/停止 Edge、检测登录态并返回状态，但暂时不接学习中心 UI。

### P2：上下文编排与 Learning 接入

1. 通过 `LearningService` 读取用户选择的笔记。
2. 实现 skill、个人上下文、学习笔记和任务的分段模板。
3. 实现长度限制、来源摘要和发送前预览数据。
4. 个人上下文按安全方案保存，日志只记录来源标签和字符数。
5. 通过现有 Learning CRUD 保存用户确认后的回答。

交付物：不经过浏览器也可以测试“输入来源 -> 最终提示词 -> 结果保存”链路。

### P3：网页 AI adapter

1. 实现登录检测。
2. 实现应用专属新标签页和新对话。
3. 实现可访问性优先的 composer 定位和发送。
4. 实现回答稳定检测、文本提取和错误识别。
5. 实现只关闭应用创建标签页的清理逻辑。

交付物：可以在真实 Edge profile 中完成一次非流式文本问答，并能处理未登录和超时。

### P4：学习中心与设置 UI

1. 在设置中增加 Edge/CDP 配置和连接测试。
2. 在学习中心增加“发送到浏览器 AI”入口。
3. 增加来源选择和最终提示词预览。
4. 增加任务进度、取消、错误重试和回答预览。
5. 增加新建笔记/追加当前笔记的确认流程。
6. 完成中英文文案和深浅色主题检查。

交付物：用户可以从学习中心完成完整闭环。

### P5：稳定性与扩展准备

1. 增加通用网页页面结构变化诊断和版本化 selector；对高频站点补充专用 adapter。
2. 增加连接断开后的有限重连，不重复发送同一任务。
3. 增加可选的 headed/headless 配置实验。
4. 用第二个网页 AI 站点验证通用 adapter 与专用 adapter 的接口边界。
5. 评估任务历史是否需要持久化；默认不保存敏感 prompt 原文。

## 十、测试与验收

### 自动化测试

- Edge executable path 探测和 Windows 路径规范化。
- 启动参数构造，确认回环地址、动态端口和独立 profile。
- 配置默认值、非法端口和非法模式。
- 上下文来源排序、标签包裹、长度限制和超限错误。
- 敏感信息不进入日志对象。
- 任务状态机：成功、登录缺失、超时、取消、断线、重复执行。
- 通用网页 adapter 和专用 adapter 的 mock 页面：找到 composer、发送、等待完成、提取回答。
- Learning 结果保存：新建笔记、追加前预览、更新失败不丢失原文。
- IPC/preload 类型契约和错误码传递。

### 本机手动验收

1. 关闭所有不需要的 Edge 实例，启动应用管理 profile。
2. 第一次运行打开登录页，完成人工登录。
3. 在学习中心选一个 skill 和一条笔记，输入测试问题。
4. 发送前确认最终提示词只包含勾选来源。
5. 网页 AI 返回后，确认回答可预览、复制和保存。
6. 关闭 Edge 后重试，确认显示 CDP 断开并可重新启动。
7. 未登录、站点报错、空回答、超时和手动关闭标签页时，确认 UI 能恢复。
8. 确认日常 Edge 的 Default profile、标签页和历史记录没有被关闭或修改。

真实浏览器 smoke test 需要用户本机登录态，不作为 CI 测试，也不把账号信息写入测试 fixture。按仓库规则，涉及 `node.exe`、`npm` 或依赖安装的验证命令必须提权执行；本计划编写阶段不运行这些命令，也不执行 build。

## 十一、风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 网页 AI DOM/文案变化 | 自动化突然失败 | 通用和专用 adapter 集中管理 selector，错误码明确，保留手动重试和诊断 |
| Edge 默认 profile 被锁 | 浏览器启动失败或资料损坏 | MVP 使用应用独立 profile，不复用日常 profile |
| CDP 端口被占用或暴露 | 无法连接或本机其他进程可控制浏览器 | 动态端口、只绑定回环、不返回 CDP URL |
| 用户和自动化同时操作 | 发送到错误会话或关闭错误标签页 | 应用专属 profile、应用专属标签页、任务锁和归属 tracking |
| 未登录/验证码/额度限制 | 任务无法继续 | 返回状态给用户，不代填验证码、不绕过限制 |
| 个人信息泄露 | 隐私风险 | 明确勾选、发送前预览、safeStorage、日志脱敏、默认不保存 prompt |
| 长上下文导致网页拒绝或截断 | 结果质量差 | 字符限制、来源统计、超限提示，不静默丢弃内容 |
| 浏览器关闭/断网 | 任务悬挂 | 超时、断线监听、取消和 finally 清理资源 |
| 网页自动化违反站点规则 | 账号或产品风险 | 仅模拟用户可见网页操作，限制频率，不绕过限制；上线前确认适用条款 |
| headless 模式不稳定 | 登录或风控异常 | MVP headed，headless 只作为后续可选实验，不作为默认承诺 |

## 十二、MVP 定义

满足以下条件才算第一版完成：

- 使用用户指定的 Edge 可执行文件启动独立 profile。
- 能通过 loopback CDP 建立连接并检测配置的网页 AI 站点登录状态。
- 学习中心可以选择 skill、学习笔记、个人上下文和任务。
- 发送前可以查看最终提示词和目标站点。
- 配置的网页 AI 站点可以完成一次文本问答并返回回答；常见页面由通用 adapter 处理。
- 任务有进度、取消、超时、未登录和断线错误状态。
- 只关闭应用创建的标签页，不影响用户日常浏览器。
- 回答默认不覆盖原笔记，保存前需要用户确认。
- 不记录 Cookie、Token、个人上下文原文或 CDP URL。
- 自动化测试覆盖上下文编排、启动参数、状态机和 Learning 保存链路。

第一版不承诺：图片/文件上传、语音、网页搜索开关、工具调用、多轮会话复用、每个站点的专用 selector、批量任务和无界面后台运行。通用 adapter 只承诺常见网页对话界面的兼容性。

## 十三、待评审决策

推荐在进入 P0 之前确认以下选择：

| 问题 | 推荐选择 | 原因 |
| --- | --- | --- |
| 是否复用日常 Edge profile | 否，使用应用独立 profile | 避免锁、误操作和隐私扩大 |
| 是否默认连接用户手动启动的 Edge | 否，默认 managed-edge | 生命周期和故障恢复可控 |
| 是否立即支持隐藏浏览器 | 否，先 headed | 首次登录、验证码和 selector 调试更可靠 |
| 默认 adapter | 通用网页 AI | 覆盖更多可网页登录的 AI 站点；结构特殊的站点再增加专用 adapter |
| 是否保存完整 prompt 历史 | 否，默认只保存状态和结果元数据 | 降低个人信息泄露面 |
| 是否允许自动回写当前笔记 | 否，必须预览确认 | 防止 AI 回答覆盖原始学习资料 |
| 浏览器控制库 | `playwright-core` | 不下载 Chromium，适配现有 Edge；需确认新增依赖 |

如果接受这些选择，后续实现可以从 P0 的 Edge/CDP 本机验证开始；P0 只验证连接和一次短文本问答，不会接入学习中心 UI，也不会修改现有学习数据。
