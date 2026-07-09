# AI Gateway Responses Tools 未来支持计划（2026-07-05）

## 1. 背景

当前如果通过 AI Gateway 的 `/v1/responses` 路由发送带 `tools` 的请求，可能返回：

```json
{
  "error": {
    "message": "Responses tools are not supported by AI Gateway MVP.",
    "type": "unsupported_feature",
    "code": "unsupported_feature"
  }
}
```

这不是网络错误，而是当前 MVP 阶段的显式 fail-closed 行为。

现有链路里，`openai_responses` 上游可以走原生透传；但当请求被路由到 `openai_chat` 上游时，`Responses -> Chat Completions` 仍是降级路径，只支持文本、基础采样参数和 streaming。带 `tools`、工具调用上下文或非空 `reasoning` 的 Responses 请求目前会被明确拒绝，避免静默丢失工具语义。

## 2. 当前代码事实

相关代码位于：

- `src/core/electron/main/ai-gateway/gateway-request-handlers.ts`
- `src/core/electron/main/ai-gateway/adapters/responses-to-chat.ts`
- `src/core/electron/main/ai-gateway/protocol-types.ts`

当前行为：

- `provider.protocol === "openai_responses"` 时，优先原生透传到 Responses 上游，并按 provider capability 检查 `supportsTools` / `supportsReasoning` / `supportsStreaming`。
- `provider.protocol === "openai_chat"` 时，走 `responsesToChatCompletion()` 降级转换。
- 降级转换中只保留文本输入、`instructions`、`model`、`max_output_tokens`、`temperature`、`top_p`、`stream`。
- `input.tools` 非空时直接抛出 `UnsupportedGatewayFeatureError("Responses tools are not supported by AI Gateway MVP.")`。
- `input` items 中出现 `function_call`、`function_call_output` 或 `tool_call` 时直接抛出 `UnsupportedGatewayFeatureError("Responses tool calls are not supported by AI Gateway MVP.")`。

## 3. 目标

未来计划的目标不是简单“放开 tools 字段”，而是让 Responses tools 在不同上游能力下具备清晰、可验证、可诊断的行为：

- 对原生 `openai_responses` 上游继续保持无损透传。
- 对只支持 `openai_chat` 的上游，逐步实现可控的 Responses tools 降级转换。
- 对无法安全转换的工具类型、调用上下文和输出结构继续 fail-closed。
- 在 Agent Logs 中明确展示是否发生协议降级、丢失了哪些语义、为什么拒绝。
- 在 Settings / provider capability 中让用户能看懂当前 provider 是否支持 Responses tools。

## 4. 非目标

本计划不把所有 Responses API 能力一次性补齐。

暂不纳入：

- Computer use、file search、web search、code interpreter 等内置工具的完整模拟。
- 复杂 reasoning items 的无损转换。
- 所有 `output` item 类型的完全等价转换。
- 为不稳定 OpenAI-compatible 模型强行模拟可靠工具执行。
- 在 Gateway 内执行工具。Gateway 只做协议转发、转换、校验和诊断，不成为 tool runtime。

## 5. 分阶段计划

### 阶段 1：错误提示与诊断增强

目标：

- 用户看到 `unsupported_feature` 时能知道是 provider 能力问题，还是 Responses -> Chat 降级限制。

任务：

- 在 Gateway trace 中记录 `unsupportedFeature.kind`，区分 `responses_tools`、`responses_tool_calls`、`responses_reasoning`。
- 在错误响应中保留现有 `unsupported_feature` code，同时增加可读 remediation 文案。
- Agent Logs detail 展示当前 route、provider protocol、capability 与拒绝原因。
- Settings 中对 `openai_chat` provider 标注“Responses tools 需要降级转换，当前未支持”。

验收：

- 同一个带 tools 的 Responses 请求，在原生 Responses provider 和 Chat provider 下能看到不同诊断原因。
- 用户能从日志判断该切换 provider，还是等待降级转换能力。

### 阶段 2：Responses function tools -> Chat tools 最小转换

目标：

- 支持最常见的 function tool 定义从 Responses 请求降级到 Chat Completions。

任务：

- 扩展 `responses-to-chat.ts`，只接受明确可转换的 function tools。
- 将 Responses function tool schema 转换为 Chat `tools[].function.parameters`。
- 保留 `tool_choice` / parallel tool 相关语义的最小安全映射；无法等价时记录 lossy warning 或拒绝。
- 对非 function 类工具继续拒绝。

