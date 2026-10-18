# 开启流程：从入口到终端就绪

本文覆盖「用户触发 → 面板唤醒/新建 → 主进程起进程 → xterm 就绪」的完整开启链路。

## 1. 入口清单（5 类）

| # | 入口 | 位置 | 行为 |
| --- | --- | --- | --- |
| 1 | Ctrl+J 键盘 | `app/AppGlobalEffects.tsx:414` TerminalCollectionShortcutListener | `toggleTerminalCollection(contextProjectId)` |
| 2 | 右键「向上滑」手势 | `hooks/useMouseGestureNavigator.ts:425` → 派发 `app:toggle-terminal-collection` 事件 | 与 Ctrl+J 等价（`AppGlobalEffects.tsx:446` 消费） |
| 3 | 首页工具条终端按钮 | `pages/home/HomeToolbar.tsx:88` | `toggleTerminalCollection()`（无上下文项目） |
| 4 | code 工作区 chrome 按钮 | `pages/code/CodeWorkspacePanel.tsx:1032` | `revealTerminal(projectId)` 直接定位当前项目 |
| 5 | 跨页面唤起 | `hooks/useOpenProjectTerminal.ts` → `revealTerminal(projectId, processKey)` | 查看日志 / 项目卡 / 运行任务对话框等；不跳路由 |

另外：面板 header 加号 = 「加入项目」（`TerminalCollectionProjectPicker`，选中即给该项目新建 float 终端并收录）；列表底部「+ 新建终端」= 给当前激活项目新建。两者都走同一个 `addCollectionTerminal`。

## 2. 快捷键判定细节（capture 阶段）

`TerminalCollectionShortcutListener`（`AppGlobalEffects.tsx:414`）在 **window keydown capture 阶段**监听，优先于 xterm/输入框，保证终端聚焦时也能开合面板。判定顺序：

1. `accelerator === 'disabled'` → 不注册（设置里可关闭）。
2. `event.repeat` → 忽略（否则长按第二次会把刚弹出的面板立刻收起，表现为闪一下就没了）。
3. 必须带 `ctrlKey || metaKey`（CommandOrControl）。
4. `CommandOrControl+Shift+J` 配置时要求 `shiftKey`；否则（Ctrl+J / Ctrl+`）**带 Shift 直接 return**，避免与 Ctrl+Shift+J 混淆。
5. 按键匹配：`CommandOrControl+\`` 配置匹配 `event.code === 'Backquote'`；其余匹配 `event.key.toLowerCase() === 'j'`。
6. `preventDefault()` + `stopPropagation()` 后调用 `toggleTerminalCollection(contextProjectId)`。

accelerator 来自 `config.shortcutPreferences?.floatingTerminalToggleAccelerator`，默认 `CommandOrControl+J`。这是**应用内快捷键**（非 globalShortcut），仅应用聚焦时生效。

## 3. toggleTerminalCollection 决策树

入口在 `appStore.terminalCollectionSlice.ts:128`：

```
面板当前可见？
├─ 是 → 整体隐藏：{ ...panel, hidden: true }
│        persistFloatingPanelNow（立即落盘，不用防抖）
│        进程不动，轮询停止
└─ 否（唤醒）→
     目标项目 = contextProjectId ?? collectionActiveProjectId ?? 最近打开项目（lastOpened 降序）
     无任何项目 → return
     目标项目不在 projects → return
     该项目已有终端？（pending 占位 or 清单内非 toolbox）
     ├─ 有 → { hidden: false, 激活该项目, collectionActiveKey: null }
     │        persistFloatingPanel（300ms 防抖落盘）
     └─ 无 → addCollectionTerminal(projectId, project.path)（新建后自然可见）
```

要点：

- **唤醒不保证一定有终端**：只是定位到项目；组件侧 `activeGroup.terminals[0]` 兜底，空态引导新建。
- **可见性切换立即落盘**（`persistFloatingPanelNow`，`:38`）：注释说明防抖窗口内 renderer 刷新（Ctrl+R）会把刚收起的面板「复活」，所以显隐不能走防抖。
- **几何走 300ms 防抖**（`persistFloatingPanel`，`:29`）：拖动/resize 期间高频变更只落一次 config。

## 4. 新建 float 终端：addCollectionTerminal 全链路

`appStore.terminalCollectionSlice.ts:179`。时序：

