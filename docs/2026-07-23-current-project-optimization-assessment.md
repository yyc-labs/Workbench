# 当前项目优化评估与建议（2026-07-23）

> 状态：建议稿，尚未实施。
>
> 范围：对 `src/core`、`test/`、`package.json`、CI 配置和已有优化计划的只读评估。本文不重复已经完成的 IPC 契约收敛、Learning Center 第二阶段、基础 typecheck/test 门禁等工作；工作区中已有的未提交 Learning / Code 改动不在本文的评估结论范围内。

## 结论

项目已经从早期的单体 Electron 应用走到较清晰的分层形态：IPC 已按 domain 注册，preload 与 renderer 共享 `ElectronApi` 契约，Zustand 已按业务 slice 拆分，`npm run verify` 和 Windows CI 也覆盖了类型检查与 Node 测试。下一轮的目标不应是全仓“再拆一次”，而应优先降低三类真实风险：

1. **用户配置可靠性**：配置损坏、迁移和并发保存的恢复能力；
2. **AI Gateway 协议回归风险**：流式协议转换继续堆积在单一入口后的可验证性；
3. **高频改动面的耦合度**：主进程启动编排、Code 工作区和 shared 类型的局部职责边界。

推荐按以下优先级推进：

| 优先级 | 建议 | 主要收益 | 建议落点 |
| --- | --- | --- | --- |
| P0 | 配置存储的原子写入、损坏备份和迁移测试 | 避免设置/项目数据因异常被静默退回默认值或覆盖 | `main/config` + 纯 migration helper + tests |
| P0 | AI Gateway 流式处理二次拆分与协议矩阵测试 | 降低协议改动牵动 2600+ 行入口的回归风险 | `main/ai-gateway/` + `test/electron/` |
| P1 | 主进程启动与生命周期编排收口 | 让 `main/index.ts` 回归装配职责，降低初始化顺序风险 | `main/bootstrap`、`main/lifecycle` |
| P1 | shared 类型按 domain 拆分、保持兼容出口 | 降低跨领域冲突与 IPC 契约维护成本 | `shared/types/` 或 domain type files |
| P1 | Code 工作区按交互边界继续下沉 | 降低编辑器、Markdown、文件树联动的修改面 | `renderer/pages/code/` |
| P2 | 把格式/静态检查纳入轻量质量门禁 | 尽早发现格式、可疑代码和导入问题，不增加 build 成本 | `package.json`、GitHub Actions |
| P2 | 为关键用户流补最小交互级回归覆盖 | 覆盖纯函数测试无法发现的 IPC/UI 装配问题 | 先测试 harness，再按需补 smoke test |

## 评估依据

本次扫描的主要事实如下：

- `src/core/electron/main/ipc/registerIpcHandlers.ts` 已仅做 domain handler 装配，符合当前架构规则。
- `src/core/shared/electronApi.ts` 已是 preload/renderer 共享的 API 契约；这是新增 IPC 能力时应继续坚持的基础。
- `test/` 中已有 AI Gateway、配置、运行环境、文件操作、Markdown 解析等 Node 测试；GitHub Actions 在 Windows 上执行 `npm ci` 和 `npm run verify`。
- `src/core/electron/main/ai-gateway/gateway-server.ts` 约 2677 行。现有 `gateway-http`、`gateway-routes`、`gateway-upstream`、`gateway-trace` 和 request handler 的首轮拆分已完成，但流式累积、协议转换与部分日志细节仍集中在该文件。
- `src/core/electron/main/config.ts` 约 1080 行，同时承担默认值、兼容迁移、归一化、读取、缓存与保存职责；`src/core/shared/types.ts` 约 1800 行，包含多个不相邻 domain 的模型。
- `src/core/electron/main/index.ts` 约 573 行，除服务装配外还承担窗口、托盘、快捷键、二次启动、关闭清理和 transcript capture 生命周期。
- Code 区域仍是 renderer 的高触达热点：`CodeWorkspacePanel.tsx`、Markdown parser / renderer、explorer state hook 均体量较大。这里已有纯逻辑测试，是继续小步收口的良好基础。
- 当前 Biome 配置以 formatter 为主；仓库要求改代码后格式化，但 `package.json` 和 CI 没有显式的 `biome check` 入口。

