# Settings AI / Agent 拆分与日志增强计划（2026-06-30）

## 1. 背景

当前 Settings 里的 AI / Agent 相关能力已经跨了 4 类职责：

- Agent 模型与运行时配置
- AI Gateway 配置
- Hook Gateway / Transcript Import / Feishu 等入口配置
- 调试日志与请求排障

现状里这些职责被拆在两个面板里，但每个面板内部仍然混杂：

- `src/core/renderer/pages/settings/SettingsAgentsPanel.tsx`
  - 当前把 `Claude / Codex / Gateway` 放在同一个 tab 容器里。
- `src/core/renderer/pages/settings/SettingsAiGatewayPanel.tsx`
  - 同时承载 `网关状态`、`Provider 配置`、`全局接管`、`最近日志`。
- `src/core/renderer/pages/settings/SettingsAgentHooksPanel.tsx`
  - 同时承载 `Hook Gateway 配置`、`Transcript Import`、`Feishu`、`最近事件列表`、`原始 payload 详情`。

用户感知上的问题已经很明确：

- “模型配置”和“网关配置”不是同一层职责，但现在在 `AI / Agents` 里并列混放。
- “配置”页面里直接塞“日志列表”，导致页面既重又难扫。
- Gateway 日志只有扁平字段和 `bodyPreview`，无法完整查看一次请求的真实结构。
- Hook 页虽然能看 `raw`，但它本质上是“事件观测”，不应该继续和配置项挤在一个页面里。
- 当前 `settings/logs` 已经是 Startup Logs，不能再把 Agent/Gateway 调试日志继续堆进去。

这次计划的目标不是先改实现，而是先把信息架构、路由边界、日志数据模型和执行顺序定义清楚。

## 2. 当前代码事实

### 2.1 Settings 路由现在只有单段 section

当前 renderer 路由：

- `src/core/renderer/App.tsx`
  - `/settings`
  - `/settings/:section`

当前 section 定义：

- `src/core/renderer/pages/settings/settings.types.ts`
  - `general`
  - `shortcuts`
  - `data`
  - `runtime`
  - `agents`
  - `transcripts`
  - `hooks`
  - `logs`
  - `ai`
  - `rules`
  - `about`

说明：

- 现在并没有单独的 `gateway` 或 `agent-logs` 路由。
- `ai-runtime` 和 `codex` 只是 alias，最终仍落到 `agents`。

### 2.2 `agents` 页当前把模型和网关混在一起

`src/core/renderer/pages/settings/SettingsAgentsPanel.tsx`

- tab: `claude`
- tab: `codex`
- tab: `gateway`

也就是说，用户从“Agent 模型配置”入口进来后，还会在同一个页面中切到“本地协议网关配置”，语义已经开始混层。

### 2.3 `gateway` 页当前还混着日志

`src/core/renderer/pages/settings/SettingsAiGatewayPanel.tsx`

当前同页承载：

- 本地监听地址
- Provider 配置
- 全局接管
- Recent Gateway Logs

当前日志契约：

- `src/core/shared/types.ts`
  - `AiGatewayLogEntry`

字段主要是：

- `route`
- `requestMethod`
- `requestPath`
- `providerName`
- `model`
- `statusCode`
- `bodyPreview`

问题：

- 没有完整请求体对象。
- 没有“转换前请求”和“转换后上游请求”。
- 没有上游响应头/响应体结构。
- 没有持续一致的 `requestId / correlationId / durationMs`。
- `bodyPreview` 是字符串预览，不适合做稳定排障。

### 2.4 `hooks` 页当前还混着事件观测

`src/core/renderer/pages/settings/SettingsAgentHooksPanel.tsx`

当前同页承载：

- Hook Gateway 状态
- Transcript Import 配置
- Feishu 配置
- Recent Events 列表
- Raw payload 详情

当前事件契约：

- `src/core/shared/types.ts`
  - `AgentHookEnvelope`
  - `AgentHookGatewayStatus`

当前 `AgentHookEnvelope` 保留了：

- `provider`
- `providerEvent`
- `canonicalEvent`
- `cwd`
- `toolName`
- `raw`

问题：

- `raw` 只有 payload 级别的数据。
- 没有 HTTP ingress request 的 headers / path / query / auth source / body size / request id。
- 事件观测和入口配置继续耦合在同一页面。

### 2.5 日志链路目前分散，没有统一聚合面

当前日志来源至少有两套：

- `AI Gateway`
  - `window.electronAPI.getAiGatewayRecentLogs()`
