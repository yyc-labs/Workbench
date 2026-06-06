# 渲染层大组件拆分（2026-06-05）

## 1. 当前重点目标

当前渲染层最需要继续处理的文件：

| 文件 | 当前行数 | 目标 |
|------|----------|------|
| `src/core/renderer/pages/detail/DetailAiCommitPanel.tsx` | 989 | 已进入目标区间，后续只做收口 |
| `src/core/renderer/pages/Detail.tsx` | 751 | 新的页面入口候选，拆出 header、pane 装配和项目操作 handler |
| `src/core/renderer/pages/code/CodeWorkspacePanel.tsx` | 740 | 已进入目标区间，后续只做收口 |
| `src/core/renderer/pages/detail/DetailGitDiffDrawer.tsx` | 612 | 已进入目标区间，后续只做收口 |
| `src/core/renderer/pages/settings/SettingsRuntimePanel.tsx` | 551 | 新的独立面板候选，拆出 runtime 设置、诊断和终端清理区域 |
| `src/core/renderer/pages/code/code.markdown.tsx` | 546 | 可选收口，拆出 Markdown renderer / helper |
| `src/core/renderer/pages/code/MonacoCodeEditor.tsx` | 540 | 已进入目标区间，后续只做收口 |
| `src/core/renderer/components/ProjectMetaDialog.tsx` | 536 | 新的弹窗候选，拆分项目元信息与 workspace 管理 |
| `src/core/renderer/hooks/useMouseGestureNavigator.ts` | 530 | 谨慎处理，hook 职责集中时不为降行数强拆 |
| `src/core/renderer/pages/detail/DetailDocumentationCard.tsx` | 138 | 已完成拆分，不再是大文件目标 |
| `src/core/renderer/pages/detail/useDetailDocumentationCardState.ts` | 454 | 已拆出的状态 hook，后续避免继续膨胀 |

## 2. `Detail.tsx`

当前问题：

- 当前 751 行，是新的渲染层页面入口候选。
- 文件同时承接路由参数、store 接线、项目 header 展示、pane 装配、运行/停止/终端/CLI/元信息 handler。
- 业务功能分散在页面入口里，后续新增项目操作容易继续堆到同一个文件。

建议拆分方向：

- `DetailProjectHeader.tsx`：承接项目标题、环境、运行状态、折叠状态和资料入口。
- `useDetailProjectActions.ts`：收口运行/停止、打开终端、切换 CLI、元信息保存等 handler。
- `DetailPaneContent.tsx`：收口 `code` / `aicommit` pane 的装配。

验收：

- `Detail.tsx` 只保留路由参数、store 接线和页面级布局编排。
- header 细节和项目操作 handler 不再直接堆在页面入口里。

## 3. `CodeWorkspacePanel.tsx`

当前问题：

- 第二轮已经完成，滚动同步、Markdown preview mode、图片粘贴和 session 恢复链路已不再直接堆在父组件里。
- 当前 740 行，已进入目标区间，主组件已基本收敛为布局和状态串联层。

已完成：

- 已拆出 `CodeWorkspaceChrome.tsx`
- 已拆出 `CodeWorkspaceSidebar.tsx`
- 已拆出 `CodeWorkspaceEditorPane.tsx`
- 已拆出 `useProjectCodeSession.ts`
- 已拆出 `useProjectCodeSessionState.ts`
- 已拆出 `useCodeWorkspaceExplorerState.ts`
- 已拆出 `code.markdown.tsx`
- 已拆出 `useMarkdownPreviewModeState.ts`
- 已拆出 `useCodeWorkspaceScrollSync.ts`
- 已拆出 `useCodeWorkspaceRestoreState.ts`

目标：

- 把“工作区编排”与“具体子功能”分开。
- 让主组件只负责布局和状态串联。

当前遗留问题：

- viewport、quick drawer 和搜索聚焦仍然在入口层协调
- open tab、explorer 和搜索面板切换的状态编排仍然比较集中
- `useCodeWorkspaceExplorerState.ts` 已到 454 行，后续需要继续避免“逻辑平移式拆分”

