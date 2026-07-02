# Settings 模型配置与 Gateway 统一计划（2026-07-01）

## 1. 背景

用户反馈：在 Settings 中修改了模型配置后，Gateway 配置没有同步变化，导致实际请求流量看起来仍然走旧的 provider、旧的 model map 或旧的本地接管状态。

这不是单个输入框 bug，而是当前信息架构和保存链路造成的认知断层：

- `Agents / Models` 负责 Claude profile、Codex provider/model 配置。
- `Gateway` 负责本地协议代理、上游 provider、model map、Claude/Codex 全局接管。
- Claude profile 侧已有 profile 级 Gateway 绑定和路由同步。
- Codex 侧只有独立的 `.codex/config.toml` 保存逻辑，保存后不会反向更新 Gateway provider 或路由。
- Gateway 侧的 Codex 接管只会把 Codex provider 改成 `local-router`，并不会把 Codex 当前选择的真实 provider/model 变成 Gateway 的活跃上游。

结果是用户会自然认为“我换了模型配置，流量也应该换”，但系统实际把“模型配置”和“流量路由”拆成了两套状态。

## 2. 当前代码事实

### 2.1 Settings 页面入口

相关 renderer 文件：

- `src/core/renderer/pages/Settings.tsx`
- `src/core/renderer/pages/settings/SettingsAgentsPanel.tsx`
- `src/core/renderer/pages/settings/SettingsAiRuntimePanel.tsx`
- `src/core/renderer/pages/settings/SettingsCodexPanel.tsx`
- `src/core/renderer/pages/settings/SettingsAiGatewayPanel.tsx`

当前路由已经拆成：

- `/settings/agents`
- `/settings/gateway`
- `/settings/agent-logs`

这说明“模型配置”和“Gateway 配置”在页面层已经分离，但还缺少跨页面的状态关系表达。

### 2.2 Claude 配置链路

Claude profile 位于：

- `src/core/shared/types.ts`
  - `ClaudeRuntimeProfile`
  - `ClaudeRuntimeProfileGatewayBinding`
- `src/core/renderer/pages/settings/SettingsAiRuntimePanel.tsx`
- `src/core/renderer/lib/claudeGatewayProfiles.ts`

当前行为：

- Claude profile 保存直连配置在 `profile.config`。
- 开启 profile 级 Gateway 后，运行时把 `ANTHROPIC_BASE_URL` 指向 `/profiles/<profileId>`。
- `withClaudeProfileModelRoutes()` 会把已开启 Gateway 的 Claude profile 写入 `AiGatewayConfig.modelRoutes`。
- Gateway 保存时会调用 `syncClaudeGatewayProfileConfigs()` 同步 Claude profile 的 provider 绑定。

Claude 侧已经有一个较清晰的设计：profile 是模型/运行配置来源，Gateway 只是某个 profile 的可选路由层。

### 2.3 Codex 配置链路

Codex 配置位于：

- `src/core/shared/types.ts`
  - `CodexConfig`
  - `CodexModelProviderConfig`
  - `CodexSettingsSnapshot`
- `src/core/electron/main/codex-config.ts`
- `src/core/renderer/pages/settings/SettingsCodexPanel.tsx`
- `src/core/renderer/stores/appStore.settingsSlice.ts`

当前行为：

- Codex panel 读取/写入 `.codex/config.toml`。
- `saveCodexSettings()` 只更新 Codex snapshot 和 app config cache。
- Codex provider 字段包括 `modelProvider`、`model`、`modelProviders`、provider `baseUrl`、`wireApi`、`envKey`。
- 保存 Codex 配置不会保存 `AiGatewayConfig`。
- 保存 Codex 配置不会同步 Gateway provider、active provider、modelRoutes 或 modelMap。

### 2.4 Gateway 配置链路

Gateway 配置位于：

- `src/core/shared/types.ts`
  - `AiGatewayConfig`
  - `AiGatewayProviderConfig`
  - `AiGatewayClientBinding`
  - `AiGatewayModelRoute`
- `src/core/electron/main/ai-gateway/gateway-config.ts`
- `src/core/electron/main/ai-gateway/gateway-service.ts`
- `src/core/electron/main/ai-gateway/provider-registry.ts`
- `src/core/renderer/pages/settings/SettingsAiGatewayPanel.tsx`

当前行为：

