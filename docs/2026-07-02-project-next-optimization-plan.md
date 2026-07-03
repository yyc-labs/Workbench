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

本计划已完成前四个阶段，并继续推进了阶段 5、阶段 6 和阶段 7。当前状态如下：

- 阶段 1 已完成：preload / renderer 共享 `ElectronApi` 类型契约，preload 使用 `satisfies` 校验，renderer 的 `Window.electronAPI` 改为引用 shared contract，并清理了多处 `window.electronAPI as unknown as ...` 局部 cast。
- 阶段 2 已完成：`PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS` 已移动到 shared，`main/config.ts` 不再从 renderer 引入文档链接 helper。
- 阶段 3 已完成本轮拆分目标：AI Gateway 已抽出 `gateway-http.ts`、`gateway-routes.ts`、`gateway-upstream.ts`、`gateway-trace.ts`、`gateway-request-handlers.ts`，`gateway-server.ts` 更接近生命周期、依赖注入和路由装配层。后续如继续协议硬化，可再评估 stream proxy / stream conversion 的二次拆分。
- 阶段 4 已完成：原 `ai-gateway-adapters.test.mjs` 已拆成按职责命名的多个测试文件，并新增共享测试 helper。
- 阶段 5 继续推进：`SettingsRuntimePanel.tsx` 已再抽出 runtime entrypoint history / 删除确认 / 保存同步 hook；`DetailAiCommitPanel.tsx` 已抽出 diff/conflict hook 与 branch manager hook；`CodeWorkspacePanel.tsx` 已抽出 tree path action hook；`code.markdown.tsx` 已抽出 structured block 渲染 helper。
- 阶段 6 已完成本轮目标：`ModalShell` 遮罩 aria 已接入 common messages；Learning Center 主界面、编辑面板、删除/frontmatter 弹窗、左右侧栏、保存/分类提示、Learning Markdown context menu / templates 和鼠标手势提示已接入 messages；main 已新增 `mainI18n.ts`，托盘菜单、Feishu 通知、Learning 默认新建内容、Git diff 空输出提示已按 locale 解析；`Terminal.tsx`、`LearningEditorPanel.tsx`、`monacoEnvironment.ts`、`transcriptShareSnapshot.ts` 已统一复用 shared theme resolver；`legacy-pages.css` 的遗留按钮 / badge 主色已切换为 token。
- 阶段 7 已完成：新增 `npm run verify`，新增仅跑 `typecheck` + `test` 的 GitHub Actions workflow，并将被 git 跟踪的 `logs/*.md` 说明文档迁移到 `docs/logs/`。
- 补充核对：当前代码中已不再检出 `window.electronAPI as unknown as`；`main/config.ts` 已只从 shared 读取文档链接默认值；`SettingsAiGatewayPanel.tsx` 当前约 311 行，可从主要热点列表移除。

当前验证结果：

```text
npm run typecheck
npm test
```

均已通过；最近一次全量测试为 `196 passed, 0 failed`。按项目规则未执行 build。

当前判断：

- `SettingsRuntimePanel.tsx` 的 custom-script history / 删除确认 / 保存同步链路本轮已下沉，后续只有在继续修改 Runtime custom-script / WSL 路径行为时再考虑二次细分。
- `DetailAiCommitPanel.tsx` 与 `CodeWorkspacePanel.tsx` 仍然不算小，但入口文件已进一步靠近状态装配层，后续更适合按触达再做收口，而不是继续机械拆分。
- 阶段 6 当前轮计划项已收口；如果后续继续做 i18n / 主题清理，更适合转向 Transcript Share fallback 文案、少量 shell / 诊断文本，以及 `Terminal.tsx` 的 xterm 色板 token 化。

## 当前剩余问题与后续热点

### P1：AI Gateway 仍有二次拆分空间

阶段 3 已完成第一轮拆分，但 `src/core/electron/main/ai-gateway/gateway-server.ts` 当前仍约 2380 行，同一个类内仍保留了较多请求编排与流式处理路径：

- HTTP 路由分发。
- provider / model 选择。
- 三类协议路径处理：Anthropic Messages、OpenAI Responses、OpenAI Chat Completions。
- JSON 与 SSE passthrough。
- Chat -> Anthropic / Responses 流式转换。
- 部分 trace、structured log、recent log 收口。

它已经不再是“必须立刻处理”的阻塞项，但如果后续继续增强协议保真、工具调用校验或日志观测，仍建议把 stream proxy / conversion 继续下沉，避免再次把协议细节堆回入口类。

### 已解决并移出当前问题列表

- IPC / preload API 契约漂移问题已在阶段 1 收口：preload / renderer 已共享同一份 contract，局部 `as unknown as` 已清理。
- `main -> renderer` 的文档链接默认值依赖已在阶段 2 修复：默认值已下沉到 `src/core/shared/projectDocLinks.ts`。
- 阶段 6 的本轮剩余项已收口：Learning Markdown 菜单 / 模板、Learning 页面残余保存与分类提示、鼠标手势提示、主进程托盘 / 通知 / 默认学习内容与 `legacy-pages.css` 历史色值已完成清理。

### P1：多个 renderer 页面 / 面板仍是高维护成本热点

当前更值得继续投入的热点包括：

- `SettingsRuntimePanel.tsx`（约 790 行）
- `SettingsCodexPanel.tsx`（约 953 行）
- `SettingsAiRuntimePanel.tsx`（约 936 行）
- `DetailAiCommitPanel.tsx`（约 1168 行）
- `src/core/renderer/pages/code/CodeWorkspacePanel.tsx`（约 1007 行）
- `src/core/renderer/pages/code/code.markdown.tsx`（约 1019 行）

`SettingsAiGatewayPanel.tsx` 当前约 311 行，本轮可视为已完成收口，不再作为优先热点。