- `Agent Hooks`
  - `window.electronAPI.getAgentHookRecentEvents()`
  - `window.electronAPI.onAgentHookEvent(...)`

它们的表现形式不同：

- Gateway 是“请求流量日志”
- Hook 是“事件日志”

但从用户排障视角看，它们都属于 Agent 观测面，不应该继续分裂在两个配置页里。

## 3. 目标信息架构

### 3.1 路由职责重新划分

本轮建议采用“新增顶层 section”的方式，不做多段嵌套路由。

原因：

- 当前 `App.tsx` 和 `Settings.tsx` 都基于 `/settings/:section`，新增顶层 section 风险最小。
- 只需要扩展 `settings.types.ts`、sidebar、route catalog 和对应 panel 装配。
- 不需要同时重写 Settings 页面内部导航模型。

目标路由：

```text
/settings/agents       -> Agent / 模型配置
/settings/gateway      -> AI Gateway 配置
/settings/hooks        -> Hook Gateway / Transcript Import / Feishu 配置
/settings/agent-logs   -> Agent 观测日志
/settings/logs         -> 保持 Startup Logs，不混入 Agent 流量
```

### 3.2 页面职责

#### A. `/settings/agents`

只保留：

- Claude profile / shell / runtime 相关配置
- Codex provider / model 相关配置
- 安装命令入口

不再包含：

- Gateway tab
- Recent logs

允许保留：

- `Claude / Codex` 二级 tab

因为这两者都属于“Agent / 模型配置层”，语义仍然一致。

#### B. `/settings/gateway`

只保留：

- Gateway 状态
- 本地监听 host / port
- Provider 配置
- model map
- client binding / global takeover

不再包含：

- Recent logs

#### C. `/settings/hooks`

只保留：

- Hook Gateway 状态
- token / ingress endpoint
- Transcript Import 配置
- Feishu 配置

不再包含：

- Recent event list
- Raw payload 详情

#### D. `/settings/agent-logs`

统一承载：

- Gateway 流量日志
- Hook 事件日志
- 请求 / 事件详情
- JSON 原始结构视图
- 自动生成的 Markdown 调试视图

## 4. 目标 UI 结构

### 4.1 左侧 Settings Sidebar

建议新增两个 section：

- `gateway`
- `agent-logs`

建议调整文案：

- `agents`: 从 “AI / Agents” 改成更明确的 “Agents / Models” 或中文 “Agent 与模型”
- `hooks`: 保留 “Agent Hooks” 或中文 “Hook Gateway”
- `logs`: 明确为 “Startup Logs”
- `agent-logs`: 新增 “Agent Logs” 或中文 “Agent 日志”

### 4.2 新的 Agent Logs 页面布局

建议采用三段式布局：

```text
筛选栏 / Source Tabs
  -> 日志列表
    -> 详情面板
```

详情面板建议 3 个视图：

- `Summary`
- `JSON`
- `Markdown`

#### Summary

用于快速扫一条记录的关键元数据：

- source
- route / providerEvent
- status / level
- provider / profile / model
- duration
- stream / eventCount
- request size / response size
- truncation 状态

#### JSON

用于看完整结构化数据，优先解决“能看到完整请求”的诉求。

结构建议：

```json
{
  "meta": {},
  "ingressRequest": {},
  "normalizedRequest": {},
  "upstreamRequest": {},
  "upstreamResponse": {},
  "clientResponse": {},
  "stream": {},
  "error": {}
}
```

对 Hook 日志则变成：

```json
{
  "meta": {},
  "ingressRequest": {},
  "normalizedEnvelope": {},
  "payload": {},
  "error": {}
}
```

#### Markdown

这里不是 Mermaid。

这里的目标是把一条 JSON 日志自动整理成可复制、可贴给人或模型排障的 Markdown 文本，例如：

````md
# AI Gateway Request

## Meta

```json
{ ... }
```

## Ingress Request

```json
{ ... }
```

## Upstream Request

```json
{ ... }
```

## Upstream Response

```json
{ ... }
```
````

这个视图适合：

- 直接复制到 issue / docs / 聊天里
- 提交给外部模型协助排障
- 保留和 UI JSON 视图一致的结构

## 5. 日志数据模型升级方案

### 5.1 不再让列表接口承载完整详情

当前 `AiGatewayLogEntry[]` 直接返回整条日志，但字段不够。

建议拆成：

- `AgentLogSummary[]`
- `AgentLogDetail`

