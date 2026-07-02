# AI Gateway 协议保真与工具调用硬化计划（2026-07-02）

## 1. 背景

近期在 Claude Code 通过本地 AI Gateway 使用公司模型时，出现过一类协议 / 工具调用相关异常，并伴随外部落盘现象：

- 代码里出现中文引号、智能引号、Unicode escape 等不符合源码语境的标点。
- Claude Code 工作区里曾出现 `void`、`0`、`prettier`、`currentInputs`、`output.probability`、`()`, `,` 等 0 字节异常文件名。

从现象看，这不是单纯的字符编码问题。

更合理的判断是：

- 网关原始上游响应可能没有明显乱码。
- 某些工具调用参数可能已经漂移，例如把代码 token 错当成 `file_path`。
- 0 字节异常文件、`git add -A`、worktree 回收属于 Claude Code 客户端或外部自动化行为，只能作为事故线索，不应写成 AI Gateway 的验收责任。

这类问题的核心风险不是“响应文本能不能显示”，而是：

- Claude / OpenAI / Responses 三套协议并非等价。
- 工具调用语义不能只靠字段改名。
- 上游 OpenAI-compatible 模型不一定具备 Claude Code 工具协议的稳定行为。
- 当前网关仍有 MVP 阶段遗留的兼容边界和观测缺口。

本计划目标是把 AI Gateway 从“能转发和基础转换”推进到“协议保真、工具调用可控、异常可定位”。

## 2. 当前代码事实

### 2.1 Gateway 主链路

当前 AI Gateway domain 位于：

```text
src/core/electron/main/ai-gateway/
```

主要入口：

- `gateway-server.ts`
- `gateway-service.ts`
- `provider-registry.ts`
- `protocol-types.ts`
- `adapters/anthropic-to-chat.ts`
- `adapters/responses-to-chat.ts`
- `adapters/chat-to-anthropic.ts`
- `adapters/chat-to-responses.ts`
- `adapters/sse.ts`

当前支持的基本路径：

```text
Claude Code -> Anthropic Messages -> Gateway -> openai_chat upstream
Codex CLI   -> OpenAI Responses   -> Gateway -> openai_chat upstream
Chat client -> OpenAI Chat        -> Gateway -> openai_chat upstream
```

以及：

```text
Claude Code -> Anthropic Messages -> Gateway -> anthropic_messages upstream passthrough
```

### 2.2 Anthropic Messages -> Chat 转换

`adapters/anthropic-to-chat.ts` 当前会做：

- `system` -> Chat `system` message
- text content blocks -> string content
- `tool_use` -> Chat `tool_calls`
- `tool_result` -> Chat `tool` message
- `tools[].input_schema` -> Chat `tools[].function.parameters`
- `tool_choice` -> Chat `tool_choice`

这个方向是合理的，但不是完整等价转换。

原因：

- Claude 的工具使用包含专门的工具调用行为约束。
- Anthropic 文档说明，提供 `tools` 时 API 会构造特殊 tool-use system prompt。
- OpenAI Chat 的 `tool_calls` 是另一套协议语义。
- 第三方 OpenAI-compatible 模型未必严格遵守工具 schema。

### 2.3 Responses -> Chat 转换

`adapters/responses-to-chat.ts` 当前仍是 MVP 降级路径：

- `instructions` -> Chat `system`
- `input` -> Chat messages
- `max_output_tokens` -> `max_tokens`
- 非空 `tools` 直接拒绝
- 非空 `reasoning` 直接拒绝

这意味着 `/v1/responses` 当前不是完整 Responses 兼容实现，而是文本场景兼容层。

### 2.4 Chat -> Anthropic 流式转换

`adapters/chat-to-anthropic.ts` 当前会把 Chat SSE 转成 Anthropic SSE：

- `message_start`
- `content_block_start`
- `content_block_delta`
- `content_block_stop`
- `message_delta`
- `message_stop`

工具调用参数通过 `function.arguments` 字符串片段累积，并转换为 Anthropic `input_json_delta.partial_json`。

