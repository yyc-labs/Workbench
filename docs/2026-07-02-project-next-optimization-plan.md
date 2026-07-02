# 2026-07-02 项目下一轮优化计划

## 背景

本计划基于当前仓库只读扫描结果整理，目标不是继续做泛泛重构，而是把下一轮优化聚焦到明确会降低维护风险、架构漂移风险和回归成本的点。

当前项目整体分层已经比较清晰：

- `App.tsx` 已基本收敛为路由和应用壳层。
- preload 已按 domain 拆分。
- renderer store 已按 slice 拆分。
- 关键纯逻辑已有 `node --test` 覆盖。
- 多轮历史优化计划已覆盖 Runtime 刷新、主题初始化、App / Transcript 拆分、LearningCenter 拆分和 AI Gateway 协议硬化。

下一轮不应重复已完成的结构性优化，而应优先处理仍然存在的高收益热点。

## 截至 2026-07-03 的执行状态

本计划已完成前四个阶段，并推进了阶段 5 的前两个 Settings 热点。当前状态如下：

- 阶段 1 已完成：preload / renderer 共享 `ElectronApi` 类型契约，preload 使用 `satisfies` 校验，renderer 的 `Window.electronAPI` 改为引用 shared contract，并清理了多处 `window.electronAPI as unknown as ...` 局部 cast。
- 阶段 2 已完成：`PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS` 已移动到 shared，`main/config.ts` 不再从 renderer 引入文档链接 helper。
- 阶段 3 已完成本轮拆分目标：AI Gateway 已抽出 `gateway-http.ts`、`gateway-routes.ts`、`gateway-upstream.ts`、`gateway-trace.ts`、`gateway-request-handlers.ts`，`gateway-server.ts` 更接近生命周期、依赖注入和路由装配层。后续如继续协议硬化，可再评估 stream proxy / stream conversion 的二次拆分。
- 阶段 4 已完成：原 `ai-gateway-adapters.test.mjs` 已拆成按职责命名的多个测试文件，并新增共享测试 helper。
- 阶段 5 部分完成：`SettingsAiGatewayPanel.tsx` 已拆出 draft hook、provider editor、说明卡片和删除确认弹窗；`SettingsRuntimePanel.tsx` 已拆出 terminal inventory hook、diagnostics card 和 terminal inventory 展示组件。
- 阶段 6、阶段 7 尚未开始。

当前验证结果：

```text
npm run typecheck
npm test
```

均已通过；最近一次全量测试为 `196 passed, 0 failed`。按项目规则未执行 build。

当前判断：

- `SettingsRuntimePanel.tsx` 剩余的 custom-script history / 删除确认 / 保存同步链路仍有拆分价值，但不是必须立即处理。
- 如果近期还会继续修改 Runtime custom-script、WSL 路径或历史记录行为，建议继续抽成页面私有 hook。
- 如果近期不再触达 Runtime 设置，建议先暂停该文件，转向 `DetailAiCommitPanel.tsx`、`CodeWorkspacePanel.tsx` 或 `code.markdown.tsx` 等后续热点。

## 当前主要问题

### P0：AI Gateway 服务文件职责过重

`src/core/electron/main/ai-gateway/gateway-server.ts` 约 3000 行，同一个类同时承担：

- HTTP 路由分发。
- 请求体读取与错误响应。
- provider / model 选择。
- 三类协议路径处理：Anthropic Messages、OpenAI Responses、OpenAI Chat Completions。
- 上游 fetch、认证、超时。
- JSON 与 SSE passthrough。
- Chat -> Anthropic / Responses 流式转换。
- 工具调用校验。
- trace、structured log、recent log 存储。

这会导致两个问题：

- 后续继续增强协议保真、工具调用校验或日志观测时，改动面过大。
- 流式路径和错误路径混在一起，回归风险难以局部控制。

### P0：IPC / preload API 类型契约存在漂移风险

preload 已导出 `ElectronAPI = typeof api`，但 renderer 侧在 `appStore.types.ts` 手写了完整 `window.electronAPI` 声明。随着 IPC 方法增多，这两份契约容易漂移。

代码中还存在多处：

```ts
window.electronAPI as unknown as { ... }
```

这些局部 cast 多数是历史兼容写法，会绕开类型系统，降低 IPC 契约检查价值。

### P0：main 依赖 renderer 的架构边界问题

`src/core/electron/main/config.ts` 直接从 renderer 引入：

```ts
../../renderer/lib/projectDocLinks
```

