# 渲染层大组件拆分（2026-06-05）

## 1. 当前重点目标

当前渲染层最需要继续处理的文件：

| 文件 | 当前行数 | 目标 |
|------|----------|------|
| `src/core/renderer/pages/code/CodeWorkspacePanel.tsx` | 732 | 已进入目标区间，后续只做收口 |
| `src/core/renderer/pages/detail/DetailAiCommitPanel.tsx` | 989 | 已进入目标区间，后续只做收口 |
| `src/core/renderer/pages/detail/DetailDocumentationCard.tsx` | 1308 | 拆出区域组件和 view-model |
| `src/core/renderer/pages/detail/DetailGitDiffDrawer.tsx` | 612 | 已进入目标区间，后续只做收口 |
| `src/core/renderer/pages/code/MonacoCodeEditor.tsx` | 501 | 已进入目标区间，后续只做收口 |

## 2. `CodeWorkspacePanel.tsx`

当前问题：

- 第二轮已经完成，滚动同步、Markdown preview mode、图片粘贴和 session 恢复链路已不再直接堆在父组件里。
- 当前 732 行，已进入目标区间，主组件已基本收敛为布局和状态串联层。

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

## 3. `DetailAiCommitPanel.tsx`

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

## 4. 第二阶段文件

### 4.1 `DetailDocumentationCard.tsx`

当前问题：

- 目前基本仍是单文件实现。
- 拖拽排序、标签设置、编辑表单、默认链接切换、账号/密钥复制与展示都混在一起。

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

### 4.2 `DetailGitDiffDrawer.tsx`

当前问题：

- 共享 Monaco 基础设施和冲突纯逻辑已经迁出，但 diff 切换、冲突视图拼装和结果区交互仍在主文件里。
- 当前已不再是重复基础设施问题，而是剩余 diff / conflict 视图编排问题。

目标：

- 把 diff 状态、视图切换、文件切换、渲染区域拆开。

建议拆分：

- `GitDiffToolbar.tsx`
- `GitDiffContent.tsx`
- `useGitDiffState.ts`

### 4.3 `MonacoCodeEditor.tsx`

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

## 5. 渲染层拆分约束

渲染层几个大文件在拆的时候，容易出现“看起来拆了，实际上只是 JSX 挪位置”的问题。后续要避免这种假拆分。

### 5.1 `CodeWorkspacePanel.tsx`

重点不是单纯把 JSX 切出去，而是先把下面几类逻辑抽干净：

- 编辑会话状态
- 搜索状态
- Markdown 图片与预览相关逻辑
- drawer 或 quick action 的状态组织
- 滚动同步和恢复链路

如果这些状态管理还留在入口层，单纯多几个子组件，后续维护成本不会真正下降。

### 5.2 `DetailAiCommitPanel.tsx`

重点先拆：

- 计算逻辑
- 派生显示数据
- 操作权限判断

当前这一步已经不再需要继续为了降行数做 UI 切分。后续如果再动，重点应该转到 diff/conflict 请求和 branch manager handler 的状态收口，而不是继续机械拆 JSX。

### 5.3 `DetailDocumentationCard.tsx` / `DetailGitDiffDrawer.tsx` / `MonacoCodeEditor.tsx`

这三个文件适合放在第二阶段，原因是：

- `DetailAiCommitPanel.tsx` 已进入目标区间，`CodeWorkspacePanel.tsx` 也已转为收口型跟进
- `DetailGitDiffDrawer.tsx` 和 `MonacoCodeEditor.tsx` 的共享基础设施已经打通，后续重点转到 `MonacoCodeEditor.tsx` 自身逻辑
- `DetailDocumentationCard.tsx` 虽然大，但业务相对独立，适合放在后面单独收口