这是必要能力，但风险也集中在这里：

- 上游工具参数可能不是合法 JSON。
- 流式 JSON 片段可能被截断或转义不一致。
- 当前主要保证“能拼出事件”，还没有做严格 schema 校验和 fail-closed 策略。

## 3. 问题定性

### 3.1 不应归因于低层编码转换

当前代码主要使用：

- `JSON.stringify`
- `JSON.parse`
- `TextDecoder`
- 标准 SSE data 行重组

这些操作不会主动把 `"` 转成 `“”`，也不会主动把代码片段变成根目录文件名。

如果最终文件里出现中文标点或异常文件名，优先怀疑：

- 上游模型工具参数已经错误。
- 网关协议转换后工具参数错误。
- Claude Code 客户端执行工具时参数错误。
- Claude Code 客户端或外部自动化在落盘 / 回收阶段引入异常。

最后一类不属于 AI Gateway 的实现范围；Gateway 只需要提供足够日志，帮助判断问题是否已经发生在协议转换前后。

### 3.2 异常空文件是外部落盘线索，不是 Gateway 验收项

异常文件名具有明显代码语义：

```text
void
0
prettier
currentInputs
output.probability
()
,
```

这些不是乱码，而是代码 token。

它们可能来自类似链路：

```text
模型 / 转换层 / 客户端某一步把代码 token 错当成 file_path
-> Write/Edit 工具创建根目录空文件
-> git add -A 暂存
-> worktree 整文件 cp 回收
```

但其中 `Write/Edit` 执行、`git add -A`、worktree 回收都是 Claude Code 客户端或外部自动化行为，不应作为 AI Gateway 的优化项或测试验收项。

AI Gateway 能做的是：

- 工具 schema 约束
- 工具参数校验
- 协议转换保真
- 事故证据链日志

从而回答一个问题：

```text
危险参数是在上游响应里已经出现，还是在网关转换后才出现？
```

## 4. 官方协议参考

后续实现和验证应以官方文档为准：

- Anthropic Messages API: https://docs.anthropic.com/en/api/messages
- Anthropic tool use: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
- Anthropic tool result handling: https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls
- Anthropic strict tool use: https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use
- OpenAI Chat API reference: https://developers.openai.com/api/reference/resources/chat
- OpenAI function calling: https://developers.openai.com/api/docs/guides/function-calling
- OpenAI Responses migration: https://developers.openai.com/api/docs/guides/migrate-to-responses

## 5. 优化目标

### 5.1 协议保真

目标：

- 明确每条路由是 passthrough、lossless conversion，还是 lossy conversion。
- 对有损转换给出日志标记和不支持字段列表。
- 能原生透传的 provider 优先原生透传，不强制降级成 Chat。

### 5.2 工具调用稳定

目标：

- 尽量使用 strict tool/function calling。
- 工具参数必须通过 schema 校验。
- 校验失败时 fail closed，不把危险参数继续交给 Claude Code。
- 对文件路径类参数增加额外安全规则。

### 5.3 可观测性

目标：

- 一次请求能完整看到：
  - ingress request
  - normalized request
  - upstream request
  - upstream response / stream events
  - client response
  - tool argument parse / validation result
- 能区分问题发生在上游、网关转换，还是已经超出 Gateway、进入客户端执行阶段。

### 5.4 职责边界

目标：

- 不把 Claude Code worktree 回收、`git add -A`、文件落盘策略写成 Gateway 责任。
- Gateway 日志只负责证明协议转换前后的请求、响应和工具参数。
- 如果 Gateway client payload 正常，但最终文件异常，应转入 Claude Code 客户端或外部自动化排查。

## 6. 非目标

- 不通过全局字符替换修复中文引号问题。
- 不把中文正文中的标点强行改成英文标点。
- 不假装所有 Anthropic / OpenAI / Responses 能力都可互转。
- 不让 renderer 直接理解模型协议细节。
- 不把 Agent Hook Gateway 改造成模型协议网关。
- 不默认新增第三方依赖。
- 不负责 Claude Code 客户端的 worktree 回收、`git add -A`、根目录异常文件扫描或提交前阻断。

