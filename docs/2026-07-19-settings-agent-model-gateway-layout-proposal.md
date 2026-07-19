# Settings Agent 模型配置与 Gateway 布局方案（2026-07-19）

## 1. 目标

为 Settings 的 Claude / Codex 模型配置提供更容易理解的布局，同时让用户能在同一页面确认 Gateway 的实际转发关系。

核心原则：

- Claude profile 与 Codex scope 的原始配置仍是唯一配置来源。
- Gateway 是可选的连接层和路由层，不成为第二份模型配置。
- Gateway 信息只以摘要、引用和状态的方式出现在模型页；不复制 API Key、base URL 或 provider 编辑表单。
- 开启或关闭 Gateway 只切换请求路径，必须能够恢复原来的直连配置。

## 2. 信息架构

保持现有顶层分工：

```text
Agents / Models
  Claude | Codex
  - 配置原始模型、Provider、认证和运行参数
  - 选择直连或通过 Gateway

Gateway
  - 管理本地监听、上游 Provider、协议、model map 和高级全局接管
  - 展示 Claude profile / Codex scope 的引用关系
```

普通用户只需在 `Agents / Models` 完成配置。只有新增上游、修改协议或排查 model map 时才进入 `Gateway`。

## 3. Agents / Models 页面布局

页面保留 Claude / Codex tab，但两个 tab 使用相同的三段结构：

```text
[运行目标 / 当前模型 / 连接方式]  <- 只读状态摘要

[原始配置]                          <- Claude profile 或 Codex scope 的权威配置

[Gateway 路由]                      <- 可选连接层，默认折叠或紧凑展示
```

### 3.1 顶部状态摘要

使用一行稳定高度的摘要条，而不是大型卡片。字段按优先级排列：

| 字段 | Claude | Codex |
| --- | --- | --- |
| 运行目标 | 当前 profile | Native / WSL scope |
| 当前模型 | profile model | Codex model |
| 连接方式 | 直连 / AI Gateway | 直连 / AI Gateway |
| 最终端点 | Provider base URL 或 Gateway profile URL | Provider base URL 或 Gateway `/v1` URL |
| 生效状态 | 正常 / Gateway provider 不可用 | 正常 / binding 失效 |

摘要中的模型、端点和状态必须来自现有配置与 Gateway status 的实时计算，不创建新的可编辑副本。

### 3.2 原始配置区

原始配置区始终显示，且始终是保存时的权威数据：

- Claude：继续使用 profile、模型、环境变量和现有 profile 级 Gateway binding。
- Codex：继续使用当前 scope 的 `.codex/config.toml`、provider 列表、模型、reasoning、认证与审批配置。

Gateway 模式下也不隐藏原始 Provider 配置。原因是用户关闭 Gateway 后应能立即回到相同的直连配置，而不是重新填写 Provider。

### 3.3 Gateway 路由区

Gateway 路由区放在原始配置之后，采用紧凑的两列布局：

```text
通过 AI Gateway                  [开关]
上游 Provider                    [选择器]
当前转发：<CLI model> -> <上游 model> [只读]
本地端点：http://127.0.0.1:<port>/... [只读]
```

行为：

- 未开启时，仅显示“直连当前 Provider”的简短说明和“配置 Gateway”链接。
- 开启时，选择的是现有 Gateway provider 的引用 `providerId`，不在此处重复编辑 provider URL、协议、API Key 或 model map。
- Codex 按 scope 保存 binding；Native 与 WSL 不能共用一份隐式 binding。
- Claude 继续按 profile 保存 binding，沿用现有 profile route 规则。
- provider 已删除、禁用或 Gateway 不可用时，显示明确错误，禁止静默回退到默认上游。

保存按钮按实际影响命名：

```text
直连：保存 Claude 配置 / 保存 Codex 配置
Gateway：保存并更新 Gateway 路由
```

## 4. Claude Tab 方案

Claude 的 profile 是核心对象。建议把 profile 列表中的每一项做成可扫描的行：

```text
Profile name        Model                 Connection                 Status
Work                claude-sonnet-*       Gateway -> OpenRouter      Active
Personal            claude-opus-*         Direct                     Active
```

选中 profile 后显示配置详情。Gateway 区只补充：

- Gateway provider 名称。
- profile URL，例如 `/profiles/<profileId>`。
- 模型映射是否存在。
- 当前 provider 的可用性。

不要把 Claude 的 Gateway 设置提升成全局 Claude 设置。profile 级别是现有语义，也更符合“不同任务使用不同上游”的需求。

## 5. Codex Tab 方案

Codex 的核心对象是环境 scope，而不是全局单例配置。顶部首先显示 Native / WSL 和对应 home path，其次才是模型与连接方式。

推荐布局：

