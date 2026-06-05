# 渲染层大组件拆分（2026-06-05）

## 1. 当前重点目标

当前渲染层最需要继续处理的文件：

| 文件 | 当前行数 | 目标 |
|------|----------|------|
| `src/core/renderer/pages/code/CodeWorkspacePanel.tsx` | 2906 | 降到 700-900 行 |
| `src/core/renderer/pages/detail/DetailAiCommitPanel.tsx` | 2248 | 降到 800-1000 行 |
| `src/core/renderer/pages/detail/DetailDocumentationCard.tsx` | 1308 | 拆出区域组件和 view-model |
| `src/core/renderer/pages/detail/DetailGitDiffDrawer.tsx` | 996 | 拆出 diff 状态和渲染区 |
| `src/core/renderer/pages/code/MonacoCodeEditor.tsx` | 912 | 拆出 Monaco 初始化与命令逻辑 |

## 2. `CodeWorkspacePanel.tsx`

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

## 3. `DetailAiCommitPanel.tsx`

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

## 4. 第二阶段文件

### 4.1 `DetailDocumentationCard.tsx`

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

### 4.2 `DetailGitDiffDrawer.tsx`

目标：

- 把 diff 状态、视图切换、文件切换、渲染区域拆开。

建议拆分：

- `GitDiffToolbar.tsx`
- `GitDiffContent.tsx`
- `useGitDiffState.ts`

### 4.3 `MonacoCodeEditor.tsx`

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

如果这些状态管理还留在入口层，单纯多几个子组件，后续维护成本不会真正下降。

### 5.2 `DetailAiCommitPanel.tsx`

重点先拆：

- 计算逻辑
- 派生显示数据
- 操作权限判断

不要一开始就只拆左栏、右栏 UI。否则最后会变成多个展示组件一起依赖同一个超大父组件。

### 5.3 `DetailDocumentationCard.tsx` / `DetailGitDiffDrawer.tsx` / `MonacoCodeEditor.tsx`

这三个文件适合放在第二阶段，原因是：

- 它们虽然大，但模块边界比前两个核心文件更容易收敛
- 当前收益最高的仍然是主进程入口和核心工作区编排
