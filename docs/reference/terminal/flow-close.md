# 关闭流程：两级关闭与停止时序

终端体系有两级完全不同的「关闭」，语义不能混（`AGENTS.md` 与历史反馈都强调过）：

| 操作 | 语义 | 进程 | 数据 |
| --- | --- | --- | --- |
| 面板 × / Ctrl+J / 手势 | **隐藏保活** | 继续运行 | 轮询暂停；store 清单停留旧快照 |
| 终端列表 × | **停止进程**（按 kind 分发） | 结束 | 清单移除、状态 stopped |

## 1. 面板级关闭（隐藏保活）

`toggleTerminalCollection` 可见分支（`appStore.terminalCollectionSlice.ts:128`）：

1. `{ ...panel, hidden: true }` → set → `persistFloatingPanelNow`（立即落盘）。
2. `TerminalCollectionLayer` 因 `hidden` return null：**xterm 组件卸载**（term.dispose），5s 轮询 effect 清理（`:36`）。
3. 主进程进程不受任何影响；输出继续进 `terminalOutputs`（`ProcessOutputListener` 是全局订阅，与面板显隐无关，`AppGlobalEffects.tsx:61`）。
4. 会话可在 设置 → 日志（`SettingsStartupLogsPanel` / `useTerminalProcessInventory`）查看和停止。

重新打开时：先以**旧清单快照**渲染（store 里停留的数据），Layer effect 立即 `refresh()` 一次再恢复 5s 轮询。

## 2. 终端级关闭：按 kind 分发

`stopCollectionTerminal(projectId, processKey)`（`appStore.terminalCollectionSlice.ts:241`）：

```
parseTerminalProcessKey(processKey)
├─ 解析失败或 projectId 不匹配 → 忽略
├─ run    → stopRunTask(projectId, taskId)        生命周期归 scheduler
├─ primary / script / float → stopProject(processKey)   IPC process:stop
└─ toolbox → 忽略（只读，UI 也不给关闭按钮）
```

批量入口：

| 入口 | 行为 |
| --- | --- |
| header 全部停止按钮 | ConfirmDialog（scope: all）→ `stopAllCollectionTerminals`：遍历清单内非 toolbox 逐个分发 |
| 项目 tab 右键「关闭全部终端」 | ConfirmDialog（scope: project）→ `stopProjectTerminals`：该项目清单内非 toolbox + pending 占位 |
| 终端 × | 单个 `stopCollectionTerminal`，无确认 |

`stopProjectTerminals`（`appStore.terminalCollectionSlice.ts:270`）对 pending 占位补一次 `stopProject`（主进程可能尚未注册该 key），并直接移除占位；若激活 key 正好被停，回落 null。

## 3. renderer 侧 stopProject

`appStore.processSlice.ts:88`：

1. 本地有状态条目 → 置 `status: 'stopping'`（无条目则什么都不做，直接 IPC）。
2. IPC `process:stop` → `ProcessManager.stop(projectId)`。
3. **不等待退出**：退出由 `process:exit` 事件驱动 `handleProcessExit` → `status: 'stopped'`（code≠0 带 error 文案）。

注意 `stopping` 期间 UI 状态点按 warning 色（`statusDotClass`，`TerminalCollectionPanel.tsx:57`），但 xterm 里只有一行 `*** stopping ***` 灰字（`Terminal.tsx` 的 onProcessStatus 订阅写的是事件原样 status）。

## 4. 主进程 ProcessManager.stop 时序

`runner.ts:230`。这是整个关闭链路的核心：

```
stop(projectId)
├─ stopping.has(projectId)？→ 是：return true（去重，重复点击无害）
├─ processes 无该 key → return false
├─ stopping.add(projectId)
├─ 3500ms 安全网定时器：
│    若 stopping 仍含该 key（说明 onExit 一直没来）→
│    清理 stopping/resizeCtrls/processes，补发 process:status:stopped + process:exit{code:null}
│    （防「永远 stopping」卡死重启）
├─ backend === 'spawn' → stopSpawn
└─ pty 系 → stopPty
```

### 4.1 stopPty（`runner.ts:647`）

