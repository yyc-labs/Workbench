# Agent Logs 全屏检查器与 Markdown/JSON 联动优化计划（2026-07-03）

## 1. 背景

`Agent Logs` 最近已经补上了不少基础能力：

- 设置页可以统一查看 `AI Gateway` 和 `Agent Hook` 日志。
- `Request` 视图已经有 `Flow Map`、聚焦步骤面板、字段索引和原始 JSON 聚焦。
- `JSON` 视图已经支持搜索、重要路径展开、长字符串预览。
- `Markdown` 视图已经能把 `json fenced block` 渲染成可折叠 JSON。

但这一块整体体验仍然偏乱，主要不是“看不到”，而是“信息虽然都在，但缺少一个稳定的查看工作台”：

- 设置页右侧详情面板空间仍然偏紧，长日志会让 `Request / JSON / Markdown` 三种视图来回切换。
- 同一条日志同时存在 `Flow Step`、`JSON`、`Markdown` 三套表达，用户会反复跳视图。
- 点击字段后，还不能稳定把右侧 JSON 精准带到对应路径。
- Markdown 标题目前是主进程里写死的英文字符串，不走 i18n，也不是真正面向当前 locale 的查看体验。
- Markdown 现在更像“复制报告”，还不是“按流程阅读 + 折叠查看 JSON”的工作流视图。
- Markdown 一旦把超长 JSON 字段整段铺开，renderer 很容易因为首屏渲染量过大而卡顿甚至假死。

本计划是在现有 2026-07-01 两份方案基础上，单独收口一版“查看器工作台”方向，重点解决：

1. 点击后进入全屏查看。
2. 点击字段自动定位对应 JSON。
3. Markdown 标题改为 renderer 侧 i18n。
4. Markdown 视图可以按整个流程阅读，并在每一步折叠/展开对应 JSON。

## 2. 相关现状

当前关键落点：

- `src/core/renderer/pages/settings/SettingsAgentLogsPanel.tsx`
  - 负责列表、筛选、详情和 `markdown` 加载。
  - 当前会同时请求 `getAgentLogDetail(...)` 和 `getAgentLogMarkdown(...)`。
- `src/core/renderer/pages/settings/agentLogs/AgentLogDetailPane.tsx`
  - 当前详情分为 `Summary / Request / JSON / Markdown` 四个 tab。
- `src/core/renderer/pages/settings/agentLogs/AgentLogRequestView.tsx`
  - 已有 `Flow Map + Focused Step Inspector` 结构。
- `src/core/renderer/pages/settings/agentLogs/AgentLogStepInspector.tsx`
  - 已支持 body 字段索引，并能把点击结果映射到当前 step 的原始 JSON 聚焦路径。
- `src/core/renderer/pages/settings/agentLogs/AgentLogJsonView.tsx`
  - 已支持 `focusedPath`、搜索、重要路径展开。
- `src/core/renderer/pages/settings/agentLogs/AgentLogMarkdownView.tsx`
  - 当前并未真正做“按 locale 渲染的 Markdown 文档视图”，而是把文本块当 `pre` 渲染，并仅把 `json fence` 替换成折叠 JSON。
- `src/core/electron/main/agent-logs/agent-log-service.ts`
  - 当前 Markdown 标题是主进程里硬编码的英文：
    - `# AI Gateway Request`
    - `# Agent Hook Event`
    - `## Summary`
    - `## Meta`
    - ...

另外，仓库里已经有可复用能力，不需要额外加依赖：

- `src/core/renderer/components/ModalShell.tsx`
  - 已有通用弹窗壳，可直接承接全屏或近全屏查看器。
- `react-markdown`
  - 已在 transcript 相关页面使用，可复用到 Agent Logs 的 Markdown 文档视图。

## 3. 核心问题诊断

### 3.1 详情区没有稳定的“工作台”

现在的设置页右侧更像“预览面板”，不是“重度排障查看器”。

