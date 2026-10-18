# 检测流程：进程状态如何被面板感知

「检测终端」= 面板如何知道有哪些进程、各自什么状态。体系里有**三条独立数据流**，在聚合层汇合。

## 1. 三态数据源总览

| 数据源 | 驱动方式 | 覆盖 kind | 权威性 |
| --- | --- | --- | --- |
| `terminalInventory`（store） | 面板可见时 5s 轮询 `terminal:list-all` | 全部（进程存在性） | 进程存在性权威 |
| `store.processes` | IPC 事件（status/exit）+ 启动水合 | primary/script/float | 单进程状态机权威 |
| `runTaskStates` | scheduler 进度事件 `run-task:progress`（5s reconcile 兜底） | run | run 任务状态权威 |

```
主进程 ProcessManager ──process:status/exit──▶ store.processes ──┐
run-task-scheduler ────run-task:progress───▶ runTaskStates ────┤
RuntimeService.listTerminalInventory ──5s 轮询──▶ terminalInventory ──┤
                                                              ↓
                              buildTerminalCollectionModel（纯函数聚合）
                                                              ↓
                              面板：项目 tab / 终端列表 / 状态点 / 遮罩
```

## 2. 轮询：TerminalCollectionLayer

`components/terminal-collection/TerminalCollectionLayer.tsx`：

```
hidden === true → 不轮询（effect 直接 return）
hidden === false →
   立即 refresh() 一次
   setInterval 5000ms
   refresh: listTerminalProcesses() → setTerminalInventory(data.managedProcesses)
   失败 → setTerminalInventory([])
```

`terminal:list-all`（`registerRuntimeIpcHandlers.ts:66` → `runtime-service.ts:300`）不是轻量接口：

1. `ProcessManager.listManagedProcesses()`：读内存 Map，快。
2. `shouldQueryRuntimeSessions(capability)` 为真时 `listRuntimeSessions()`：**可能查询 WSL/tmux 运行时，耗时数百毫秒以上**（handler 注释原文）。
3. 合并出 `managedProcesses` + `runtimeSessions` + `tmuxSessions` + `checkedAt`。

集合面板只消费 `managedProcesses`；`runtimeSessions`/`tmuxSessions` 给设置页用。另有一个轻量通道 `terminal:list-managed`（只读 Map，不查 WSL/tmux），目前被 `addCollectionTerminal` 分配 key 前使用。

## 3. setTerminalInventory 的占位收敛

`appStore.terminalCollectionSlice.ts:118`：

```
liveKeys = new Set(inventory.map(s => s.processId))
terminalInventory = inventory
collectionPendingTerminals = 旧的.filter(p => !liveKeys.has(p.processKey))
```

即：**轮询追上后，启动中占位自动让位给真实终端**。这是占位生命周期的终点。起点见 [flow-open.md](./flow-open.md) 的 `addCollectionTerminal`。

## 4. 聚合模型：buildTerminalCollectionModel

纯函数（`lib/terminalCollectionModel.ts:81`），输入全部由组件注入。步骤：

### 4.1 分组

- 遍历 inventory：`parseTerminalProcessKey`，解析失败丢弃；toolbox 按 `showToolbox` 过滤（默认隐藏）。
| 按 projectId 分桶。

### 4.2 项目 tab 集合

`有终端的项目 ∪ { 路由项目 } ∪ { 有 pending 占位的项目 }`。路由项目无终端也显示（空态引导新建）。

### 4.3 终端项构造（每个 snapshot）

| 字段 | 来源 |
| --- |
| kind / token | `parseTerminalProcessKey` |
| title | `resolveTerminalTabTitle` 优先级：**override（用户重命名）→ float 实例 title → run 任务名/taskId → 项目名 → 序号名**（`shared/terminals.ts:71`） |
| status | run：`runTaskStates[taskId].state ?? 'stopped'`；其它：`processes[processKey].status ?? 'running'` |
| url / warning | run 任务状态（有则列表提示） |

注意 status 兜底：清单里有但 `processes` 没有条目的进程显示 `running`——**「清单存在即视为运行中」**，这条兜底保证了水合前/跨页面启动的进程状态合理。

### 4.4 排序

- 组内：`KIND_ORDER`（run → primary → float → script → toolbox），同 kind 按 `startTime` 升序；pending 占位排末尾。
| 组间：路由项目置顶，其余按 `lastOpened` 降序（`sortProjectsByRecency`）。

### 4.5 同名序号与 runningCount

- 同名 title 自动追加 ` 2`、` 3`（`terminalCollectionModel.ts:189`）。
| `runningCount` = status ∈ {running, ready, stopping} 的计数，驱动 tab 上的绿点。

### 4.6 激活解析（组件侧）

`activeGroup` = store 激活项目 ?? 模型建议项目 ?? 第一组；`activeTerminal` = 激活 key 命中 ?? 该组第一个。`setCollectionActiveProject` 切项目时清 key，回落第一个终端。

## 5. 状态点与文案映射

`statusDotClass`（`TerminalCollectionPanel.tsx:57`）：

| status | 颜色 | 语义 |
| --- | --- |
| running / ready | success 绿 | 活着 |
| stopping / starting | warning 黄 | 过渡态 |
| failed / error | destructive 红 | 异常 |
| 其它（stopped 等） | muted 灰 | 已退出 |