- Gateway provider 是独立配置，有自己的 `id`、`baseUrl`、`protocol`、`apiKey`、`modelMap`。
- Gateway 请求优先按 `modelRoutes` 找 provider，否则 fallback 到 `activeProviderId`。
- Claude profile route 通过 `source: 'claude-profile'` 区分。
- Codex 全局接管通过 `applyClientBinding('codex')` 写入 `local-router` provider 到 Codex config。
- Codex 接管保存的是“Codex 请求本地 Gateway”，不是“Codex 当前模型同步到 Gateway”。

## 3. 问题归因

### 3.1 用户心智是“选一个模型，然后使用它”

用户通常不会区分：

- Codex config 里的 provider
- Gateway provider
- Gateway active provider
- Gateway model map
- Codex local-router binding

他们更关心：

- 当前 Claude/Codex 用哪个模型？
- 是否通过 Gateway？
- 通过 Gateway 时最终上游是谁？
- 改完设置后下一次请求是否生效？

### 3.2 当前系统是“三个独立保存按钮”

当前至少存在三类保存动作：

- Claude profile 保存。
- Codex provider/model 保存。
- Gateway provider/binding 保存。

这些保存动作没有统一的“变更影响提示”，也没有统一的“保存后是否同步 Gateway”策略。

### 3.3 Claude 与 Codex 的 Gateway 模型不对称

Claude：

- 支持 profile 级 Gateway。
- profile 级 route 明确写入 Gateway。
- 用户可以只让某个 profile 走 Gateway。

Codex：

- 只有全局接管到 `local-router`。
- 没有 Codex profile 级 route。
- 没有 Codex provider 到 Gateway provider 的稳定映射。
- Codex 保存后不会告诉用户 Gateway 仍在使用另一套 provider。

### 3.4 Gateway 页面承担了过多“底层概念”

Gateway 页面暴露：

- provider id
- protocol
- active provider
- model map
- binding

这些对高级用户有用，但对普通用户来说，“模型配置”和“流量路由”之间的关系不够直观。

## 4. 设计目标

1. 模型配置页应该成为用户选择模型的主入口。
2. Gateway 页面应该表达“流量代理与路由”，而不是让用户重复维护另一套模型配置。
3. 修改 Claude/Codex 模型后，页面必须明确提示 Gateway 是否会受影响。
4. 对 Claude 和 Codex 提供尽量一致的 Gateway 使用方式。
5. 保留高级用户手工维护 Gateway provider/model map 的能力。
6. 不破坏现有 Windows/WSL scope：Codex 配置仍必须走 `resolveCodexEnvironmentScope()`。
7. 不让 renderer 直接依赖 main 实现；跨层修改仍遵循 `shared -> main service -> IPC -> preload -> renderer`。

## 5. 推荐产品模型

### 5.1 引入“连接模式”

在 Claude profile 和 Codex 配置中，都明确展示连接模式：

```text
直连 Provider
通过 AI Gateway
```

含义：

- 直连 Provider：CLI 直接使用当前模型配置里的 provider/baseUrl/apiKey。
- 通过 AI Gateway：CLI 指向本地 Gateway，Gateway 再按绑定规则转发到上游 provider。

这样用户能明确知道“模型配置”和“Gateway 配置”是否联动。

### 5.2 模型配置页增加 Gateway 摘要

在 `Agents / Models` 页面中，不要求用户跳到 Gateway 页才能理解现状。

Claude tab 每个 profile 展示：

- 当前是否通过 Gateway。
- Gateway provider。
- 最终 Gateway baseUrl。
- 是否有 model map。

Codex tab 展示：

- 当前 Codex scope。
- 当前 Codex model/provider。
- 是否已绑定到 Gateway `local-router`。
- 如果已绑定，显示 Gateway active provider 和本地 baseUrl。
- 如果 Codex 当前 provider 与 Gateway active provider 不一致，显示提示。

### 5.3 Gateway 页面增加“来源关系”而不是只显示 provider 表单

Gateway 页面在 provider 配置上方增加一个关系总览：

```text
Claude Profiles
- DeepSeek Default: Gateway -> provider-x
- Work Profile: Direct

Codex
- Scope: WSL / Native
- CLI binding: Gateway local-router enabled / disabled
- Model config source: Direct Codex config / Gateway-managed
- Current model: xxx
```

这样 Gateway 页面不再像一套孤立配置。

### 5.4 Codex 支持 Gateway 管理模式

Codex tab 增加一个明确开关：

```text
使用 AI Gateway 管理 Codex 请求
```

