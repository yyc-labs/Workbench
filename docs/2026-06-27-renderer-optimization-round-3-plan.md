# 2026-06-27 渲染层优化第三轮执行计划

## 背景

前两轮已完成主进程、preload 和部分共享逻辑收敛，但渲染层仍存在明显热点文件：

1. `src/core/renderer/pages/TranscriptPage.tsx` 仍超过 1500 行，同时承接页面状态、操作 handler、头部编排、列表展示、主视图展示和多个弹窗装配。
2. `src/core/renderer/App.tsx` 仍集中承接全局监听器、标题同步、快捷键监听、Recent Projects Drawer、窗口标题栏和路由装配。
3. 这些文件目前已经不只是 JSX 体积问题，而是“页面入口承担过多行为编排”的结构问题。

本轮继续遵循“先在 docs 写计划，再执行”的要求，范围聚焦在 renderer 入口层降复杂度，不引入新功能，不修改 Electron/IPC 协议。

## 本轮范围

### P0 必须完成

1. 收敛 `App.tsx`：
   - 抽出全局监听器集合。
   - 抽出窗口标题栏。
   - 保留 `App.tsx` 作为路由与壳层编排入口。

2. 收敛 `TranscriptPage.tsx`：
   - 抽出页面头部/工具栏区域。
   - 抽出转录列表侧栏区域。
   - 抽出主预览/编辑区域。
   - 保留页面级状态和跨区域编排在入口层。

3. 运行回归验证：
   - `npm run typecheck`
   - `npm test`

### P1 本轮尽量完成

1. 为后续继续拆 `TranscriptPage` 的 share / delete / reference / doc-link 逻辑建立更清晰的边界。
2. 避免把新组件做成纯 JSX 搬运，尽量让组件边界与职责边界一致。

## 非目标

1. 本轮不重写 `TranscriptPage` 的全部 state 组织。
2. 本轮不重写 `LearningCenterPage.tsx` 或 `Detail.tsx`。
3. 本轮不改动现有 store、IPC、runtime 协议。
4. 本轮不替换现有 PowerShell 脚本。

## 实施顺序

### 阶段 1：App 入口拆分

1. 抽出窗口标题解析 helper。
2. 抽出全局监听器 host。
3. 抽出窗口标题栏组件。
4. 让 `App.tsx` 只保留路由、Suspense 和壳层装配。

### 阶段 2：TranscriptPage 区域拆分

1. 抽出顶部 header / collapsed toolbar。
2. 抽出 transcript list sidebar。
3. 抽出 transcript main content。
4. 保留 page 入口中的共享状态、handler 和 modal 装配。

### 阶段 3：验证

1. 跑 `npm run typecheck`
2. 跑 `npm test`
3. 如发现拆分带来的 props / 类型问题，直接补齐。

## 验收标准

1. `App.tsx` 主要保留应用壳层和路由编排，不再直接定义大段监听器与标题栏 UI。
2. `TranscriptPage.tsx` 不再直接承载头部、侧栏和主视图的大段 JSX。
3. 入口文件职责更加接近编排层，而不是完整页面实现层。
4. `npm run typecheck` 通过。
5. `npm test` 通过。