1. `pty.write('\x03')` —— **Ctrl+C 优雅终止**（让 shell/前台进程自己收尾）。
2. 1500ms 后 `pty.kill('SIGTERM')` —— 宽限后强杀 pty 进程。
3. 真正的清理发生在 `pty.onExit`（`runner.ts:520`）：删 stopping/resizeCtrl/processes，发 stopped + exit 事件。

### 4.2 stopSpawn（`runner.ts:601`）

- win32：`taskkill /pid <pid> /t /f`（杀进程树；失败回退 `child.kill()`）。
| POSIX：`kill(-pid, SIGTERM)`，2000ms 后 `kill(-pid, SIGKILL)`。
| pid 为 null（从未起来）：立即本地清理 + 补发事件。

### 4.3 已知边界

- **Ctrl+C 可能被前台程序吞掉**：pty 里跑着 vim/前台 node 进程时，`\x03` 不一定导致退出，只能等 1500ms SIGTERM；SIGTERM 也可能被忽略，最终靠 3500ms 安全网把状态机解锁（但**进程本身可能变成孤儿**——安全网只清 Map，不补杀）。
- **tmux backend 的 stop**：走 stopPty 杀的是「attach 的 wsl.exe」，tmux 会话本身由 `tmux kill-session` 或 runtime-service 管理；这也是「隐藏保活」语义下 tmux 会话天然存活的机制。
| **run kind 不走 stop()**：`stopRunTask` → scheduler `stopTask` → `processManager.stop(runTaskProcessKey(...))`，并带端口释放观察（`watchTaskPortRelease`）与依赖任务连锁停止（transitive dependents）。

## 5. 应用退出清理（另一条关闭路径）

`main/index.ts:652` before-quit：

```
runtimeKeepAliveOnQuit === false → runtimeService.cleanupOnBeforeQuit()（停 tmux runtime 会话）
processManager.stopAllImmediate()   同步强杀全部托管进程（不等宽限、不写 Ctrl+C）
   win32: spawnSync taskkill /pid /t /f（逐进程）
   POSIX: kill(-pid, SIGKILL) + kill(pid, SIGKILL)
ai-commit / agent-hooks / ai-gateway / transcript-share / browser-* 各自 cleanup
```

`stopAllImmediate`（`runner.ts:269`）与 `stop()` 的区别：**同步、无宽限、无事件补发**——注释明确说明 `stop()` 的延迟 kill 在 `app.quit()` 前可能来不及触发，会留孤儿 shell。启动失败回滚（`index.ts:761`）也复用它。

## 6. 状态机视角的完整关闭时序

```
终端 ×            slice                IPC              ProcessManager            事件回流
 │                │                    │                    │                     │
 ├ stopCollectionTerminal(key)          │                    │                     │
 │ ├ parse → float → stopProject(key)   │                    │                     │
 │                ├ processes[key] = stopping               │                     │
 │                ├ process:stop ───────▶│ stop(key)         │                     │
 │                │                    │ ├ write \x03        │                     │
 │                │                    │ ├ 1500ms → kill    │                     │
 │                │                    │ │                  ├ onExit              │
 │                │                    │ │                  │ ├ 清理 Map           │
 │                │ ◀── process:exit ───┼──────────────────┼─── send             │
 │                ├ handleProcessExit → stopped             │                     │
 │                │                    │                  （3500ms 安全网未触发）  │
 │ (≤5s) 下次轮询清单已无该 key → 列表项消失                 │                     │
```

## 7. 与旧机制的关系（排错时别找错地方）

- 旧浮动终端的 hydrate/reconnect 遮罩、ProjectTerminalDock、Ctrl+` 项目坞**均已删除**；现在没有「重连」概念——进程活着就在清单里，面板只是视图。
- `SavedProject.terminalDock.titles` 字段名带 Dock 是历史遗留，语义仅是 title 覆盖表（`appStore.terminalCollectionSlice.ts:225`）。
- `config.floatingTerminals` 旧实例数组由主进程 normalize 丢弃，现在只有 `config.floatingPanel`（几何+显隐）。