```text
Native Windows | ~/.codex                 [同步]
Model: gpt-5.4 | Provider: NowCoding
Connection: AI Gateway -> Gateway Provider A

Codex 原始配置
  模型 / reasoning / provider / API key / auth / approvals

Gateway 路由
  使用 AI Gateway [开关]
  上游 Provider [选择器]
  Effective URL [只读]
```

关键约束：

- Gateway 开启前保存 direct snapshot；关闭后恢复该 snapshot。
- Gateway 路由区只管理 `enabled`、`scopeKey`、`providerId` 等 binding 元数据。
- `local-router` 是 Codex 写入层的实现细节，不作为主界面中的用户概念。
- 若当前 scope 尚未同步，不允许保存或切换 Gateway，避免覆盖未知的 `.codex/config.toml` 内容。

## 6. Gateway 页面配合调整

Gateway 页面不再承担 Claude / Codex 的模型编辑职责，而是提供两个视图。

### 6.1 连接关系总览

放在状态卡后，用紧凑表格展示引用，不允许直接修改模型：

```text
Client       Scope / Profile       Model              Gateway Provider     Health
Claude       Work                  claude-sonnet-*    OpenRouter           Ready
Codex        WSL Ubuntu            gpt-5.4            NowCoding            Ready
```

点击行跳转回对应的 Claude profile 或 Codex scope 编辑位置。这样用户可以追溯“谁在使用这个上游”，又不会在 Gateway 页产生第二个编辑入口。

### 6.2 Provider 编辑区

保留现有 provider、protocol、model map、host/port 与高级全局 binding，但作如下收口：

- 被 Claude profile 或 Codex scope 引用的 provider 标记“正在使用”。
- 删除或禁用时，先列出受影响的 profile/scope；不允许静默替换成 active provider。
- model map 旁显示其影响的 CLI 模型名，但不把它误表述为 Claude/Codex 原始模型配置。
- “全局接管”移入高级折叠区，并说明它会直接写入 CLI 配置；推荐路径仍是模型页的 profile/scope Gateway 开关。

## 7. 数据与保存边界

| 数据 | 权威来源 | Gateway 可做的事 | Gateway 不做的事 |
| --- | --- | --- | --- |
| Claude profile | Claude runtime profile | 保存 profile 级 provider 引用和 route | 覆盖 profile 的完整模型配置 |
| Codex scope | `.codex/config.toml` + scope snapshot | 保存 scope binding、写入/恢复 local-router | 丢弃或重建用户的 direct provider 列表 |
| Gateway provider | `AiGatewayConfig` | 提供转发端点、协议和 model map | 成为 Claude/Codex provider 配置的副本 |
| model map | `AiGatewayConfig` | 翻译请求模型名到上游模型名 | 修改 CLI 选择的模型字段 |

推荐保存顺序：

1. 校验原始 Claude/Codex 配置。
2. 保存原始配置或 direct snapshot。
3. 仅在 Gateway 已启用时保存 binding / route 引用。
4. 重新读取 Gateway status，渲染最终端点和 provider 健康状态。
5. provider 不存在或禁用时返回显式错误，不使用 fallback。

## 8. 状态与错误呈现

使用状态文案代替隐藏的自动行为：

- `直连：请求将发送至 <provider>`
- `通过 Gateway：<model> -> <gateway provider>`
- `Gateway 已配置但未运行：下次请求不可用`
- `Gateway provider 已禁用：请在 Gateway 页面修复或切回直连`
- `模型映射：<cli model> -> <upstream model>`

不建议使用“已同步”来表达流量结果。应明确说明“下一次请求会通过哪里发送”。

## 9. 实施优先级

### P1：只读关系与状态摘要

- Claude/Codex 顶部增加最终连接摘要。
- Gateway 页增加 profile/scope 引用总览。
- 不改变任何现有保存行为。

### P2：统一 Gateway 路由区

- Claude profile 与 Codex scope 使用相同的 `直连 / AI Gateway` 交互结构。
- 复用既有 binding 数据和 provider 选择，不新增第二套 provider 表单。

### P3：保护与跳转

- provider 删除前展示影响范围。
- 失效 binding 以错误状态呈现。
- Gateway 关系总览可以跳回对应模型配置。

## 10. 验收标准

1. 用户在 Claude 或 Codex 页无需进入 Gateway 页面，即可确认当前模型、连接方式、最终端点和上游 provider。
2. 开启 Gateway 后，Claude profile 与 Codex scope 原有配置可完整恢复。
3. Native / WSL Codex scope 的 Gateway 绑定不会互相覆盖。
4. Gateway provider 改动、禁用或删除时，受影响的 Claude/Codex 配置可被发现，且不会静默 fallback。
5. Gateway 页只维护代理与上游能力；模型页只维护模型与运行配置，两个页面没有重复的可编辑 Provider 表单。
