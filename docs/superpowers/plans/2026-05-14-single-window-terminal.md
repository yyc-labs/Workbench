# Single-Window Terminal Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor from "one wt.exe window per project" to singleton Windows Terminal hosting tmux with multiple sessions, managed via `tmux switch-client`.

**Architecture:** A `TerminalHost` singleton (in-memory, main process) tracks the single wt.exe pid. `openTerminal` checks if the host is alive, spawns it if not, then runs `tmux switch-client -t <session>` to switch to the target session.

**Tech Stack:** Electron main process (Node.js `spawn`, `process.kill(pid, 0)` for liveness check), WSL `tmux switch-client`, Windows `wt.exe`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/main/terminal-host.ts` | **Create** | Singleton TerminalHost tracker |
| `src/main/index.ts` | Modify | Rewrite `SHELL_OPEN_TERMINAL` handler |
| `src/preload/index.ts` | Modify | `openTerminal` signature unchanged |
| `src/renderer/runtime/RuntimeManager.ts` | Modify | `openTerminal` passes sessionName |
| `src/renderer/stores/appStore.ts` | Modify | Add `terminalHost` state + updated `openTerminal` |
| `src/renderer/pages/RuntimePage.tsx` | Modify | "Open Terminal" → always available (not hidden behind session state), reflects host status |

---

### Task 1: Create TerminalHost singleton module

**Files:**
- Create: `src/main/terminal-host.ts`

- [ ] **Step 1: Write the module**

```typescript
import { spawn } from 'child_process'
import type { Capability } from '../shared/types'

interface TerminalHost {
  pid: number
  startedAt: number
}

let host: TerminalHost | null = null

/** Check if the tracked wt.exe process is still alive. */
function isAlive(): boolean {
  if (!host) return false
  try {
    // Signal 0 = existence check, no actual signal sent
    process.kill(host.pid, 0)
    return true
  } catch {
    host = null
    return false
  }
}

/** Spawn the singleton Windows Terminal running tmux. */
function spawnHost(capability: Capability): Promise<TerminalHost | null> {
  const distro = capability.wslDistro || 'Ubuntu'

  return new Promise((resolve) => {
    const child = spawn('wt.exe', [
      'wsl', '-d', distro,
      '--', 'bash', '-lc',
      'exec tmux'
    ], {
      detached: true,
      stdio: 'ignore',
    })

    child.on('error', (err) => {
      console.error('[terminal-host] spawn failed:', err.message)
      resolve(null)
    })

    child.on('spawn', () => {
      host = {
        pid: child.pid!,
        startedAt: Date.now(),
      }
      resolve(host)
    })

    child.unref()
  })
}

/** Ensure the terminal host exists. Returns true if a live tmux container is ready. */
async function ensureHost(capability: Capability): Promise<boolean> {
  if (isAlive()) return true
  host = null
  const result = await spawnHost(capability)
  if (!result) return false
  // Give tmux a moment to initialise inside wt.exe
  await new Promise(r => setTimeout(r, 1000))
  return true
}

/** Switch the singleton tmux client to a target session. */
async function switchSession(sessionName: string, distro: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('wsl.exe', [
      '-d', distro,
      '--', 'bash', '-lc',
      `tmux switch-client -t '${sessionName}' 2>/dev/null || tmux attach -t '${sessionName}'`
    ], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    })

    child.on('error', (err) => {
      console.error('[terminal-host] switch failed:', err.message)
      resolve(false)
    })

    child.on('close', (code) => {
      resolve(code === 0)
    })

    child.unref()
  })
}

export const terminalHost = {
  isAlive,
  ensureHost,
  switchSession,
}
```

---

### Task 2: Rewrite SHELL_OPEN_TERMINAL IPC handler

**Files:**
- Modify: `src/main/index.ts` (import + handler body)

- [ ] **Step 1: Add import**

```typescript
import { terminalHost } from './terminal-host'
```

- [ ] **Step 2: Replace the existing SHELL_OPEN_TERMINAL handler**

Replace the entire `ipcMain.handle(IPC.SHELL_OPEN_TERMINAL, ...)` block with:

```typescript
  ipcMain.handle(IPC.SHELL_OPEN_TERMINAL, async (_event, sessionName: string) => {
    if (!bootCapability) return false

    // 1. Ensure singleton Windows Terminal + tmux is running
    const ok = await terminalHost.ensureHost(bootCapability)
    if (!ok) return false

    // 2. Switch the client to the target tmux session
    const distro = bootCapability.wslDistro || 'Ubuntu'
    return terminalHost.switchSession(sessionName, distro)
  })
```

This replaces the old handler that spawned a new `wt.exe` per call.

---

### Task 3: Update renderer RuntimeManager

**Files:**
- Modify: `src/renderer/runtime/RuntimeManager.ts`

- [ ] **Step 1: `openTerminal` signature unchanged but update comment**

```typescript
  /** Open the singleton Windows Terminal and switch to the target tmux session.
   *  If the terminal host is not running, it spawns one first. */
  async openTerminal(sessionName: string): Promise<void> {
    await window.electronAPI.openTerminal(sessionName)
  }
