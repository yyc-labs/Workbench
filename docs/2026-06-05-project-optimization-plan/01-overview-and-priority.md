# 总览与优先级（2026-06-05）

## 1. 目标与边界

这轮计划只保留一件事：拆分当前项目里的超大文件和超大组件，降低维护成本，减少后续改动时的联动风险。

本轮不讨论：

- 安全整改
- 性能优化
- 测试体系
- 脚本改造
- UI 视觉调整

## 2. 当前快照

### 2.1 文件规模

基于当前代码快照，剩余重点目标如下：

| 文件 | 当前行数 | 状态 | 说明 |
|------|----------|------|------|
| `src/core/renderer/pages/code/CodeWorkspacePanel.tsx` | 732 | 本轮完成 | 第二轮已完成，父组件已收敛到编排层 |
| `src/core/renderer/pages/detail/DetailAiCommitPanel.tsx` | 989 | 本轮完成 | 已进入目标区间，主体区 / 顶部区 / modal 已拆出 |
| `src/core/renderer/pages/detail/DetailDocumentationCard.tsx` | 1308 | 待拆 | 资料编辑、排序、设置仍集中在单文件 |
| `src/core/renderer/pages/detail/DetailGitDiffDrawer.tsx` | 612 | 本轮完成 | Monaco 基础设施与冲突 helper 已迁出，已进入目标区间 |
| `src/core/renderer/pages/code/MonacoCodeEditor.tsx` | 854 | 进行中 | 共享 Monaco 基础设施已迁出，搜索 / 命令逻辑仍集中 |
| `src/core/electron/main/index.ts` | 121 | 已完成 | 第二轮目标已超额达成 |
| `src/core/electron/main/ipc/registerIpcHandlers.ts` | 351 | 已拆出 | 仍可按 handler 领域继续拆分 |
| `src/core/electron/main/ai-commit/ai-commit-service.ts` | 341 | 已拆出 | AI Commit 主链路已迁出入口文件 |
| `src/core/electron/main/project-file-service.ts` | 13 | 已完成 | 当前只保留兼容出口 |

### 2.2 当前进度

已完成：

- `src/core/electron/main/project-file-service.ts`
- `src/core/electron/main/index.ts` 第二轮拆分
- `src/core/renderer/pages/code/CodeWorkspacePanel.tsx` 第二轮拆分

本次拆分结果：