验收：

- 带简单 function tool schema 的 `/v1/responses` 请求可以降级到 `/v1/chat/completions`。
- 转换后的 upstream request 在 trace 中可见。
- 不支持的 tool 类型不会被静默丢弃。

### 阶段 3：Chat tool_calls -> Responses output items 转换

目标：

- Chat 上游返回 tool calls 时，Gateway 能按 Responses 形态返回给客户端。

任务：

- 在非流式路径中把 Chat `message.tool_calls` 转换为 Responses `output` 中的 function call item。
- 保留 call id、function name、arguments 字符串和 finish reason。
- 如果上游 arguments 不是合法 JSON 字符串，按策略记录诊断；是否 reject 由 provider safety policy 控制。
- 补齐 request / response trace 中转换前后对照。

验收：

- 客户端能收到可继续执行的 Responses function call item。
- 错误 arguments 能在 Agent Logs 中定位为 upstream 问题或 Gateway 转换问题。

### 阶段 4：function_call_output 输入回灌

目标：

- 支持客户端执行工具后，把工具结果作为下一轮 Responses 输入继续发回 Gateway。

任务：

- 将 Responses `function_call_output` 输入 item 转成 Chat `tool` message。
- 将上一轮 function call item 转成 Chat `assistant` message 的 `tool_calls`。
- 校验 call id 配对关系，无法配对时 fail-closed。
- 在 trace 中展示 tool loop step 序号和 call id。

验收：

- 一个最小 tool loop 可以通过 Responses 客户端、Gateway 和 Chat 上游跑通。
- call id 错配、缺失上一轮调用、重复输出等情况会被明确拒绝。

### 阶段 5：流式工具调用转换

目标：

- 支持 Chat streaming tool call delta 转换为 Responses streaming event。

任务：

- 梳理 Responses streaming event 序列，避免只靠文本 delta 拼接。
- 累积 Chat `tool_calls[].function.arguments` 分片，输出符合 Responses 预期的 call item / delta event。
- 对流式 JSON 截断、中途断流、arguments 非法等情况补充回归测试。
- Agent Logs 增加流式 tool call timeline。

验收：

- 流式 tool call 不丢 call id、function name 和 arguments。
- 中途失败时客户端得到清晰错误，日志能定位断点。

### 阶段 6：Provider capability 与 UI 收口

目标：

- 用户在配置 provider 时可以预期工具能力，而不是运行时才反复试错。

任务：

- 扩展 provider capability，区分 `nativeResponsesTools`、`responsesToolsViaChatDowngrade`、`responsesBuiltInTools`。
- Settings 中展示 Responses tools 支持矩阵。
- Model binding / route 选择时给出不兼容提示。
- 文档更新：说明不同 provider protocol 下 Responses tools 的支持等级。

验收：

- 用户在 Settings 就能判断某个 Codex / Responses 请求是否适合走当前 Gateway provider。
- 错误日志、UI 文案、provider capability 三者一致。

## 6. 测试计划

需要补充的测试范围：

- `responses-to-chat` 对纯文本请求保持现有兼容。
- 非空 `tools` 在未开启降级支持时仍按现有方式拒绝。
- function tool schema 能正确转换到 Chat tools。
- 非 function 工具类型继续拒绝。
- Chat `tool_calls` 能转换回 Responses function call output item。
- `function_call_output` 能转换成 Chat `tool` message。
- call id 缺失、错配、重复时 fail-closed。
- streaming tool call delta 能正确累计和输出。
- 原生 `openai_responses` provider 的 passthrough 行为不被降级转换影响。

## 7. 风险与边界

- Responses tools 与 Chat tools 不是完全等价协议，降级路径必须持续标记 `lossy_conversion`。
- 第三方 OpenAI-compatible provider 即使声称支持 tools，也可能不稳定，需要保留 provider-level capability 和事故日志。
- Gateway 不应执行工具，也不应替客户端修复危险工具参数。
- 对任何可能导致工具误执行的异常，应优先 reject，而不是自动猜测或修正。

## 8. 推荐优先级

建议先做阶段 1 和阶段 2。

原因：

- 阶段 1 能立即改善当前报错的可诊断性。
- 阶段 2 覆盖最常见的 function tools 场景。
- 阶段 3 之后才进入完整 tool loop，风险和测试成本明显上升。

如果短期只想消除该报错，应该优先把相关请求路由到原生 `openai_responses` provider；不要在 `openai_chat` 降级路径中静默忽略 `tools`。
