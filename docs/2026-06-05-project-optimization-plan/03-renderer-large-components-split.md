# 渲染层大组件拆分（2026-06-05）

## 1. 当前重点目标

当前渲染层最需要继续处理的文件：

| 文件 | 当前行数 | 目标 |
|------|----------|------|
| `src/core/renderer/pages/code/CodeWorkspacePanel.tsx` | 732 | 已进入目标区间，后续只做收口 |
| `src/core/renderer/pages/detail/DetailAiCommitPanel.tsx` | 1879 | 继续降到 800-1000 行 |
| `src/core/renderer/pages/detail/DetailDocumentationCard.tsx` | 1308 | 拆出区域组件和 view-model |
| `src/core/renderer/pages/detail/DetailGitDiffDrawer.tsx` | 996 | 拆出 diff 状态、冲突编辑与 Monaco 基础设施 |
| `src/core/renderer/pages/code/MonacoCodeEditor.tsx` | 912 | 拆出 Monaco 初始化、搜索控件与命令逻辑 |

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

- 已经拆出 AI Flow 相关模块，并且本轮额外拆出 Git helper / history 子模块，但 Git 状态编排、分支操作、冲突处理、确认弹窗等主体逻辑仍集中在一个 1879 行文件里。
- 文件内部仍保留大量本地 helper、派生数据和局部子视图。

已完成：

- 已拆出 `useAiCommitFlow.ts`
- 已拆出 `detail.aiFlow.ts`
- 已拆出 `detail.aiFlow.styles.ts`
- 已拆出 `detail.aiFlowNodeTypes.ts`
- 已拆出 `DetailAiFlowStepNode.tsx`
- 已拆出 `gitGuideContent.ts`
- 已拆出 `detail.gitOperations.ts`
- 已拆出 `detail.commitHistory.tsx`

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

- diff 切换、冲突文件解析、冲突块提取、Monaco 环境初始化、查找控件适配都在一个文件里。
- 与 `MonacoCodeEditor.tsx` 已经出现 Monaco worker 配置和查找控件 hover guard 的重复实现。

目标：

- 把 diff 状态、视图切换、文件切换、渲染区域拆开。

建议拆分：

- `GitDiffToolbar.tsx`
- `GitDiffContent.tsx`
- `useGitDiffState.ts`
- `monacoEnvironment.ts`
- `monacoSearchWidget.ts`

### 4.3 `MonacoCodeEditor.tsx`

当前问题：

- Monaco worker 初始化、model cache、查找替换、搜索状态同步、快捷命令都仍集中在单文件中。
- 与 `DetailGitDiffDrawer.tsx` 有重复的 Monaco 环境和查找控件适配逻辑。

目标：

- 把 Monaco 初始化、主题/语言扩展、编辑器命令、滚动同步等职责拆开。

建议拆分：

- `useMonacoInstance.ts`
- `useMonacoCommands.ts`
- `useMonacoSearchWidget.ts`
- `monacoTheme.ts`
- `monacoLanguageSetup.ts`
- `monacoEnvironment.ts`

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

不要一开始就只拆左栏、右栏 UI。否则最后会变成多个展示组件一起依赖同一个超大父组件。

### 5.3 `DetailDocumentationCard.tsx` / `DetailGitDiffDrawer.tsx` / `MonacoCodeEditor.tsx`

这三个文件适合放在第二阶段，原因是：

- `DetailAiCommitPanel.tsx` 仍然比它们更影响主流程，`CodeWorkspacePanel.tsx` 已转为收口型跟进
- `DetailGitDiffDrawer.tsx` 和 `MonacoCodeEditor.tsx` 需要一起处理共享基础设施，拆分顺序不能再完全按行数排
- `DetailDocumentationCard.tsx` 虽然大，但业务相对独立，适合放在后面单独收口
