# AI Gateway 流式重试说明（2026-07-10）

本次为 AI Gateway 的 `chat/completions` 流式请求补充了“首包前重试”能力，目的是降低上游短暂抖动导致的客户端报错概率。

## 变更范围

- 仅影响 `src/core/electron/main/ai-gateway/gateway-server.ts` 中的 `chat/completions` 流式握手阶段。
- 不影响已经开始向客户端转发 SSE 数据之后的流。
- 不修改 `Responses` / `Anthropic` 路径的现有行为。

## 新增配置

Provider 高级配置新增两项：

- `streamRetryCount`
- `streamRetryDelayMs`

含义如下：

- `streamRetryCount` 控制最大重试次数，`0` 表示关闭重试。
- `streamRetryDelayMs` 控制每次重试之间的等待时间。

默认值：

- `streamRetryCount = 0`
- `streamRetryDelayMs = 500`

## 触发条件

只有在满足以下条件时才会重试：

- 请求目标是 `chat/completions`
- 请求为 `stream: true`
- 上游在首个 SSE 数据到达前失败
- 失败属于可重试场景，例如：
  - 上游返回 5xx
  - 网络连接失败
  - 上游响应不是 SSE，但发生在首包前，且尚未开始向客户端写流

## 不重试的情况

- 上游已经开始返回 SSE 事件后
- 客户端侧已经开始消费流
- 非流式请求
- `Responses` / `Anthropic` 路由
- 明确的 4xx 业务错误

## 设计意图

这不是一个通用的“自动恢复流”机制，而是一个保守的握手级重试：

- 避免把短暂 500 / 连接抖动直接暴露给客户端
- 不在已输出部分流量后尝试回滚
- 不改变现有协议转换和日志结构

## 验证

已补充回归测试覆盖“首次 500、第二次成功 SSE”的场景，确认重试只发生在首包前阶段。

## 日志语义

网关会记录三类和重试相关的日志：

- `Upstream chat/completions stream returned retryable response`
- `Upstream chat/completions stream recovered after retry`
- `Upstream chat/completions stream retry exhausted`

对应含义：

- 第一条表示当前这次上游响应已经被判定为可重试，网关准备重新发起请求。
- 第二条表示某次重试成功，最终拿到了可转发的 SSE 流。
- 第三条表示已经用完所有重试次数，仍然无法拿到可用流。