- 在常规宽度下，用户需要在 `Request / JSON / Markdown` 之间切换。
- 长消息、长工具 schema、merged stream、protocol diagnostics 同时出现时，预览面板会显得拥挤。
- 这类日志排查天然适合更宽的工作区，而不是长期挤在 settings 右栏。

### 3.2 三套视图不是同一套语义源

当前：

- `Request` 视图按 flow step 组织。
- `JSON` 视图按原始对象路径组织。
- `Markdown` 视图按主进程字符串模板组织。

这会导致：

- 同一个概念在 3 个地方有 3 种名字或顺序。
- renderer 里的 i18n 文案和 main 里的英文 Markdown 标题容易漂移。
- 点击字段时很难做“跨视图统一跳转”。

### 3.3 Markdown 标题边界放错了层

Markdown 标题现在由 `main/agent-log-service.ts` 直接拼字符串。问题是：

- 主进程不持有 renderer 的 locale 语义。
- 用户切换语言后，详情 UI 已本地化，但 Markdown 标题还是英文。
- 如果后续要按流程重组章节，renderer 还得反向适配 main 返回的固定字符串。

这一块更适合在 renderer 里根据 `detail + i18n` 生成。

### 3.4 字段点击只能局部聚焦，不能成为全局交互

目前 step inspector 里的字段索引已经能聚焦当前 step 的 raw JSON，但范围还不够：

- 详情头部 badge 不能直接跳 JSON。
- Markdown 章节标题和段内字段不能跳 JSON。
- message row / tool row / merged stream block 还没有统一的“Reveal in JSON”语义。
- 不同视图之间缺少共享的 `activeSectionId + focusedPath` 状态。

### 3.5 Markdown 大 JSON 缺少性能保护

当前 Markdown 视图虽然已经能把 `json fence` 变成折叠 JSON，但还没有把“超大 JSON 的初始渲染成本”当成单独问题处理。

需要明确区分两件事：

- 视觉上的折叠
- 渲染上的延迟展开

如果只是默认收起 UI，但组件还是先把整棵 JSON 树完整 mount 出来，那么：

- 超长字符串
- 超大数组
- 深层嵌套对象
- 大量 section 同时展开

仍然会把主线程吃满，最后表现成打开 Markdown 就卡。

所以这次计划里，Markdown 的 JSON 折叠必须同时包含“默认不展开”和“默认不深渲染”两层约束。

## 4. 目标

### 4.1 产品目标

- 设置页保留“筛选 + 列表 + 轻预览”职责。
- 单条日志的深度排查进入全屏查看器完成。
- 用户可以先看流程，再点字段，再看原始 JSON，而不是反复切 tab。

### 4.2 交互目标

- 点击日志后，可以一键进入全屏弹窗查看。
- 点击任意关键字段、message、tool、merged stream 区块，JSON 自动定位到对应路径。
- Markdown 视图按整个流程阅读，并且每一步对应 JSON 可以折叠/展开。

### 4.3 架构目标

- 尽量先做 renderer 内收口，不在第一阶段引入新的 main/preload/shared 复杂改动。
- 让 `Request / JSON / Markdown` 共用一套 section/anchor 模型，避免继续各自长各自的逻辑。
- 所有新增用户可见文案继续走 `src/core/renderer/i18n/messages/settings.ts`。

## 5. 目标体验

### 5.1 设置页角色调整

设置页里保留现有两栏结构，但右侧只承担“预览 + 进入工作台”：

- 保留 `Summary / Request / JSON / Markdown` 预览能力。
- 在详情头部增加 `Open Fullscreen` 操作。
- 列表项支持双击或次级按钮打开全屏查看器。

这样设置页不会被继续做成一个超重页面。

### 5.2 全屏查看器

建议使用 `ModalShell` 实现近全屏工作台，而不是新建路由。

推荐布局：

```text
Header
┌────────────────┬──────────────────────────────┬──────────────────────┐
│ Flow Outline   │ Markdown / Step Narrative   │ JSON Inspector       │
│                │                              │                      │
│                │                              │                      │
└────────────────┴──────────────────────────────┴──────────────────────┘
```