新增 shared 类型建议：

```ts
export type AgentLogSource = 'ai-gateway' | 'agent-hooks'

export interface AgentLogSummary {
  id: string
  source: AgentLogSource
  title: string
  timestamp: number
  level: 'info' | 'warn' | 'error'
  route?: string
  providerEvent?: string
  providerName?: string
  model?: string
  profileId?: string
  statusCode?: number
  durationMs?: number
  stream?: boolean
  eventCount?: number
  truncated?: boolean
}

export interface StructuredJsonSnapshot {
  contentType?: string
  sizeBytes?: number
  truncated?: boolean
  parseError?: string
  rawText?: string
  parsed?: unknown
}

export interface StructuredHttpRequestSnapshot {
  method: string
  path: string
  query?: Record<string, string | string[]>
  headers: Record<string, string | string[]>
  body?: StructuredJsonSnapshot
}

export interface StructuredHttpResponseSnapshot {
  statusCode: number
  headers?: Record<string, string | string[]>
  body?: StructuredJsonSnapshot
}
```

再分别扩成：

```ts
export interface AiGatewayLogDetail {
  summary: AgentLogSummary
  meta: {
    requestId: string
    route: 'anthropic' | 'responses' | 'chat' | 'health' | 'unknown'
    providerId?: string
    providerName?: string
    profileId?: string
    model?: string
    durationMs?: number
    authSource?: string
  }
  ingressRequest?: StructuredHttpRequestSnapshot
  normalizedRequest?: StructuredJsonSnapshot
  upstreamRequest?: StructuredHttpRequestSnapshot
  upstreamResponse?: StructuredHttpResponseSnapshot
  clientResponse?: StructuredHttpResponseSnapshot
  stream?: {
    enabled: boolean
    upstreamEventCount?: number
    previewEvents?: unknown[]
  }
  error?: {
    code?: string
    message: string
  }
}
```

```ts
export interface AgentHookLogDetail {
  summary: AgentLogSummary
  meta: {
    requestId: string
    provider: string
    providerEvent: string
    canonicalEvent: string
    durationMs?: number
  }
  ingressRequest?: StructuredHttpRequestSnapshot
  normalizedEnvelope?: unknown
  payload?: StructuredJsonSnapshot
  error?: {
    code?: string
    message: string
  }
}
```

### 5.2 安全策略

“完整请求”不等于“明文泄露密钥”。

必须默认做脱敏：

- `Authorization`
- `x-api-key`
- `api-key`
- `X-Agent-Hook-Token`
- `x-ide-electron-token`
- `x-ide-electron-transcript-token`
- provider inline `apiKey`

建议展示策略：

- UI 默认永远显示 masked value
- 复制 JSON / Markdown 时也复制 masked value
- 不提供“显示明文密钥”切换

### 5.3 大体积请求策略

当前已有 `maxBodyBytes`。

新日志侧要补 3 个语义：

- `sizeBytes`
- `truncated`
- `parseError`

这样即使 body 太大或不是 JSON，也仍然能准确知道：

- 是完整捕获
- 还是被截断
- 还是无法解析

## 6. 主进程与 IPC 设计

### 6.1 新增独立 `agent-logs` domain

不建议让 renderer 直接同时拼两套日志接口。

建议新增：

```text
src/core/electron/main/agent-logs/
  agent-log-service.ts
```

职责：

- 聚合 `ai-gateway` 和 `agent-hooks` 两类日志 summary
- 通过 `id + source` 返回 detail
- 统一做筛选、排序、限制和脱敏
- 统一输出 Markdown 调试文本

这样 Settings 日志页只依赖一个 domain。

### 6.2 建议 IPC

```text
AGENT_LOGS_LIST
AGENT_LOGS_GET_DETAIL
AGENT_LOGS_GET_MARKDOWN
```

链路：

```text
shared types
-> main/agent-logs/*
-> main/ipc/registerAgentLogsIpcHandlers.ts
-> preload/invokeApi.agentLogs.ts
-> renderer/settings/SettingsAgentLogsPanel.tsx
```

说明：

- `ai-gateway` 和 `hooks` 仍然各自维护自己的 config/status 能力。
- 只有“观测日志”由 `agent-logs` 统一聚合。

## 7. 各层落点

### 7.1 Renderer

需要改动：

- `src/core/renderer/pages/Settings.tsx`
- `src/core/renderer/pages/settings/settings.types.ts`
- `src/core/renderer/pages/settings/SettingsSidebar.tsx`
- `src/core/renderer/app/RouteCatalogDialog.tsx`
- `src/core/renderer/i18n/messages/settings.ts`
- `src/core/renderer/i18n/messages/common.ts`