行数只用来寻找热点，不是拆分依据。下面每项均以职责、数据边界和可验证性作为是否实施的判断标准。

## P0：先保护配置数据与升级路径

### 现状与风险

`config.ts` 在读取时把 JSON 解析、旧字段兼容、各类 AI / Runtime / Browser 配置归一化混在一起。读取异常会进入兜底分支并在内存中使用默认配置；随后一次正常保存可能将原本仍在磁盘上的异常文件内容覆盖掉。当前顺序写入队列能避免同进程内的写入乱序，但 `writeFile` 直接写目标文件，进程中断或存储异常时缺少明确的恢复路径。

这不是建议“为了整洁而拆文件”，而是用户项目列表、运行配置和密钥相关设置都依赖该文件，出错后的影响面很大。

### 建议的最小改造

1. 将每个 domain 的 `normalizeXxx`、默认值和旧版本迁移拆到 `main/config/` 的纯函数模块；`config.ts` 只保留读取、组合迁移、缓存和持久化边界。
2. 引入显式配置版本号和一次性迁移链；迁移函数输入/输出均为 plain object，不读取 Electron、文件或全局单例。
3. 保存时使用同目录临时文件写入、`rename` 替换，并保留最近一次可解析配置的备份。实现前需确认 Windows 上的替换语义并为失败路径补测试。
4. JSON 无法解析时，保留原文件并创建带时间戳的诊断备份；向 renderer 返回可本地化的“配置已恢复为默认值、原文件未删除”的状态，而不是静默吞掉异常。
5. 为迁移和恢复建立 fixture 测试：旧配置、字段缺失、未知字段、截断 JSON、写入失败、连续 update 的最后写入胜出。

### 边界与验收

- 密钥继续只走当前既有的安全存储边界；本项不扩大 renderer 的文件访问权限。
- 保留 `loadConfig()` / `updateConfig()` 外部契约，调用点无需同步大改。
- 人为提供损坏 JSON 后，原始文件不会被自动删除或覆盖；产品能明确说明恢复状态。
- 任意历史 fixture 升级后都满足 `AppConfig` 的不变量，新增迁移必须同时添加 fixture。

## P0：完成 AI Gateway 的“流式路径”二次收口

### 现状与风险

Gateway 已经有良好的第一轮模块边界，但最大入口仍同时处理 Chat、Responses、Anthropic 的 SSE 解码、增量聚合、tool call 还原、协议事件转换、日志快照和错误收尾。该区域的困难不在 HTTP 路由，而在“同一个流式事件既影响下游输出、最终结果、工具校验和审计日志”。继续往 `gateway-server.ts` 加 provider 或协议分支，会让一次改动很难得到局部证明。

### 建议的拆分边界

| 模块 | 只负责 | 不负责 |
| --- | --- | --- |
| `gateway-stream-proxy.ts` | 上游响应读取、SSE/JSON passthrough、断开与 abort 收尾 | 具体协议字段转换 |
| `gateway-chat-stream-conversion.ts` | Chat 增量到 Anthropic / Responses 事件的转换与状态机 | 网络请求、recent log 持久化 |
| `gateway-stream-accumulators.ts` | 文本、usage、tool call / tool input 的累积与最终快照 | 写响应、选择 provider |
| `gateway-stream-observability.ts` | trace 更新、限制/脱敏后的请求与响应摘要 | 修改业务事件或协议内容 |

入口类只保留 server 生命周期、依赖注入、请求分发和对上述模块的装配。先移动无副作用 accumulator，再移动单协议 conversion，最后抽 raw proxy；每一步只允许保持既有响应字节和日志语义不变。

