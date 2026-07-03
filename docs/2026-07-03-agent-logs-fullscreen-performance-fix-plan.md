# Agent Logs 全屏查看性能修复方案（2026-07-03）

## 1. 问题定义

当前 `Agent Logs` 的全屏查看器在打开大日志时明显卡顿，体感上不是单个交互点慢，而是：

- 打开瞬间首屏阻塞明显。
- 切换 `Document / JSON` 时掉帧。
- 保持全屏不操作时，仍然会周期性抖动。

从现有实现看，这不是 Electron 窗口最大化本身的问题，而是 renderer 在全屏态同时做了太多重复渲染和整树遍历。

结论先说：

- 这是一个“重复挂载 + 隐藏组件仍在渲染 + 大 JSON 全树扫描 + 后台轮询持续刷新”叠加出来的问题。
- 主要修复面应放在 `renderer/pages/settings/agentLogs`，第一阶段不需要改 main / preload 契约。

## 2. 代码证据

### 2.1 全屏打开后，后台预览面板并没有卸载

`src/core/renderer/pages/settings/SettingsAgentLogsPanel.tsx`

- `256-261` 行始终渲染右侧 `AgentLogDetailPane`。
- `277-283` 行又额外挂了 `AgentLogViewerModal`。
- `viewerOpen` 只控制 modal 是否打开，没有让后台详情面板降级或卸载。

这意味着用户打开全屏后，页面实际上同时维护了两套详情树：

- 设置页右栏预览
- 全屏工作台

如果当前日志本身包含大请求体、长 messages、tools、stream payload，这个重复成本会非常高。

### 2.2 全屏 modal 内部又挂了多套“隐藏但仍然活着”的重视图

`src/core/renderer/pages/settings/agentLogs/AgentLogViewerModal.tsx`

- `181-213` 行的移动端 `outline / document / json` 三块都通过 `block/hidden` CSS 切换。
- `215-239` 行的桌面端主视图也是单独再挂一套。
- `142-179` 行左栏还会再挂 `FlowMap` 或 `JsonFieldIndexPanel`。

这里的关键问题不是“是否可见”，而是“是否 mount”：

- `hidden` 只是不显示，不会阻止 React 渲染子树。
- 所以在桌面端，移动端那套 `FlowMap + MarkdownView + JsonInspectorRail` 仍然会一起参与渲染。
- 在移动端，桌面端那套结构同样还活着。

结果是一个全屏 modal 实际上常常会同时持有多份重组件实例。

### 2.3 全屏状态下，父层 3.5 秒轮询仍在持续触发刷新

`src/core/renderer/pages/settings/SettingsAgentLogsPanel.tsx`

- `81-87` 行启动了 `setInterval(..., 3500)`，持续刷新 summaries。

即使用户已经进入全屏工作台，这个轮询也不会暂停。直接后果：

- `SettingsAgentLogsPanel` 周期性 re-render。
- 作为其子组件的 `AgentLogViewerModal` 也会跟着走一轮 render。
- 如果这时 modal 内已经挂着多套 JSON / document / flow 子树，就会形成稳定卡顿和周期性抖动。

这也是“打开后不操作也感觉不顺”的主要来源之一。

### 2.4 JSON 视图在渲染前就会做整树索引和整树元数据扫描

`src/core/renderer/pages/settings/agentLogs/AgentLogJsonView.tsx`

- `76-103` 行的 `buildPathIndex` 会深度遍历 JSON，构造字段索引。
- `180` 行和 `231` 行分别在 `AgentLogJsonFieldIndexPanel`、`AgentLogJsonView` 中调用它。

`src/core/renderer/pages/settings/agentLogs/AgentLogCollapsibleJson.tsx`

- `137-174` 行的 `buildJsonTreeMetadata` 会递归整棵 JSON，计算：
  - `importantBranchKeys`
  - `searchBranchKeys`
  - `searchMatchKeys`
  - `focusedBranchKeys`