这违反当前架构方向。main 不应依赖 renderer。该常量目前是纯默认值，适合下沉到 `src/core/shared/`。

### P1：多个 renderer 页面 / 面板仍是高维护成本热点

仍然偏大的文件包括：

- `SettingsAiGatewayPanel.tsx`
- `SettingsRuntimePanel.tsx`
- `SettingsCodexPanel.tsx`
- `SettingsAiRuntimePanel.tsx`
- `DetailAiCommitPanel.tsx`
- `CodeWorkspacePanel.tsx`
- `code.markdown.tsx`

这些文件已有一定拆分基础，不建议按行数机械搬迁。下一轮应按职责边界拆：

- 表单草稿状态。
- 数据加载和保存副作用。
- 状态卡片 / 说明卡片。
- provider / profile / binding helper。
- Git diff / conflict / branch manager 子状态。
- Markdown renderer、代码块、媒体和 diagram 子能力。

### P1：用户可见文案仍有硬编码中文

学习中心、手势提示、部分弹窗 aria、主进程菜单和通知仍有中文硬编码。新增功能已经要求接入 i18n messages，后续应逐步清理历史硬编码，避免中文 / 英文界面行为不一致。

### P1：主题和视觉 token 仍有少量分叉

主要集中在：

- `Terminal.tsx` 的 xterm 主题硬编码颜色。
- `legacy-pages.css` 的遗留按钮 / badge 颜色。
- 少量组件直接读取 `document.documentElement.getAttribute('data-theme')` 或自建 `MutationObserver`。

已有 `useEffectiveTheme`，后续应继续复用该 hook 或抽象纯 resolver，减少重复主题监听。

### P2：工程质量门禁仍偏轻

当前 `package.json` 只有：

- `npm run typecheck`
- `npm test`

没有 lint、format 或 CI。考虑到项目 build 成本较高，不应默认引入 build 门禁，但可以先建立轻量质量门禁。

## 执行原则

1. 不为“好看”做大范围重构，只处理能降低真实风险的边界。
2. 所有跨层改动遵守 `renderer -> preload -> main -> service` 的链路。
3. main / shared / renderer 依赖方向必须保持清晰。
4. 用户可见文案新增或迁移时必须进入 i18n messages。
5. 视觉改动优先使用现有 token、`surface-card`、`quiet-control`、`app-chrome`。
6. 默认不执行 build；验证优先 `npm run typecheck` 和 `npm test`，且 Node / npm 命令按仓库规则提权执行。
7. 工作区已存在改动时，以当前内容为基准，不覆盖无关改动。

## 分阶段计划

### 阶段 1：IPC 类型契约收敛（已完成）

目标：减少 `window.electronAPI` 契约漂移和局部 cast。

执行结果：

- 新增 shared preload API contract。
- preload 的 `api` 已使用 shared contract 做 `satisfies` 校验。
- renderer 的 `Window.electronAPI` 声明已改为引用 shared contract。
- AI Commit / Transcript / Home / Detail 等位置的重复局部 cast 已清理。

建议步骤：

1. 在 `src/core/shared/` 新增 preload API contract 类型文件。
2. 将各 domain 的 API 类型按 domain 组织，例如 core、runtime、project-file、git、transcript、learning、agent-logs、ai-gateway。
3. preload 的 `api` 使用该 shared 类型做 `satisfies` 校验。
4. renderer 的 global `Window.electronAPI` 声明改为引用 shared contract。
5. 清理 `ProjectCard`、`Detail`、`TranscriptPage`、`useAiCommitFlow` 等位置的重复 `as unknown as`。
6. 如仍需兼容旧 preload，集中提供一个 feature-detect helper，而不是每个组件局部声明。

验收标准：

- preload 和 renderer 共享同一份 API 类型契约。
- 不再因为新增 IPC 方法需要手写两份声明。
- 现有 AI Commit 相关局部 cast 明显减少或清零。

### 阶段 2：修复 main -> renderer 依赖方向（已完成）

目标：消除主进程直接依赖 renderer helper 的边界问题。

执行结果：

- `PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS` 已下沉到 `src/core/shared/projectDocLinks.ts`。
- renderer 继续保留展示 label helper。
- main `config.ts` 已改为从 shared 引入默认值。

建议步骤：

