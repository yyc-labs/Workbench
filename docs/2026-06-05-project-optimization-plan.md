# IDE Electron 拆分文件计划（2026-06-05）

这份计划已按主题拆成多份子文档，当前文件只保留入口索引和状态快照，避免继续把后续拆分记录堆回同一个 500+ 行文档。

## 文档入口

- [01. 总览与优先级](./2026-06-05-project-optimization-plan/01-overview-and-priority.md)
- [02. 主进程入口拆分](./2026-06-05-project-optimization-plan/02-main-process-index-split.md)
- [03. 渲染层大组件拆分](./2026-06-05-project-optimization-plan/03-renderer-large-components-split.md)
- [04. 执行标准与检查清单](./2026-06-05-project-optimization-plan/04-execution-guidelines-and-checklist.md)

## 当前快照

这轮计划只处理一个问题：继续拆分项目里的超大文件和超大组件，降低维护成本，减少改动联动风险。

当前不在范围内：

- 安全整改
- 性能优化
- 测试体系扩建
- 脚本改造
- UI 视觉调整

## 当前文件规模

基于当前分支快照，剩余重点目标如下：

| 文件 | 当前行数 | 状态 |
|------|----------|------|
| `src/core/renderer/pages/code/CodeWorkspacePanel.tsx` | 732 | 第二轮已完成，已进入目标区间 |
| `src/core/renderer/pages/detail/DetailAiCommitPanel.tsx` | 989 | 第二轮已达目标区间，主体区 / 顶部区 / modal 已拆出 |
| `src/core/renderer/pages/detail/DetailDocumentationCard.tsx` | 1308 | 基本未拆 |
| `src/core/renderer/pages/detail/DetailGitDiffDrawer.tsx` | 612 | 共享 Monaco 基础设施已抽出，已进入目标区间 |
| `src/core/renderer/pages/code/MonacoCodeEditor.tsx` | 854 | 共享 Monaco 基础设施已抽出，剩余搜索 / 命令逻辑待继续收口 |
| `src/core/electron/main/index.ts` | 121 | 已完成第二轮 |
| `src/core/electron/main/ipc/registerIpcHandlers.ts` | 351 | 已拆出，后续可按领域继续收口 |
| `src/core/electron/main/ai-commit/ai-commit-service.ts` | 341 | 已拆出 |
| `src/core/electron/main/project-file-service.ts` | 13 | 已完成 |

## 已完成进度

- `src/core/electron/main/project-file-service.ts`
  - 兼容入口保留在原路径
  - 共享工具迁到 `project-file/shared.ts`
  - 文件树与文件名搜索迁到 `project-file/tree-service.ts`
  - 内容搜索迁到 `project-file/content-search-service.ts`
  - 文件读写迁到 `project-file/read-write-service.ts`
- `src/core/electron/main/index.ts` 第二轮拆分
  - `window/createWindow.ts` 承接窗口创建、主题背景和窗口快捷键
  - `shell/openers.ts` 承接打开文件夹、VS Code、路径终端等外部打开逻辑
  - `git/git-service.ts` 承接 Git 相关能力
  - `runtime/runtime-service.ts` 承接 Runtime 相关能力
  - `ai-commit/ai-commit-service.ts` 承接 AI Commit 执行链路与状态回传
  - `ipc/registerIpcHandlers.ts` 承接 IPC 注册装配
  - IPC 注册改为启动期单次注册，避免窗口重建时重复挂 handler
- `src/core/renderer/pages/code/CodeWorkspacePanel.tsx` 第二轮拆分
  - `CodeWorkspaceChrome.tsx`、`CodeWorkspaceSidebar.tsx`、`CodeWorkspaceEditorPane.tsx` 已拆出
  - `useProjectCodeSession.ts`、`useProjectCodeSessionState.ts`、`useCodeWorkspaceExplorerState.ts` 已拆出
  - `useMarkdownPreviewModeState.ts` 已收口 Markdown 预览模式、主题同步和图片粘贴
  - `useCodeWorkspaceScrollSync.ts` 已收口滚动记忆、split 同步和模式切换恢复
  - `useCodeWorkspaceRestoreState.ts` 已收口初始恢复、content search reveal 和 cursor reveal
- `src/core/renderer/pages/detail/DetailAiCommitPanel.tsx` 当前轮拆分
  - `detail.gitOperations.ts` 已收口 Git 操作状态、状态文案和 diff/branch 通用 helper
  - `detail.commitHistory.tsx` 已收口提交历史映射和历史项子组件
  - `detail.aiCommitPanel.types.ts` 已收口分支候选、middle panel 和确认弹窗类型
  - `DetailAiCommitHeader.tsx`、`DetailAiCommitMiddlePanel.tsx`、`DetailAiCommitBranchPanel.tsx`、`DetailAiCommitWorkingTreePanel.tsx` 已拆出
  - `DetailAiCommitOperationConfirmModal.tsx`、`DetailAiCommitBranchManagerModal.tsx` 已拆出
  - `DetailAiCommitGitGuideModal.tsx` 已拆出
- `src/core/renderer/pages/code/MonacoCodeEditor.tsx` / `src/core/renderer/pages/detail/DetailGitDiffDrawer.tsx` 当前轮拆分
  - `src/core/renderer/lib/monacoEnvironment.ts` 已收口 worker 环境、主题判断和 find widget hover guard
  - `src/core/renderer/lib/monacoDiffLanguage.ts` 已收口 git diff 语言注册
  - `src/core/renderer/components/MonacoTextViewer.tsx` 已收口只读/可编辑 Monaco 文本查看器
  - `src/core/renderer/pages/detail/detail.gitDiffConflicts.ts` 已收口冲突块解析与替换 helper
- 静态检查
  - `npm run typecheck` 已于本次核对通过

## 推荐执行顺序

建议继续按下面顺序推进，不并行拆多个核心文件：

1. `src/core/renderer/pages/code/MonacoCodeEditor.tsx`
2. `src/core/renderer/pages/detail/DetailDocumentationCard.tsx`
3. `src/core/renderer/pages/detail/DetailAiCommitPanel.tsx`（只保留收口型跟进）
4. `src/core/renderer/pages/code/CodeWorkspacePanel.tsx`（只保留收口型跟进）
5. `src/core/renderer/pages/detail/DetailGitDiffDrawer.tsx`（只保留收口型跟进）

原因：

- `index.ts` 已经降到 121 行，主进程入口不再是当前最高优先级。
- `DetailGitDiffDrawer.tsx` 已明显收缩，`MonacoCodeEditor.tsx` 成为当前 Monaco 批次里剩余最重的入口文件。
- `MonacoCodeEditor.tsx` 和 `DetailGitDiffDrawer.tsx` 的共享 Monaco 初始化与 hover guard 已经统一，后续重点应转到 `MonacoCodeEditor.tsx` 自身搜索 / 命令逻辑。
- `project-file-service.ts` 已完成，可以从后续治理顺序中移除。

## 下一步

如果下一步直接动代码，优先继续做：

1. 继续进入 `src/core/renderer/pages/code/MonacoCodeEditor.tsx`，收口搜索状态、替换逻辑和快捷命令
2. 之后转到 `src/core/renderer/pages/detail/DetailDocumentationCard.tsx`
3. 回头视情况再收口 `DetailAiCommitPanel.tsx` 的 diff/conflict 请求链路和 branch manager handler

后续细节见子文档，不再继续往这个入口文件里堆完整计划正文。