## 7. 建议优化项

### 7.1 Provider capability matrix

当前 provider 主要由 `protocol` 区分：

```ts
'openai_chat' | 'openai_responses' | 'anthropic_messages'
```

这不够。

建议新增 capability matrix，显式声明：

```ts
interface AiGatewayProviderCapabilities {
  supportsStreaming?: boolean
  supportsTools?: boolean
  supportsStrictTools?: boolean
  supportsParallelToolCalls?: boolean
  supportsDeveloperMessages?: boolean
  supportsReasoning?: boolean
  supportsResponsesInputItems?: boolean
  supportsAnthropicContentBlocks?: boolean
  supportsImages?: boolean
  supportsDocuments?: boolean
}
```

用途：

- 决定是否原生透传。
- 决定是否允许某些字段。
- 决定转换时是否 fail closed。
- 在日志里标记“本次请求使用了哪些降级策略”。

### 7.2 Strict tools 端到端

优先级最高。

建议：

- 在 shared/provider 配置中增加 strict tools 开关。
- Anthropic `input_schema` 转 Chat `parameters` 时尽量保留 schema。
- 对支持 strict 的上游，设置 `strict: true` 或等价字段。
- 对不支持 strict 的上游，在网关侧做 schema 校验。

原则：

```text
工具参数不合法 -> 返回协议内错误事件 -> 不继续交给客户端执行
```

对于 `file_path`、`path`、`command` 类参数，Gateway 只做协议层和 schema 层处理：

- 非法 JSON arguments 必须拒绝。
- schema 明确不允许的参数必须拒绝。
- schema 中已有 `required`、`type`、`enum`、`pattern` 等约束时必须执行。
- schema 合法但值看起来可疑时，只记录 diagnostic warning，不在 Gateway 中硬编码工作区路径策略。

工作区范围、根目录新文件、提交前阻断等属于客户端 / 自动化执行层职责。

### 7.3 工具参数验证与差异日志

建议在 Chat -> Anthropic 转换阶段增加结构化日志：

```json
{
  "toolCall": {
    "name": "Write",
    "rawArguments": "...",
    "parsedArguments": {},
    "schemaValid": false,
    "validationErrors": [],
    "forwarded": false
  }
}
```

对流式工具参数也要记录：

- 每个 delta 的 index
- 拼接后的 raw JSON
- sanitizer 是否改写过片段
- 最终 parse 结果
- 最终 schema 校验结果

### 7.4 Responses 原生路由

当前 `/v1/responses` 到 `openai_chat` 是降级适配。

建议改为：

```text
provider.protocol === openai_responses
  -> 原生转发 /v1/responses

provider.protocol === openai_chat
  -> 明确标记 lossy conversion
```

这样 Codex CLI 走支持 Responses 的上游时，不必损失：

- tools
- reasoning
- output items
- richer stream events

不支持原生 Responses 的 provider 再走 Chat 降级。

### 7.5 Anthropic 原生优先

Claude Code 场景最稳的路径仍然是：

```text
Claude Code -> Gateway -> anthropic_messages provider passthrough
```

建议 UI 和配置上明确提示：

- 如果上游提供 Anthropic Messages 兼容接口，优先使用 `anthropic_messages`。
- 只有上游只有 OpenAI Chat 兼容接口时，才使用 `openai_chat` 转换。

这能减少 Claude Code 工具调用语义损失。

### 7.6 Developer/system message 策略

OpenAI 新模型推荐使用 developer message 表达开发者级指令。

建议：

- Chat role 类型支持 `developer`。
- provider capability 声明是否支持 `developer`。
- Claude `system` 转 Chat 时：
  - 支持 developer 的 provider 可转成 `developer`。
  - 不支持时继续使用 `system`。

注意：

- 这不是简单替换，必须按 provider 能力选择。
- 对历史第三方 Chat 兼容服务，`system` 兼容性可能更好。

### 7.7 有损字段处理策略