说明：

- 左栏：流程目录 / 步骤状态 / 快速摘要。
- 中栏：按流程阅读的 Markdown 文档视图。
- 右栏：原始 JSON 检查器，始终保留聚焦能力。

中屏可退化为：

```text
Header
Flow Outline
[Markdown | JSON]
```

小屏可退化为：

```text
Header
[Outline | Document | JSON]
```

### 5.3 全局联动状态

查看器内部统一维护：

- `activeSectionId`
- `focusedPath`
- `activeSurface`
  - `document`
  - `json`
- `jsonExpansionMode`

交互规则：

- 点击 flow step：切换 `activeSectionId`。
- 点击字段：同时设置 `activeSectionId + focusedPath`，并把 JSON inspector 展开到对应路径。
- 点击 Markdown 章节标题或章节中的 `Reveal in JSON`：同样设置 `focusedPath`。
- 点击 JSON inspector 中的路径项：反向高亮当前 section。

## 6. 核心方案

### 6.1 先引入统一 section 模型

新增 renderer helper，建议位置：

```text
src/core/renderer/pages/settings/agentLogs/agentLogs.document.ts
```

建议模型：

```ts
type AgentLogDocumentSection = {
  id: string
  title: string
  titleKey: string
  status: 'ok' | 'warn' | 'error' | 'missing'
  summary: string[]
  description?: string
  jsonRootPath: string[]
  primaryFocusPath?: string[]
  extraFocusPaths?: string[][]
  bodyValue?: unknown
  request?: StructuredHttpRequestSnapshot
  response?: StructuredHttpResponseSnapshot
  mergedStream?: ...
}
```

用途：

- `Flow Map` 用它。
- `Focused Step Inspector` 用它。
- `Markdown` 文档视图用它。
- `JSON` 右栏的默认定位也用它。

这样后续不会再出现：

- flow step 自己定义一套标题
- markdown 自己定义一套标题
- json index 再自己猜一套路径

### 6.2 Markdown 改为 renderer 侧生成

不建议继续把“最终显示的 Markdown 文案”放在主进程拼接。

推荐做法：

1. renderer 基于 `detail + t(...) + section model` 生成本地化 section。
2. 由 renderer 负责：
   - 显示 Markdown 文档
   - 复制 Markdown 文本
3. `main` 侧的 `getAgentLogMarkdown(...)` 暂时保留兼容，但不再作为 UI 唯一数据源。

原因：

- 当前 `getAgentLogMarkdown(...)` 只在 `SettingsAgentLogsPanel.tsx` 一处被使用，迁移成本相对可控。
- renderer 才知道当前 locale。
- 以后调整章节顺序或补新的 section，不需要 main/renderer 双边维护模板。

### 6.3 Markdown 视图改为“流程文档”而不是“纯文本报告”

目标不是把整段 JSON 再原样贴一遍，而是把整个流程组织成可阅读文档：

```text
# Gateway Request

## Summary
- ...

## Ingress Request
说明文字
[可折叠 JSON]

## Normalized Request
说明文字
[可折叠 JSON]

## Protocol Diagnostics
说明文字
[可折叠 JSON]

...
```

展示上保留 Markdown 观感，但每个 JSON block 用 `AgentLogCollapsibleJson` 渲染，而不是裸 `pre`。

具体要求：

- 一级、二级标题全部走 i18n。
- 每个 section 的 JSON 默认折叠，异常节点默认展开。
- 很长的 JSON 字段默认只显示摘要，不直接把完整子树渲染到 DOM。
- `merged stream`、`error`、`protocol diagnostics` 这类高价值段默认靠前且更显眼。
- `Copy Markdown` 复制的是当前 locale 下序列化出的 Markdown 文本。

### 6.3.1 Markdown 大 JSON 性能保护

这一条需要作为明确实现约束写进方案，而不是留给实现阶段自由发挥。

规则：

- 文档视图中的 JSON section 默认折叠。
- 超过阈值的节点不仅默认折叠，还必须延迟渲染子树内容，只有用户展开时才真正渲染。
- 长字符串节点默认只显示预览：
  - 字符数
  - 行数
  - `truncated / parseError` 标记
