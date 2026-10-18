# 优化建议：终端体系（基于全流程分析）

本文是 [flow-open](./flow-open.md) / [flow-close](./flow-close.md) / [flow-detect](./flow-detect.md) 分析的产出，按优先级排列。每项含：问题、证据、影响、建议改法、落点、风险。

## P0 — 功能性缺陷

### O1. 面板几何「只写不读」：dock/sizeRatio 重启后丢失

- **证据**：`terminalCollectionSlice.ts:29/38` 把 `floatingPanel` 写入 `config.floatingPanel`（含 300ms 防抖与立即落盘两条路径）；`config.ts:817` `normalizeFloatingPanel` 也认真 normalize 了；但 store 初始值在 `terminalCollectionSlice.ts:110` 硬编码 `{ dock: 'bottom', sizeRatio: 0.35, hidden: true }`，`initSlice.ts:88` 的 `set({ config, ... })` 与 `loadConfig`（`:136`）**都没有把 `config.floatingPanel` 水合回 store**。
- **影响**：用户切换停靠（左/右/上）或拖动缩放后，重启应用（甚至 Ctrl+R 刷新 renderer）几何回默认。`hidden` 默认 true 恰好让「重启后面板收起」符合直觉，所以 bug 只暴露在几何上，容易漏测。
- **建议**：`initApp` set config 时补 `floatingPanel: { ...默认, ...config.floatingPanel, hidden: true }`（**hidden 强制 true**：重启/刷新后收起是预期语义，避免恢复出一个盖住工作区的面板）；或产品若希望恢复展开，则全量水合并在 Layer 侧处理。`loadConfig` 同样处理。
| **风险**：低。注意 `persistFloatingPanelNow` 的注释场景（Ctrl+R 防复活）在 hidden 强制 true 后依然成立。

## P1 — 检测体系（flow-detect 的直接产出）

### O2. 轮询改事件驱动：进程清单变化即时推送

- **证据**：Layer 5s 轮询 `terminal:list-all`（`TerminalCollectionLayer.tsx:36`），且该接口可能查 WSL/tmux 耗时数百毫秒（`registerRuntimeIpcHandlers.ts:71` 注释）；退出到列表消失延迟 0–5s；占位收敛延迟 0–5s。
- **建议**：
  1. 主进程 `ProcessManager` 在进程 Map 变化处（`finalizePtyStart` 注册成功、`pty.onExit`/`child.on('exit')`/`child.on('error')` 清理、`stop` 的安全网清理）广播轻量事件 `terminal:inventory-changed`（payload 直接带 `listManagedProcesses()` 快照，零查询成本）。
  2. renderer Layer 订阅该事件 → `setTerminalInventory`；轮询降级为兜底（30–60s）或直接取消（打开时 refresh + 事件推送已覆盖）。
  3. 新增 channel 走 `shared` 常量 + preload subscriptions，三侧契约同步。
| **收益**：退出即时消失、占位即时收敛、去掉高频重量级 IPC、隐藏期间零成本。
| **风险**：中。多窗口场景下 `send` 只发 `outputWindow`（`runner.ts:671`），事件广播语义需确认（至少主窗口）；WSL 路径的 pty 退出事件本身可能有延迟（wsl.exe 桥接），事件驱动不改变该固有延迟。

### O3. 轮询期间改用轻量通道

- **证据**：`terminal:list-managed` 已存在（只读 Map，`registerRuntimeIpcHandlers.ts:71`），目前只有 `addCollectionTerminal` 用；面板轮询和设置页都用重量级 `list-all`。
- **建议**：面板轮询（或 O2 的兜底轮询）换 `listManagedProcesses`；`list-all` 留给设置页（它要 runtimeSessions/tmuxSessions）。
| **风险**：低。集合面板本来就只消费 `managedProcesses`。

### O4. 轮询失败不清空清单

- **证据**：`TerminalCollectionLayer.tsx:32` catch 后 `setTerminalInventory([])`。
- **影响**：IPC 瞬时失败（主进程繁忙）把面板打成「全部终端消失」空态，下次轮询才恢复，用户视角是「终端全掉了」惊吓。
- **建议**：catch 保持旧清单 + 连续失败计数，超阈值（如 3 次）才清空或提示。
| **风险**：低。

### O5. 退出即时一致（O2 的轻量替代）

- 若暂不做事件驱动，可在 `handleProcessExit`（`processSlice.ts:167`）同步从 `terminalInventory` 移除该 key（乐观一致），把 0–5s 的「已退出仍显示运行中」压到 0。
| **风险**：低，但要注意与轮询快照的竞态（移除后轮询又带回旧快照——所以 O2 才是根治）。

## P1 — 关闭与进程卫生

### O6. 停止安全网只清状态、不补杀 → 孤儿进程

- **证据**：`runner.ts:230` `stop()` 的 3500ms 安全网定时器只清理 Map 并补发事件；若 Ctrl+C 被前台程序吞掉且 SIGTERM 也被忽略，pty 子进程成为孤儿（设置页清单里看不到、任务管理器里有）。
- **建议**：安全网触发时（说明宽限+强杀都失败）补一次 `killProcessTreeImmediate(pid)`（该函数已存在，`runner.ts:308`，win32 taskkill /t /f，POSIX 杀进程组），并 `console.warn` 记录（当前安全网触发无任何日志，排障困难）。
| **风险**：低。补杀只发生在「本就要杀但杀不掉」的路径。

### O7. stopPty 宽限期可观测

- **证据**：`runner.ts:647` Ctrl+C → 1500ms SIGTERM，全程无日志。
- **建议**：`stopping` 进入与退出各一行 debug 日志（或至少安全网/强杀路径），方便用户报「终端关不掉」时定位是哪种后端、哪个 pid。
| **风险**：无。

