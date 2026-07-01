# Agent Logs 合并流查看计划（2026-07-01）

## 1. 背景

当前 AI Gateway 的非流式请求已经能在 Agent Logs 中看到完整 request / response body；流式请求则主要记录状态、headers、事件数量和少量 `previewEvents`。

这导致一个排障缺口：

- 客户端实际能收到完整 stream，因为主进程在转发时持续 `res.write(...)`。
- 日志详情里看不到完整的“最终合并文本”或“最终合并 payload”。
- Provider Response / Client Response 节点只能说明“流开了、来了多少事件”，不能直接回答模型最终输出了什么、网关最终发给客户端什么。

本计划目标是先补齐采集层，再在 Agent Logs 中做真正的 `Merged Stream` 查看，而不是继续拼接 `previewEvents`。

## 2. 当前代码事实

相关落点：

- `src/core/shared/types.ts`
  - `AiGatewayLogDetail.stream` 当前只有 `requested / enabled / upstreamEventCount / previewEvents`。
- `src/core/electron/main/ai-gateway/gateway-server.ts`
  - `GatewayRequestTrace.stream` 最终写入 Agent Logs detail。
  - `finalizeGatewayTrace` 会把 `trace.stream` 持久化到 summary/detail。
  - `proxyChatStreamRaw` 直接把上游 chunk 写给客户端，没有记录完整 body。
  - `proxyChatStreamAsAnthropic` 会把上游 chat stream 转成 Anthropic stream，但当前只记录事件预览。
  - `proxyChatStreamAsResponses` 已经在内存中累积 `fullText`，但没有写入 trace。
  - `proxyAnthropicMessagesStream` 是 Anthropic passthrough，目前只转发事件并记录 preview。
- `src/core/renderer/pages/settings/agentLogs/`
  - 当前已有 Flow Map / Step Inspector 结构。
  - Provider Response / Client Response 节点已经存在，适合作为 `Merged Stream` 视图入口。

## 3. 目标

1. 在 shared 的 `detail.stream` 中增加流式响应的合并产物，支持文本和最终 payload。
2. 在 main 的所有 streaming 分支中边转发边累积，累积行为必须受 `maxBodyBytes` 限制。
3. 在 Agent Logs 的 Provider Response / Client Response 节点中新增 `Merged Stream` 视图。
4. 保留 `previewEvents` 作为事件调试样本，但不再把它当作最终内容视图。
5. 不改变客户端收到的 stream 语义，不因为日志采集引入额外阻塞或协议格式变化。

## 4. 非目标

- 不重做 AI Gateway 协议转换架构。
- 不把 stream 全量事件数组无限制持久化。
- 不在 renderer 重新解析全部 SSE 来“猜”最终文本。
- 不新增第三方依赖。
- 不默认执行 build；本项目 build 成本较高，按仓库规则只在用户明确要求时执行。

## 5. 数据结构方案

建议在 `AiGatewayLogDetail.stream` 下新增 `merged` 字段，避免把流式 body 塞进普通 `upstreamResponse.body` / `clientResponse.body` 后混淆非流式语义。

建议结构：

```ts
stream?: {
  requested?: boolean
  enabled: boolean
  upstreamEventCount?: number
  previewEvents?: unknown[]
  merged?: {
    upstreamText?: StructuredJsonSnapshot
    upstreamPayload?: StructuredJsonSnapshot
    clientText?: StructuredJsonSnapshot
    clientPayload?: StructuredJsonSnapshot
    finishReason?: string | null
    usage?: unknown
  }
}
```

字段语义：

- `upstreamText`：从上游 stream delta 中合并出的纯文本。
- `upstreamPayload`：上游协议视角的最终响应快照；如果无法安全构造，则不填。
- `clientText`：网关最终发给客户端协议中的合并文本。
- `clientPayload`：客户端协议视角的最终响应 payload，例如 Responses 的 `response.completed` payload 或 Anthropic message 形态。
- `finishReason` / `usage`：从上游 stream 中提取到的终止原因和 token usage。

`StructuredJsonSnapshot` 继续承担 `sizeBytes / truncated / rawText / parsed / parseError` 语义，所有新增合并产物都必须走同一套截断规则。

## 6. Main 采集方案

新增轻量 helper，位置优先放在 `gateway-server.ts` 附近；如果增长明显，再下沉到 `src/core/electron/main/ai-gateway/stream-trace.ts`。

建议 helper：

