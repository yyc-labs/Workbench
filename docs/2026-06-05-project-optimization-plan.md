# IDE Electron 拆分文件计划（2026-06-05）

## 1. 目标

这份文档只保留一件事：拆分当前项目里的超大文件和超大组件，降低维护成本，减少后续改动时的联动风险。

本轮不讨论：

- 安全整改
- 性能优化
- 测试体系
- 脚本改造
- UI 视觉调整

## 2. 当前最需要拆分的文件

按当前代码规模，优先级如下：

1. `src/core/renderer/pages/code/CodeWorkspacePanel.tsx`，约 2900 行
2. `src/core/electron/main/index.ts`，约 2800 行
3. `src/core/renderer/pages/detail/DetailAiCommitPanel.tsx`，约 2200 行
4. `src/core/renderer/pages/detail/DetailDocumentationCard.tsx`，约 1300 行
5. `src/core/electron/main/project-file-service.ts`，原约 1160 行，已拆分完成
6. `src/core/renderer/pages/detail/DetailGitDiffDrawer.tsx`，约 1000 行
7. `src/core/renderer/pages/code/MonacoCodeEditor.tsx`，约 900 行

## 2.1 当前进度

已完成：

- `src/core/electron/main/project-file-service.ts`
- `src/core/electron/main/index.ts` 第一轮拆分

本次拆分结果：

- 兼容入口保留在 `src/core/electron/main/project-file-service.ts`
- 共享工具拆到 `src/core/electron/main/project-file/shared.ts`
- 文件树和文件名搜索拆到 `src/core/electron/main/project-file/tree-service.ts`
- 内容搜索拆到 `src/core/electron/main/project-file/content-search-service.ts`
- 文件读写拆到 `src/core/electron/main/project-file/read-write-service.ts`
- `src/core/electron/main/window/createWindow.ts` 承接窗口创建、主题背景和窗口快捷键
- `src/core/electron/main/shell/openers.ts` 承接打开文件夹、VS Code、路径终端等外部打开逻辑

当前状态：

- 外部调用方式未改
- `project-file-service.ts` 已从大体积实现文件收缩为兼容出口
- `index.ts` 已先收缩掉窗口创建和 shell opener 两块平台细节
- IPC 注册改为启动期单次注册，避免窗口重建时重复挂 handler
- `npm run typecheck` 已通过

## 3. 拆分原则

- 先拆职责，再拆体积。不要只是把一个大文件机械切成多个小文件。
- 先抽纯函数和类型，再抽 hook，最后抽 JSX 和 service。
- 单次拆分只处理一个核心文件，避免多个大文件同时改动。
- 拆分后入口文件只负责编排，不再承载大量细节实现。
- 新拆出来的模块命名要直接表达职责，避免 `utils2`、`helpers-new` 这类过渡命名。

## 4. 拆分计划

### 4.1 拆 `src/core/electron/main/index.ts`

当前问题：

- 同时承担窗口创建、IPC 注册、Git、AI Commit、Runtime、terminal、shell 打开等多类职责。
- 入口文件过大，任何主进程改动都要进入同一个文件处理。

目标：

- 保留 `index.ts` 作为启动编排层。
- 把具体能力拆到独立 service 或模块中。

建议拆分：

- `src/core/electron/main/window/createWindow.ts`
- `src/core/electron/main/ipc/registerIpcHandlers.ts`
- `src/core/electron/main/runtime/runtime-service.ts`
- `src/core/electron/main/git/git-service.ts`
- `src/core/electron/main/ai-commit/ai-commit-service.ts`
- `src/core/electron/main/shell/openers.ts`

拆分顺序：

1. 先抽 `createWindow`
2. 再抽 `registerIpcHandlers`
3. 再把 Git、Runtime、AI Commit、shell 打开逻辑逐个迁出

当前进度：

- `createWindow` 已迁到 `window/createWindow.ts`
- shell opener 已迁到 `shell/openers.ts`
- `registerIpcHandlers` 仍留在 `index.ts`，但已改为单次注册
- Git、Runtime、AI Commit 仍在 `index.ts`，是下一轮主要体积来源