开启后：

- Codex `.codex/config.toml` 的 active provider 写成 `local-router`。
- `local-router.base_url` 指向 Gateway `/v1`。
- `model` 保留用户在 Codex tab 里选择/输入的模型名。
- Gateway 根据 Codex 绑定选择的 provider 或 model route 转发。

关闭后：

- 恢复 Codex direct provider。
- 不删除 Gateway provider。
- 不修改 Claude profile route。

这比当前 Gateway 页里的“Apply Codex Binding”更符合用户心智。

### 5.5 高级 Gateway 设置继续保留

Gateway 页面仍保留：

- provider 增删改。
- protocol。
- api key。
- model map。
- host/port。
- global binding/restore。

但建议把全局 binding 标记为高级操作，文案说明它会改写 CLI 配置。

## 6. 数据模型建议

### 6.1 扩展 `AiGatewayModelRoute.source`

当前：

```ts
source?: 'manual' | 'claude-profile'
```

建议扩展为：

```ts
source?: 'manual' | 'claude-profile' | 'codex-scope'
```

新增字段：

```ts
scopeKey?: string
cli?: 'codex'
```

用途：

- 记录某个 Codex scope 的 model route。
- 避免 Codex route 和手工 route 混在一起。
- Gateway 保存时可以保留手工 route，只重建 `codex-scope` route。

### 6.2 增加 Codex Gateway binding 元数据

建议在 app config 中增加轻量元数据，而不是把所有状态塞进 Codex TOML。

可选形态：

```ts
export interface CodexGatewayBinding {
  enabled: boolean
  scopeKey: string
  providerId: string
  directSnapshot?: CodexSettingsSnapshot
  updatedAt?: string
}
```

放置位置可选：

```ts
AppConfig.codexGatewayBindings?: Record<string, CodexGatewayBinding>
```

或复用现有：

```ts
AiGatewayConfig.clientBindings.codex
```

但现有 `AiGatewayClientBinding` 是按 cli 全局一份，不够表达多个 Codex scope。推荐新增 scope keyed binding，避免 Windows Native / WSL 配置互相覆盖。

### 6.3 Codex provider 与 Gateway provider 映射 helper

新增纯函数，放在 renderer/lib 或 shared helper，避免页面散写转换逻辑：

```text
CodexModelProviderConfig -> AiGatewayProviderConfig
AiGatewayProviderConfig -> CodexModelProviderConfig(local-router only)
CodexSettingsSnapshot + binding -> effective display summary
```

建议落点：

- shared 只放类型和纯转换规则。
- main `ai-gateway` domain 负责持久化和接管。
- renderer lib 只负责展示摘要。

## 7. 保存链路建议

### 7.1 Claude 保存链路保持现状，但补提示

Claude 侧已有可用机制，建议只做增强：

- 保存 profile 时继续调用 `withClaudeProfileModelRoutes()`。
- 如果 Gateway provider 被删除或禁用，Claude profile 上显示失效提示。
- 保存 Gateway provider 时继续 `syncClaudeGatewayProfileConfigs()`，并在 UI 中提示影响的 Claude profiles。

### 7.2 Codex 保存链路增加同步策略

`SettingsCodexPanel.handleSave()` 保存 Codex 设置后，根据用户选择的 Codex Gateway 管理模式执行：

1. 保存 Codex direct config 或 Gateway local-router config。
2. 更新 app config 中的 Codex scope snapshot。
3. 如果该 scope 启用 Gateway：
   - 更新 Codex gateway binding。
   - 更新或重建 `source: 'codex-scope'` 的 Gateway model route。
   - 如果 Gateway 正在运行，刷新 registry。
4. 如果未启用 Gateway：
   - 不自动改 Gateway provider。
   - 若存在旧的 `codex-scope` route，提示用户可清理或自动禁用。

### 7.3 Gateway 保存链路增加反向影响提示

`SettingsAiGatewayPanel.persistDraftConfig()` 保存后：

- 继续同步 Claude profile routes。
- 检查 Codex gateway bindings 指向的 provider 是否仍存在且 enabled。
- 对失效 binding 标记 warning，不要静默 fallback 到 active provider。

重要原则：

- 不要在 provider 被删除时自动让 Codex 跑到另一个 provider。
- 需要用户确认，否则“模型明明换了但流量没按预期走”的问题会换一种形式出现。

## 8. UI 改造方案

### 8.1 Agents / Models 页