```

(No functional change — just a clearer JSDoc.)

---

### Task 4: Update store — add terminalHost state

**Files:**
- Modify: `src/renderer/stores/appStore.ts`

- [ ] **Step 1: Add `terminalHostAlive` to AppState interface**

```typescript
  terminalHostAlive: boolean
```

- [ ] **Step 2: Add to initial state**

```typescript
  terminalHostAlive: false,
```

- [ ] **Step 3: Update `openTerminal` store action to also set host-alive state after success**

```typescript
  openTerminal: async (projectId: string) => {
    const session = get().sessions[projectId]
    if (!session || session.sessionName === '') return
    const ok = await runtimeManager.openTerminal(session.sessionName)
    if (ok !== false) {
      set({ terminalHostAlive: true })
    }
  },
```

Wait — `openTerminal` currently returns `void`. The new IPC returns `boolean`. Need to update the chain.

- [ ] **Step 4: Update `runtimeManager.openTerminal` return type and global type**

In `appStore.ts` global declaration:
```typescript
      openTerminal: (sessionName: string) => Promise<boolean>
```

In `RuntimeManager.ts`:
```typescript
  async openTerminal(sessionName: string): Promise<boolean> {
    return window.electronAPI.openTerminal(sessionName)
  }
```

In `preload/index.ts`:
```typescript
  openTerminal: (sessionName: string) =>
    ipcRenderer.invoke(IPC.SHELL_OPEN_TERMINAL, sessionName),
```

(This already returns `Promise<boolean>` from the IPC handler — no change needed at preload level.)

---

### Task 5: Update RuntimePage — "Open Terminal" button always visible

**Files:**
- Modify: `src/renderer/pages/RuntimePage.tsx`

- [ ] **Step 1: Add terminalHostAlive selector**

```typescript
  const terminalHostAlive = useAppStore((s) => s.terminalHostAlive)
```

- [ ] **Step 2: Restructure action buttons — "Open Terminal" always visible**

Currently the "Open Terminal" button is only shown when `!isStopped`. Change it so:

- "Start Runtime" / "Stop Runtime" buttons as before (based on session state)
- "Open Terminal" button is **always visible** when a session exists (the terminal host is a singleton — you can always open it to see tmux, even if the specific project session is stopped)

Replace the action buttons section (the `{isStopped ? ... : ...}` block) with:

```tsx
            {/* Action buttons */}
            <div className="flex items-center gap-3">
              {/* Open Terminal — always available once a runtime entry exists */}
              {session && (
                <button
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
                  onClick={handleOpenTerminal}
                >
                  <Terminal className="w-4 h-4" />
                  Open Terminal
                </button>
              )}

              {isStopped ? (
                <button
                  disabled={isLoading}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 shadow-sm"
                  onClick={handleStartRuntime}
                >
                  {actionLoading === 'start' ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Zap className="w-4 h-4" />
                  )}
                  Start Runtime
                </button>
              ) : (
                <>
                  <button
                    disabled={isLoading}
                    className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all text-gray-500 hover:text-gray-400 hover:bg-[#eae9e6] border border-[#e2e2df] disabled:opacity-50"
                    onClick={handleRestart}
                  >
                    <RefreshCw className={`w-4 h-4 ${actionLoading === 'restart' ? 'animate-spin' : ''}`} />
                    Restart
                  </button>
                  <button
                    disabled={isLoading}
                    className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all text-red-500 hover:text-red-600 hover:bg-red-50 border border-red-200 disabled:opacity-50"
                    onClick={handleStopRuntime}
                  >
                    <Square className="w-4 h-4" />
                    Stop
                  </button>
                </>
              )}
            </div>
```

- [ ] **Step 3: Update the body "Recent Activity" card text**

Change from:
```tsx
<p className="text-gray-400">— Press "Start Runtime" to launch Claude</p>
```
To:
```tsx
<p className="text-gray-400">— Press "Start Runtime" to launch Claude in tmux</p>
```

---

### Task 6: Verify and commit

- [ ] **Step 1: Review all changes**

```bash
git diff --stat
```

Expected: ~6 files changed.

- [ ] **Step 2: Commit**

```bash
git add src/main/terminal-host.ts src/main/index.ts src/preload/index.ts src/renderer/runtime/RuntimeManager.ts src/renderer/stores/appStore.ts src/renderer/pages/RuntimePage.tsx
git commit -m "refactor: singleton Windows Terminal + tmux switch-client replaces multi-window

- Add TerminalHost singleton (src/main/terminal-host.ts): tracks single wt.exe pid,
  ensureHost() spawns 'wt.exe wsl ... exec tmux' if not alive,
  switchSession() runs 'tmux switch-client -t <name>'
- SHELL_OPEN_TERMINAL handler: calls ensureHost() then switchSession() instead
  of spawning fresh wt.exe per project
- RuntimePage: 'Open Terminal' button always visible when runtime entry exists,
  no longer hidden behind session running state

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```
```