```
1. resolveInteractiveShell(useWsl)           IPC shell:interactive-shell（按 useWsl 缓存，避免每次 IPC）
   useWsl = resolveProcessUseWsl(cwd) ?? false
2. listManagedProcesses()                    IPC terminal:list-managed（轻量：只读主进程内存 Map）
3. allocateFloatProcessKey(liveKeys, id)     模块级高水位 + 清单最大值，只增不减
4. 乐观 UI：collectionPendingTerminals += { processKey, projectId, title }
   floatingPanel.hidden = false；激活 key = 新 key
   persistFloatingPanelNow                    「启动中」占位立即可见，避免用户以为卡住
5. startProject(projectId, shellCommand, processKey, useWsl, cwd, 'silent')
6. 失败 → 移除占位 + 激活 key 回落 null，面板保持可见
```

### 4.1 startProject（renderer 侧，`appStore.processSlice.ts:28`）

1. `command = commandOverride || project.customCommand || project.command`（集合终端传 shellCommand，不走项目命令）。
2. `pid = processId || projectId`（集合终端传 float key）。
3. `isPrimaryProjectRun = pid === projectId`：仅当**不带 processId 的主 dev 启动**且 `runStartupMode === 'terminal'` 时走 `openPathTerminal` 外部终端；集合终端显式传 `'silent'`，永远走托管 pty。
4. `cwd = resolveRunWorkingDirectory(project.path, cwdOverride ?? project.runWorkingDirectory)`。
5. `resolvedUseWsl = resolveProcessUseWsl(cwd, useWsl)`（显式评估，不猜后端）。
6. 先写 store：`processes[pid] = { status: 'running', startTime }`、清空 `terminalOutputs[pid]`、`processUrls[pid] = []`（**乐观状态**，先 UI 后 IPC）。
7. IPC `process:start`（`invokeApi.core.ts` → `registerCoreIpcHandlers.ts:28` → `ProcessManager.start`）。
8. 返回 false → 本地状态回落 `stopped`，并 `syncManagedProcesses()` 重同步。

### 4.2 主进程 ProcessManager.start 后端决策树

`runner.ts:186`（`start` → `startResolved`，`:201`）：

```
processes.has(projectId)？→ 是：直接 return false（重键拒绝，float 高水位就是为了避免这个）
↓
forceWslForPath = win32 && hasWsl && cwd 是 WSL UNC 路径（//wsl.localhost/ 或 //wsl$/ 形态，判定见 runner.ts isWslUncPath）
├─ 是 → startWithPty（UNC 路径不能给 cmd.exe 当 cwd，强制 WSL）
├─ useWsl === false && win32 → startHostNative
├─ useWsl === true → hasWsl ? startWithPty : false
└─ 按 capability.backend：
   ├─ tmux / direct-pty：win32 → startHostNative；其它 → startWithPty
   └─ default（无 pty 能力）→ startWithSpawn（child_process 兜底）
```

四种后端：

| 后端 | 实现 | 典型场景 |
| --- | --- | --- |
| `wsl-pty` | node-pty spawn `wsl.exe -d <distro> -e bash -lc 'cd <wslPath> && exec bash -lc <cmd>'` | win32 + hasWsl，Claude 等 Linux 工具 |
| `direct-pty` | node-pty spawn cmd/powershell（`buildWindowsAutomationShellLaunch`）或 `/bin/bash -lc` | Windows 原生 shell / Linux、macOS |
| `tmux` | node-pty spawn `wsl.exe ... tmux attach-or-create`（会话名 `getSessionName(projectId, basename)`） | AI Runtime 会话恢复场景 |
| `spawn` | `child_process.spawn(command, { shell: true })` + 双 decoder（UTF-8 / GB18030 回退） | 无 node-pty 能力的兜底 |

startHostNative 内部：无 pty 能力再退 spawn；pty spawn 失败也退 spawn（`runner.ts:416` 内）。

### 4.3 finalizePtyStart：事件注册与首批事件

`runner.ts:500`（pty 路径）：

1. `processes.set(processId, { pty, projectId, startTime, backend })`。
2. 建 `ResizeController`（80ms 防抖合并，`resize-controller.ts`）。
3. `pty.onData` → `emitOutput`（outputTaps，run-task scheduler 等直连消费者）+ `webContents.send('process:output')`。
4. `pty.onExit` → 清理 stopping/resizeCtrls/processes → 发 `process:status: stopped` + `process:exit { code }` + `emitExit`。
5. 立即发 `process:status: running`（**注意：这是「进程已 spawn」而非「服务已就绪」**）。

## 5. xterm 视图就绪（renderer 侧）

面板渲染激活终端：`<Terminal key={activeTerminal.processKey} projectId={activeTerminal.processKey} variant="soft" />`（`TerminalCollectionPanel.tsx:323`）。`key` 为 processKey → 切换终端即重建组件。