建议后续只做收口型整理：

- 如后续再动，优先处理 viewport / search focus / quick drawer 协调
- 不建议为继续降行数而再拆一轮“纯搬运式” hook

验收：

- `CodeWorkspacePanel.tsx` 已控制在 700-900 行以内
- 主组件已以编排为主，不再包含大段 Markdown、编辑器和恢复链路细节实现

## 4. `DetailAiCommitPanel.tsx`

当前问题：

- 已经拆出 AI Flow 相关模块，并且本轮额外拆出 Git helper / history / left-middle-right 主体区 / 顶部区 / 三类 modal，但 diff/conflict 请求链路和 branch manager handler 仍集中在父组件里。
- 文件内部剩余压力已经从“大段 JSX”转为“状态编排与请求链路”，优先级已下降。

已完成：

- 已拆出 `useAiCommitFlow.ts`
- 已拆出 `detail.aiFlow.ts`
- 已拆出 `detail.aiFlow.styles.ts`
- 已拆出 `detail.aiFlowNodeTypes.ts`
- 已拆出 `DetailAiFlowStepNode.tsx`
- 已拆出 `gitGuideContent.ts`
- 已拆出 `detail.gitOperations.ts`
- 已拆出 `detail.commitHistory.tsx`
- 已拆出 `detail.aiCommitPanel.types.ts`
- 已拆出 `DetailAiCommitHeader.tsx`
- 已拆出 `DetailAiCommitMiddlePanel.tsx`
- 已拆出 `DetailAiCommitBranchPanel.tsx`
- 已拆出 `DetailAiCommitWorkingTreePanel.tsx`
- 已拆出 `DetailAiCommitOperationConfirmModal.tsx`
- 已拆出 `DetailAiCommitBranchManagerModal.tsx`
- 已拆出 `DetailAiCommitGitGuideModal.tsx`

目标：

- 分离“Git 计算逻辑”和“面板展示逻辑”。
- 分离“左中右区域 UI”和“操作判断逻辑”。

建议后续只做收口：

- `useDetailAiCommitDiffState.ts`
- `useDetailAiCommitBranchManager.ts`

验收：

- `DetailAiCommitPanel.tsx` 已控制在 800-1000 行以内
- 入口面板已主要保留状态组织、事件分发和布局拼装

## 5. 第二阶段文件

### 5.1 `DetailDocumentationCard.tsx`

当前状态：

- 当前 138 行，已完成拆分。
- 主体只保留默认资料卡片入口和 `DetailDocumentationSettingsModal` 装配。
- `useDetailDocumentationCardState.ts` 承接状态、标签、排序、链接 action 和派生数据。
- `DetailDocumentationSettingsModal.tsx`、`DetailDocumentationLinkList.tsx`、`DetailDocumentationLinkItem.tsx`、`DetailDocumentationTagSelect.tsx` 已承接原来的大块 UI。

后续约束：

- 不再把资料编辑、排序、标签管理、账号/密钥展示重新堆回 `DetailDocumentationCard.tsx`。
- `useDetailDocumentationCardState.ts` 当前 454 行，如果后续继续增长，应优先拆 view-model 或 action helper，而不是继续扩大 hook。

### 5.2 `SettingsRuntimePanel.tsx`

当前问题：

- 当前 551 行，runtime launcher 配置、Claude bashrc 写入、诊断、inventory 刷新、终端清理都在同一组件。
- UI 区块和异步 handler 交织，后续新增 runtime 设置会继续扩大组件。

建议拆分：

- `useRuntimeInventory.ts`：收口 inventory 刷新、分类和清理操作。
- `SettingsRuntimeLauncherForm.tsx`：承接 launcher / Anthropic 环境变量表单。
- `SettingsRuntimeDiagnostics.tsx`：承接诊断和 bashrc 写入状态。
- `SettingsRuntimeTerminalInventory.tsx`：承接 managed process / tmux session 列表。

