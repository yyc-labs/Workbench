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
| `src/core/renderer/pages/code/CodeWorkspacePanel.tsx` | 2906 | 待拆 | 当前最大的渲染层编排组件 |
| `src/core/renderer/pages/detail/DetailAiCommitPanel.tsx` | 2248 | 待拆 | Git 与 AI Commit 逻辑混合过重 |
| `src/core/renderer/pages/detail/DetailDocumentationCard.tsx` | 1308 | 待拆 | 数据整理和条件渲染都偏重 |
| `src/core/renderer/pages/detail/DetailGitDiffDrawer.tsx` | 996 | 待拆 | diff 状态与渲染耦合 |
| `src/core/renderer/pages/code/MonacoCodeEditor.tsx` | 912 | 待拆 | 初始化、主题、命令、同步混在一起 |
| `src/core/electron/main/index.ts` | 757 | 进行中 | 第一轮已完成，第二轮仍需压缩 |
| `src/core/electron/main/project-file-service.ts` | 13 | 已完成 | 当前只保留兼容出口 |

### 2.2 当前进度

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
- `src/core/electron/main/git/git-service.ts` 承接 Git 能力
- `src/core/electron/main/runtime/runtime-service.ts` 承接 Runtime 能力

当前状态：

- 外部调用方式未改
- `project-file-service.ts` 已从大体积实现文件收缩为兼容出口
- `index.ts` 已先收缩掉窗口创建、shell opener、Git、Runtime 四块细节
- IPC 注册改为启动期单次注册，避免窗口重建时重复挂 handler
- 下一轮重点变成 AI Commit 和 IPC 装配层

## 3. 推荐执行顺序

建议按下面顺序做，不要并行拆多个大文件：

1. `src/core/electron/main/index.ts`
2. `src/core/renderer/pages/code/CodeWorkspacePanel.tsx`
3. `src/core/renderer/pages/detail/DetailAiCommitPanel.tsx`
4. `src/core/renderer/pages/detail/DetailDocumentationCard.tsx`
5. `src/core/renderer/pages/detail/DetailGitDiffDrawer.tsx`
6. `src/core/renderer/pages/code/MonacoCodeEditor.tsx`

原因：

- 先拆主进程入口，能尽快建立更清晰的模块边界。
- `index.ts` 虽然不再是最大文件，但仍然是主进程核心装配点，边界收益高于单纯按行数排序。
- 再拆两个最大的渲染层业务组件，收益最高。
- `project-file-service.ts` 已完成，可以从后续顺序中移除。
- 剩下几个文件作为第二阶段治理。

## 4. 分阶段里程碑

### M1

- 拆 `src/core/electron/main/index.ts` 第二轮
- 完成 AI Commit 与 IPC 装配分层

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

## 5. 下一步建议

如果按这套计划继续往下做，建议下一步直接从：

- `src/core/electron/main/index.ts` 的 AI Commit / IPC 两块继续拆

开始拆。

这一步最值得继续切的是：

- AI Commit 执行链路与状态回传
- IPC 注册装配层

这样能让 `index.ts` 更接近纯装配层，后面的主进程维护成本会明显下降。

## 6. 后续执行清单

### 下一步 1：拆 `src/core/electron/main/index.ts`

优先做：

1. 先抽 `ai-commit-service`
2. 再抽 `registerIpcHandlers`
3. 最后再看是否还需要继续压缩零散启动细节

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