### 测试策略

按“入站协议 × 上游协议 × 是否流式 × tool 场景”建立小型测试矩阵，而不是继续扩张单个集成测试：

- Chat → Chat passthrough、Chat → Anthropic、Chat → Responses；
- Responses → Responses passthrough、Responses → Chat downgrade；
- Anthropic → Anthropic passthrough，以及支持范围外的明确错误；
- 普通文本、多个 tool call、分片 JSON arguments、usage、上游 abort、非法 SSE、客户端取消。

每个 case 至少断言：下游事件序列、最终非流式快照、trace/错误码。敏感 token 和完整 prompt 只能以既有的截断/脱敏口径写入 fixture。

### 验收

- `gateway-server.ts` 不再包含协议专属的增量累积实现。
- 现有 Gateway adapter / passthrough 测试全部保留并通过；新增矩阵覆盖流式终止与工具调用边界。
- 新增 provider 或 conversion 时，主要改动位于一个协议模块和对应测试，而非入口服务。

## P1：把主进程入口收敛为真正的装配层

### 现状

`main/index.ts` 的服务创建本身合理，但它同时直接管理窗口创建、窗口显示策略、托盘菜单、快捷键、二次启动、退出清理和 transcript capture 的异步状态。这会使启动顺序、销毁顺序和 Electron event listener 的测试/审查难度随功能增加而上升，也与仓库“入口只保留装配职责”的目标逐渐偏离。

### 建议

不建议一次性重写入口。按以下顺序抽离：

1. `main/appServices.ts`：构建 service graph，显式声明依赖（窗口 getter、配置 getter、事件 emitter）。
2. `main/appLifecycle.ts`：注册 `whenReady`、`before-quit`、`activate`、`window-all-closed`，为启动/关闭提供可 await 的有序步骤。
3. `main/transcript-capture-controller.ts`：承接 capture window、请求版本号、焦点和剪贴板降级逻辑。
4. `main/tray-controller` 保持为窗口可见性和菜单的单一责任，不让业务 service 直接感知 tray。

应使用依赖注入和小范围的 `dispose()`，不要把 Electron 全局对象引入 shared 或 renderer。`index.ts` 最终只创建依赖、调用 bootstrap、注册最外层进程策略。

### 验收

- 启动失败时可识别已初始化资源并按逆序清理；退出逻辑不会因某一个可选 service 失败而跳过其余清理。
- transcript capture 的“重复快捷键、窗口提前关闭、异步剪贴板返回”保持现有行为，并有 controller 级测试。
- 不改变 Windows 托盘、macOS 生命周期或 WSL/Runtime 选择语义。

## P1：收口 shared 类型与 Code 工作区的高频改动面

### shared 类型：按 domain 拆文件，维持单一导入入口

`shared/types.ts` 已汇集项目、运行时、Gateway、Git、Transcript、Learning、Browser AI 等模型。它是正确的依赖层，但单文件会放大多人修改冲突，也难以判断某个 IPC 改动的真实契约范围。

建议按稳定 domain 拆分为例如 `shared/types/project.ts`、`runtime.ts`、`gateway.ts`、`git.ts`、`transcript.ts`、`learning.ts`，并由 `shared/types.ts` 只做 re-export。分批迁移，保留旧 import 路径，避免把“整理类型”变成大范围功能重构。第一批优先迁出本次会触及的 domain；只有出现真实冲突再继续扩展。

### Code 工作区：从交互边界而不是组件行数继续下沉

Code 区已有 parser 测试和多个页面私有 hook，说明方向正确。建议后续变更遵循以下界线：

- 文件树展开、刷新和路径操作继续归 explorer state；
- 编辑器模型、脏状态、保存冲突和 cursor session 归 document session；
- Markdown 渲染、表格/图表/媒体的纯转换保持独立且可直接 Node 测试；
- 视图模式、快捷键和面板布局留在 workspace 编排层。