- `569-571` 行每次 `value / focusedPath / searchQuery` 变化时都会重新做这轮扫描。

注意这里的成本发生在“树展开之前”：

- 即使节点默认折叠，整树元数据仍然已经先跑了一遍。
- 如果同时挂着多份 `AgentLogCollapsibleJson`，这个成本会被直接放大。

### 2.5 Document 视图默认一次性渲染所有 section 的 narrative

`src/core/renderer/pages/settings/agentLogs/AgentLogDocumentView.tsx`

- `556-566` 行直接 `sections.map(...)`，把所有 section 都挂出来。
- 每个 `SectionNarrative` 内部都会进一步决定是否渲染：
  - `OverviewFields`
  - `MergedStreamNarrative`
  - `AgentLogMessageList`
  - `AgentLogToolSummary`
  - `NarrativeTextBlock`
  - `JsonDocumentBlock`

虽然 `JsonDocumentBlock` 在未展开时只显示摘要，但 section 本身仍然全部 mount 了，前置处理并没有被真正推迟。

### 2.6 Document 视图对 section JSON 的读取是“按 section 重复取值”

`src/core/renderer/pages/settings/agentLogs/agentLogs.document.ts`

- `114-122` 行的 `getAgentLogDocumentSectionJsonValue(...)` 内部每次都会先做一次 `detailToJson(detail)`。

`src/core/renderer/pages/settings/agentLogs/AgentLogDocumentView.tsx`

- `246-253` 行的 `JsonDocumentBlock` 对每个 section 都会执行这条读取链。

`detailToJson(...)` 本身不是深拷贝，单次成本不算最重，但在“多 section + 多视图 + 多次 render”叠加下仍然属于无效重复计算。

### 2.7 同一份派生模型在多个视图里被重复构造

`buildAgentLogDocumentSections(...)` 和 `detailToJson(...)` 当前会在多处独立计算：

- `AgentLogDetailPane.tsx:157-158`
- `AgentLogRequestView.tsx:17`
- `AgentLogViewerModal.tsx:38-40`
- `AgentLogJsonInspectorRail.tsx:28`
- `agentLogs.document.ts:118`

这类派生数据没有统一缓存层，导致：

- 预览面板算一次
- request tab 再算一次
- fullscreen modal 再算一次
- document section 取 JSON 时再拼一次

问题不是某一次特别慢，而是每层都各算各的。

## 3. 根因归纳

按影响排序，当前卡顿主要来自四类问题：

### 3.1 结构性重复挂载

- 后台详情面板和全屏 modal 并存。
- modal 内部又同时挂了移动端和桌面端的重子树。

这是最需要先处理的一层，因为它会把后面的所有计算放大。

### 3.2 大 JSON 的前置同步计算太多

- 字段索引先全树遍历。
- 树元数据先全树遍历。
- 文档 section 还会反复抽取 JSON 子树。

这会直接拉高首屏打开成本。

### 3.3 非当前视图也在参与工作

- 当前用户在 `Document` 面上时，隐藏的 `JSON` 面可能仍然 mount。
- 当前用户在 `JSON` 面上时，隐藏的 `Document` narrative 也可能还活着。

这是明显的“产品语义上不可见，但技术上仍在消耗”的问题。

### 3.4 全屏态还在接受后台轮询刷新

- 即使用户正在排查单条日志，全局列表还在按 3.5 秒刷新。
- 这会把本该静止的工作台变成周期性重算现场。

## 4. 修复目标

第一阶段目标不追求功能重做，只追求把全屏工作台变成“只为当前视图付费”。

具体目标：

1. 打开全屏时，只保留一套详情工作树。
2. 当前屏幕尺寸下，只 mount 当前布局需要的那套组件。
3. 当前 surface 不可见时，不做对应的大 JSON 计算。
4. 当前 section 未激活时，不渲染完整 narrative 和 JSON 子树。
5. 全屏停留期间，不再被后台 3.5 秒轮询持续打断。