需要调整现有面板：

- `src/core/renderer/pages/settings/SettingsAgentsPanel.tsx`
  - 删除 `gateway` tab
- `src/core/renderer/pages/settings/SettingsAiGatewayPanel.tsx`
  - 删除 `Recent Gateway Logs` 模块
- `src/core/renderer/pages/settings/SettingsAgentHooksPanel.tsx`
  - 删除 `Recent Events + Raw payload` 模块

建议新增：

```text
src/core/renderer/pages/settings/SettingsAgentLogsPanel.tsx
src/core/renderer/pages/settings/agentLogs/
  agentLogs.types.ts
  agentLogs.helpers.ts
  AgentLogFiltersBar.tsx
  AgentLogSummaryList.tsx
  AgentLogDetailPane.tsx
  AgentLogJsonView.tsx
  AgentLogMarkdownView.tsx
```

### 7.2 共享层

需要扩展：

- `src/core/shared/types.ts`

### 7.3 Main / Preload

AI Gateway 侧：

- `src/core/electron/main/ai-gateway/gateway-server.ts`
- `src/core/electron/main/ai-gateway/gateway-service.ts`
- `src/core/electron/preload/invokeApi.aiGateway.ts`
- `src/core/electron/main/ipc/registerAiGatewayIpcHandlers.ts`

Hook 侧：

- `src/core/electron/main/hooks/agent-hook-gateway.ts`
- `src/core/electron/preload/invokeApi.core.ts`

新增聚合层：

- `src/core/electron/main/agent-logs/agent-log-service.ts`
- `src/core/electron/main/ipc/registerAgentLogsIpcHandlers.ts`
- `src/core/electron/preload/invokeApi.agentLogs.ts`

### 7.4 Markdown 渲染复用

如果日志页需要渲染自动生成的 Markdown，不要直接从 `pages/code/*` 反向引用重页面组件。

建议做法：

- 把通用 Markdown 渲染能力提取到更中性的 renderer 共享层
- 或者在日志页先只提供“Markdown 原文 + copy”视图，后续再抽共享 renderer

本轮优先级建议：

1. 先把 JSON 结构化详情做好
2. 再补 Markdown 生成
3. 如确有必要，再抽通用 Markdown 预览组件

## 8. Gateway 日志需要补采集的字段

`src/core/electron/main/ai-gateway/gateway-server.ts` 当前已经在多个节点记录日志，但信息不成体系。

建议按一次请求生成统一 `requestId`，沿链路写入 detail：

### 8.1 Ingress request

- method
- path
- query
- masked headers
- raw body text
- parsed JSON body
- body size

### 8.2 Normalized request

指路由 adapter 转换后的协议内请求：

- Anthropic request -> normalized chat request
- Responses request -> normalized chat request
- Chat request -> mapped chat request

### 8.3 Upstream request

- target URL
- masked headers
- final JSON body

### 8.4 Upstream response

- status code
- response headers
- response body JSON
- 如果是 stream，则记录 preview event 列表与 eventCount

### 8.5 Client response

- 实际回给 Claude / Codex 的响应
- 非流式时记录完整 JSON
- 流式时记录 summary 和首批 event 预览

## 9. Hook 日志需要补采集的字段

`src/core/electron/main/hooks/agent-hook-gateway.ts` 当前只保存 `AgentHookEnvelope`。

建议额外保存 ingress request detail：

- provider path
- query `event`
- masked headers
- raw request body
- parsed JSON body
- normalized envelope
- request size
- parsing / auth / size-limit error

这样日志页里才能统一看到：

- 请求是怎样进来的
- 被归一化成了什么事件
- 哪一步失败

## 10. Agent Logs 页交互细节

### 10.1 列表筛选

首版建议支持：

- source: `all / gateway / hooks`
- level: `all / info / warn / error`
- route: `anthropic / responses / chat`
- provider / profile / model 搜索
- providerEvent / canonicalEvent 搜索

### 10.2 列表摘要字段

Gateway：

- 时间
- 路由
- provider
- model
- status
- duration
- stream
- level

Hooks：

- 时间
- provider
- providerEvent
- canonicalEvent
- cwd / toolName
- level

### 10.3 详情区 copy 能力

建议每个区块都支持 copy：

- Copy Summary JSON
- Copy Request JSON
- Copy Markdown Report