所有 adapter 都应有明确规则：

```text
支持 -> 转换
不支持但可安全忽略 -> 记录 lossy warning
不支持且影响行为 -> reject
```

需要显式覆盖：

- Anthropic `thinking`
- Anthropic `signature`
- Anthropic `cache_control`
- Anthropic image/document blocks
- Anthropic server tools
- Responses `tools`
- Responses `reasoning`
- Responses complex input items
- Chat `response_format`
- Chat `stream_options`
- Chat `parallel_tool_calls`
- Chat `refusal`

### 7.8 事故证据链日志

Agent Logs 里建议新增一个“协议诊断视图”。

必须能比较：

```text
ingressRequest.body
normalizedRequest.parsed
upstreamRequest.body
upstreamResponse / stream.previewEvents
clientResponse / stream.merged.clientPayload
toolValidation
```

定位规则：

- upstream tool arguments 已错：上游模型问题或 prompt/schema 约束不足。
- upstream 正常、clientPayload 错：网关转换问题。
- clientPayload 正常、Claude Code 实际工具参数错：客户端执行层问题。
- clientPayload 正常、最终文件异常：客户端执行、shell 命令或外部自动化问题，非 Gateway 验收项。

### 7.9 外部落盘风险边界

worktree 回收、`git add -A`、根目录异常空文件扫描不属于模型协议网关核心。

本计划只保留边界说明：

- 如果需要治理这类风险，应另起 Claude Code 客户端 / Agent 自动化 / 提交前安全检查计划。
- AI Gateway 不实现 worktree 合并策略。
- AI Gateway 不实现 `git add -A` 前文件扫描。
- AI Gateway 不以根目录异常文件是否出现作为功能验收标准。

## 8. 分阶段执行计划

### P0：补事故复盘和测试样例

目标：

- 固化这次事故模式，避免未来无法复现。

任务：

- 保存协议层工具参数漂移样例：
  - `file_path: "void"`
  - `file_path: "output.probability"`
  - `file_path: "()"`
- 增加日志样例，覆盖 upstream/client/tool argument 三段对比。

验收：

- 后续改 adapter 时能通过测试发现协议层工具参数风险。

### P1：Provider capability matrix

目标：

- 不再只靠 `protocol` 判断能力。

任务：

- 扩展 provider 类型。
- 配置规范化时补默认能力。
- UI 展示关键能力。
- 日志记录本次请求使用的能力和降级策略。

验收：

- 同为 `openai_chat` 的不同 provider 可以声明不同能力。

### P2：Strict tools 与 schema 校验

目标：

- 避免错误工具参数继续传给 Claude Code / Codex。

任务：

- 扩展工具类型支持 strict。
- 增加工具参数 JSON parse + schema validation。
- 增加文件路径类参数安全校验。
- 校验失败时按协议返回错误，而不是继续流式输出危险 tool_use。

验收：

- 如果 schema 明确不允许，`file_path: "void"` 这类参数不会被转发给客户端执行。
- 如果 schema 允许但值可疑，日志能标记 diagnostic warning。
- 日志能看到校验失败原因。

### P3：Responses 原生透传

目标：

- Codex 场景减少 Chat 降级。

任务：

- `openai_responses` provider 原生转发 `/v1/responses`。
- 保留 `openai_chat` 降级路径。
- 对降级路径增加 lossy 标记。
- 增加 Responses stream passthrough 日志。

验收：

- 支持 Responses 的上游不再丢 `tools` / `reasoning`。
- 不支持的上游仍能走明确降级路径。

### P4：Anthropic 工具协议保真增强

目标：

- Claude Code 场景减少工具语义损失。

任务：

- 对 `anthropic_messages` provider 继续优先 passthrough。
- 对 `openai_chat` 转换路径补齐 tool choice、parallel tool、strict schema 的兼容策略。
- 对 unsupported Anthropic content blocks 明确 reject。

验收：

- Claude tool loop 的每一步都有协议内可解释日志。

### P5：协议诊断视图

目标：

- 出问题时不用猜。

任务：

