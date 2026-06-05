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
| `src/core/renderer/pages/code/CodeWorkspacePanel.tsx` | 2906 | 待拆 |
| `src/core/renderer/pages/detail/DetailAiCommitPanel.tsx` | 2248 | 待拆 |
| `src/core/renderer/pages/detail/DetailDocumentationCard.tsx` | 1308 | 待拆 |
| `src/core/renderer/pages/detail/DetailGitDiffDrawer.tsx` | 996 | 待拆 |
| `src/core/renderer/pages/code/MonacoCodeEditor.tsx` | 912 | 待拆 |
| `src/core/electron/main/index.ts` | 757 | 已完成第一轮，待第二轮 |
| `src/core/electron/main/project-file-service.ts` | 13 | 已完成 |

## 已完成进度

- `src/core/electron/main/project-file-service.ts`
  - 兼容入口保留在原路径
  - 共享工具迁到 `project-file/shared.ts`
  - 文件树与文件名搜索迁到 `project-file/tree-service.ts`
  - 内容搜索迁到 `project-file/content-search-service.ts`
  - 文件读写迁到 `project-file/read-write-service.ts`
- `src/core/electron/main/index.ts` 第一轮拆分
  - `window/createWindow.ts` 承接窗口创建、主题背景和窗口快捷键
  - `shell/openers.ts` 承接打开文件夹、VS Code、路径终端等外部打开逻辑
  - `git/git-service.ts` 承接 Git 相关能力
  - `runtime/runtime-service.ts` 承接 Runtime 相关能力
  - IPC 注册改为启动期单次注册，避免窗口重建时重复挂 handler

## 推荐执行顺序

建议继续按下面顺序推进，不并行拆多个核心文件：

1. `src/core/electron/main/index.ts` 第二轮
2. `src/core/renderer/pages/code/CodeWorkspacePanel.tsx`
3. `src/core/renderer/pages/detail/DetailAiCommitPanel.tsx`
4. `src/core/renderer/pages/detail/DetailDocumentationCard.tsx`
5. `src/core/renderer/pages/detail/DetailGitDiffDrawer.tsx`
6. `src/core/renderer/pages/code/MonacoCodeEditor.tsx`

原因：

- `index.ts` 虽然已降到约 760 行，但 AI Commit 和 IPC 装配仍然集中，继续拆能尽快收口主进程边界。
- `CodeWorkspacePanel.tsx` 和 `DetailAiCommitPanel.tsx` 仍然是渲染层最重、最影响后续改动的两个入口。
- `project-file-service.ts` 已完成，可以从后续治理顺序中移除。

## 下一步

如果下一步直接动代码，优先继续做：

1. 从 `src/core/electron/main/index.ts` 抽 `ai-commit-service.ts`
2. 把 IPC 注册收口到 `ipc/registerIpcHandlers.ts`
3. 回来更新本计划中的当前进度和目标行数

后续细节见子文档，不再继续往这个入口文件里堆完整计划正文。
