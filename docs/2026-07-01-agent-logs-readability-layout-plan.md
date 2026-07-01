# Agent 日志可读性与调度流程布局优化计划（2026-07-01）

## 1. 背景

当前设置页的 Agent 日志已经完成了关键基础能力：

- `Agent Logs` 已从配置页中拆出，独立承载 Gateway 流量日志与 Hook 事件日志。
- 日志详情已经支持 `Summary / Request / JSON / Markdown` 多视图。
- 请求链路已经能展示 `ingress / normalized / upstream / response` 等结构。
- JSON 视图已经有基础折叠能力，Markdown 也可以用于复制排障材料。

现阶段的问题不再是“能不能看到”，而是“看起来是否高效”：

- 信息密度偏高，日志列表、详情标题、tab、请求块、body 内容同时出现时容易拥挤。
- 长文本、长 JSON、headers、tools、messages 会撑高页面，用户需要大量滚动才能定位问题。
- 调度流程虽然以请求块顺序呈现，但缺少一个稳定的“流程地图”，不利于快速判断卡在哪一步。
- JSON 折叠是按对象层级折叠，不等于按排障语义折叠；用户更关心 `system / messages / tools / upstream response / error` 这些业务区域。
- Request 视图更像“详情罗列”，还没有形成“先看流程，再点节点看详情”的排查节奏。

本计划只讨论下一轮 UI 与交互优化，不调整底层日志采集边界，不引入新的第三方依赖。

## 2. 当前代码事实

相关落点：

- `src/core/renderer/pages/settings/SettingsAgentLogsPanel.tsx`
  - 当前是筛选栏 + 左侧日志列表 + 右侧详情面板的两栏布局。
  - 列表区在大屏下 sticky，详情区占更大宽度。
- `src/core/renderer/pages/settings/agentLogs/AgentLogDetailPane.tsx`
  - 当前详情区包含 `Summary / Request / JSON / Markdown` tab。
  - 每次切换日志后默认回到 `Request` tab。
- `src/core/renderer/pages/settings/agentLogs/AgentLogRequestView.tsx`
  - 当前按 Gateway / Hook 的阶段生成多个 `RequestSectionCard`。
  - 顶部已有轻量流程 breadcrumb，但它只展示顺序，不能作为导航和状态判断入口。
  - `BodyInspector` 会把 `system / instructions / messages / tools` 拆出来，但展开策略仍偏“全部铺开”。
- `src/core/renderer/pages/settings/agentLogs/AgentLogCollapsibleJson.tsx`
  - 当前可按 JSON 层级折叠。
  - 仍缺少长字符串截断、按路径默认折叠、搜索命中展开、折叠状态批量控制等能力。

结论：

- 不需要推翻当前架构。
- 优先在 `agentLogs/` 子目录内迭代组件和 helper。
- `SettingsAgentLogsPanel.tsx` 继续保持页面装配职责，不承接复杂详情逻辑。

## 3. 优化目标

### 3.1 阅读目标

用户进入一条日志后，应先回答 4 个问题：

1. 这条日志属于 Gateway 还是 Hook？
2. 整个流程走到了哪一步？
3. 哪一步异常、耗时、截断或返回了错误？
4. 需要展开哪一块原始数据继续排查？

### 3.2 布局目标

- 默认状态更紧凑，避免一屏内同时铺开全部长内容。
- 大屏强调“列表 + 流程 + 详情”三段式排障节奏。
- 中等宽度仍保持当前两栏结构，但详情内部需要有流程导航。
- 小屏改为单列，列表和详情用分段切换，不强行挤压。

### 3.3 折叠目标

- 长文本默认摘要化，保留“展开全部 / 收起全部 / 复制完整内容”。
- 长 JSON 默认只展开关键层级，非关键数组和大对象默认折叠。
- Headers、tools、raw body、stream preview 默认折叠。
- 出错节点、截断节点、搜索命中节点应优先展开或高亮。

## 4. 目标信息结构