- 兼容入口保留在 `src/core/electron/main/project-file-service.ts`
- 共享工具拆到 `src/core/electron/main/project-file/shared.ts`
- 文件树和文件名搜索拆到 `src/core/electron/main/project-file/tree-service.ts`
- 内容搜索拆到 `src/core/electron/main/project-file/content-search-service.ts`
- 文件读写拆到 `src/core/electron/main/project-file/read-write-service.ts`
- `src/core/electron/main/window/createWindow.ts` 承接窗口创建、主题背景和窗口快捷键
- `src/core/electron/main/shell/openers.ts` 承接打开文件夹、VS Code、路径终端等外部打开逻辑
- `src/core/electron/main/git/git-service.ts` 承接 Git 能力
- `src/core/electron/main/runtime/runtime-service.ts` 承接 Runtime 能力
- `src/core/electron/main/ai-commit/ai-commit-service.ts` 承接 AI Commit 执行链路、输出回传和状态恢复
- `src/core/electron/main/ipc/registerIpcHandlers.ts` 承接 IPC 装配
- `src/core/renderer/pages/code/CodeWorkspaceChrome.tsx`、`CodeWorkspaceSidebar.tsx`、`CodeWorkspaceEditorPane.tsx` 已从 `CodeWorkspacePanel.tsx` 拆出
- `src/core/renderer/pages/code/useProjectCodeSession.ts`、`useProjectCodeSessionState.ts`、`useCodeWorkspaceExplorerState.ts` 已抽为独立模块
- `src/core/renderer/pages/code/useMarkdownPreviewModeState.ts` 已收口 Markdown 预览模式、主题同步和图片粘贴
- `src/core/renderer/pages/code/useCodeWorkspaceScrollSync.ts` 已收口滚动记忆、split 同步和模式切换恢复
- `src/core/renderer/pages/code/useCodeWorkspaceRestoreState.ts` 已收口初始恢复、content search reveal 和 cursor reveal
- `src/core/renderer/pages/detail/detail.gitOperations.ts` 已收口 Git 操作状态、状态文案和 diff/branch 通用 helper
- `src/core/renderer/pages/detail/detail.commitHistory.tsx` 已收口提交历史映射和历史项子组件
- `src/core/renderer/pages/detail/detail.aiCommitPanel.types.ts` 已收口分支候选、middle panel 和确认弹窗类型
- `src/core/renderer/pages/detail/DetailAiCommitHeader.tsx` 已承接顶部项目切换、链接入口和 AI 状态摘要
- `src/core/renderer/pages/detail/DetailAiCommitMiddlePanel.tsx` 已承接提交历史 / AI 日志 / Git 日志中区
- `src/core/renderer/pages/detail/DetailAiCommitBranchPanel.tsx` 已承接分支、远程和 Git 操作右区
- `src/core/renderer/pages/detail/DetailAiCommitWorkingTreePanel.tsx` 已承接工作区文件列表左区
- `src/core/renderer/pages/detail/DetailAiCommitOperationConfirmModal.tsx`、`DetailAiCommitBranchManagerModal.tsx` 已承接两类弹窗
- `src/core/renderer/pages/detail/DetailAiCommitGitGuideModal.tsx` 已承接 Git guide 弹窗
- `src/core/renderer/lib/monacoEnvironment.ts` 已收口 worker 环境、主题判断和 find widget hover guard
- `src/core/renderer/lib/monacoDiffLanguage.ts` 已收口 git diff 语言注册
- `src/core/renderer/components/MonacoTextViewer.tsx` 已承接 Diff/Conflict 预览用 Monaco 文本查看器
- `src/core/renderer/pages/detail/detail.gitDiffConflicts.ts` 已收口冲突块解析与替换 helper

当前状态：

- 外部调用方式未改
- `project-file-service.ts` 已从大体积实现文件收缩为兼容出口
- `index.ts` 已收缩为主进程启动编排层
- IPC 注册改为启动期单次注册，避免窗口重建时重复挂 handler
- `CodeWorkspacePanel.tsx` 已从 2906 行降到 732 行，进入 700-900 行目标区间
- `DetailAiCommitPanel.tsx` 已从 2248 行降到 989 行，左中右主体区、顶部区和三类 modal 已迁出，进入 800-1000 行目标区间
- `DetailGitDiffDrawer.tsx` 已从 996 行降到 612 行，Monaco 基础设施和冲突纯逻辑已迁出，进入目标区间
- `MonacoCodeEditor.tsx` 已从 912 行降到 854 行，共享 Monaco 基础设施已迁出，但搜索 / 替换 / 命令逻辑仍集中
- `npm run typecheck` 已于本次核对通过

### 2.3 当前已确认的问题

- `CodeWorkspacePanel.tsx` 的滚动同步、Markdown 预览模式和恢复链路已经下沉，但 viewport、quick drawer 和搜索聚焦仍集中在入口层，后续只适合做收口型整理。
- `useCodeWorkspaceExplorerState.ts` 已单独成文件，但也达到 454 行；如果后续继续往里堆，会把问题从父组件平移到 hook。
- `DetailAiCommitPanel.tsx` 已进入目标区间，但 diff/conflict 请求链路、branch manager handler 和部分状态编排仍集中在父组件里。
- `DetailDocumentationCard.tsx` 基本仍是单文件实现，拖拽排序、标签设置、编辑表单、密钥展示都混在一起。
- `MonacoCodeEditor.tsx` 虽然已经迁出共享 Monaco 基础设施，但搜索状态、替换逻辑、快捷命令和 model cache 仍集中在入口层。