- Agent Logs detail 增加 protocol diagnostics 区域。
- 展示 lossy conversion warnings。
- 展示 tool validation result。
- 提供“一键复制事故报告 Markdown”。

验收：

- 用户可以直接判断问题发生在上游、网关还是客户端。

## 9. 测试计划

### 9.1 Adapter 单元测试

覆盖：

- Anthropic system -> Chat system/developer
- Anthropic tools -> Chat tools
- Anthropic tool_use -> Chat tool_calls
- Chat tool_calls -> Anthropic tool_use
- 非法 JSON arguments
- schema 不匹配 arguments
- stream tool arguments 分片
- unsupported content blocks reject
- Responses tools/reasoning 在不同 provider capability 下的行为

### 9.2 Gateway 集成测试

覆盖：

- fake upstream 返回合法 tool_calls
- fake upstream 返回非法 tool_calls
- fake upstream 返回 schema 不匹配的 tool arguments
- stream 中途断开
- stream 返回非 SSE
- upstream 200 但 body 非 JSON
- capability 不支持时 reject

### 9.3 协议事故回归测试

覆盖：

- 上游 `tool_calls.function.arguments` 已经错误时，日志能定位到 upstream。
- 上游 arguments 正常、转换后 `tool_use.input` 错误时，测试能失败。
- 转换后 `tool_use.input` 正常时，不把最终文件异常归因到 Gateway。
- schema validation 失败时，按协议返回错误，不继续生成可执行 tool_use。

### 9.4 手工验证

验证路径：

1. Claude Code 通过 `anthropic_messages` provider 透传完成一次普通任务。
2. Claude Code 通过 `openai_chat` provider 转换完成一次普通任务。
3. Claude Code 触发工具调用，确认工具参数日志完整。
4. 上游返回非法工具参数，确认客户端不执行危险工具。
5. Codex CLI 通过 `openai_responses` provider 原生转发。
6. Codex CLI 通过 `openai_chat` provider 降级，确认日志标记 lossy。

## 10. 风险与控制

### 10.1 风险：过度拦截导致可用性下降

控制：

- fail-closed 仅用于工具参数和高风险路径。
- 普通文本回复不做强制 ASCII 替换。
- UI 中提供明确错误原因。

### 10.2 风险：第三方 provider 能力声明不准确

控制：

- capability 支持手动覆盖。
- 日志记录上游实际响应特征。
- 对 capability 与实际响应不一致的情况给出 warning。

### 10.3 风险：schema validation 实现复杂

控制：

- 第一阶段只做 JSON parse、required、type、additionalProperties 等最小校验。
- 不新增依赖时先实现最小 validator。
- 后续如果确认需要完整 JSON Schema，再评估依赖。

### 10.4 风险：日志泄露敏感信息

控制：

- header 和 body 中的 token 默认脱敏。
- 复制 Markdown/JSON 也使用脱敏版本。
- 不提供显示明文密钥开关。

## 11. 建议优先级

最高优先级：

1. Strict tools / schema validation。
2. 工具参数差异日志。
3. Provider capability matrix。

次优先级：

1. Responses 原生透传。
2. Developer/system message 策略。
3. Agent Logs 协议诊断视图。

后续增强：

1. 更完整的 Anthropic/OpenAI 多模态内容块支持。
2. 更完整的 JSON Schema validator。

## 12. 完成标准

满足以下条件后，可以认为本轮硬化完成：

- 每个 provider 明确声明关键能力。
- 工具参数在转发给客户端前会被解析和校验。
- 非法工具参数不会继续执行。
- Responses provider 能原生透传，不再全部降级到 Chat。
- Anthropic provider 能原生透传时优先透传。
- 有损转换在日志中可见。
- 一条异常请求能从日志判断问题发生在上游、网关转换，还是已经进入客户端执行层。

最终目标不是让所有协议“看起来都一样”，而是让每次转换都明确：

```text
这一步是否有损？
哪些字段被保留？
哪些字段被拒绝？
工具参数是否可信？
出了问题能否定位？
```
