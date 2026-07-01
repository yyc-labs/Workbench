# AI Agent 协议网关计划（2026-06-30）

## 背景

当前需求是：让 Claude 模型、Codex/Responses 格式模型，以及只提供 OpenAI `chat/completions` 的第三方模型，可以在同一个 AI Agent 入口下切换。

调研后的关键判断是：

- 不能把 Claude Code 和 Codex CLI 都直接“改成 chat/completions 客户端”。
- Claude Code 侧天然期望 Anthropic Messages 兼容协议。
- Codex CLI 侧天然期望 OpenAI Responses 兼容协议；当前 Codex provider 配置里已有 `wire_api = "responses"`。
- 真正可控的统一点应该是本地或远端协议网关：Agent CLI 仍按各自协议请求网关，网关再把请求转换为上游供应商需要的格式。

也就是说：

```text
Claude Code -> Anthropic Messages -> 本地网关 -> OpenAI chat/completions -> 上游模型
Codex CLI   -> OpenAI Responses   -> 本地网关 -> OpenAI chat/completions -> 上游模型
```

上游返回时需要反向转换：

```text
上游 chat/completions -> 本地网关 -> Anthropic Messages 或 OpenAI Responses -> Agent CLI
```

参考方向：

- CC Switch: https://ccswitch.io/zh/
- OpenAI Codex 配置参考: https://developers.openai.com/codex/config-reference
- OpenAI Responses API: https://platform.openai.com/docs/api-reference/responses/create
- OpenAI Chat Completions API: https://platform.openai.com/docs/api-reference/chat/create
- Anthropic Messages API: https://docs.anthropic.com/en/api/messages

## 当前代码事实

### 1. 当前没有模型协议网关

已有的 `Agent Hook Gateway` 位于：

- `src/core/electron/main/hooks/agent-hook-gateway.ts`
- `docs/hooks/agent-hook-gateway.md`

它负责接收 Claude Code / Codex CLI 生命周期 hook 事件，并统一成 `AgentHookEnvelope` 广播给 renderer。

它不参与模型请求，不应该扩展成 LLM 协议代理。

### 2. Claude 配置目前走环境变量

Claude 相关配置位于：

- `src/core/electron/main/claude-bashrc.ts`
- `src/core/renderer/pages/settings/SettingsAiRuntimePanel.tsx`
- `src/core/electron/main/windows-env.ts`

核心字段是：

- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_AUTH_TOKEN`
- `ANTHROPIC_MODEL`
- `ANTHROPIC_DEFAULT_OPUS_MODEL`
- `ANTHROPIC_DEFAULT_SONNET_MODEL`
- `ANTHROPIC_DEFAULT_HAIKU_MODEL`

如果接入本地网关，Claude 侧应该把 `ANTHROPIC_BASE_URL` 指向网关的 Anthropic 兼容入口，而不是让 Claude 直接请求第三方 `chat/completions`。

### 3. Codex 配置目前写入 `.codex/config.toml`

Codex provider 配置位于：

- `src/core/electron/main/codex-config.ts`
- `src/core/renderer/pages/settings/SettingsCodexPanel.tsx`
- `src/core/shared/types.ts`

当前支持保存：

- `model_provider`
- `model`
- `model_reasoning_effort`
- `preferred_auth_method`
- `approvals_reviewer`
- `model_providers.<id>.name`
- `model_providers.<id>.base_url`
- `model_providers.<id>.wire_api`
- `model_providers.<id>.requires_openai_auth`
- `model_providers.<id>.env_key`

如果接入本地网关，Codex 侧应该写：

```toml
model_provider = "local-router"
model = "<codex侧模型名或映射名>"

