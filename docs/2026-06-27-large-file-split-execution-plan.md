# 2026-06-27 大文件检测与拆分执行计划

## 检测口径

- 文件大小扫描排除 `.git`、`node_modules`、`dist`、`out`、`build`、`coverage` 等目录。
- 源码复杂度优先按手写源码行数排序，生成文件、锁文件、发布产物不作为本轮源码拆分目标。
- 本轮目标不是删除功能，而是把页面入口从“大块 UI + 手势 + 弹窗 + 状态编排”收敛为编排层。

## 检测结果

### 大体积产物

| 文件 | 大小 | 处理策略 |
| --- | ---: | --- |
| `release/win-unpacked/IDE Electron.exe` | 216 MB | 构建产物，不做源码拆分；后续如需瘦身应进入发布产物清理计划。 |
| `release/win-unpacked.zip` | 206 MB | 构建产物，不做源码拆分。 |
| `release/IDE Electron-1.0.0-x64-setup.exe` | 106 MB | 构建产物，不做源码拆分。 |
| `release/win-unpacked/resources/app.asar` | 38 MB | 打包产物，不做源码拆分。 |

### 生成或数据文件

| 文件 | 行数 | 处理策略 |
| --- | ---: | --- |
| `package-lock.json` | 11135 | 锁文件，不拆分。 |
| `src/core/renderer/pages/code/tm-grammars/source.js.tmLanguage.json` | 6001 | TextMate grammar 数据，不拆分。 |
| `src/core/renderer/pages/code/tm-grammars/source.ts.tmLanguage.json` | 5752 | TextMate grammar 数据，不拆分。 |
| `src/core/renderer/pages/code/tm-grammars/text.html.markdown.tmLanguage.json` | 3326 | TextMate grammar 数据，不拆分。 |

### 手写源码热点

| 文件 | 当前行数 | 本轮策略 |
| --- | ---: | --- |
| `src/core/renderer/pages/LearningCenterPage.tsx` | 1756 | P0，本轮执行拆分。 |
| `src/core/renderer/pages/detail/DetailAiCommitPanel.tsx` | 1210 | P1，后续继续拆 diff/branch manager 状态。 |
| `src/core/renderer/pages/code/code.markdown.tsx` | 1120 | P1，后续拆 Markdown renderer、代码块、媒体 helper。 |
| `src/core/renderer/pages/TranscriptPage.tsx` | 1101 | 已有独立拆分计划，暂不重复处理。 |
| `src/core/shared/types.ts` | 1075 | P2，谨慎按领域拆类型，避免破坏共享 API。 |
| `src/core/renderer/components/RunCommandConfigPopover.tsx` | 1007 | P2，后续拆表单区和命令预览。 |

## 本轮执行范围

### 阶段 1：学习中心基础边界

- 抽出学习中心通用类型和工具函数。
- 抽出侧栏折叠手势 hook 和手势轨迹覆盖层。
- 抽出侧栏 rail 按钮，避免入口页保留重复按钮 JSX。

### 阶段 2：学习中心区域组件

- 抽出顶部 header。
- 抽出左侧分类/笔记列表侧栏。
- 抽出中间 Markdown 编辑/预览面板。
- 抽出右侧笔记信息栏。

### 阶段 3：弹窗组件

- 抽出 frontmatter 创建/编辑弹窗。
- 抽出删除笔记确认弹窗。

## 验收标准

- `LearningCenterPage.tsx` 从完整页面实现收敛为状态、handler 和布局装配层。
- 子组件边界对应页面功能区域，而不是纯粹按行数搬运。
- 保持现有学习中心交互不变：分类管理、笔记创建/编辑/删除、Markdown 右键插入、快捷键保存、侧栏手势折叠。
- `npm run typecheck` 通过。
- `npm test` 通过。

## 执行结果

- 已完成阶段 1：新增学习中心类型、工具函数、侧栏手势 hook、手势轨迹覆盖层和 rail 按钮。
- 已完成阶段 2：抽出顶部 header、左侧分类/笔记列表、中间 Markdown 编辑/预览面板、右侧笔记信息栏。
- 已完成阶段 3：抽出 frontmatter 创建/编辑弹窗和删除笔记确认弹窗。
- `src/core/renderer/pages/LearningCenterPage.tsx` 从 1756 行降到 819 行，入口页保留数据加载、保存、分类/笔记 handler、编辑历史和布局装配。
- 新增子模块集中放在 `src/core/renderer/pages/learning/`，后续学习中心新增 UI 应优先落到对应区域组件，避免重新堆回入口页。

## 验证结果

- `npm run typecheck`：通过。
- `npm test`：通过，23 个测试全部通过。