验收：

- `index.ts` 控制在 400-600 行以内
- 只保留 app lifecycle、能力初始化、模块装配

### 4.2 拆 `src/core/renderer/pages/code/CodeWorkspacePanel.tsx`

当前问题：

- 同时承载文件树、文件搜索、Monaco、Markdown preview、图片粘贴、drawer、session 持久化等职责。
- 这是当前渲染层最重的单文件。

目标：

- 把“工作区编排”与“具体子功能”分开。
- 让主组件只负责布局和状态串联。

建议先拆纯逻辑：

- `markdownImageResolver.ts`
- `useProjectCodeSession.ts`
- `useCodeSearchState.ts`
- `useMarkdownPasteImage.ts`

建议再拆 UI：

- `CodeWorkspaceHeader.tsx`
- `CodeEditorPane.tsx`
- `MarkdownPreviewPane.tsx`
- `CodeSearchPanel.tsx`

验收：

- `CodeWorkspacePanel.tsx` 控制在 700-900 行以内
- 主组件以编排为主，不再包含大段 Markdown、编辑器和搜索细节实现

### 4.3 拆 `src/core/renderer/pages/detail/DetailAiCommitPanel.tsx`

当前问题：

- 混合了 Git 状态计算、分支操作、AI 日志、历史提交、冲突处理相关逻辑。
- 业务密度高，后续继续加功能会更难维护。

目标：

- 分离“Git 计算逻辑”和“面板展示逻辑”。
- 分离“左中右区域 UI”和“操作判断逻辑”。

建议拆分：

- `gitOperationState.ts`
- `branchDisplay.ts`
- `commitHistoryViewModel.ts`
- `GitOperationToolbar.tsx`
- `GitChangedFilesPanel.tsx`
- `BranchManagerPanel.tsx`
- `AiCommitLogPanel.tsx`

验收：

- `DetailAiCommitPanel.tsx` 控制在 800-1000 行以内
- 入口面板主要保留状态组织、事件分发和布局拼装

### 4.4 拆 `src/core/renderer/pages/detail/DetailDocumentationCard.tsx`

当前问题：

- 文档卡片逻辑和展示内容都比较重，已经超过单组件舒适区间。

目标：

- 把卡片内部不同区域拆成独立展示组件。
- 把数据整理逻辑从组件主体中抽离。

建议拆分方向：

- 文档列表区域
- 标签/筛选区域
- 链接编辑区域
- 展示映射或 view-model 逻辑

验收：

- 主卡片组件不再直接承载大段条件渲染和数据整理代码

### 4.5 拆 `src/core/electron/main/project-file-service.ts`

当前问题：

- 文件树、文件搜索、内容搜索、文件读写、图片写入都在同一个 service 内。

目标：

- 按能力拆开，而不是继续堆在一个服务里。

建议拆分：

- `project-file/tree-service.ts`
- `project-file/search-service.ts`
- `project-file/read-write-service.ts`
- `project-file/path-guards.ts`

验收：

- 单个 service 只负责一类文件能力
- 路径校验逻辑集中到单独模块

当前状态：

- 已完成首轮拆分
- 后续如需继续细化，只需要在 `project-file/` 目录内部继续收敛共享工具，不需要再改外部调用层

### 4.6 拆 `src/core/renderer/pages/detail/DetailGitDiffDrawer.tsx`

目标：

- 把 diff 状态、视图切换、文件切换、渲染区域拆开。

建议拆分：

- `GitDiffToolbar.tsx`
- `GitDiffContent.tsx`
- `useGitDiffState.ts`

### 4.7 拆 `src/core/renderer/pages/code/MonacoCodeEditor.tsx`

目标：

- 把 Monaco 初始化、主题/语言扩展、编辑器命令、滚动同步等职责拆开。

建议拆分：