## P2 — 渲染与交互

### O8. Terminal 回放全量输出缓冲

- **证据**：`Terminal.tsx` 挂载时把 `terminalOutputs[processKey]`（上限 120k 字符，`appStore.helpers.ts:5`）整份 `term.write`；xterm `scrollback` 只 200 行（`Terminal.tsx:68`），回放内容绝大部分落在 scrollback 之外被裁掉。
- **影响**：切换终端有一次全量 parse+write 开销（120k 字符约几 ms～几十 ms 量级），且「回放」体验与 scrollback 能力不一致。
- **建议**：二选一——(a) 回放只写尾部（如最后 20–30k 字符）并保持 scrollback 200；(b) 若产品要「切回来还能往上翻」，提高 scrollback 到 1000+ 并接受切换开销。建议 (a)：面板是「看一眼」语义，长历史应去日志文件。
| **风险**：低。

### O9. float key 高水位放在 renderer 模块级

- **证据**：`terminalCollectionSlice.ts:52` `floatKeyHighWater` 是模块级变量；renderer 重载（Ctrl+R）后重置为 -1，只能靠分配时查 `listManagedProcesses` 兜底（`:194`），若主进程尚未把新进程注册进 Map（启动窗口期）仍可能撞 key → `start` 返回 false → 占位被撤。
- **建议**：高水位挪到主进程（ProcessManager 内维护 `floatKeyHighWaterByProject`，`start` 时对 float key 自动分配或校验），renderer 只传项目 id。彻底消除窗口，同时简化 renderer 逻辑。
| **风险**：中。需要改 IPC 契约（processKey 由主进程分配并返回），shared 类型同步；或折中——主进程提供 `allocateFloatKey(projectId)` 轻量 IPC。

### O10. resize 两级 80ms 防抖级联

- **证据**：`Terminal.tsx` ResizeObserver → 80ms 后 `fitAddon.fit()`；`term.onResize` → IPC → `ResizeController`（80ms）→ `pty.resize`（`resize-controller.ts:3`）。级联最坏 160ms，pty 尺寸滞后于视觉。
- **建议**：fit 完成后直接把 `{cols, rows}` 随 resize IPC 发出，主进程 `ResizeController` 防抖降至 30ms 或取消（IPC 本身已是合帧后的低频事件）。
| **风险**：低。注意 Windows ConPTY 高频 resize 有抖动报告，别完全取消防抖。

### O11. Terminal 组件 prop 语义重载

- **证据**：`TerminalCollectionPanel.tsx:323` `<Terminal projectId={activeTerminal.processKey} />`——prop 名叫 projectId，实际传的是进程 key（float/script key 与 projectId 不同形）。组件内部全部按 key 用（订阅、sendInput、resize）。
- **建议**：纯重构改名 `processKey`，与进程 key 模型对齐，减少新读者误解。`Terminal.tsx` 无单测，改名注意全局引用（仅面板一处使用）。
| **风险**：低。

## P3 — 测试与可观测

### O12. 关键纯逻辑补测试

- 现有：`test/shared/terminals.test.mjs`（key 解析/title）、`test/renderer/terminalCollectionModel.test.mjs`（聚合）。
| 缺口建议：
  1. `allocateFloatProcessKey`：高水位递增、清单顶高、跨项目隔离。
  2. O6 安全网补杀后的行为（`runner.ts` 已有 `runner-windows-start.test.mjs`，可扩展 stop 时序：Ctrl+C 写入、SIGTERM 延时、安全网清理）。
  3. O1 水合后的 `initApp`（参考 `init-app-wsl-lazy.test.mjs` 的 stub 模式）。
| 4. O2 事件广播后 Layer 的收敛行为。

### O13. 运行时可观测

- 面板无「为什么这个终端起不来」的聚合视图：start 失败只把 Error 写进该终端输出（`runner.ts:192`）。
| 建议：`process:status: error` / exit code≠0 时，列表项 title 旁加警告图标 + tooltip 显示 error 文案（`handleProcessExit` 已存 `error` 字段，模型层透出即可）。
| **风险**：低，需要模型层加字段 + i18n。

## 不建议做（避免过度优化）

1. **不要把面板改成 keep-alive 缓存 xterm 实例**。「隐藏即卸载、输出进 store buffer、回来回放」是当前保活设计的核心（`AppGlobalEffects.tsx:61` 全局订阅与面板解耦），保留组件只会增加常驻内存与主题同步复杂度。
| **不要把 float 终端全部 tmux 化**。tmux 化利于会话恢复，但引入会话命名、attach/detach 竞态、WSL 依赖；当前直接 pty + 清单保活已满足「隐藏保活」语义。
| **不要把 run 任务改成面板直接 stop**。scheduler 拥有生命周期（依赖连锁、端口观察、stop 命令）是明确边界，面板只转发。
| **不要为「检测」引入 WebSocket/长连接**。事件推送（O2）+ 低频兜底足够；IPC 已是进程内通道。

## 建议落地顺序

```
第一批（低风险高收益）：O1 水合 → O4 失败不清空 → O6/O7 安全网补杀与日志 → O8 回放尾部
第二批（检测重构）：O2 事件驱动 + O3 轻量通道（可一起做，O5 作为过渡替代）
第三批（契约与重构）：O9 高水位挪主进程 → O11 改名 → O13 错误可见性 → O12/O10 收尾
```

每批落地后跑 `npm run verify`；涉及 shared 类型的改动同步 preload/renderer 三侧；涉及 runner 的改动评估 Windows/WSL 双路径。