建议把单条日志详情重组为 3 层：

```text
Detail Header
  -> Flow Map
    -> Focused Step Inspector
```

### 4.1 Detail Header

只保留最关键的元数据：

- source
- title
- status / level
- duration
- model / provider / event
- timestamp
- request id

调整方向：

- `request id` 默认单行截断，提供 copy。
- 错误态、截断态、stream 态用 badge 提醒，不在标题区堆字段。
- Summary tab 可以保留，但标题区需要承担最常用摘要，减少用户频繁切 tab。

### 4.2 Flow Map

Gateway 日志建议固定为：

```text
Ingress Request -> Normalized Request -> Upstream Request -> Upstream Response -> Client Response
```

Hook 日志建议固定为：

```text
Ingress Request -> Normalized Envelope -> Payload -> Side Effects
```

其中 `Side Effects` 首版可以只作为占位摘要：

- Transcript import 是否触发
- Feishu notify 是否触发
- 如果当前 detail 没有这些字段，则显示 `not captured`

Flow Map 每个节点显示：

- 节点名
- 状态：ok / warn / error / missing
- 摘要：method + path、statusCode、body size、event name、truncated 等
- 耗时：如果当前模型没有 step duration，则先只显示总 duration，不伪造分段耗时

交互：

- 点击节点后，下方或右侧只展示该节点详情。
- 异常节点默认选中。
- 如果没有异常，默认选中最有排障价值的节点：
  - Gateway：`Upstream Response`
  - Hook：`Normalized Envelope`

### 4.3 Focused Step Inspector

替代当前“一次铺开所有 RequestSectionCard”的默认体验。

每次只聚焦一个流程节点，节点内部再分区：

- Overview
- Headers
- Body Summary
- Messages
- Tools
- Raw JSON

默认展开策略：

- `Overview` 默认展开。
- `Body Summary` 默认展开。
- `Messages` 只展开前 2 条和错误相关条目。
- `Tools` 默认折叠，只显示数量和名称摘要。
- `Headers` 默认折叠。
- `Raw JSON` 默认折叠。

## 5. 长内容折叠策略

### 5.1 文本截断

新增通用长文本展示组件，建议命名：

```text
src/core/renderer/pages/settings/agentLogs/AgentLogExpandableText.tsx
```

规则：

- 单段文本超过 12 行默认折叠。
- 单段文本超过 4000 字符默认只渲染预览，点击后再渲染完整内容。
- 折叠态显示：
  - 字符数
  - 行数
  - 是否被日志采集层截断
- 操作：
  - Expand
  - Collapse
  - Copy full

### 5.2 JSON 折叠

增强 `AgentLogCollapsibleJson`：

- 支持 `defaultCollapsedPaths`，例如：
  - `headers`
  - `tools`
  - `rawText`
  - `previewEvents`
- 支持 `importantPaths`，例如：
  - `error`
  - `statusCode`
  - `model`
  - `messages`
- 支持批量操作：
  - Expand all
  - Collapse all
  - Expand important
- 长字符串节点显示预览，不直接撑满整块。
- 对数组显示更可读的摘要，例如 `messages [18]`、`tools [42]`。

### 5.3 Messages 折叠

针对 AI 请求 body 的 `messages / input` 做专门展示：

- 每条 message 是独立卡片。
- 默认只展示 role、name、content 类型、字符数。
- `system / developer / user / assistant / tool` 使用轻量标签区分。
- 长 content 默认折叠。
- tool result 默认折叠，因为通常很长。

### 5.4 Tools 折叠

工具定义经常占用大量空间，默认展示摘要：

- tool count
- tool names
- 每个 tool 的 schema 是否存在

展开后再看完整 schema。

## 6. 调度流程表达

### 6.1 Gateway 流程

首版不需要画复杂图，建议用横向 stepper：

```text
[Ingress] -> [Normalize] -> [Upstream] -> [Provider Response] -> [Client Response]
```

节点状态判断：