Claude tab：

- 保留现有 profile 级 Gateway 开关。
- 增加“最终连接”摘要：
  - Direct: `ANTHROPIC_BASE_URL`
  - Gateway: `http://127.0.0.1:<port>/profiles/<profileId>`
  - Provider: `<provider name>`
  - Model map: configured / none

Codex tab：

- 在模型/provider 表单上方增加状态条：
  - Current scope
  - Current model
  - Connection mode: Direct / AI Gateway
  - Effective baseUrl
- 把“使用 AI Gateway 管理 Codex 请求”放在醒目位置。
- 开启 Gateway 时让用户选择 Gateway provider。
- 保存按钮文案根据模式变化：
  - Direct: `保存 Codex 配置`
  - Gateway: `保存并同步 Gateway`

### 8.2 Gateway 页

新增顶部关系总览：

- Gateway running/stopped。
- Claude profiles using Gateway count。
- Codex scopes using Gateway count。
- 失效绑定 warning count。

Provider 表单区域：

- 对被 Claude/Codex binding 使用的 provider 显示“正在使用”标签。
- 删除 provider 前弹窗列出受影响的 Claude profile / Codex scope。

Bindings 区域：

- 将当前 `Apply Binding` 改名为更明确的高级操作：
  - `全局接管 Claude`
  - `全局接管 Codex`
- 增加说明：推荐优先在模型页按 profile/scope 开启 Gateway。

### 8.3 文案原则

避免使用只有开发者理解的词作为主文案：

- 少用 `binding`，多用“通过 Gateway”。
- 少用 `active provider`，多用“默认上游”。
- `model map` 保留，但加说明：“当 CLI 模型名和上游真实模型名不一致时使用”。
- 明确“保存后是否会影响下一次请求”。

## 9. 分阶段执行计划

### P1. 先做诊断与提示，不改变核心行为

目标：

- 用户能看清当前 Codex 是否通过 Gateway。
- 用户能看清 Gateway 当前使用哪个 provider。
- 保存 Codex 后，如果 Gateway 不会同步，明确提示。

改动：

- `SettingsCodexPanel.tsx` 读取 `getAiGatewayConfig()` 和 `getAiGatewayStatus()`。
- 增加 Codex effective summary。
- 增加“Gateway 未同步”的 warning。
- i18n 补充文案。

完成标准：

- 用户不会再误以为保存 Codex provider 会自动修改 Gateway provider。

### P2. 把 Codex Gateway 开关放到 Codex tab

目标：

- 用户在配置 Codex 模型时即可决定是否走 Gateway。

改动：

- shared 增加 Codex Gateway binding 类型。
- main 增加按 scope 保存/恢复 Codex Gateway binding 的 service 方法。
- preload 增加对应 API。
- `SettingsCodexPanel` 增加 Gateway mode 开关和 provider 选择。

完成标准：

- 不需要去 Gateway 页点击 `Apply Codex Binding`，也能完成 Codex 走 Gateway。
- direct / gateway 两种模式切换可恢复。

### P3. 引入 Codex scope route

目标：

- Codex 保存模型时，Gateway 可以按该 scope 的绑定稳定转发。

改动：

- `AiGatewayModelRoute.source` 增加 `codex-scope`。
- `provider-registry` 支持按 Codex route 解析，或在 Codex binding 下生成明确 model route。
- Gateway 保存时保留 manual route，只重建 codex-scope route。

完成标准：

- Codex 模型配置变化后，Gateway route 明确同步。
- 删除/禁用 provider 时能发现受影响的 Codex scope。

### P4. Gateway 页关系总览与删除保护

目标：

- Gateway 页面从“孤立 provider 编辑器”变成“流量关系总览”。

改动：

- `SettingsAiGatewayPanel` 展示 Claude profile / Codex scope 使用关系。
- 删除 provider 时弹出影响确认。
- provider 列表显示使用标签。

完成标准：

- 用户能从 Gateway 页看到“谁正在使用这个 provider”。

### P5. 清理高级全局接管语义

目标：

- 降低 `Apply Binding` 的误用概率。

改动：

- 重命名按钮和文案。
- 把全局接管放到高级折叠区。
- 文档说明推荐使用模型页的 profile/scope 级 Gateway。

完成标准：

- 普通用户路径是“模型页选择是否走 Gateway”。
- 高级用户仍可做全局接管/恢复。

## 10. 技术落点

### Shared