[model_providers.local-router]
name = "Local Router"
base_url = "http://127.0.0.1:<port>/v1"
wire_api = "responses"
requires_openai_auth = true
env_key = "OPENAI_API_KEY"
```

网关内部再把 Responses 请求转换为上游 `chat/completions`。

## 目标

1. 在 Electron main 进程内新增独立的 `ai-gateway` domain，负责本地模型协议代理。
2. 保持 Claude Code / Codex CLI 的外部协议不变，降低 CLI 兼容风险。
3. 允许上游供应商按能力声明协议格式，例如 `openai_chat`、`openai_responses`、`anthropic_messages`。
4. 支持 OpenAI Chat Completions 作为统一上游协议，优先解决第三方模型只兼容 `/v1/chat/completions` 的场景。
5. 支持流式响应转换，避免 Claude/Codex 终端交互卡死或丢事件。
6. 保留原有 Claude / Codex 配置方式的备份与恢复能力。

## 非目标

- 不把 `Agent Hook Gateway` 改造成模型代理。
- 不要求 renderer 直接拼模型协议请求。
- 不在第一阶段实现所有供应商的完整工具调用语义。
- 不新增第三方依赖，除非后续确认 Node 内置能力无法可靠处理 SSE 和 HTTP 代理。
- 不默认把用户现有 Claude / Codex 配置覆盖为网关模式。

## 推荐架构

新增 main domain：

```text
src/core/electron/main/ai-gateway/
  gateway-service.ts
  gateway-server.ts
  gateway-config.ts
  provider-registry.ts
  protocol-types.ts
  adapters/
    anthropic-to-chat.ts
    responses-to-chat.ts
    chat-to-anthropic.ts
    chat-to-responses.ts
    sse.ts
```

新增 shared 类型：

```text
src/core/shared/types.ts
```

建议新增类型：

```ts
export type AiGatewayUpstreamProtocol =
  | 'openai_chat'
  | 'openai_responses'
  | 'anthropic_messages'