```ts
type StreamMergeSnapshot = {
  text?: StructuredJsonSnapshot
  payload?: StructuredJsonSnapshot
}

function createLimitedTextAccumulator(maxBytes: number, contentType: string): {
  append(value: string): void
  snapshot(): StructuredJsonSnapshot | undefined
}

function buildStreamMergedSnapshot(params: {
  upstreamText?: string
  upstreamPayload?: unknown
  clientText?: string
  clientPayload?: unknown
  finishReason?: string | null
  usage?: unknown
  maxBodyBytes: number
}): AiGatewayLogDetail['stream']['merged']
```

实现要求：

- 按 UTF-8 byte 长度截断，不按 JS 字符数截断。
- 截断只影响日志，不影响 `res.write(...)`。
- 截断后继续统计事件数，但不继续追加日志正文。
- 空文本不强行写入 `rawText: ''`，避免 UI 误判为有内容。
- payload snapshot 优先填 `parsed`，必要时附带 `rawText`，并复用现有 `buildJsonSnapshot` 语义。

## 7. 各流式分支改造

### 7.1 Chat raw passthrough

函数：`proxyChatStreamRaw`

当前行为是读取 `response.body.getReader()` 后原样写出 bytes。

计划：

- 保持原样转发，不为了日志采集改成重新编码 SSE。
- 在写出 bytes 的同时，用 `TextDecoder` 做旁路解析，尽力识别 SSE frame。
- 能识别 OpenAI chat delta 时累积 `upstreamText` / `clientText`。
- 不能完整解析时至少记录截断后的 raw SSE 文本到 `upstreamPayload` / `clientPayload`，并标记 parse hint。
- `upstreamPayload` 和 `clientPayload` 可相同，因为该路由是 passthrough。

风险控制：

- 旁路解析失败不得中断正常转发。
- 原始 chunk 写出顺序、内容和结束时机不变。

### 7.2 Chat stream -> Anthropic stream

函数：`proxyChatStreamAsAnthropic`

当前行为是把 OpenAI Chat SSE chunk 转成 Anthropic SSE event。

计划：

- 解析每个 chat chunk 后，用 `extractDeltaText(chunk)` 累积 `upstreamText`。
- 同步把映射后要写给客户端的文本累积为 `clientText`。
- 在 `createAnthropicStreamStop(...)` 前后构造 `clientPayload`：
  - `id`
  - `type: 'message'`
  - `role: 'assistant'`
  - `content: [{ type: 'text', text: clientText }]`
  - `stop_reason`
  - `usage`
- `finishReason` 继续来自 `extractFinishReason(chunk)`。
- `usage` 继续来自 `extractUsage(chunk)`。

注意：

- 当前 `streamState` 已经服务于 Anthropic event 生成，可以复用它来减少重复状态。
- 如果中途出错，trace 中仍保留已累积的部分文本，并通过 `trace.error` 表示失败。

### 7.3 Chat stream -> Responses stream

函数：`proxyChatStreamAsResponses`

当前已经存在 `fullText`，并用于 `createResponsesStreamStop(...)`。

计划：

- 将 `fullText` 写入 `stream.merged.upstreamText` 和 `stream.merged.clientText`。
- 将 `createResponsesStreamStop(...)` 中最终 `response.completed` 事件的数据同步保存为 `clientPayload`。
- 如需要，可构造简化的 OpenAI Chat final payload 写入 `upstreamPayload`：
  - `choices[0].message.content`
  - `finish_reason`
  - `usage`
- `usage` 保持现有提取方式。

注意：

- 不要只把 `fullText` 放在临时变量里；必须进入 `trace.stream.merged`。
- 出错时也应保存已累积的部分 `fullText`。

### 7.4 Anthropic passthrough stream

函数：`proxyAnthropicMessagesStream`

当前行为是把 Anthropic upstream event 原样转发给客户端。

计划：

- 继续 `decodeSseStream(response.body)` 并原样 `res.write(encodeSseEvent(...))`。
- 解析 Anthropic SSE event：
  - `message_start` 记录 message metadata。
  - `content_block_delta` 中 `delta.type === 'text_delta'` 时累积文本。
  - `message_delta` 中提取 `stop_reason` 和 `usage`。
  - `message_stop` 后生成最终 `upstreamPayload` / `clientPayload`。
- 因为是 passthrough，`upstreamText` 与 `clientText` 默认相同，payload 默认相同。
- 解析失败时保留 raw event preview，不影响转发。

### 7.5 非 SSE 错误响应

当前非 OK、非 SSE 或空 body 分支已经通过 `buildResponseSnapshot` 记录 body。