## 3. 推荐执行顺序

建议按下面顺序做，不要并行拆多个大文件：

1. `src/core/renderer/pages/code/MonacoCodeEditor.tsx`
2. `src/core/renderer/pages/detail/DetailDocumentationCard.tsx`
3. `src/core/renderer/pages/detail/DetailAiCommitPanel.tsx`（只保留收口型跟进）
4. `src/core/renderer/pages/code/CodeWorkspacePanel.tsx`（只保留收口型跟进）
5. `src/core/renderer/pages/detail/DetailGitDiffDrawer.tsx`（只保留收口型跟进）

原因：

- 主进程入口拆分已经完成，不再需要占据第一优先级。
- `CodeWorkspacePanel.tsx`、`DetailAiCommitPanel.tsx`、`DetailGitDiffDrawer.tsx` 都已达标，当前最高收益点转移到 `MonacoCodeEditor.tsx` 和 `DetailDocumentationCard.tsx`。
- `MonacoCodeEditor.tsx` 和 `DetailGitDiffDrawer.tsx` 之间的共享基础设施已经统一，接下来更适合继续收口编辑器自身逻辑。
- `project-file-service.ts` 已完成，可以从后续顺序中移除。
- `DetailDocumentationCard.tsx` 虽然也大，但相对更独立，适合放在第三批。

## 4. 分阶段里程碑

### M1

- 已完成 `src/core/renderer/pages/code/CodeWorkspacePanel.tsx` 第二轮
- 已完成工作区编排状态进一步下沉

### M2

- 拆 `src/core/renderer/pages/detail/DetailAiCommitPanel.tsx`
- 完成 Git/分支/历史/工作区主体区、顶部区和 modal 的拆分

### M3

- 拆 `src/core/renderer/pages/code/MonacoCodeEditor.tsx`
- 已抽出共享 Monaco 环境，继续收口搜索与命令逻辑

### M4

- 拆 `DetailGitDiffDrawer.tsx`
- 已复用 Monaco 共享模块完成 diff / conflict 基础设施抽离
- 拆 `DetailDocumentationCard.tsx`

## 5. 下一步建议

如果按这套计划继续往下做，建议下一步直接进入：

- `src/core/renderer/pages/code/MonacoCodeEditor.tsx` 的搜索状态、替换逻辑和快捷命令收口

开始拆。

这一步最值得继续切的是：

- 搜索状态与匹配计算
- 查找替换命令绑定
- model cache / editor instance 的职责边界

这样可以把 Monaco 批次从“先去重基础设施”推进到“继续收口入口层业务逻辑”，随后再进入 `DetailDocumentationCard.tsx`。

## 6. 后续执行清单

### 下一步 1：拆 `src/core/renderer/pages/detail/DetailAiCommitPanel.tsx`

优先做：

1. 仅保留收口型整理
2. 优先评估 diff / conflict 请求逻辑是否需要独立 hook
3. 评估 branch manager handler 是否下沉到独立 hook

这一轮结束时应达到：

- `DetailAiCommitPanel.tsx` 主要保留状态组织、事件分发和布局拼装

### 下一步 2：拆 `src/core/renderer/pages/code/MonacoCodeEditor.tsx` / `DetailGitDiffDrawer.tsx`

优先做：

1. 共享的 Monaco worker / environment 配置已完成
2. 继续抽编辑器搜索控件与命令逻辑
3. `DetailGitDiffDrawer.tsx` 只保留收口型整理

这一轮结束时应达到：

- Monaco 基础设施不再在两个文件里重复实现

### 下一步 3：第二阶段治理

这一阶段处理：

- `DetailDocumentationCard.tsx`
- `registerIpcHandlers.ts` 的按领域细分（可选）

适合在前三个核心拆分完成后再做。