## 5. 修复方案

### 5.1 P0：打开全屏时，卸载或降级后台详情面板

目标：

- `viewerOpen === true` 时，设置页右栏不再保留完整 `AgentLogDetailPane`。

建议做法：

- 在 `SettingsAgentLogsPanel.tsx` 中对右栏详情做 gating。
- 全屏打开后，右栏只保留轻量占位信息，或者直接不渲染详情 pane。

建议形态：

- 列表仍保留，方便用户切换条目。
- 右栏重详情在全屏期间卸载。

收益：

- 立即砍掉一整套重复的 `summary/request/json/markdown` 子树。

### 5.2 P0：全屏期间暂停 summaries 轮询

目标：

- `viewerOpen === true` 时暂停 `loadSummaries()` 定时器。

建议做法：

- 把 `81-87` 行轮询改成依赖 `viewerOpen` 和 `document.visibilityState`。
- 关闭全屏时再恢复轮询。

收益：

- 避免 modal 在 idle 状态下每 3.5 秒整棵 re-render。
- 用户阅读大日志时，交互稳定性会立刻改善。

风险：

- 全屏期间列表不会自动滚动出最新日志。

这个风险是可接受的，因为当前用户已经进入单条日志排障流，实时刷新列表优先级低于交互流畅度。

### 5.3 P0：把 modal 的“隐藏布局”改成真正的条件渲染

目标：

- 桌面端只 mount 桌面工作台。
- 移动端只 mount 移动端工作台。
- `surface` 只 mount 当前激活的 surface。

建议做法：

- 拆出 `DesktopViewerBody` / `MobileViewerBody`。
- 不再用 `hidden/block/xl:hidden/xl:block` 控制重组件显隐。
- 直接用条件分支决定是否渲染 `AgentLogMarkdownView`、`AgentLogJsonInspectorRail`、`AgentLogFlowMap`。

实现约束：

- “不可见”必须等于“未挂载”。
- 不接受继续用 CSS class 伪装条件渲染。

### 5.4 P1：引入共享 viewer model，避免各层重复算 sections / jsonValue

目标：

- 对同一条 `detail`，只在一个地方构造：
  - `detailKey`
  - `sections`
  - `defaultSectionId`
  - `jsonValue`
  - `sectionJsonById`

建议位置：

- 新增 renderer hook，例如：
  - `src/core/renderer/pages/settings/agentLogs/useAgentLogViewerModel.ts`

建议返回值：

```ts
type AgentLogViewerModel = {
  detailKey: string | null
  jsonValue: unknown
  sections: AgentLogDocumentSection[]
  defaultSectionId: string
  sectionJsonById: Record<string, unknown>
}
```

然后统一给：

- `AgentLogDetailPane`
- `AgentLogRequestView`
- `AgentLogViewerModal`
- `AgentLogJsonInspectorRail`
- `AgentLogDocumentView`

消费，而不是每层自己重新 `buildAgentLogDocumentSections()` / `detailToJson()`。

### 5.5 P1：Document 视图改成“轻 section 列表 + 激活 section 深渲染”

目标：

- 非激活 section 只显示：
  - 标题
  - 状态
  - summary chips
  - 必要说明
- 只有激活 section 才渲染：
  - message list
  - tool summary
  - raw text
  - merged stream payload
  - section JSON block

建议做法：

- `SectionNarrative` 分成：
  - `SectionCardShell`
  - `ActiveSectionNarrative`
- `sections.map(...)` 时，inactive section 只走轻量卡片。
- 可选保留“激活 section 前后各 1 个邻居”做预热，但默认不要全量 narrative。

收益：

- 文档视图首屏从“整份日志全展开式 narrative”变成“目录化渐进加载”。

### 5.6 P1：JSON 索引和树元数据按 surface 惰性计算

目标：

- 不在 `document` surface 下计算完整 JSON 字段索引。
- 不在 JSON 视图未进入时构建 path index。