run 任务的状态词汇更丰富（starting/waiting/running/ready/stopping/stopped/failed），直接透传 scheduler 状态。

## 6. store.processes 状态机（事件驱动）

`AppGlobalEffects.tsx:61` ProcessOutputListener 全局订阅（与面板显隐无关）：

```
process:output → appendOutput(key, data)  累加 terminalOutputs（120k 上限滚动裁剪）+ 采 URL
process:status → updateProcessStatus(key, status) → processes[key].status = status
                 + refreshRuntimeState('sessions')
process:exit  → handleProcessExit(key, code) → processes[key] = { status:'stopped', error? }
                 + refreshRuntimeState('sessions')
```

事件发送方在 `runner.ts`：`finalizePtyStart` 发 running；`pty.onExit`/`child.on('exit')` 发 stopped + exit；spawn error 发 error；stop 的 3500ms 安全网补发 stopped + exit{null}。

`refreshRuntimeState('sessions')` 会触发 runtime 会话清单刷新（AI Runtime 子系统），与集合面板的 `terminalInventory` 是两套清单，别混淆。

## 7. 启动水合：syncManagedProcesses

`appStore.processSlice.ts:208`，两个触发点：`initApp` 后台任务（`initSlice.ts:116`）和 `startProject` 失败后。

过滤规则（**只把「主 dev 进程」合并进项目状态**）：

```
item.processId.includes('::toolbox')  → skip
item.processId.includes('::run::')    → skip（scheduler 所有）
item.processId.includes('::script::') → skip
item.processId.includes('::float::')  → skip
item.backend === 'tmux'               → skip（AI Runtime 会话）
projectId 不在已知项目                → skip
```

合并后还会从已有 `terminalOutputs` 反推 URL 补 `processUrls`。**它是 store.processes 的水合通道，不写 terminalInventory**——集合面板的清单只来自轮询。

## 8. 启动中占位（pending）生命周期

```
addCollectionTerminal ──▶ collectionPendingTerminals += { key, projectId, title }
   │                      （模型合并为 status:'starting' 的 float 项 + 面板遮罩）
   ├─ startProject 失败 ──▶ 立即移除占位
   └─ 轮询收录该 key ──▶ setTerminalInventory 过滤移除占位
```

双重去重：模型构造时若清单已收录同 key 也不重复占位（`terminalCollectionModel.ts:102`），覆盖「轮询已到、store 未清」的窗口。

## 9. 检测延迟量化（现状基线）

| 场景 | 延迟来源 | 量级 |
| --- | --- |
| 新建终端可见 | 乐观占位，无延迟 | 0 |
| 占位 → 真实终端 | 轮询间隔 | 0–5s |
| 进程退出 → 列表消失 | 轮询间隔（onExit 只改 processes，不改清单） | 0–5s |
| 面板隐藏期间启动的终端 | 不轮询；重开时立即 refresh 一次 | 重开瞬间 |
| 外部（项目卡）启动 dev | 下次轮询收录 | 0–5s |
| run 任务状态变化 | scheduler 进度事件推送 + 5s reconcile 兜底 | 事件级 |
| 设置页进程清单 | 独立 5s 轮询（挂页期间） | 0–5s |

## 10. 其它检测消费方

### 10.1 设置页进程清单（`useTerminalProcessInventory.ts`）

- 独立 5s 轮询 `listTerminalProcesses`（**与面板互不相关**，挂载才轮）。
| 分类：project（非 toolbox 托管进程）/ idle（toolbox）/ sessionGroups（按 sessionName 合并 managed + runtime + tmux 行）。
| 动作：`closeManagedProcess`（stopProcess）、`closeSessionRow`（killTmuxSession 或 stopProcess）、`closeAllTerminals`（`terminal:stop-all` → `stopAllTerminals`：stopAllWithCount + 逐 session stop + 计数返回）。

### 10.2 code chrome 运行徽标（`CodeWorkspacePanel.tsx:143`）

`terminalRunningCount` **双来源**：`store.processes` 里该项目的 key（含 `::` 前缀匹配）+ `runTaskStates[projectId]` 的 ready/running。面板隐藏时也准确（纯 store 派生），不依赖轮询。

### 10.3 RuntimeStateListener（`AppGlobalEffects.tsx:136`）

有 runtime 条目或活进程时 10s 轮询 sessions + 窗口 focus/visibilitychange 刷新——这是 AI Runtime 会话状态，不属于集合面板进程清单。

## 11. 检测链路的已知缺口

1. **退出到列表消失有轮询延迟**：onExit 已把 processes 置 stopped，但列表项来自 inventory，仍显示 running 绿点最多 5s。
| **隐藏期间完全不检测**：隐藏时不开轮询，store 清单是陈旧快照；别的入口（项目卡）启停进程期间打开面板，先渲染旧态再被立即 refresh 修正（有一次渲染闪烁）。
| **轻量通道未复用**：`terminal:list-managed` 已存在但轮询用的是重量级 `list-all`（可能查 WSL/tmux）。
| **失败即清空**：轮询 catch 后 `setTerminalInventory([])`，IPC 瞬时失败会把整个面板打成空态（下次轮询恢复）。