这些文件已有一定拆分基础，不建议按行数机械搬迁。下一轮应按职责边界拆：

- 表单草稿状态。
- 数据加载和保存副作用。
- 状态卡片 / 说明卡片。
- provider / profile / binding helper。
- Git diff / conflict / branch manager 子状态。
- Markdown renderer、代码块、媒体和 diagram 子能力。

### P1：主题和视觉 token 仍有少量分叉

主要集中在：

- `Terminal.tsx` 的 xterm 主题硬编码颜色。
- 少量组件直接读取 `document.documentElement.getAttribute('data-theme')` 或自建 `MutationObserver`。

已有 `useEffectiveTheme`，后续应继续复用该 hook 或抽象纯 resolver，减少重复主题监听。`legacy-pages.css` 目前仍保留少量老版式规则，但本轮已先把仍在使用的按钮 / badge 色值切到 token。

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

### 阶段 5：Settings / Detail / Code 热点拆分（继续完成）

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
  - 已抽出 runtime entrypoint history / delete confirm / save sync hook。

- `DetailAiCommitPanel.tsx`
  - 已抽出 diff/conflict 状态 hook。
  - 已抽出 branch manager 状态与操作 hook。

- `CodeWorkspacePanel.tsx`
  - 已抽出 tree path action hook。

- `code.markdown.tsx`
  - 已抽出 structured block 渲染 helper。

暂缓：

- `SettingsRuntimePanel.tsx` 已完成当前轮剩余拆分目标，除非近期继续修改 Runtime custom-script / WSL 路径行为，否则建议先不再继续拆。

后续建议顺序：

1. `SettingsRuntimePanel.tsx`
   - 仅在继续修改 Runtime custom-script / WSL 路径行为时，再评估更细的页面私有 hook。

2. `DetailAiCommitPanel.tsx`
   - 本轮已完成 diff/conflict 与 branch manager 下沉，后续只做收口型改动。

3. `src/core/renderer/pages/code/CodeWorkspacePanel.tsx`
   - 本轮已完成 tree path action 下沉，后续再视触达补 markdown workspace 级状态装配。

4. `src/core/renderer/pages/code/code.markdown.tsx`
   - 本轮已完成 structured block helper 下沉，后续如继续增强 Markdown 媒体能力，再按 props boundary 收口。

验收标准：

- 入口文件更接近状态选择和区域装配。
- 子组件边界对应业务职责，不只是按行数搬运。
- 不新增跨页面全局状态，除非明确需要共享或持久化。

### 阶段 6：i18n 与主题 token 清理（已完成本轮目标）

目标：减少历史硬编码，提高深浅色和多语言一致性。

本轮已完成：

1. `ModalShell` 遮罩 aria 文案接入 common messages。
2. Learning Center 主界面、编辑面板、删除/frontmatter 弹窗、左右侧栏、默认新建内容、保存状态文案和分类管理提示接入 learning messages。
3. Learning Markdown context menu / templates 全量改为按 locale 读取 messages，并保持旧调用默认中文行为以兼容现有测试。
4. 鼠标手势提示接入 common messages，不再散落中文硬编码。
5. `Terminal.tsx`、`LearningEditorPanel.tsx`、`monacoEnvironment.ts`、`transcriptShareSnapshot.ts` 统一改用 shared theme resolver。
6. main 新增 `mainI18n.ts`，托盘菜单、Feishu 通知、Learning 默认新建内容和 Git diff 空输出提示改为按 locale 解析。
7. `legacy-pages.css` 中仍被使用的按钮 / badge 主色迁到 token 风格。

后续可选：

1. 若继续做主题清理，可再评估 `Terminal.tsx` 的 xterm 色板 token 化和剩余 direct theme read 的收口。
2. 若继续做 i18n 深挖，可再处理 Transcript Share fallback 文案与少量 shell / 诊断文本。

验收标准：

- 新增或迁移的用户可见文案不再散落在页面组件中。
- 深浅色主题行为不回退。
- legacy 样式继续减少，不新增随机硬编码色。

### 阶段 7：轻量工程门禁（已完成）

目标：在不引入 build 成本的前提下提高基础质量。

执行结果：

1. `package.json` 已新增 `npm run verify`，默认只跑：
   - `npm run typecheck`
   - `npm test`
2. 已新增 `.github/workflows/verify.yml`，默认不跑 build。
3. `logs/` 下仍被 git 跟踪的说明文档已迁移到 `docs/logs/`。
4. lint / format 仍作为后续独立计划评估，不在本轮强制引入。

验收标准：

- 常规 PR / 提交前有轻量验证入口。
- 不增加默认 build 时间。
- 文档目录职责更清晰。

## 推荐执行顺序

已完成顺序：

1. 阶段 2：修复 main -> renderer 依赖。
2. 阶段 1：收敛 IPC 类型契约。
3. 阶段 3 + 阶段 4：拆 AI Gateway 服务和测试。
4. 阶段 5：已完成 `SettingsAiGatewayPanel.tsx`、`SettingsRuntimePanel.tsx` 的 runtime history hook 下沉、`DetailAiCommitPanel.tsx` 的 diff / branch hook 下沉，以及 `CodeWorkspacePanel.tsx` / `code.markdown.tsx` 的本轮目标拆分。

后续建议顺序：

1. 回到仍然体量偏大的 `SettingsCodexPanel.tsx`、`SettingsAiRuntimePanel.tsx`，按触达继续做职责下沉。
2. 若继续做视觉 / 主题收口，再处理 `Terminal.tsx` 的 xterm 色板与剩余 direct theme read。
3. 若继续做历史 i18n 清理，再处理 Transcript Share fallback 文案和少量 shell / 诊断文本。

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