当新增 Code 功能跨越这些界线时，先定义输入/输出类型和测试，再修改 `CodeWorkspacePanel`。不建议仅为降低行数而继续搬 JSX，也不建议把编辑器临时状态塞入全局 store。

## P2：把现有工程约束变成可自动验证的信号

### 轻量静态检查

仓库已要求每次代码改动后使用 Biome 格式化，且 CI 当前不跑 build，这个方向应保持。可先新增显式的 `check:style` 命令（基于仓库锁定版本的 `biome check`），本地与 CI 都只检查源码和测试。

建议采用两阶段落地：先在 CI 以非阻断报告或只检查改动文件运行，解决已有基线问题后再转为阻断门禁。不要在这一项中引入新的 lint 依赖、不要把 build 纳入默认验证。

### 最小交互级回归测试

当前 Node 测试对纯逻辑和主进程服务的覆盖不错，但很难证明“renderer action → preload 契约 → IPC handler 装配”的整体连通性。可先不引入完整 E2E 框架，而建立可替换依赖的 smoke harness，覆盖以下高风险链路：

1. 进程启动时 `useWsl` 从 renderer store 到 main runner 未被丢失；
2. Learning / Browser AI 的保存能力遵循 shared → IPC → preload 的同一契约；
3. Gateway 的启动、停止和日志读取不会绕过 shared API。

若这些 harness 稳定后仍有 UI 回归，再评估复用已有 `playwright-core` 或引入 Electron 专用 smoke 方案。实施前应先明确测试是否需要真实 WSL、真实浏览器或真实密钥；默认使用 fake service，避免 CI 环境依赖。

## 推荐实施顺序与停损点

1. **配置恢复与迁移测试**：先只提取 pure normalizer 和 fixture；测试锁定后再切换原子保存。若 Windows 替换语义无法可靠验证，暂停替换策略，不改变当前写入实现。
2. **Gateway accumulator / conversion 拆分**：每次只迁移一个协议路径，保留现有集成测试作为回归护栏。出现响应字节或 trace 语义变化时立即回退该小步，不与新 provider 功能混合。
3. **Main bootstrap 收口**：先抽 transcript capture controller，再抽 lifecycle；不要与 tray、Runtime 或 WSL 行为改动同批提交。
4. **shared 类型与 Code 区域**：只在实际 feature 触达相应 domain 时渐进迁移，不开全仓机械重构任务。
5. **质量门禁与 smoke harness**：先确认基线，再逐步设为阻断；继续保持默认不执行 build。

## 暂不建议投入的方向

- **再次全局重排页面视觉或大规模组件迁移**：现有痛点主要在状态/协议/持久化边界，视觉重排不能降低上述风险。
- **替换 Zustand、Electron Vite、React Router 或引入新的状态/DI 框架**：当前问题可以通过现有 slice、service factory 和纯函数测试解决，替换基础设施的迁移成本不成比例。
- **把 Runtime/WSL 路径抽象成“自动猜测”**：现有 `useWsl` 显式传递和 Windows/WSL 规则是正确约束，后续任何收口都必须保留这一参数与进程 key 语义。
- **默认加入 build / 打包门禁**：项目已明确 build 成本高；优先强化 typecheck、test 和静态检查即可。

## 交付检查清单

- [ ] 本次改动是否对应一个可观察的风险或用户价值，而非纯行数目标？
- [ ] 是否保持 `renderer → preload → main → service` 与 `shared` 单向依赖？
- [ ] 是否保留 `useWsl`、Runtime profile 和进程 key 的既有契约？
- [ ] 是否为配置迁移、协议转换或纯转换函数补了 fixture/单元测试？
- [ ] 是否只格式化本次实际修改的代码文件，并检查未覆盖工作区的无关改动？
- [ ] 验证是否至少覆盖相关 `typecheck` / `test`，且未默认执行 build？