`components/Terminal.tsx` 挂载时序：

1. 建 XTerm（fontSize 13、scrollback **200 行**、`convertEol`、自定义字体栈 `MONO_FONT_STACK`）+ FitAddon，`term.open(container)`，`term.focus()`。
2. **回放 store 缓冲**：`terminalOutputs[processKey]` 非空则整份 `term.write`（上限 120k 字符，`appStore.helpers.ts:5` 的 `trimTerminalBuffer`）。这是「面板隐藏期间进程继续跑、切回来不丢输出」的实现方式。
3. `term.onData` → `sendInput(processKey, data)` → IPC `process:input` → `pty.write`。
4. 自定义按键：Ctrl+Shift+C/V/A 复制/粘贴/全选（`attachCustomKeyEventHandler`）。
5. `term.onResize` → IPC `process:resize` → `ResizeController.emit`（80ms）→ `pty.resize`。
6. `ResizeObserver` → 80ms 防抖 `fitAddon.fit()`。**渲染器 fit 与主进程 resize 两级 80ms 防抖级联**。
7. 订阅 `onProcessOutput`：数据先进 rAF 缓冲再 write（合帧）。
8. 订阅 `onProcessStatus`：往 xterm 写一行 `*** status ***` 灰字。

`status === 'starting'` 时面板盖一层「正在启动 shell…」遮罩（`TerminalCollectionPanel.tsx:327`），遮罩下 xterm 已挂载并在接收输出。

## 6. 其它 kind 的开启归属

| kind | 谁启动 | 入口 |
| --- | --- | --- |
| float | 集合面板 `addCollectionTerminal`（本文主链） | 加号 / 新建 / Ctrl+J 无终端时 |
| primary | 项目卡启动 dev（`startProject` 不带 processId） | Home / Detail / code chrome |
| run | `run-task-scheduler.ts` 直接调 `processManager.start(runTaskProcessKey(...))` | 运行任务对话框 / 一键启动 |
| script | 脚本终端通道（同为 `startProject` 带 script key） | 脚本相关入口 |
| toolbox | AI Commit | `projectId::toolbox` |

run/primary/script 的进程**启动后自动出现在集合面板**（清单轮询收录），不需要面板参与启动。

## 7. 开启链路异常分支

| 异常 | 表现 | 处理 |
| --- | --- | --- |
 重键（进程已存在） | `start` 返回 false | renderer 移除占位、激活回落（float 高水位 + 清单查询降低概率）
| shell 命令解析失败 | `resolveInteractiveShell` throw | 直接 return false，不出占位 |
| 主进程 spawn 抛错 | `start` catch | 向该 key 发 `Error: ...` 输出 + `process:status: error` |
| pty 立即退出 | `onExit` 秒触发 | 占位被轮询收敛前可能闪一下「启动中」；随后清单移除、列表消失 |
| WSL 不可用但 useWsl=true | `startResolved` return false | renderer 状态回落 stopped |
| UNC 路径 + win32 无 WSL | forceWslForPath 为 false，走 native | cmd.exe 打不开 UNC cwd 时 spawn 报错进输出 |

## 8. 时序图（文字版）

```
用户            AppGlobalEffects     terminalCollectionSlice      preload/IPC        ProcessManager        XTerm
 │ Ctrl+J            │                       │                        │                  │             │
 ├─ keydown(capture)─▶│                       │                        │                  │             │
 │                   ├ toggleTerminalCollection(ctx)▶│                 │                  │             │
 │                   │                       ├ 隐藏中 → 无终端？       │                  │             │
 │                   │                       ├ addCollectionTerminal ▶│                  │             │
 │                   │                       ├ ├ getInteractiveShellCommand ▶│           │             │
 │                   │                       ├ ├ listManagedProcesses ▶│ ───────────────▶│ list        │
 │                   │                       ├ ├ allocateFloatKey     │                  │             │
 │                   │                       ├ ├ pending 占位 + set   │                  │             │
 │                   │                       ├ └ startProject('silent')▶│ process:start ─▶│ start       │
 │                   │                       │                        │ ◀── started      │             │
 │                   │                       │                        │ ◀ process:status:running      │
 │ 面板可见 + 遮罩    │                       │                        │                  │             │
 │                   │                       │                        │ ◀ process:output ─────────────┤ write
 │ (5s 后轮询)        │                       ├ setTerminalInventory ◀──│ terminal:list-all│             │
 │                   │                       ├ pending 收敛、遮罩撤    │                  │             │
```