1. 将 `PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS` 移到 `src/core/shared/projectDocLinks.ts` 或同类 shared 文件。
2. renderer `projectDocLinks.ts` 从 shared 引入默认值，继续保留 renderer-only label helper。
3. main `config.ts` 改为从 shared 引入默认值。
4. 搜索 `src/core/electron` 和 `src/core/shared` 中是否还有对 renderer 的不合理依赖。

验收标准：

- `src/core/electron/main/config.ts` 不再引用 `../../renderer/...`。
- shared 不反向依赖 main / preload / renderer。
- renderer 现有文档链接展示行为不变。

### 阶段 3：AI Gateway 服务拆分（已完成本轮目标）

目标：把 `gateway-server.ts` 从巨型类收敛为可局部验证的模块，服务行为不变。

执行结果：

- 已抽出 HTTP helper、路由识别、上游 URL / auth / fetch helper、trace helper 和 route handler。
- `gateway-server.ts` 已移除三类协议 route handler 主体，转为分发到 `gateway-request-handlers.ts`。
- trace 构建、route data 更新和工具校验诊断写入已迁到 `gateway-trace.ts`。
- stream proxy 逻辑本轮未继续拆出，保留为后续协议硬化时的可选增量。

建议拆分边界：

- `gateway-http.ts`：HTTP response helper、body parse、route error payload。
- `gateway-routes.ts`：`/health`、`/v1/messages`、`/v1/responses`、`/v1/chat/completions` 路由分发。
- `gateway-upstream.ts`：Chat / Responses / Anthropic upstream fetch、auth、timeout、URL 构造。
- `gateway-trace.ts`：`GatewayRequestTrace`、trace 更新、finalize。
- `gateway-stream-proxy.ts`：raw passthrough stream、Responses passthrough stream、Anthropic passthrough stream。
- `gateway-chat-stream-conversions.ts`：Chat stream -> Anthropic / Responses 转换。

实施顺序：

1. 先抽纯 helper，不改行为。
2. 再抽 trace/logging，保持 existing tests 通过。
3. 再抽 upstream fetch，确保认证、timeout、headers 和 trace snapshot 不变。
4. 最后抽 stream proxy，避免一次性移动所有 SSE 逻辑。

验收标准：

- `gateway-server.ts` 只保留 server 生命周期、依赖注入和路由装配。
- 原有 AI Gateway adapter / stream / passthrough 测试继续通过。
- 不降低当前工具调用校验和 structured log 记录能力。

### 阶段 4：AI Gateway 测试拆分（已完成）

目标：测试结构与实现结构对齐，降低单测试文件维护成本。

执行结果：

- 原单体测试已拆为：
  - `ai-gateway.adapters.test.mjs`
  - `ai-gateway.tool-validation.test.mjs`
  - `ai-gateway.server-chat-stream.test.mjs`
  - `ai-gateway.server-anthropic-passthrough.test.mjs`
  - `ai-gateway.server-responses-passthrough.test.mjs`
  - `ai-gateway.config-registry.test.mjs`
- 公共测试 helper 已下沉到 `test/helpers/ai-gateway-test-helpers.mjs`。
- 原测试用例已按名称对齐，未遗漏覆盖项。

建议拆分：

- `ai-gateway.adapters.test.mjs`
- `ai-gateway.tool-validation.test.mjs`
- `ai-gateway.server-chat-stream.test.mjs`
- `ai-gateway.server-anthropic-passthrough.test.mjs`
- `ai-gateway.server-responses-passthrough.test.mjs`
- `ai-gateway.config-registry.test.mjs`

验收标准：

- 当前 1700+ 行测试文件被拆成按职责命名的小文件。
- 公共 HTTP fake server helper 下沉到 test helper。
- 流式实时 flush 行为仍有覆盖。

### 阶段 5：Settings / Detail / Code 热点拆分（部分完成）

目标：继续降低 renderer 高复杂度文件的改动面，但不改变产品行为。

已完成：

- `SettingsAiGatewayPanel.tsx`
  - 已抽出 `useAiGatewaySettingsDraft`。
  - 已抽出 provider draft helper 和共享类型。
  - 已抽出 provider editor。
  - 已抽出 Gateway quick start / guide / advanced meaning / binding card。
  - 已抽出 provider 删除确认弹窗。

- `SettingsRuntimePanel.tsx`
  - 已抽出 terminal process inventory hook。
  - 已抽出 runtime diagnostics card。
  - 已抽出 terminal inventory 展示组件。
  - stop-all / stop process / kill session 动作已随 inventory hook 收敛。

暂缓：