- `error`：detail.error 存在，或该节点 response status >= 400。
- `warn`：body truncated、parseError、missing optional response。
- `missing`：当前节点没有捕获到数据。
- `ok`：节点有数据且无异常。

节点摘要：

- Ingress：`POST /v1/messages`、body size、auth source。
- Normalize：route、requested model、stream requested。
- Upstream：provider、mapped model、target host。
- Provider Response：status、stream enabled、event count。
- Client Response：status、response size、stream summary。

### 6.2 Hook 流程

建议 stepper：

```text
[Ingress] -> [Normalize] -> [Payload] -> [Import / Notify]
```

节点摘要：

- Ingress：provider path、event query、body size。
- Normalize：providerEvent、canonicalEvent。
- Payload：cwd、toolName、payload size。
- Import / Notify：首版只展示是否有可用字段；没有字段时明确显示 `not captured yet`。

## 7. 布局方案

### 7.1 大屏布局（建议 >= 1536px）

```text
Filters
┌──────────────┬──────────────────────────────┬──────────────────────┐
│ Log List     │ Flow + Focused Step          │ JSON / Markdown       │
│              │                              │ Quick Inspector       │
└──────────────┴──────────────────────────────┴──────────────────────┘
```

说明：

- 左侧列表固定宽度，避免被详情挤压。
- 中间是流程图和选中节点详情。
- 右侧作为可折叠 Inspector，放 JSON / Markdown / Copy。
- 如果实现复杂，首版可以先不做第三栏，只做详情内部的可折叠 inspector。

### 7.2 中屏布局

保持当前两栏：

```text
Filters
┌──────────────┬──────────────────────────────┐
│ Log List     │ Detail Header                │
│              │ Flow Map                     │
│              │ Focused Step Inspector       │
│              │ JSON / Markdown Tabs         │
└──────────────┴──────────────────────────────┘
```

重点是右侧详情不再一次性铺开所有请求阶段。

### 7.3 小屏布局

```text
Filters
[List | Detail]
```

规则：

- 未选中日志时显示列表。
- 选中后进入详情，提供返回列表按钮。
- Flow Map 横向滚动，节点不压缩到不可读。

## 8. 组件拆分建议

保留现有文件职责，并新增更语义化的子组件：

```text
src/core/renderer/pages/settings/agentLogs/
  AgentLogDetailHeader.tsx
  AgentLogFlowMap.tsx
  AgentLogStepInspector.tsx
  AgentLogExpandableText.tsx
  AgentLogMessageList.tsx
  AgentLogToolSummary.tsx
  AgentLogInspectorRail.tsx
```

调整现有组件：

- `AgentLogDetailPane.tsx`
  - 继续作为详情装配层。
  - 管理 active tab 和 active flow step。
- `AgentLogRequestView.tsx`
  - 从“渲染所有 section”改为“构造 flow sections + 渲染选中 section”。
  - 可把 section 生成逻辑提取到 `agentLogs.flow.ts`。
- `AgentLogCollapsibleJson.tsx`
  - 增加按路径折叠、批量展开、长字符串预览。
- `AgentLogJsonView.tsx`
  - 增加 `Expand important / Collapse all` 操作入口。
- `AgentLogMarkdownView.tsx`
  - 保持复制能力，默认不渲染过多装饰。

不建议：

- 不把流程、消息、tools 展示逻辑塞回 `SettingsAgentLogsPanel.tsx`。
- 不为了这次布局引入全局状态；局部 UI 状态留在日志页组件内即可。
- 不把 code page 的大型 Markdown/JSON 能力反向依赖到 Settings。

## 9. i18n 与文案

新增用户可见文案必须进入 `src/core/renderer/i18n/messages/settings.ts`。

建议新增文案类别：

- flow step 名称
- step 状态
- expand / collapse / copy 操作
- long content metadata
- not captured yet
- hidden large content hint

中文文案原则：