计划：

- 这些分支不需要新增 `stream.merged`。
- UI 显示普通 response body 即可。
- 仅当 `trace.stream.enabled === true` 且存在合并产物时显示 `Merged Stream`。

## 8. Renderer 展示方案

落点：

- `src/core/renderer/pages/settings/agentLogs/agentLogs.flow.ts`
- `src/core/renderer/pages/settings/agentLogs/AgentLogStepInspector.tsx`
- `src/core/renderer/pages/settings/agentLogs/AgentLogRequestView.tsx`
- `src/core/renderer/i18n/messages/settings.ts`

计划：

- 在 Provider Response 节点读取 `detail.stream.merged.upstreamText` / `upstreamPayload`。
- 在 Client Response 节点读取 `detail.stream.merged.clientText` / `clientPayload`。
- Step summary 中增加 `merged` / `truncated` 摘要。
- Step Inspector 中新增 `Merged Stream` section，默认展示在 `Overview` 和普通 body 之间。
- 文本优先用现有长文本折叠组件展示。
- payload 使用现有 JSON 折叠组件展示。
- 当 stream enabled 但没有 merged 产物时，显示明确空态：`Merged stream was not captured for this route.`。

i18n 新增文案建议：

- `settings.agentLogs.mergedStream`
- `settings.agentLogs.mergedStreamDescription`
- `settings.agentLogs.upstreamMergedText`
- `settings.agentLogs.clientMergedText`
- `settings.agentLogs.finalPayload`
- `settings.agentLogs.mergedStreamNotCaptured`

## 9. 截断与安全

截断规则：

- 复用 `maxBodyBytes`。
- 文本和 payload 分开截断，避免一个超长字段挤掉另一个字段。
- UI 必须展示 `truncated` 标记。
- Markdown / copy 视图也要保留截断提示。

安全规则：

- 不记录 auth token、api key 或 Authorization header。
- 合并内容属于模型响应，默认可进入 Agent Logs；但仍按 `maxBodyBytes` 限制落盘。
- 不把所有 SSE event 全量持久化，避免日志膨胀。

## 10. 验证计划

建议验证项：

- `proxyChatStreamAsResponses`：stream 完成后 Agent Logs 能看到 `clientText` 和 `response.completed` payload。
- `proxyChatStreamAsAnthropic`：stream 完成后 Provider Response / Client Response 都能看到合并文本。
- `proxyAnthropicMessagesStream`：Anthropic passthrough 能从 `content_block_delta` 合并文本。
- `proxyChatStreamRaw`：原始 SSE 转发不变，旁路解析失败也不影响客户端。
- 截断：超过 `maxBodyBytes` 时 UI 显示 truncated，且客户端仍收到完整 stream。
- 错误：中途 parse error / upstream abort 时保留已合并部分和 `trace.error`。

测试落点：

- 优先补 `test/electron/ai-gateway-adapters.test.mjs` 或新增针对 stream trace helper 的 Node test。
- Renderer 侧可先通过类型检查和手工样例验证，不为这次新增 heavy E2E。
- 如需运行 `node` / `npm` / `tsc`，按仓库规则提权执行。

## 11. 实施顺序

1. 修改 shared 类型：扩展 `AiGatewayLogDetail.stream.merged`。
2. 增加 stream merge helper：统一文本累积、payload snapshot 和截断。
3. 改造 Responses 分支：先落已有 `fullText`，风险最低。
4. 改造 Anthropic 转换分支：补齐 OpenAI Chat -> Anthropic 的合并文本与 payload。
5. 改造 Anthropic passthrough：解析 Anthropic event 并生成最终合并产物。
6. 改造 Chat raw passthrough：旁路解析 raw SSE，保证不影响原样转发。
7. Renderer 接入：Provider Response / Client Response 节点新增 `Merged Stream` section。
8. 补 i18n 文案和截断提示。
9. 补测试或最小验证脚本。
10. 手工检查 Agent Logs 中 stream / non-stream / error 三类样例。

## 12. 验收标准

- 流式请求完成后，Agent Logs 中能直接看到最终合并文本。
- Provider Response 和 Client Response 能区分上游协议视角与客户端协议视角。
- `previewEvents` 仍可用于事件样本排查，但不承担最终内容展示。
- 超长流式输出不会突破 `maxBodyBytes`。
- 中途失败时日志保留已合并部分，并清楚标记错误。
- 不改变现有 CLI 客户端的 stream 接收行为。