- `SettingsRuntimePanel.tsx` 的 custom-script history、删除确认和保存同步链路仍可继续拆，但目前不是必须立即处理。除非近期继续修改 Runtime custom-script / WSL 路径行为，否则建议先转向其他热点。

优先级建议：

1. `SettingsAiGatewayPanel.tsx`（已完成）
   - 抽 provider draft helper。
   - 抽 Gateway guide / advanced meaning cards。
   - 抽 binding card / provider usage card。
   - 抽 `useAiGatewaySettingsDraft`。

2. `SettingsRuntimePanel.tsx`（部分完成）
   - 抽 terminal process inventory hook。
   - 抽 runtime diagnostics card。
   - 抽 stop-all / kill session action helpers。
   - 可选继续：抽 custom-script history / delete confirm / save sync hook。

3. `DetailAiCommitPanel.tsx`
   - 抽 Git diff drawer 状态协调。
   - 抽 conflict action handlers。
   - 抽 branch operation state。

4. `CodeWorkspacePanel.tsx` 和 `code.markdown.tsx`
   - 抽 markdown renderer 组件。
   - 抽代码块渲染和 path action。
   - 抽 Mermaid / box table / media 的 props boundary。

验收标准：

- 入口文件更接近状态选择和区域装配。
- 子组件边界对应业务职责，不只是按行数搬运。
- 不新增跨页面全局状态，除非明确需要共享或持久化。

### 阶段 6：i18n 与主题 token 清理（未开始）

目标：减少历史硬编码，提高深浅色和多语言一致性。

建议范围：

1. 学习中心相关文案迁入 `src/core/renderer/i18n/messages`。
2. 手势提示接入 messages，或至少集中到可按 locale 解析的 helper。
3. `ModalShell` aria 文案接入 common messages。
4. `Terminal.tsx` xterm 主题颜色从 token resolver 或集中常量读取。
5. `legacy-pages.css` 中仍被使用的规则迁到 token 风格；未使用规则再考虑删除。
6. 直接读取 `data-theme` 的组件优先改用 `useEffectiveTheme` 或共享 resolver。

验收标准：

- 新增或迁移的用户可见文案不再散落在页面组件中。
- 深浅色主题行为不回退。
- legacy 样式继续减少，不新增随机硬编码色。

### 阶段 7：轻量工程门禁（未开始）

目标：在不引入 build 成本的前提下提高基础质量。

建议步骤：

1. 增加 CI 或本地脚本，默认只跑：
   - `npm run typecheck`
   - `npm test`
2. 暂不默认跑 build。
3. lint / format 可作为后续独立计划评估，不在本轮强制引入。
4. 将仍被 git 跟踪的 `logs/` 中文说明文档评估迁移到 `docs/`，避免 logs 目录语义混乱。

验收标准：

- 常规 PR / 提交前有轻量验证入口。
- 不增加默认 build 时间。
- 文档目录职责更清晰。

## 推荐执行顺序

已完成顺序：

1. 阶段 2：修复 main -> renderer 依赖。
2. 阶段 1：收敛 IPC 类型契约。
3. 阶段 3 + 阶段 4：拆 AI Gateway 服务和测试。
4. 阶段 5：已完成 `SettingsAiGatewayPanel.tsx`，并完成 `SettingsRuntimePanel.tsx` 的 terminal inventory / diagnostics 拆分。

后续建议顺序：

1. 若近期继续修改 Runtime custom-script / WSL 路径行为，先完成 `SettingsRuntimePanel.tsx` 剩余 custom-script history hook 拆分。
2. 若 Runtime 设置近期不再触达，转向 `DetailAiCommitPanel.tsx`。
3. 之后按触达频率推进 `CodeWorkspacePanel.tsx` 和 `code.markdown.tsx`。
4. 阶段 6 可结合页面改动顺手推进 i18n 和主题 token。
5. 阶段 7 放在结构改动趋稳后再补轻量门禁。

## 验证策略

每个阶段完成后优先执行：

```text
npm run typecheck
npm test
```

注意：

- 本仓库 Node / npm 命令需要按规则提权执行。
- 默认不执行 `npm run build`。
- 若测试涉及本地端口或系统能力，失败时需要记录是代码问题还是环境限制。

## 非目标

- 不重写 AI Gateway 协议模型。
- 不改 provider 配置语义。
- 不改 Runtime / WSL 行为。
- 不做大规模 UI 视觉重设。
- 不新增第三方依赖。
- 不默认执行 build 或打包。