- 大数组默认只显示摘要：
  - `messages [120]`
  - `tools [42]`
  - `previewEvents [200]`
- 大对象默认只显示摘要：
  - key 数量
  - 前几个关键 key
- 非活动 section 不预渲染深层 JSON 内容，避免整篇文档同时 mount 多棵大树。

建议阈值方向：

- 单个字符串超过 `2000` 字符或 `24` 行，进入预览态。
- 数组长度超过 `20`，默认只渲染前几个摘要项。
- 对象 key 数量超过 `24`，默认折叠。
- 单个 JSON block 估算体积超过 `64 KB` 时，首次只渲染摘要卡，不直接挂载完整 `CollapsibleJsonNode` 树。

实现要求：

- 折叠态不能只是 `display: none`；要避免先完整构建再隐藏。
- 展开动作应按节点局部生效，不要因为展开一个大字段导致整个文档重新深渲染。
- 如果 section 本身不是当前活动 section，可只保留摘要和一个 `Expand JSON` 入口。
- Markdown 文档区与右侧 JSON inspector 的职责分开：
  - 文档区重在摘要阅读和轻量展开
  - 右侧 inspector 承担完整 JSON 深查
- renderer 侧不要在首屏预先生成整份 Markdown 复制文本；`Copy Markdown` 必须按需序列化。
- JSON 复制不要在每次 render 都先做一次整棵 `JSON.stringify(...)`；只在用户点击复制时生成文本。
- JSON 树默认展开策略不能依赖“每个节点都递归扫描自己的整棵子树”；应先做一次路径元数据预计算，再按节点 O(1) 判定展开态。
- 超大数组 / 大对象即使被用户展开，也应分批挂载子项，避免一次性把数百上千个 children 全塞进 DOM。

结论：

- Markdown 里不追求“一眼看到完整原始 JSON”。
- Markdown 里追求“先看流程和摘要，需要深查时再跳右侧 JSON inspector”。

### 6.4 字段点击自动跳 JSON

这部分需要把“路径映射”提升成明确能力，而不是分散在局部组件里。

建议新增轻量工具：

```text
src/core/renderer/pages/settings/agentLogs/agentLogs.anchors.ts
```

职责：

- 定义常见字段对应的 JSON path。
- 提供 `focusJsonPath(path, sectionId)` 这类统一动作。

首批覆盖对象：

- 详情头部
  - `requestId`
  - `model`
  - `provider`
  - `status`
- Flow step 摘要 badge
- Body field index
- Message row
- Tool row
- Merged stream text / payload
- Protocol diagnostics
- Error block

要求：

- 所有“可跳 JSON”的位置，都有一致的 hover / click 反馈。
- 聚焦路径后，JSON inspector 自动展开祖先节点并滚动到目标位置。
- 如果当前 section 没有结构化 JSON，明确提示而不是静默失败。

### 6.5 预览页与全屏页职责拆开

当前 `AgentLogDetailPane.tsx` 承担太多角色：既要做 settings 里的详情，又想承接重度查看。

建议拆成两层：

- `AgentLogDetailPane.tsx`
  - 保留 settings 右栏预览职责。
- `AgentLogViewerModal.tsx`
  - 承接全屏工作台。

这能避免把所有重交互继续压进设置页右栏。

## 7. 文件级实施建议

### 7.1 renderer 新增

建议新增：

```text
src/core/renderer/pages/settings/agentLogs/
  AgentLogViewerModal.tsx
  AgentLogDocumentView.tsx
  AgentLogJsonInspectorRail.tsx
  agentLogs.document.ts
  agentLogs.anchors.ts
```

职责建议：

- `AgentLogViewerModal.tsx`
  - 全屏弹窗壳、布局、联动状态。
- `AgentLogDocumentView.tsx`
  - 按 section 渲染 Markdown 风格文档。
- `AgentLogJsonInspectorRail.tsx`
  - 承载右侧 JSON 检查器和路径跳转状态。