- 少用技术堆叠，优先说明“这一步做了什么”。
- 对缺失字段明确区分：
  - `未捕获`
  - `无内容`
  - `已截断`
  - `解析失败`

## 10. 分阶段执行计划

### P1. 先做流程地图和单节点详情

目标：

- 在 Request tab 顶部加入可点击 Flow Map。
- Request tab 默认只展开一个流程节点。
- 异常 / warn / missing 节点有清晰状态。

完成标准：

- 用户不用滚完整页，就能看出请求走到哪一步。
- 点击 step 能快速切换对应详情。

### P2. 做长文本和 messages 折叠

目标：

- 新增 `AgentLogExpandableText`。
- Messages 默认摘要化。
- tool result / long content 默认折叠。

完成标准：

- 长 prompt、长 tool schema、长 tool result 不再撑爆详情页。
- 每段长内容都能复制完整内容。

### P3. 增强 JSON 折叠

目标：

- `AgentLogCollapsibleJson` 支持重要路径、默认折叠路径、批量展开/收起。
- 长字符串 JSON 节点默认预览。

完成标准：

- JSON tab 默认可读，不再一打开就是大面积原始结构。
- 排查时能一键展开关键字段。

### P4. 调整响应式布局

目标：

- 大屏评估三栏 inspector。
- 中屏保留两栏但压缩标题和详情密度。
- 小屏提供 List / Detail 切换。

完成标准：

- 1366px 宽度下详情不明显拥挤。
- 1536px 以上宽度能更充分利用横向空间。

### P5. 文案、空态和验证

目标：

- 补齐中英文文案。
- 明确空态、缺失、截断、解析失败。
- 手工验证深浅色主题。

完成标准：

- 所有新增 UI 文案走 i18n。
- 不破坏现有 Agent Logs 基础功能。

## 11. 验证清单

手工验证：

1. 进入 `/settings/agent-logs`，确认列表与详情在 1366px 宽度下不拥挤。
2. 选择 Gateway 日志，确认 Flow Map 顺序为 `Ingress -> Normalize -> Upstream -> Provider Response -> Client Response`。
3. 选择 Hook 日志，确认 Flow Map 顺序为 `Ingress -> Normalize -> Payload -> Import / Notify`。
4. 构造长 prompt / 长 messages / 多 tools 日志，确认默认折叠且可复制完整内容。
5. 打开 JSON tab，确认默认折叠路径和长字符串预览生效。
6. 构造 error / truncated / parseError 日志，确认对应节点高亮或默认选中。
7. 切换深浅色主题，确认状态 badge、折叠块、scroll 区域可读。
8. 小屏宽度下确认可以从列表进入详情并返回。

不默认执行：

- 不执行 build。
- 不新增依赖安装。

如需要验证 TypeScript，可单独执行 `tsc --noEmit`，但按仓库规则涉及 Node 命令时需要提权。

## 12. 风险与控制

### 12.1 风险：UI 组件继续膨胀

控制：

- `AgentLogDetailPane` 只做装配。
- 流程构造放 helper。
- 长文本、message、tool、JSON 折叠各自独立组件。

### 12.2 风险：折叠导致关键信息被藏起来

控制：

- error / warn / truncated / parseError 默认可见。
- 搜索命中或异常节点优先展开。
- 每个折叠块显示摘要和数量。

### 12.3 风险：流程图表达过度设计

控制：

- 首版使用 stepper，不引入复杂画布、Mermaid 或第三方流程图库。
- 只表达当前日志数据中真实存在的节点，不伪造不可得的耗时或 side effect。

## 13. 预期结果

完成后，Agent Logs 的使用节奏应从：

```text
选日志 -> 看一整页详情 -> 大量滚动 -> 找字段
```

变成：

```text
选日志 -> 看流程地图 -> 点异常节点 -> 展开必要长内容 -> 复制排障材料
```

这样既保留当前“所有格式都能查到”的完整性，又能让默认视图更清楚、更松弛，也更适合真实排查问题。
