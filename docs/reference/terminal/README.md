# 终端体系分析：Ctrl+J 终端集合面板全流程

本目录分析 Workbench 终端体系（Ctrl+J 终端集合面板）的完整链路：**开启终端 → 运行/检测终端 → 关闭终端**，作为优化该体系的事实基线。所有结论以 2026-10-18 仓库代码为准，关键结论均带 `file:line` 引用。

> 术语提醒：本文中的「终端」指 Ctrl+J 面板管理的**托管进程 + xterm 视图**（primary / run / script / float / toolbox 五种 kind），不包含 AI Runtime 的 tmux 会话（另一个子系统，仅在清单检测处交汇）。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [flow-open.md](./flow-open.md) | 开启流程：5 类入口、快捷键判定、新建终端的完整时序（含主进程后端决策树） |
| [flow-close.md](./flow-close.md) | 关闭流程：两级关闭语义、按 kind 分发、主进程停止时序与应用退出清理 |
| [flow-detect.md](./flow-detect.md) | 检测流程：进程清单轮询、三态数据源聚合、状态点与启动中占位 |
| [optimization.md](./optimization.md) | 基于以上分析整理的优化建议（按优先级，含改法与落点） |

## 1. 体系总览

```
┌───────────────────────────── Renderer ─────────────────────────────┐
│ 入口层                                                            │
│  Ctrl+J 键盘（capture 阶段）  右键上滑手势  首页工具条              │
│  code chrome 按钮            跨页面 useOpenProjectTerminal          │
│       │ AppGlobalEffects.tsx / useMouseGestureNavigator.ts         │
│       ↓                                                          │
│ Store（Zustand）                                                    │
│  appStore.terminalCollectionSlice.ts   面板显隐/几何/激活/占位      │
│  appStore.processSlice.ts              进程状态/输出缓冲/水合       │
│       │ preload bridge（invokeApi.core.ts / invokeApi.runtime.ts）  │
└───────┼────────────────────────────────────────────────────────────┘
        │ IPC
┌───────┼───────────────────── Main ──────────────────────────────────┐
│       ↓                                                          │
│ ProcessManager（runner.ts）  进程 Map / 事件出口 / 停止时序         │
│  ├─ wsl-pty     node-pty + wsl.exe                                 │
│  ├─ direct-pty  node-pty（cmd/powershell 或 /bin/bash）            │
│  ├─ tmux        node-pty + wsl tmux attach-or-create               │
│  └─ spawn       child_process（无 pty 兜底）                        │
│       │ process:output / process:status / process:exit（webContents）│
│       ↓ 回流                                                       │
│ RuntimeService.listTerminalInventory（清单查询，可能查 WSL/tmux）   │
└───────────────────────────────────────────────────────────────────┘
```

面板本身是**全局层**：`TerminalCollectionLayer` 挂在 `App.tsx` 的 Router 内、Routes 外（`App.tsx:71`），`position: fixed`、`zIndex: 9000`，不参与文档流，任何路由下都在。

## 2. 进程 key 模型（贯穿全链路的主键）

进程 key 是终端体系的唯一主键，约定在 `shared/terminals.ts` 顶部注释，主进程 renderer 共用：

| key 形态 | kind | 所有者 | 说明 |
| --- | --- | --- | --- |
| `<projectId>` | primary | 项目 dev 启动 | 主 dev 进程，一个项目一个 |
| `<projectId>::toolbox` | toolbox | AI Commit | 默认隐藏，只读不提供关闭 |
| `<projectId>::run::<taskId>` | run | 运行任务调度器 | 生命周期归 scheduler |
| `<projectId>::script::<n>` | script | 脚本通道 | 独立实例 |
| `<projectId>::float::<n>` | float | Ctrl+J 交互 shell | 集合面板新建的终端 |

解析入口 `parseTerminalProcessKey`（`shared/terminals.ts:27`），无法识别返回 null（聚合时丢弃）。`::float::` 序号由 renderer 模块级高水位 + 主进程清单共同保证只增不减（`appStore.terminalCollectionSlice.ts:52`）。

## 3. 核心不变量（优化时不能破坏）

1. **面板隐藏 ≠ 杀进程**。面板 × / Ctrl+J 收起只置 `floatingPanel.hidden`，会话继续跑（可在 设置 → 日志 查看）。终端列表 × 才按 kind 停止进程。见 [flow-close.md](./flow-close.md)。
2. **进程运行态以主进程清单为权威**。`terminalInventory` 来自 `terminal:list-all` 轮询；store 只持有面板显隐/几何/激活态与 float 启动/标题覆盖（`appStore.terminalCollectionSlice.ts:14`）。
3. **进程 key 高水位只递增不复用**，避免与主进程保活会话撞 key 导致 start 失败。
4. **run 任务生命周期归 scheduler**：集合面板的「停止」对 run kind 转发 `stopRunTask`，不直接杀进程。
5. **toolbox 只读**：可显示（Eye 开关），不提供关闭按钮。
6. **Windows/WSL 双路径**：每个进程显式解析 `useWsl`（`resolveProcessUseWsl`），集合终端永远走托管 pty 的 `silent` 模式，不跟随项目 `runStartupMode`。