export interface AiGatewayProviderConfig {
  id: string
  name: string
  baseUrl: string
  apiKeyEnv?: string
  apiKey?: string
  protocol: AiGatewayUpstreamProtocol
  modelMap?: Record<string, string>
  enabled: boolean
}
```

新增 IPC 链路：

```text
shared types/constants
-> main/ai-gateway/*
-> main/ipc/registerAiGatewayIpcHandlers.ts
-> preload/invokeApi.aiGateway.ts
-> renderer/settings panel
```

`registerIpcHandlers.ts` 只负责装配，不直接写 handler 逻辑。

## 协议转换设计

### Claude -> chat/completions

入口：

```text
POST /v1/messages
```

Claude 请求转换为 Chat 请求：

```text
model              -> modelMap[model] ?? model
system             -> messages: [{ role: "system", content }]
messages[].role    -> user / assistant
messages[].content -> text content blocks flatten 为 content
max_tokens         -> max_tokens 或 max_completion_tokens，按上游兼容性配置
temperature        -> temperature
stream             -> stream
```

Chat 响应转换回 Claude：

```text
choices[0].message.content -> content: [{ type: "text", text }]
usage                      -> usage
finish_reason              -> stop_reason
```

流式响应需要转换 SSE 事件，而不是简单透传 JSON 行。

### Codex Responses -> chat/completions

入口：

```text
POST /v1/responses
```

Responses 请求转换为 Chat 请求：

```text
model         -> modelMap[model] ?? model
instructions  -> messages: [{ role: "system", content }]
input         -> messages
tools         -> 第一阶段可拒绝或降级；后续映射为 chat tools
reasoning     -> 第一阶段保守丢弃或映射到上游私有参数
stream        -> stream
```

Chat 响应转换回 Responses：

```text
id                    -> resp_<generated>
object                -> "response"
status                -> "completed"
output[].type         -> "message"
output[].content.type -> "output_text"
output_text           -> choices[0].message.content
usage                 -> usage
```

流式模式需要把 Chat delta 转换为 Responses stream events，例如：

```text
response.created
response.output_item.added
response.content_part.added
response.output_text.delta
response.output_text.done
response.completed
```

具体事件字段必须用实际 Codex CLI 抓包或官方协议样例校准，不能只靠猜测。

## 配置模型

建议把“CLI 接管配置”和“上游供应商配置”拆开。

### CLI 接管配置

```ts
interface AiGatewayClientBinding {
  cli: 'claude' | 'codex'
  enabled: boolean
  baseUrl: string
  providerId: string
  backupPath?: string
}
```

用途：

- Claude binding 修改 `ANTHROPIC_BASE_URL` / token / model。
- Codex binding 修改 `.codex/config.toml` provider。
- 每次接管前生成备份。
- 提供一键恢复。

### 上游 provider 配置

```ts
interface AiGatewayProviderConfig {
  id: string
  name: string
  baseUrl: string
  protocol: 'openai_chat' | 'openai_responses' | 'anthropic_messages'
  apiKey?: string
  apiKeyEnv?: string
  modelMap?: Record<string, string>
  timeoutMs?: number
}
```

第一阶段只必须支持 `openai_chat`。

## UI 调整范围

新增或扩展 Settings 页面时，落点建议：

- `src/core/renderer/pages/settings/SettingsAgentsPanel.tsx`
- 新增 `SettingsAiGatewayPanel.tsx`
- 必要时在 `src/core/renderer/i18n/messages/aiAndRuntime.ts` 增加文案

UI 应展示：

- 网关是否运行
- 本地监听地址
- Claude 是否已接管
- Codex 是否已接管
- 当前上游 provider
- provider 协议格式
- 模型映射
- 备份/恢复按钮

不要把协议转换细节散落在页面组件里。

## 分阶段实施

### P0：验证协议与最小 PoC

1. 用本地独立脚本模拟 `/v1/messages`、`/v1/responses`、`/v1/chat/completions` 的互转。
2. 抓取 Claude Code 和 Codex CLI 在非流式、流式场景下实际发送的字段。
3. 确认 Codex CLI 对 Responses stream events 的最小必需事件集合。
4. 确认常见第三方 `chat/completions` 上游是否接受 `max_tokens`、`max_completion_tokens`、`stream_options` 等字段。

交付物：

- 协议样例 JSON
- 最小转换测试
- 明确第一阶段不支持字段列表

### P1：实现 main 进程网关基础

1. 新增 `ai-gateway` domain。
2. 实现本地 HTTP server 生命周期：start、stop、status。
3. 实现 provider registry 和配置持久化。
4. 实现非流式 `Anthropic Messages -> Chat -> Anthropic Messages`。
5. 实现非流式 `Responses -> Chat -> Responses`。

交付物：

- main service
- IPC status/config API
- 单元测试覆盖协议转换纯函数

### P2：实现流式转换

1. 实现 SSE parser 和 writer。
2. Chat stream delta 转 Claude stream events。
3. Chat stream delta 转 Responses stream events。
4. 加入上游中断、超时、异常的错误事件转换。

交付物：

- 流式协议转换测试
- Claude/Codex 手动联调记录

### P3：接入 Claude / Codex 配置接管

1. Claude 接管：写入 `ANTHROPIC_BASE_URL` 指向本地网关。
2. Codex 接管：写入 `.codex/config.toml` local provider，保持 `wire_api = "responses"`。
3. 接管前备份原配置。
4. 提供恢复入口。
5. Windows Native / WSL / Linux / macOS 分别处理配置位置。

交付物：

- Claude 接管/恢复
- Codex 接管/恢复
- Windows/WSL 路径验证

### P4：完善 Settings UI

1. 增加 AI Gateway 页面或 Agent 设置子页。
2. 支持 provider 增删改。
3. 支持模型映射配置。
4. 展示接管状态和错误诊断。
5. 所有用户可见文案接入 i18n。

交付物：

- Settings UI
- 深浅色主题验证
- 空态、错误态、恢复态

## 风险与约束

### 1. 流式协议最容易出问题

Claude 和 Codex 都是交互式 CLI，流式事件格式不正确时，可能表现为：

- CLI 无输出
- 输出中断
- 一直等待结束事件
- token usage 丢失
- tool call 状态异常

必须优先用真实 CLI 验证。

### 2. Tool call / function call 不能只做字段改名

Claude tools、Responses tools、Chat tools 的语义不完全一致。

第一阶段建议：

- 没有 tool 时完整支持。
- 有 tool 时明确返回可理解错误，或只支持最小只读工具。
- 不要假装支持完整 agent tool loop。

### 3. Codex 的 Responses 事件需要保守处理

Codex CLI 对 Responses stream events 的消费可能比普通 API 客户端更严格。

计划中必须保留抓包和回归样例，不要只按文档手写事件名。

### 4. 配置接管必须可恢复

涉及用户全局环境变量、`.bashrc`、`.codex/config.toml`，必须：

- 写入前备份。
- 标记哪些内容由本应用管理。
- 提供恢复按钮。
- 不覆盖用户手写的无关配置。

### 5. Windows / WSL 范围必须明确

Codex 配置位置和环境变量写入位置受 Runtime mode 影响。

必须沿用现有 scope 逻辑：

- `resolveCodexEnvironmentScope`
- `getCodexScopeCacheKey`
- `aiEnvironment.mode`
- `Capability.hostPlatform`

不要新增“猜测当前环境”的旁路逻辑。

## 验证计划

### 单元测试

- Anthropic Messages request -> Chat request
- Chat response -> Anthropic Messages response
- Responses request -> Chat request
- Chat response -> Responses response
- Chat SSE -> Anthropic SSE
- Chat SSE -> Responses SSE
- provider modelMap 解析
- 错误响应转换

### 集成测试

- 本地 fake upstream 接收 Chat 请求并返回非流式响应。
- 本地 fake upstream 返回 SSE。
- gateway start/stop/status IPC。
- provider 配置持久化。

### 手动验证

- Claude Code 使用本地网关完成一次普通问答。
- Claude Code 流式输出正常结束。
- Codex CLI 使用本地网关完成一次普通问答。
- Codex CLI 流式输出正常结束。
- 断网或上游 401 时 CLI 能看到明确错误。
- 接管后恢复原 Claude / Codex 配置。

## 建议优先级

优先做：

1. 独立转换纯函数和 fake upstream。
2. Codex Responses -> Chat 的非流式链路。
3. Claude Messages -> Chat 的非流式链路。
4. SSE 转换。
5. 配置接管和 UI。

不建议一开始就做：

- 多供应商自动测速。
- 完整 tool call 语义转换。
- 多账号密钥池。
- 复杂路由策略。
- 远端云同步配置。

## 最小可用版本定义

MVP 满足以下条件即可：

- 本地网关可启动和停止。
- 可配置一个 `openai_chat` 上游 provider。
- Claude Code 可通过网关请求该 provider。
- Codex CLI 可通过网关请求该 provider。
- 非流式和流式文本输出都能正常结束。
- 支持配置备份与恢复。
- 遇到不支持的 tool/reasoning 字段时返回明确错误。

达到 MVP 后，再考虑 provider 切换、路由规则、UI 优化和 tool call 兼容。

## 2026-06-30 实施状态

已完成 MVP 基础链路：

- 新增 `src/core/electron/main/ai-gateway/` 独立 domain，包含配置规范化、provider registry、HTTP server 生命周期、协议转换 adapter 和 SSE 工具。
- 新增本地入口：`/v1/messages`、`/v1/responses`、`/v1/chat/completions`。
- 已支持 `openai_chat` 上游 provider；`openai_responses`、`anthropic_messages` 已进入配置模型。初始 MVP 只转换 `openai_chat`，后续已为 Claude route 补充 `anthropic_messages` 上游透传。
- 已支持 Anthropic Messages -> Chat Completions -> Anthropic Messages 的非流式和文本流式转换。
- 已支持 OpenAI Responses -> Chat Completions -> OpenAI Responses 的非流式和文本流式转换。
- 已新增 IPC/preload 链路：状态、配置保存、启动、停止、Claude/Codex 接管、Claude/Codex 恢复。
- 已新增 Settings / AI Agents / Gateway 页内 tab，可编辑 provider、模型映射、本地监听地址，并手动执行接管/恢复。
- 接管前会把当前 Claude/Codex 配置快照保存到应用配置中；接管不会自动触发，必须用户点击按钮。
- 已新增协议转换单元测试：`test/electron/ai-gateway-adapters.test.mjs`。
- 已新增主进程调试日志：默认会记录上游 200 但格式异常、非 SSE、空 body、SSE JSON 解析失败等问题；设置环境变量 `IDE_ELECTRON_AI_GATEWAY_DEBUG=1` 可额外打印前几段上游 SSE 预览。

当前保留限制：

- Claude / Anthropic Messages 的 `tools`、`tool_use`、`tool_result` 已支持桥接到 `openai_chat` 的 `tools`、`tool_calls`、`tool` message；Responses tools 与非空 reasoning 仍按 MVP 规则明确拒绝。
- 流式事件已补到 Claude tool use 所需的最小事件集合，但仍需要后续用真实 Claude Code / Codex CLI 抓包校准。
- 尚未实现 `openai_responses` 上游的反向转换；`anthropic_messages` 上游仅在 Claude `/v1/messages` route 中做同协议透传。
- 尚未执行完整打包 build；本仓库规则要求默认不执行 build。

## 2026-06-30 追加实施：Claude Profile 级网关路由

已把“只让某个 Claude 配置档走网关”的入口调整到 Claude 配置页，而不是 Gateway 页：

- Gateway 页中的原 `Apply Takeover` 已按语义调整为“全局接管”，只用于把当前全局 Claude/Codex 配置写到网关地址。
- Claude profile 增加 `gateway` 元数据；在 Claude tab 中，每个已保存的 profile 都可以单独选择是否走 Gateway、走哪个 provider。
- `profile.config` 始终保存原始直连配置；开启 Gateway 只在写入运行环境时临时把 `ANTHROPIC_BASE_URL` 指向本地网关，不覆盖原模型、token 或直连 URL。
- 关闭某个 profile 的 Gateway 时，会继续使用 `profile.config` 中保存的直连配置。
- 网关新增 profile 路由入口：`/profiles/<profileId>/v1/messages` 会按 profile id 选择 provider。普通 `/v1/messages` 请求仍按手工模型路由或 active provider 处理，不会被 profile 路由污染。
- 如果上游真实模型名和 Claude profile 里的模型名不同，使用 provider 自己的 `modelMap` 做可选映射；不再要求在 Gateway 页额外维护一份 Claude profile 模型别名。

推荐使用方式更新为：

1. 在 Gateway 页配置一个或多个上游 provider，例如第三方 `https://xxx/v1`，协议选 `openai_chat`，填 API Key。
2. Start Gateway。
3. 不点“全局接管”。
4. 回到 Claude tab，只在需要的 Claude profile 上开启“使用 AI Gateway”，并选择要走的 provider。

保存后，该 profile 的有效环境会变为：

```text
ANTHROPIC_BASE_URL=http://127.0.0.1:17374/profiles/<profileId>
ANTHROPIC_MODEL=<AI / Agents 里原来配置的模型名>
```

网关内部会按该 profile id 建立专用 route：

```text
/profiles/<profileId>/v1/messages -> <选中的 provider>
```

如果上游 Provider 识别的真实模型名和 Claude profile 里的模型名不同，再在该 provider 的 Model map 中写：

```text
<Claude profile 原有模型名>=<上游真实模型名>
```

其它未开启 Gateway 的 Claude profile 会继续保留原来的 `ANTHROPIC_BASE_URL` 和模型。

当前仍保留的限制：

- profile 级 Claude 请求依赖 profile path 区分来源；普通模型路由仍只由 Gateway 页里手工配置的 route 决定。
- route 目前按精确模型名匹配，尚未实现通配符、优先级或复杂条件。
- `anthropic_messages` provider 可用于 Claude profile route 透传；`openai_responses` 上游仍未完成反向转换。

## 2026-07-01 追加实施：Anthropic Messages 上游透传

已为 Claude / Anthropic Messages route 增加 `anthropic_messages` provider 分支：

- `/v1/messages` 和 `/profiles/<profileId>/v1/messages` 会按路由选择 provider。
- 选中 `openai_chat` provider 时，继续走 Anthropic Messages -> Chat Completions -> Anthropic Messages 转换。
- 选中 `anthropic_messages` provider 时，不做协议转换，直接把请求透传到上游 Anthropic Messages 兼容入口，并记录 ingress、normalized、upstream、client 四段日志。
- 上游 URL 规则：`https://api.deepseek.com/anthropic` 会拼成 `https://api.deepseek.com/anthropic/v1/messages`；已包含 `/v1` 或 `/v1/messages` 时不会重复拼接。
- 非流式透传会保留上游 status/body 返回给 Claude Code；流式透传会解析 SSE 以生成日志预览，再按 Anthropic SSE 事件发回客户端。
- 鉴权优先使用 Claude profile 请求带来的 token；没有请求 token 时使用 provider 的 API Key 或 API Key 环境变量。