### 5.3 `ProjectMetaDialog.tsx`

当前问题：

- 当前 536 行，同时包含项目元信息编辑和 workspace/folder/tag 管理弹窗。
- `ManagerRow`、`CreateRow` 等通用管理 UI 与项目编辑表单在同一文件。

建议拆分：

- `ProjectMetaForm.tsx`
- `WorkspaceManagerDialog.tsx`
- `WorkspaceManagerRow.tsx`
- `WorkspaceCreateRow.tsx`

### 5.4 `DetailGitDiffDrawer.tsx`

当前问题：

- 共享 Monaco 基础设施和冲突纯逻辑已经迁出，但 diff 切换、冲突视图拼装和结果区交互仍在主文件里。
- 当前已不再是重复基础设施问题，而是剩余 diff / conflict 视图编排问题。

目标：

- 把 diff 状态、视图切换、文件切换、渲染区域拆开。

建议拆分：

- `GitDiffToolbar.tsx`
- `GitDiffContent.tsx`
- `useGitDiffState.ts`

### 5.5 `MonacoCodeEditor.tsx`

当前问题：

- 共享 Monaco worker 环境、find widget hover guard、搜索状态、findbar 和 model cache 已迁出。
- 当前已从“重构进行中”转为“达标后的可选收口”状态。

目标：

- 把 Monaco 初始化、主题/语言扩展、编辑器命令、滚动同步等职责拆开。

建议拆分：

- `useMonacoInstance.ts`
- `useMonacoCommands.ts`
- `monacoTheme.ts`
- `monacoLanguageSetup.ts`

### 5.6 `code.markdown.tsx`

当前问题：

- 当前 546 行，Markdown 渲染、代码块渲染、链接/图片处理和 helper 混在一个文件。
- 这是 Code Workspace 拆分后的派生大文件，优先级低于页面入口和独立面板。

建议拆分：

- `MarkdownCodeBlock.tsx`
- `markdownRenderers.tsx`
- `markdownMedia.ts`

## 6. 渲染层拆分约束

渲染层几个大文件在拆的时候，容易出现“看起来拆了，实际上只是 JSX 挪位置”的问题。后续要避免这种假拆分。

### 6.1 `Detail.tsx`

重点不是只把 header JSX 切出去，而是同步收口项目操作 handler 和 pane 装配逻辑。入口页面最后应该看起来像路由和布局编排，而不是项目详情所有行为的集合。

### 6.2 `CodeWorkspacePanel.tsx`

重点不是单纯把 JSX 切出去，而是先把下面几类逻辑抽干净：

- 编辑会话状态
- 搜索状态
- Markdown 图片与预览相关逻辑
- drawer 或 quick action 的状态组织
- 滚动同步和恢复链路

如果这些状态管理还留在入口层，单纯多几个子组件，后续维护成本不会真正下降。

### 6.3 `DetailAiCommitPanel.tsx`

重点先拆：

- 计算逻辑
- 派生显示数据
- 操作权限判断

当前这一步已经不再需要继续为了降行数做 UI 切分。后续如果再动，重点应该转到 diff/conflict 请求和 branch manager handler 的状态收口，而不是继续机械拆 JSX。

### 6.4 `SettingsRuntimePanel.tsx` / `ProjectMetaDialog.tsx`

这两个文件适合做独立面板拆分，原因是：

- 业务边界相对清晰
- 可以按 UI 区域和异步 handler 分离
- 拆分不应改动实际设置项、持久化结构或 IPC 协议

### 6.5 `DetailDocumentationCard.tsx` / `DetailGitDiffDrawer.tsx` / `MonacoCodeEditor.tsx`

这三个文件当前状态不同：

- `DetailDocumentationCard.tsx` 已完成拆分，不再是待拆大文件。
- `DetailGitDiffDrawer.tsx` 和 `MonacoCodeEditor.tsx` 的共享基础设施已经打通，后续重点是收口剩余 view/state 编排。
- 如果后续继续处理 Monaco 批次，不建议为了继续降行数而做纯搬运。