- `agentLogs.document.ts`
  - section/source-of-truth 组装。
- `agentLogs.anchors.ts`
  - section 与 JSON path 映射工具。

### 7.2 renderer 调整

需要调整：

- `src/core/renderer/pages/settings/SettingsAgentLogsPanel.tsx`
  - 增加 `viewerOpen` 状态。
  - 后续 phase 可以不再主动请求 `getAgentLogMarkdown(...)`。
- `src/core/renderer/pages/settings/agentLogs/AgentLogDetailHeader.tsx`
  - 增加 `Open Fullscreen` 操作。
- `src/core/renderer/pages/settings/agentLogs/AgentLogSummaryList.tsx`
  - 增加打开全屏查看器入口。
- `src/core/renderer/pages/settings/agentLogs/AgentLogRequestView.tsx`
  - 改为消费统一 section 模型。
- `src/core/renderer/pages/settings/agentLogs/AgentLogStepInspector.tsx`
  - 把局部 `focusedPath` 交给上层 viewer 统一管理。
- `src/core/renderer/pages/settings/agentLogs/AgentLogMarkdownView.tsx`
  - 从“读取 main 返回的 markdown 字符串”切到“消费 renderer 生成的 section / markdown model”。
- `src/core/renderer/pages/settings/agentLogs/AgentLogJsonView.tsx`
  - 继续复用现有 `focusedPath` 机制，增加和 section 联动的外部控制。

### 7.3 i18n

新增或调整文案位置：

- `src/core/renderer/i18n/messages/settings.ts`

新增文案类别建议：

- 全屏查看器标题 / 操作
- section 标题
- `Reveal in JSON`
- `Back to document`
- `Focused path`
- `No structured JSON for this section`
- 文档视图说明 / 空态

### 7.4 main / preload / shared

第一阶段建议不改日志 detail 结构，也不改采集链路。

第二阶段可选清理：

- `src/core/electron/main/agent-logs/agent-log-service.ts`
- `src/core/electron/preload/invokeApi.agentLogs.ts`
- `src/core/shared/electronApi.ts`

清理方向：

- 若 renderer 已完全接管 Markdown 生成，可考虑废弃 `getAgentLogMarkdown(...)`。
- 如果要删这条 IPC，需按链路同步：
  - `shared types/constants`
  - `main ipc handler/service`
  - `preload invoke api`
  - `renderer caller`

## 8. 分阶段执行计划

### P1. 全屏查看器壳层

目标：

- 保留 settings 右栏预览。
- 增加 `Open Fullscreen`。
- 使用 `ModalShell` 做近全屏查看器。

完成标准：

- 不离开设置页即可进入重度查看模式。
- 预览态和重度查看态职责清晰分开。

### P2. 统一 section 模型

目标：

- 抽出 `agentLogs.document.ts`。
- `Flow Map`、`Step Inspector`、`Markdown` 三处共用 section 数据。

完成标准：

- section 标题、顺序、状态只维护一套。
- Gateway / Hook 两条流程都能稳定落到同一套 section 模型。

### P3. Markdown renderer 本地化

目标：

- Markdown 标题改为 renderer 侧 i18n。
- 文档按整个流程渲染。
- 每个 section 的 JSON 可折叠。
- 超长 JSON 字段默认摘要化，并按需展开渲染。

完成标准：

- 当前 locale 为中文时，Markdown 标题和 UI 标题一致。
- 复制出来的 Markdown 也与当前 locale 一致。
- 打开包含超长 JSON 的日志时，Markdown 文档区不会因为初始渲染过重而明显卡顿。

### P4. 字段到 JSON 联动

目标：

- viewer 内统一 `focusedPath`。
- 点击字段、message、tool、section 标题均可跳 JSON。

完成标准：

- 用户不需要手动在 JSON 里二次搜索大部分关键字段。
- 聚焦路径时，JSON inspector 自动展开并滚动到位。

### P5. 清理旧 markdown 链路

目标：