## 4. 数据流全景（一次「在项目里按 Ctrl+J」）

1. 快捷键命中（capture 阶段，`AppGlobalEffects.tsx:414`）→ `toggleTerminalCollection(contextProjectId)`。
2. 面板隐藏中 → 唤醒：目标项目 = 上下文项目 ?? 上次激活 ?? 最近打开；该项目无终端则直接新建 float 终端。
3. 新建走 `addCollectionTerminal`：解析交互 shell 命令 → 分配 `::float::<n>` key → 乐观占位（pending）→ `startProject(..., 'silent')` → IPC `process:start`。
4. 主进程 `ProcessManager.start` 按 `useWsl`/`capability.backend`/路径形态选后端 spawn，注册 data/exit 回调，回发 `process:status: running`。
5. xterm 挂载 `Terminal` 组件，回放 store 输出缓冲；`onData → sendInput`，`onResize → process:resize → pty.resize`。
6. 面板可见期间 5s 轮询 `terminal:list-all`，`setTerminalInventory` 收敛占位、驱动列表与状态点。
7. 关闭：面板级（隐藏保活）或终端级（按 kind 停止，`ProcessManager.stop`：Ctrl+C → 1500ms SIGTERM → 3500ms 安全网）。

每步的细节、序号、异常分支见对应流程文档。

## 5. 关键文件地图

### Renderer

| 文件 | 职责 |
| --- | --- |
| `app/AppGlobalEffects.tsx` | Ctrl+J 快捷键监听（capture）、右键手势事件、进程事件全局订阅（output/status/exit → store） |
| `hooks/useOpenProjectTerminal.ts` | 跨页面入口：`revealTerminal(projectId, processKey)` 直接唤起聚焦，不跳路由 |
| `components/terminal-collection/TerminalCollectionLayer.tsx` | 面板层：挂载/轮询/跨页面聚焦请求消费 |
| `components/terminal-collection/TerminalCollectionPanel.tsx` | 面板 UI：项目 tab、终端列表、停靠/缩放、右键菜单、停止确认 |
| `components/terminal-collection/TerminalCollectionProjectPicker.tsx` | header 加号「加入项目」选择卡片 |
| `components/Terminal.tsx` | xterm 单终端视图：主题、fit、输入、剪贴板、输出缓冲回放 |
| `lib/terminalCollectionModel.ts` | 纯函数聚合：清单+占位+状态 → 「项目组 → 终端项」两级模型 |
| `stores/appStore.terminalCollectionSlice.ts` | 面板状态机：toggle/reveal/add/stop/rename/几何持久化 |
| `stores/appStore.processSlice.ts` | 进程动作：startProject/stopProject/sendInput/appendOutput/syncManagedProcesses |
| `lib/routeProjectContext.ts` | `/project/:projectId` → 上下文项目 id |

### Shared / Preload / Main

| 文件 | 职责 |
| --- | --- |
| `shared/terminals.ts` | 进程 key 解析、title 推导、项目排序/搜索纯函数 |
| `shared/types.ts:1541` | `ManagedProcessSnapshot` / `TerminalProcessInventory` / `FloatingTerminalPanelState` |
| `electron/preload/invokeApi.core.ts` | `startProcess/stopProcess/sendInput/resizeTerminal` |
| `electron/preload/invokeApi.runtime.ts` | `listTerminalProcesses/listManagedProcesses/stopAllTerminalProcesses` 等 |
| `electron/preload/subscriptions.ts` | `onProcessOutput/onProcessStatus/onProcessExit` 扇出订阅 |
| `electron/main/runner.ts` | `ProcessManager`：进程 Map、四种后端、停止时序、退出清理 |
| `electron/main/ipc/registerCoreIpcHandlers.ts` | `process:start/stop/input/resize` handler |
| `electron/main/ipc/registerRuntimeIpcHandlers.ts` | `terminal:list-all/list-managed/stop-all` handler |
| `electron/main/runtime/runtime-service.ts:300` | `listTerminalInventory`（合并托管进程 + runtime/tmux 会话） |
| `electron/main/run-tasks/run-task-scheduler.ts` | run kind 进程的启动/停止/就绪判定 |
| `electron/main/config.ts:817` | `normalizeFloatingPanel`：面板几何 normalize（旧 free 停靠迁移 bottom） |

### 测试

- `test/shared/terminals.test.mjs`：key 解析与 title 推导。
- `test/renderer/terminalCollectionModel.test.mjs`：聚合模型（分组/排序/占位/同名序号）。

## 6. 阅读顺序建议

先读本文建立 key 模型与不变量，再按「开启 → 检测 → 关闭」读三个流程文档，最后看 `optimization.md` 的发现与建议。优化落地前建议对照 `AGENTS.md` 的架构红线（renderer 不得直连 main、进程 key 规则不得破坏等）。