### 10.4 失败和空态

必须明确区分：

- 暂无日志
- 当前筛选无结果
- 请求体已截断
- body 非 JSON
- detail 已被清理或不存在

## 11. 分阶段执行计划

### P1. 先做路由拆分和页面职责收口

目标：

- 新增 `/settings/gateway`
- 新增 `/settings/agent-logs`
- `agents` 去掉 Gateway tab
- `gateway` 去掉 recent logs
- `hooks` 去掉 recent events/raw payload

完成标准：

- 用户从 sidebar 一眼能区分“模型 / 网关 / Hook / 日志”
- Startup Logs 仍在原位

### P2. 补结构化日志模型

目标：

- 给 Gateway 增加 detail 级别的完整日志对象
- 给 Hook 增加 ingress request detail
- 新增共享 summary/detail 类型

完成标准：

- 至少能完整看见一条 Gateway 请求的 ingress / normalized / upstream / response
- 至少能完整看见一条 Hook 请求的 ingress / normalized / payload

### P3. 增加 `agent-logs` 聚合 domain 与 IPC

目标：

- 新增 `agent-logs` main domain
- renderer 只调用统一日志接口

完成标准：

- 日志页不直接分别拼 `getAiGatewayRecentLogs()` 和 `getAgentHookRecentEvents()`

### P4. 实现 Agent Logs UI

目标：

- 日志列表
- 详情区
- JSON 视图
- Markdown 调试视图

完成标准：

- 可直接复制一条日志的 Markdown 报告
- 可直接查看完整 JSON 结构

### P5. 文案、迁移与清理

目标：

- i18n 补齐
- route catalog 补齐
- 删除旧页面上的重复日志模块
- 补充 docs

完成标准：

- Settings 内没有重复入口
- 日志与配置职责边界清晰

## 12. 测试与验证清单

### 12.1 Main / shared

- Gateway 非流式请求能生成完整 detail
- Gateway 流式请求能生成 summary + preview events
- Hook 请求能生成 ingress request + normalized envelope
- header masking 正确
- body truncation 标记正确
- Markdown 报告生成稳定

### 12.2 Renderer

- `/settings/agents` 不再出现 Gateway
- `/settings/gateway` 不再出现 recent logs
- `/settings/hooks` 不再出现 recent events
- `/settings/agent-logs` 能正确切换 source/filter/detail
- 中文英文文案完整
- 深浅色主题可用

### 12.3 手工验证路径

1. 进入 `/settings/agents`，确认只剩模型与 Agent 配置。
2. 进入 `/settings/gateway`，启动 Gateway，确认页面只关注配置与绑定。
3. 用 Claude/Codex 触发一条 Gateway 请求。
4. 进入 `/settings/agent-logs`，确认能看到该请求。
5. 展开详情，确认能看到：
   - ingress request JSON
   - normalized request JSON
   - upstream request JSON
   - upstream response JSON 或 stream summary
6. 复制 Markdown 报告，确认内容是结构化 `json` fenced blocks。
7. 触发一条 Hook 事件，确认同页也能看到 Hook detail。

## 13. 风险与控制

### 13.1 风险：日志对象膨胀过快

控制：

- 维持 recent ring buffer
- 单条 body 大小上限
- 保留 `truncated` 标记
- stream 只保留 preview events，不保留全量 event 流

### 13.2 风险：Settings 页面再次变成大文件

控制：

- 新日志页必须拆子组件
- `Settings.tsx` 只保留 route -> panel 装配
- 不把 markdown/json/detail 逻辑塞回 `Settings.tsx`

### 13.3 风险：跨 domain 直接互相偷调

控制：

- 配置页继续走各自 domain
- 日志聚合统一走 `agent-logs` domain
- shared 类型只放契约，不反向依赖 renderer/main

## 14. 建议的最终结果

这轮完成后，Settings 的 AI / Agent 结构应当变成：

- `Agents / Models`
  - Claude
  - Codex
- `Gateway`
  - 本地协议代理配置
- `Hooks`
  - Hook Gateway / Transcript Import / Feishu
- `Agent Logs`
  - Gateway traffic
  - Hook events
- `Startup Logs`
  - 保持原来的项目启动日志职责

这样用户在认知上会明确区分：

- 这是“我怎么配”
- 这是“流量怎么走”
- 这是“入口怎么接”
- 这是“出了问题去哪看”

这比继续把模型、网关、Hook、日志混在两三个页面里更稳定，也更符合当前代码架构边界。