- `useMonacoInstance.ts`
- `useMonacoCommands.ts`
- `monacoTheme.ts`
- `monacoLanguageSetup.ts`

## 5. 推荐执行顺序

建议按下面顺序做，不要并行拆多个大文件：

1. `src/core/electron/main/index.ts`
2. `src/core/renderer/pages/code/CodeWorkspacePanel.tsx`
3. `src/core/renderer/pages/detail/DetailAiCommitPanel.tsx`
4. `src/core/renderer/pages/detail/DetailDocumentationCard.tsx`
5. `src/core/renderer/pages/detail/DetailGitDiffDrawer.tsx`
6. `src/core/renderer/pages/code/MonacoCodeEditor.tsx`

原因：

- 先拆主进程入口，能尽快建立更清晰的模块边界。
- 再拆两个最大的渲染层业务组件，收益最高。
- `project-file-service.ts` 已完成，可以从后续顺序中移除。
- 剩下几个文件作为第二阶段治理。

## 6. 分阶段里程碑

### M1

- 拆 `src/core/electron/main/index.ts`
- 完成 window、ipc、runtime、git、ai-commit、shell 基础分层

### M2

- 拆 `src/core/renderer/pages/code/CodeWorkspacePanel.tsx`
- 完成 code workspace 的逻辑层和 UI 层分离

### M3

- 拆 `src/core/renderer/pages/detail/DetailAiCommitPanel.tsx`
- 完成 Git/AI 面板的计算逻辑与显示逻辑分离

### M4

- 拆 `DetailDocumentationCard.tsx`
- 拆 `DetailGitDiffDrawer.tsx`
- 拆 `MonacoCodeEditor.tsx`

## 7. 每次拆分的完成标准

每拆完一个大文件，至少满足下面几个标准：

- 原入口文件明显变薄，不再承担多个职责
- 新模块职责清晰，命名稳定
- 没有为了拆分而引入更多全局状态耦合
- `npm run typecheck` 继续通过
- 后续同类功能能找到明确落点，而不是重新堆回入口文件

## 8. 下一步建议

如果按这个文档继续往下做，建议下一步直接从：

- `src/core/electron/main/index.ts` 的 Git / Runtime / AI Commit 三块继续拆

开始拆。窗口创建和 shell 打开已经迁出，下一步最值得继续切的是：

- Git 命令与状态解析
- Runtime 启动与 terminal 打开
- AI Commit 执行与状态回传

这样能让 `index.ts` 更接近纯装配层，后面的 `registerIpcHandlers` 拆分也会更直接。

## 9. 后续执行清单

为了方便后续查看，建议按下面顺序继续推进：

### 下一步 1：拆 `src/core/electron/main/index.ts`

优先做：

1. 抽 `createWindow`
2. 抽 `registerIpcHandlers`
3. 再抽 `runtime-service`
4. 再抽 `git-service`
5. 最后抽 `ai-commit-service` 和 `shell/openers`

这一轮结束时应达到：

- `index.ts` 只保留主进程启动编排
- 大部分业务逻辑迁到独立模块

### 下一步 2：拆 `src/core/renderer/pages/code/CodeWorkspacePanel.tsx`

优先做：

1. 先抽纯逻辑 hook
2. 再抽 markdown 相关逻辑
3. 再抽头部、编辑区、搜索区 UI

这一轮结束时应达到：

- `CodeWorkspacePanel.tsx` 主要保留布局和状态串联

### 下一步 3：拆 `src/core/renderer/pages/detail/DetailAiCommitPanel.tsx`

优先做：

1. 抽 Git 计算逻辑
2. 抽分支管理区
3. 抽 AI 日志区
4. 抽操作工具栏

这一轮结束时应达到：

- Git/AI 面板逻辑和展示边界清晰

### 下一步 4：第二阶段治理

这一阶段处理：

- `DetailDocumentationCard.tsx`
- `DetailGitDiffDrawer.tsx`
- `MonacoCodeEditor.tsx`

适合在前三个核心拆分完成后再做。