- 评估是否移除 `getAgentLogMarkdown(...)`。
- 减少 main/renderer 双模板维护。

完成标准：

- Agent Logs 的 Markdown 展示逻辑完全在 renderer 可控范围内。
- 不再存在英文硬编码标题与 renderer i18n 漂移。

## 9. 验证清单

手工验证建议：

1. 在 settings 中选中一条日志，确认可正常打开全屏查看器。
2. 在全屏查看器里点击 flow step，确认中间文档区和右侧 JSON inspector 同步切换。
3. 点击头部 `requestId / provider / model / status` 等字段，确认 JSON 自动聚焦到对应路径。
4. 点击 message row、tool row、merged stream block，确认可以跳到 JSON 对应节点。
5. 切换中英文 locale，确认 Markdown 标题和 section 标题都同步变化。
6. Gateway 日志确认流程顺序为：
   - `Ingress`
   - `Normalize`
   - `Protocol Diagnostics`
   - `Upstream`
   - `Provider Response`
   - `Client Response`
7. Hook 日志确认流程顺序为：
   - `Ingress`
   - `Normalize`
   - `Payload`
   - `Side Effects`
8. 构造长 `messages / tools / merged stream`，确认文档视图与 JSON 视图都不会撑爆布局。
9. 构造超大 JSON block，确认 Markdown 默认只显示摘要或折叠态，不会一打开就把完整子树全部渲染出来。
10. 展开单个超长 JSON 字段，确认只影响当前节点，不会导致整个文档明显卡死。
11. 深浅色主题下确认：
   - 全屏遮罩
   - 折叠 JSON
   - 高亮路径
   - 错误 / 警告状态
   都可读。

不默认执行：

- 不执行 build。
- 不安装新依赖。
- 如需跑 `tsc --noEmit`，按仓库规则使用提权的 Node 命令。

## 10. 风险与控制

### 10.1 风险：又做出第四套表示层

控制：

- 先引入 section/source-of-truth。
- Flow / Markdown / JSON 跳转都围绕 section 和 path 做，不再各写一套。

### 10.2 风险：全屏查看器过重，维护成本继续上升

控制：

- settings 右栏继续做预览，不把所有行为都搬进去。
- 全屏查看器只承接重度排障，不承接额外设置逻辑。

### 10.3 风险：renderer 过度依赖 code/transcript 的 markdown 组件

控制：

- 只复用 `react-markdown` 和现成通用组件，不把 code page/transcript page 的大块业务逻辑直接搬进 settings。
- `Agent Logs` 保持自己目录内的本地组件边界。

### 10.4 风险：Markdown 复制与屏幕展示不一致

控制：

- 统一从 renderer 的 section model 序列化。
- 不再分别维护“屏幕标题”和“复制标题”。

### 10.5 风险：Markdown 打开超大 JSON 时卡死

控制：

- Markdown 文档区只做摘要化 JSON 查看，不承担完整深树首屏渲染。
- 超大节点默认折叠并延迟渲染。
- 深查完整结构时优先引导到右侧 JSON inspector，而不是在文档区无限展开。

## 11. 推荐执行顺序

1. 先做 `AgentLogViewerModal` 壳层，把 settings 预览与重度查看分开。
2. 再做 `agentLogs.document.ts`，把 section 模型收口。
3. 基于 section 模型重做 Markdown 文档视图和 i18n 标题。
4. 再接入统一 `focusedPath`，打通字段点击到 JSON。
5. 最后评估是否删除 `getAgentLogMarkdown(...)` 旧链路。

## 12. 预期结果

完成后，这块的使用节奏应从：

```text
选日志 -> 在右栏切 tab -> 人工找字段 -> 再切到 JSON -> 再搜一次
```

变成：

```text
选日志 -> 打开全屏查看器 -> 看流程 -> 点字段/章节 -> JSON 自动定位 -> 复制当前语言的 Markdown 报告
```

这样可以保留当前已有的结构化能力，同时把 Agent Logs 从“信息堆叠区”收口成真正可用的排障工作台。
