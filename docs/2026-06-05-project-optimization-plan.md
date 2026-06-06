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

基于 2026-06-06 当前分支快照，`src` 下仍超过 500 行的实现文件如下。TextMate grammar JSON、主题 JSON、lockfile 和图标资源属于数据/资源文件，不作为拆分目标。

| 文件 | 当前行数 | 状态 |
|------|----------|------|
| `src/core/renderer/pages/detail/DetailAiCommitPanel.tsx` | 989 | 已进入目标区间，后续只做 diff/conflict 与 branch manager 收口 |
| `src/core/renderer/pages/Detail.tsx` | 751 | 待评估拆分，当前是新的页面入口优先候选 |
| `src/core/renderer/pages/code/CodeWorkspacePanel.tsx` | 740 | 第二轮已完成，后续只做 viewport / quick drawer / search focus 收口 |
| `src/core/electron/main/git/git-file-operations.ts` | 616 | 待评估拆分，Git diff / conflict / file operation 逻辑偏集中 |
| `src/core/renderer/pages/detail/DetailGitDiffDrawer.tsx` | 612 | 已进入目标区间，后续只做 diff view 编排收口 |
| `src/core/shared/types.ts` | 569 | 谨慎处理，类型文件偏大但拆分会带来较多 import 变动 |
| `src/core/renderer/pages/settings/SettingsRuntimePanel.tsx` | 551 | 待评估拆分，runtime 设置、诊断、终端清理逻辑集中 |
| `src/core/renderer/pages/code/code.markdown.tsx` | 546 | 可选收口，Markdown renderer / helper 可继续分离 |
| `src/core/renderer/pages/code/MonacoCodeEditor.tsx` | 540 | 已进入目标区间，后续只做 Monaco instance / commands 收口 |
| `src/core/renderer/components/ProjectMetaDialog.tsx` | 536 | 待评估拆分，项目元信息弹窗与 workspace 管理弹窗在同文件 |
| `src/core/renderer/hooks/useMouseGestureNavigator.ts` | 530 | 谨慎处理，hook 体积偏大但职责相对集中 |
| `src/core/electron/main/project-file/shared.ts` | 506 | 可选收口，project-file 共享工具可按路径/过滤/常量再切 |
| `src/core/electron/main/runner.ts` | 505 | 待评估拆分，pty 与 spawn 进程管理可继续分离 |

已从重点目标移除：

| 文件 | 当前行数 | 状态 |
|------|----------|------|
| `src/core/renderer/pages/detail/DetailDocumentationCard.tsx` | 138 | 已完成拆分，主体只保留卡片入口和 settings modal 装配 |
| `src/core/electron/main/index.ts` | 121 | 已完成第二轮 |
| `src/core/electron/main/project-file-service.ts` | 13 | 已完成兼容出口收缩 |

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
  - `src/core/renderer/pages/code/useMonacoSearchWidget.ts` 已收口搜索状态、匹配计算与查找替换行为
  - `src/core/renderer/pages/code/MonacoCodeEditorFindBar.tsx` 已收口编辑器 findbar UI
  - `src/core/renderer/pages/code/monacoModelCache.ts` 已收口 model cache key / LRU 淘汰逻辑
- `src/core/renderer/pages/detail/DetailDocumentationCard.tsx` 后续拆分
  - 主入口已降到 138 行
  - `DetailDocumentationSettingsModal.tsx` 承接资料设置弹窗
  - `DetailDocumentationLinkList.tsx`、`DetailDocumentationLinkItem.tsx` 承接链接列表与单项展示
  - `DetailDocumentationTagSelect.tsx` 承接标签选择
  - `useDetailDocumentationCardState.ts` 承接卡片状态和派生数据
- 静态检查
  - `npm run typecheck` 已于本次核对通过

## 推荐执行顺序

建议继续按下面顺序推进，不并行拆多个核心文件：

1. `src/core/renderer/pages/Detail.tsx`
2. `src/core/electron/main/git/git-file-operations.ts`
3. `src/core/renderer/pages/settings/SettingsRuntimePanel.tsx`
4. `src/core/renderer/components/ProjectMetaDialog.tsx`
5. `src/core/electron/main/runner.ts`
6. `src/core/electron/main/project-file/shared.ts`（可选收口）

原因：

- `index.ts` 已经降到 121 行，主进程入口不再是当前最高优先级。
- `DetailDocumentationCard.tsx` 已降到 138 行，不再是拆分目标。
- `MonacoCodeEditor.tsx`、`DetailGitDiffDrawer.tsx`、`CodeWorkspacePanel.tsx`、`DetailAiCommitPanel.tsx` 都已经进入目标区间，后续只保留收口型跟进。
- 当前更值得继续投入的是 `Detail.tsx`、`git-file-operations.ts`、`SettingsRuntimePanel.tsx`、`ProjectMetaDialog.tsx` 这类仍未系统拆分的入口或独立面板。
- `project-file-service.ts` 已完成，可以从后续治理顺序中移除。

## 下一步

如果下一步直接动代码，优先继续做：

1. 评估并拆 `src/core/renderer/pages/Detail.tsx`，优先把页面 header、pane 装配和项目操作 handler 分离。
2. 评估 `src/core/electron/main/git/git-file-operations.ts`，优先把 diff、conflict stage、worktree 文件读取写入逻辑分离。
3. 回头视情况再收口 `DetailAiCommitPanel.tsx` 的 diff/conflict 请求链路和 branch manager handler。

后续细节见子文档，不再继续往这个入口文件里堆完整计划正文。