- `src/core/shared/types.ts`
  - 扩展 `AiGatewayModelRoute.source`。
  - 增加 Codex Gateway binding 类型。
  - 如需要，扩展 `AppConfig`。

### Main

- `src/core/electron/main/codex-config.ts`
  - 保持 Codex scope 读写权威。
  - 不直接耦合 renderer 状态。
- `src/core/electron/main/ai-gateway/gateway-service.ts`
  - 增加 Codex scope binding 保存/恢复。
  - 保存 Gateway config 后检查失效绑定。
- `src/core/electron/main/ai-gateway/gateway-config.ts`
  - 规范化新增 route source。
- `src/core/electron/main/ai-gateway/provider-registry.ts`
  - 支持新的 route source 或显式处理 codex scope route。
- `src/core/electron/main/ipc/registerAiGatewayIpcHandlers.ts`
  - 增加 Codex scope binding API。

### Preload

- `src/core/electron/preload/invokeApi.aiGateway.ts`
  - 暴露 Codex Gateway binding 读写。

### Renderer

- `src/core/renderer/pages/settings/SettingsCodexPanel.tsx`
  - 增加 Gateway 摘要、开关、provider 选择。
- `src/core/renderer/pages/settings/SettingsAiGatewayPanel.tsx`
  - 增加关系总览和删除保护。
- `src/core/renderer/lib/`
  - 增加 Codex/Gateway 展示 helper。
- `src/core/renderer/i18n/messages/settings.ts`
  - 补齐新文案。

## 11. 验证计划

### 11.1 单元测试

- Codex provider -> Gateway provider 转换。
- Gateway provider -> local-router Codex provider 生成。
- Codex scope binding 规范化。
- `codex-scope` route 保留/重建逻辑。
- provider 删除时影响分析。

### 11.2 主进程集成测试

- Windows native Codex scope 保存 direct 配置。
- WSL Codex scope 保存 direct 配置。
- 开启 Codex Gateway 后 `.codex/config.toml` 写入 `local-router`。
- 关闭 Codex Gateway 后恢复 direct snapshot。
- Gateway provider 被禁用后，Codex binding 不静默 fallback。

### 11.3 Renderer 手工验证

1. 修改 Codex model/provider，不开启 Gateway，确认出现“Gateway 不会自动同步”提示。
2. 开启 Codex Gateway，选择 provider，保存后确认 Codex config 指向 `local-router`。
3. 发起 Codex 请求，在 Agent Logs 中确认 provider/model 与 UI 摘要一致。
4. 修改 Gateway provider baseUrl，确认 Codex tab 摘要更新。
5. 删除被 Codex 使用的 Gateway provider，确认弹出影响提示。
6. Claude profile 级 Gateway 原有行为不回退。

## 12. 风险与控制

### 12.1 风险：自动同步导致意外改写用户配置

控制：

- P1 只做提示。
- P2 开始同步前必须有显式开关。
- 每次从 direct 切到 Gateway 前保留 direct snapshot。

### 12.2 风险：多个 Codex scope 互相覆盖

控制：

- 所有 Codex Gateway binding 必须按 `getCodexScopeCacheKey(scope)` 分组。
- 不再只用 `clientBindings.codex` 表达所有 Codex scope。

### 12.3 风险：Gateway route fallback 掩盖错误

控制：

- Codex/Claude 绑定指向的 provider 不存在或 disabled 时，显示错误并阻止保存或启动。
- 不自动 fallback 到 active provider。

### 12.4 风险：UI 过于复杂

控制：

- 普通路径只显示：Direct / Gateway、provider、model、保存。
- provider id、model map、global takeover 放在 Gateway 高级区。

## 13. 推荐最终体验

用户只需要理解两个层级：

```text
Agents / Models：我想让 Claude 或 Codex 用什么模型
Gateway：我是否要把请求代理到本地网关，以及网关再转发到哪里
```

推荐使用路径：

1. 在 `Agents / Models` 里配置 Claude/Codex 的模型。
2. 如果要统一走本地协议代理，在同一个模型页打开“通过 AI Gateway”。
3. 选择 Gateway provider。
4. 保存后页面明确显示下一次请求的最终连接路径。
5. 只有需要新增上游、改协议或改 model map 时，才进入 `Gateway` 页面。

这样可以保留 Gateway 的高级能力，同时让普通用户不再遇到“模型改了，但 Gateway 还是旧配置”的困惑。