建议做法：

1. `AgentLogJsonFieldIndexPanel`
   - 仅在 `surface === 'json'` 时 mount。
2. `AgentLogJsonView`
   - 仅在 JSON surface 激活时才构造 `pathIndex`。
3. `AgentLogCollapsibleJson`
   - 将 `buildJsonTreeMetadata(...)` 拆成分层策略：
     - 无 `searchQuery`
     - 无 `focusedPath`
     - 仅有 `importantPaths`
   - 没有搜索和 focus 时，不要完整扫描整棵树去建 `searchBranchKeys` / `searchMatchKeys`。

额外建议：

- `buildPathIndex` 可以先产出浅层索引，再在用户搜索时逐步补深层。
- 如果仍然不够，可再考虑 `requestIdleCallback` 做补索引，但这应放在 P2。

### 5.7 P1：section JSON 取值改为父层一次性切片

目标：

- 不要在每个 `JsonDocumentBlock` 里再走一遍 `detailToJson(detail)`。

建议做法：

- 在共享 viewer model 里一次性构建 `sectionJsonById`。
- `JsonDocumentBlock` 直接拿 `sectionJsonById[section.id]`。

这样可以把：

- JSON 根对象拼装
- section 路径读取

从“每个 section 自己做”改成“父层只做一次”。

### 5.8 P2：进一步减轻 message / tool 的同步文本整理成本

当前 `Document` 和 `Request` 视图都可能对大消息体做：

- `extractTextBlocks(...)`
- `rowsFromMessages(...)`
- `summarizeTools(...)`

这块不是首要矛盾，但在大 prompt / 大 tool schema 下仍会放大卡顿。

建议：

- 默认只显示前 1-2 条 message 预览。
- 大块文本先走截断摘要，用户展开后再做完整文本提取。
- tool schema 默认只渲染标签，不默认挂完整 `AgentLogCollapsibleJson`。

## 6. 推荐实施顺序

### 第一刀

- 全屏时卸载后台 `AgentLogDetailPane`
- 全屏时暂停 summaries 轮询

这两项改完后，体感大概率就会先改善一截。

### 第二刀

- modal 改成真实条件渲染
- 同时移除移动端/桌面端隐藏子树并存

这一步会直接砍掉重复 mount，是收益最大的结构性优化。

### 第三刀

- 抽 `useAgentLogViewerModel`
- 合并 `sections / jsonValue / sectionJsonById` 计算

这一步主要解决多层重复派生。

### 第四刀

- Document 视图 section 惰性深渲染
- JSON 索引和元数据惰性计算

这一步解决大日志首屏阻塞。

## 7. 验收标准

修复后至少应满足下面几条：

1. 打开全屏时，不再出现明显“整窗冻结一下”的感觉。
2. 保持全屏静止 10 秒以上，不应再出现明显周期性抖动。
3. 在 `Document / JSON` 之间切换时，不应再重复触发另一套隐藏视图的大渲染。
4. 聚焦 JSON 路径时，只展开必要分支，不触发无关 section 全量刷新。
5. 同一条大日志下，renderer 挂载的重视图数量应从“多套并存”降到“当前需要的一套”。

## 8. 非目标

这份方案第一阶段不包含：

- 改 main 侧日志采集契约
- 新增第三方虚拟列表依赖
- 改日志数据结构
- 把全屏查看器改成独立路由页

先把 renderer 当前这几层无效消耗砍掉，收益会比继续加功能更直接。

## 9. 最终判断

这次卡顿的核心不是“日志太大所以没办法”，而是当前实现没有做到按需渲染。

更准确地说，问题集中在三句话：

- 不该同时活着的视图，现在同时活着。
- 不该提前计算的 JSON，现在提前整树计算了。
- 不该在全屏时继续跑的后台刷新，现在还在继续跑。

先按本方案把这三类问题拆掉，再看是否需要更细的局部优化，才是合理顺序。
