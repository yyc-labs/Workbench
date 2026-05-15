# Claude Runtime Manager UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the embedded xterm.js TerminalPage with a RuntimePage dashboard, redesign Home with dark theme, and introduce RuntimeManager module that separates runtime lifecycle from terminal lifecycle.

**Architecture:** RuntimeManager (renderer singleton) handles IPC for start/attach/stop. appStore owns `refreshSessions()` — it calls `listTmuxSessions()` and constructs `SessionRuntime[]` from raw tmux data. Polling is a simple `setInterval(onRefresh)` where `onRefresh` is the store's `refreshSessions`. No double-dispatch. Home and RuntimePage consume `store.sessions` only — no direct IPC, no per-page polling. `runtime-registry.json` is metadata-only (lastOpened, tags), NEVER used as session existence source of truth (that's `tmux ls`). Background detached spawn starts the Claude script without opening a terminal; `wt.exe` (Windows Terminal) is only used for tmux attach.

**Tech Stack:** Electron + React + Zustand + xterm.js (Detail page only, unchanged) + tmux + WSL

---

## File Structure

| File | Role |
|------|------|
| `src/shared/types.ts` | + `SessionRuntime`, `RuntimeEntry` types; status = `'attached' \| 'detached' \| 'stopped'` |
| `src/main/ipc.ts` | + 2 IPC constants (`RUNTIME_START`, `SHELL_OPEN_TERMINAL`) — NO session-exists |
| `src/main/runtime-registry.ts` | **NEW** — metadata persistence only (NOT session source of truth) |
| `src/main/index.ts` | + IPC handlers for runtime-start, shell-open-terminal |
| `src/preload/index.ts` | + `startRuntime`, `openTerminal` API methods — NO checkSession |
| `src/renderer/stores/appStore.ts` | + `sessions` state, `refreshSessions` (owns construction logic), `startRuntime`, `stopRuntime`, `openTerminal` |
| `src/renderer/runtime/RuntimeManager.ts` | **NEW** — singleton, thin IPC wrapper + session name derivation + polling timer |
| `src/renderer/App.tsx` | Route rename, centralized session polling |
| `src/renderer/pages/Home.tsx` | Redesign: dark theme, "Claude Runtime" branding |
| `src/renderer/pages/RuntimePage.tsx` | **NEW** — replaces TerminalPage, no xterm.js |
| `src/renderer/pages/TerminalPage.tsx` | **DELETE** |
| `src/renderer/components/ProjectCard.tsx` | Redesign: dark theme runtime cards |
| `src/renderer/styles/global.css` | Dark body background |
| `src/renderer/index.html` | Title → "Claude Runtime" |

**Unchanged:** `runner.ts`, `tmux-manager.ts`, `wsl-bridge.ts`, `capability-manager.ts`, `Terminal.tsx`, `Detail.tsx`, `Settings.tsx`

---

### Task 1: Type definitions and IPC channels

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/ipc.ts`

- [ ] **Step 1: Add new types to `src/shared/types.ts`**

Append after existing `RecoveredSession` interface:

```typescript
/** Runtime session status — mirrors tmux reality, NOT user-facing labels.
 *  UI layer maps: attached→Active, detached→Background, stopped→Offline. */
export type RuntimeStatus = 'attached' | 'detached' | 'stopped'

export interface SessionRuntime {
  projectId: string
  sessionName: string
  status: RuntimeStatus
  createdAt: number
}

export interface RuntimeEntry {
  projectId: string
  sessionName: string
  createdAt: number
  lastOpened: number
}

export interface RuntimeRegistry {
  entries: Record<string, RuntimeEntry>
}
```

Note: `terminalConnected` is derived from `status === 'attached'` at the UI layer — not stored separately.

- [ ] **Step 2: Add new IPC channel constants to `src/main/ipc.ts`**

Append to the `IPC` object (only 2 channels — `sessionExists` is redundant with `listTmuxSessions`):

```typescript
RUNTIME_START: 'runtime:start',
SHELL_OPEN_TERMINAL: 'shell:open-terminal',
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts src/main/ipc.ts
git commit -m "feat: add SessionRuntime types and IPC channels for runtime manager"
```

---

### Task 2: Runtime registry (metadata only, main process)

**Files:**
- Create: `src/main/runtime-registry.ts`

- [ ] **Step 1: Create `src/main/runtime-registry.ts`**

This file stores metadata (lastOpened, tags, etc.). It is NEVER the source of truth for session existence — that always comes from `tmux list-sessions`.

```typescript
import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type { RuntimeRegistry, RuntimeEntry } from '../shared/types'

const REGISTRY_FILE = 'runtime-registry.json'

function getRegistryPath(): string {
  return join(app.getPath('userData'), REGISTRY_FILE)
}

function loadRegistry(): RuntimeRegistry {
  const p = getRegistryPath()
  try {
    const raw = readFileSync(p, 'utf-8')
    return JSON.parse(raw) as RuntimeRegistry
  } catch {
    return { entries: {} }
  }
}

function saveRegistry(registry: RuntimeRegistry): void {
  const p = getRegistryPath()
  const dir = dirname(p)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(p, JSON.stringify(registry, null, 2), 'utf-8')
}

export function getRuntimeEntry(projectId: string): RuntimeEntry | undefined {
  return loadRegistry().entries[projectId]
}

export function setRuntimeEntry(entry: RuntimeEntry): void {
  const reg = loadRegistry()
  reg.entries[entry.projectId] = { ...entry, lastOpened: Date.now() }
  saveRegistry(reg)
}

export function removeRuntimeEntry(projectId: string): void {
  const reg = loadRegistry()
  delete reg.entries[projectId]
  saveRegistry(reg)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/runtime-registry.ts
git commit -m "feat: add runtime-registry.json for metadata persistence"
```

---

### Task 3: IPC handlers (main) + preload API

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/stores/appStore.ts` (type declaration only)

- [ ] **Step 1: Add imports in `src/main/index.ts`**

After the existing `import { tmuxManager }` line, add:

```typescript
import { wslBridge } from './wsl-bridge'
import { setRuntimeEntry, removeRuntimeEntry } from './runtime-registry'
import { spawn } from 'child_process'
```

- [ ] **Step 2: Add IPC handlers in `registerIpcHandlers()` in `src/main/index.ts`**

Add before the `// ── WSL / tmux ──` comment block:

```typescript
// ── Runtime Manager ──────────────────────────────────────

ipcMain.handle(IPC.RUNTIME_START, async (_event, projectId: string, projectPath: string, sessionName: string) => {
  const distro = bootCapability?.wslDistro || 'Ubuntu'
  const wslPath = wslBridge.toWslPath(projectPath)
  const scriptPath = '~/tools/claude-code-script/start-claude-with-env.sh'

  // Array args — no shell string interpolation, avoids quoting bugs with
  // paths containing quotes, spaces, $, (, ), etc.
  const child = spawn('wsl.exe', [
    '-d', distro,
    '--', 'bash', '-lc',
    `nohup "${scriptPath}" "${wslPath}" >/dev/null 2>&1 & disown`
  ], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  // Persist metadata only (not used as session existence source of truth)
  setRuntimeEntry({
    projectId,
    sessionName,
    createdAt: Date.now(),
    lastOpened: Date.now(),
  })

  return true
})

ipcMain.handle(IPC.SHELL_OPEN_TERMINAL, async (_event, sessionName: string) => {
  const distro = bootCapability?.wslDistro || 'Ubuntu'

  const child = spawn('wt.exe', [
    'wsl', '-d', distro,
    '--', 'bash', '-lc',
    `exec tmux attach-session -t '${sessionName}'`
  ], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  return true
})
```

- [ ] **Step 3: Add new API methods in `src/preload/index.ts`**

Add to the `api` object, after `rehydrateTmuxSessions`:

```typescript
startRuntime: (projectId: string, projectPath: string, sessionName: string) =>
  ipcRenderer.invoke(IPC.RUNTIME_START, projectId, projectPath, sessionName),

openTerminal: (sessionName: string) =>
  ipcRenderer.invoke(IPC.SHELL_OPEN_TERMINAL, sessionName),
```

Note: No `checkSession` — `listTmuxSessions` already provides this information.

- [ ] **Step 4: Add new methods to the `window.electronAPI` type in `src/renderer/stores/appStore.ts`**

Add inside the `electronAPI` interface (after `rehydrateTmuxSessions`):

```typescript
startRuntime: (projectId: string, projectPath: string, sessionName: string) => Promise<boolean>
openTerminal: (sessionName: string) => Promise<boolean>
```

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts src/preload/index.ts src/renderer/stores/appStore.ts
git commit -m "feat: add runtime IPC handlers (start, open-terminal)"
```

---

### Task 4: RuntimeManager module (renderer)

**Files:**
- Create: `src/renderer/runtime/RuntimeManager.ts`

- [ ] **Step 1: Create `src/renderer/runtime/RuntimeManager.ts`**

RuntimeManager is a thin IPC wrapper. It does NOT construct SessionRuntime objects — that's the store's job (`refreshSessions`). It only provides:
- Session name derivation (pure function)
- IPC wrappers for start/stop/attach
- Polling timer (calls a callback, doesn't know about state shape)

```typescript
// Duplicated from tmux-manager.ts safeSessionName — renderer cannot import main.
function deriveSessionName(projectId: string, projectName?: string): string {
  const hashPart = projectId.startsWith('p')
    ? projectId.slice(1, 7)
    : simpleHash(projectId).slice(0, 6)
  if (projectName) {
    const safe = projectName.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)
    if (safe) return `lx_${safe}_${hashPart}`
  }
  return `lx_${hashPart}`
}

function simpleHash(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i)
    hash = hash | 0
  }
  return Math.abs(hash).toString(36)
}

class RuntimeManager {
  private pollTimer: ReturnType<typeof setInterval> | null = null

  /** Derive session name from project metadata (pure, no IPC). */
  getSessionName(projectId: string, projectName?: string): string {
    return deriveSessionName(projectId, projectName)
  }

  /** Background start — spawns the Claude init script via detached WSL process.
   *  Does NOT open a terminal window. Use `openTerminal()` for that. */
  async startRuntime(
    projectId: string,
    sessionName: string,
    projectPath: string,
  ): Promise<boolean> {
    return window.electronAPI.startRuntime(projectId, projectPath, sessionName)
  }

  /** Open Windows Terminal attached to an existing tmux session. */
  async openTerminal(sessionName: string): Promise<void> {
    await window.electronAPI.openTerminal(sessionName)
  }

  /** Stop — kills the tmux session. */
  async stopRuntime(projectId: string): Promise<void> {
    await window.electronAPI.killTmuxSession(projectId)
  }

  /** Returns raw tmux session list. Caller (store) constructs SessionRuntime[]. */
  async listTmuxSessions() {
    return window.electronAPI.listTmuxSessions()
  }

  /** Wait until a session no longer exists (for restart safety). */
  async waitForSessionGone(sessionName: string, timeoutMs = 10000): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const sessions = await window.electronAPI.listTmuxSessions()
      if (!sessions.find((s) => s.sessionName === sessionName)) return
      await new Promise((r) => setTimeout(r, 300))
    }
  }

  /** Start centralized polling. onRefresh is called on each tick. */
  startPolling(onRefresh: () => void, intervalMs = 10000): void {
    this.stopPolling()
    onRefresh() // immediate first call
    this.pollTimer = setInterval(onRefresh, intervalMs)
  }

  stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }
}

export const runtimeManager = new RuntimeManager()
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/runtime/RuntimeManager.ts
git commit -m "feat: add RuntimeManager singleton (IPC wrapper + polling timer)"
```

---

### Task 5: AppStore — sessions state and runtime actions

**Files:**
- Modify: `src/renderer/stores/appStore.ts`

- [ ] **Step 1: Add imports and types to appStore**

Add import at top:

```typescript
import type { SessionRuntime } from '../../shared/types'
import { runtimeManager } from '../runtime/RuntimeManager'
```

Add to `AppState` interface (after `tmuxSessions`):

```typescript
sessions: Record<string, SessionRuntime>
```

Add to `AppState` interface actions:

```typescript
refreshSessions: () => Promise<void>
startRuntime: (projectId: string) => Promise<void>
stopRuntime: (projectId: string) => Promise<void>
openTerminal: (projectId: string) => Promise<void>
```

Add initial state (after `tmuxSessions: []`):

```typescript
sessions: {},
```

- [ ] **Step 2: Add action implementations**

Add to the `set` callback (after `markProjectDetached`):

```typescript
refreshSessions: async () => {
  const { projects } = get()
  const rawSessions = await runtimeManager.listTmuxSessions()
  const result: Record<string, SessionRuntime> = {}

  for (const project of projects) {
    const sessionName = runtimeManager.getSessionName(project.id, project.name)
    const tmux = rawSessions.find((s) => s.sessionName === sessionName)

    result[project.id] = {
      projectId: project.id,
      sessionName,
      status: tmux
        ? (tmux.status === 'attached' ? 'attached' : 'detached')
        : 'stopped',
      createdAt: tmux?.createdAt ?? 0,
    }
  }

  set({ sessions: result })
},

startRuntime: async (projectId: string) => {
  const project = get().projects.find((p) => p.id === projectId)
  if (!project) return
  const sessionName = runtimeManager.getSessionName(projectId, project.name)
  await runtimeManager.startRuntime(projectId, sessionName, project.path)
  await get().refreshSessions()
},

stopRuntime: async (projectId: string) => {
  const session = get().sessions[projectId]
  if (!session || session.status === 'stopped') return
  await runtimeManager.stopRuntime(projectId)
  await get().refreshSessions()
},

openTerminal: async (projectId: string) => {
  const session = get().sessions[projectId]
  if (!session) return
  await runtimeManager.openTerminal(session.sessionName)
},
```

- [ ] **Step 3: Update `initApp` to run initial session refresh**

In the `initApp` function, after the existing `set({ config, projects, capability, tmuxSessions })` line, add:

```typescript
// Initial session refresh (after state is set so projects are available)
const rawSessions = await runtimeManager.listTmuxSessions()
const initialSessions: Record<string, SessionRuntime> = {}
for (const project of projects) {
  const sessionName = runtimeManager.getSessionName(project.id, project.name)
  const tmux = rawSessions.find((s) => s.sessionName === sessionName)
  initialSessions[project.id] = {
    projectId: project.id,
    sessionName,
    status: tmux
      ? (tmux.status === 'attached' ? 'attached' : 'detached')
      : 'stopped',
    createdAt: tmux?.createdAt ?? 0,
  }
}
set({ sessions: initialSessions })
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/stores/appStore.ts
git commit -m "feat: add sessions state and runtime actions to appStore"
```

---

### Task 6: Centralized polling in App + route rename

**Files:**
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Update `src/renderer/App.tsx`**

```typescript
import { useEffect } from 'react'
import { MemoryRouter as Router, Routes, Route } from 'react-router-dom'
import { HomePage } from './pages/Home'
import { DetailPage } from './pages/Detail'
import { RuntimePage } from './pages/RuntimePage'
import { SettingsPage } from './pages/Settings'
import { useAppStore } from './stores/appStore'
import { runtimeManager } from './runtime/RuntimeManager'

function ProcessOutputListener() {
  const appendOutput = useAppStore((s) => s.appendOutput)
  const updateProcessStatus = useAppStore((s) => s.updateProcessStatus)
  const handleProcessExit = useAppStore((s) => s.handleProcessExit)

  useEffect(() => {
    const unsubOutput = window.electronAPI.onProcessOutput(
      ({ projectId, data }) => { appendOutput(projectId, data) }
    )
    const unsubStatus = window.electronAPI.onProcessStatus(
      ({ projectId, status }) => { updateProcessStatus(projectId, status) }
    )
    const unsubExit = window.electronAPI.onProcessExit(
      ({ projectId, code }) => { handleProcessExit(projectId, code) }
    )
    return () => { unsubOutput(); unsubStatus(); unsubExit() }
  }, [appendOutput, updateProcessStatus, handleProcessExit])

  return null
}

/** Centralized session polling — RuntimeManager calls onRefresh on each tick,
 *  onRefresh is the store's refreshSessions (single source of truth).
 *  Uses stable project identity string to avoid re-subscribing. */
function SessionPoller() {
  const projectIds = useAppStore((s) =>
    s.projects.map((p) => p.id).sort().join(',')
  )
  const projects = useAppStore((s) => s.projects)
  const refreshSessions = useAppStore((s) => s.refreshSessions)

  useEffect(() => {
    if (projects.length === 0) return
    runtimeManager.startPolling(() => { refreshSessions() }, 10000)
    return () => runtimeManager.stopPolling()
  }, [projectIds]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

function AppInit() {
  const initApp = useAppStore((s) => s.initApp)
  useEffect(() => { initApp() }, [initApp])
  return null
}

export function App() {
  return (
    <Router>
      <AppInit />
      <ProcessOutputListener />
      <SessionPoller />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/project/:projectId" element={<DetailPage />} />
        <Route path="/runtime/:projectId" element={<RuntimePage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Router>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat: rename terminal route to runtime, add centralized session polling"
```

---

### Task 7: Dark theme foundation

**Files:**
- Modify: `src/renderer/styles/global.css`
- Modify: `src/renderer/index.html`

- [ ] **Step 1: Update `src/renderer/styles/global.css` body**

Change the `body` rule:

```css
body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #0b0d10;
  color: #e1e4e8;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 2: Update `src/renderer/index.html` title**

```html
<title>Claude Runtime</title>
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/styles/global.css src/renderer/index.html
git commit -m "style: dark theme body, rename app title to Claude Runtime"
```

---

### Task 8: RuntimePage (replaces TerminalPage)

**Files:**
- Create: `src/renderer/pages/RuntimePage.tsx`
- Delete: `src/renderer/pages/TerminalPage.tsx`

- [ ] **Step 1: Create `src/renderer/pages/RuntimePage.tsx`**

```typescript
import { useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { runtimeManager } from '../runtime/RuntimeManager'
import { ChevronLeft, Play, Square, ExternalLink, RefreshCw, Terminal, Zap } from 'lucide-react'

/** Map tmux status → user-facing label */
function statusLabel(status: string): string {
  switch (status) {
    case 'attached': return 'Active'
    case 'detached': return 'Background'
    case 'stopped': return 'Offline'
    default: return status
  }
}

export function RuntimePage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()

  const project = useAppStore((s) =>
    s.projects.find((p) => p.id === projectId)
  )
  const session = useAppStore((s) => (projectId ? s.sessions[projectId] : undefined))
  const devStatus = useAppStore((s) => s.processes[projectId!]?.status ?? 'stopped')
  const devUrl = useAppStore((s) => s.processUrls[projectId!] || '')
  const isDevRunning = devStatus === 'running'

  const startRuntime = useAppStore((s) => s.startRuntime)
  const stopRuntime = useAppStore((s) => s.stopRuntime)
  const openTerminal = useAppStore((s) => s.openTerminal)
  const refreshSessions = useAppStore((s) => s.refreshSessions)
  const startProject = useAppStore((s) => s.startProject)
  const stopProject = useAppStore((s) => s.stopProject)

  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const handleStartRuntime = useCallback(async () => {
    if (!projectId || !project) return
    setActionLoading('start')
    const sessionName = runtimeManager.getSessionName(projectId, project.name)
    await runtimeManager.startRuntime(projectId, sessionName, project.path)
    await refreshSessions()
    setActionLoading(null)
  }, [projectId, project, refreshSessions])

  const handleStopRuntime = useCallback(async () => {
    if (!projectId) return
    setActionLoading('stop')
    await stopRuntime(projectId)
    setActionLoading(null)
  }, [projectId, stopRuntime])

  const handleOpenTerminal = useCallback(async () => {
    if (!projectId || !session) return
    await openTerminal(projectId)
  }, [projectId, session, openTerminal])

  const handleRestart = useCallback(async () => {
    if (!projectId || !project || !session) return
    setActionLoading('restart')
    const sessionName = session.sessionName

    // Kill
    await runtimeManager.stopRuntime(projectId)

    // Wait for tmux to actually remove the session (poll, not blind sleep)
    await runtimeManager.waitForSessionGone(sessionName, 10000)

    // Re-create
    await runtimeManager.startRuntime(projectId, sessionName, project.path)
    await refreshSessions()
    setActionLoading(null)
  }, [projectId, project, session, refreshSessions])

  const isLoading = actionLoading !== null
  const isStopped = session?.status === 'stopped'
  const isAttached = session?.status === 'attached'
  const sessionLabel = statusLabel(session?.status ?? 'stopped')

  if (!project || !projectId) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-[#0b0d10]">
        <h2 className="text-lg font-semibold text-[#e1e4e8]">Project not found</h2>
        <button
          className="inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 transition-colors"
          onClick={() => navigate('/')}
        >
          <ChevronLeft className="w-4 h-4" strokeWidth={1.8} />
          Back to Home
        </button>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-[#0b0d10]">
      {/* ── Header ── */}
      <header
        className="flex items-center justify-between px-6 py-4 shrink-0 border-b border-white/5"
        style={{ background: '#111318' }}
      >
        <div className="flex items-center gap-4 min-w-0">
          <button
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors"
            onClick={() => navigate('/')}
          >
            <ChevronLeft className="w-5 h-5" strokeWidth={1.8} />
          </button>

          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-[#e1e4e8] tracking-tight truncate">
              {project.name}
            </h1>
            <p className="text-xs text-gray-500 truncate">{project.path}</p>
          </div>

          {/* Runtime status badge */}
          <div
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium shrink-0 ${
              isAttached
                ? 'bg-emerald-500/10 text-emerald-400'
                : !isStopped
                  ? 'bg-amber-500/10 text-amber-400'
                  : 'bg-white/5 text-gray-500'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isAttached
                  ? 'bg-emerald-500'
                  : !isStopped
                    ? 'bg-amber-500'
                    : 'bg-gray-600'
              }`}
            />
            {sessionLabel}
          </div>
        </div>

        {/* Dev server actions */}
        <div className="flex items-center gap-2 shrink-0">
          {isDevRunning && devUrl && (
            <button
              className="inline-flex items-center gap-1.5 text-xs text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 rounded-lg px-3 py-1.5 transition-colors max-w-[200px]"
              onClick={() => window.electronAPI.openExternal(devUrl)}
            >
              <ExternalLink className="w-3 h-3" />
              <span className="truncate">{devUrl}</span>
            </button>
          )}
          <button
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              isDevRunning
                ? 'border border-red-500/20 text-red-400 hover:bg-red-500/10'
                : 'text-gray-500 hover:text-gray-300 hover:bg-white/5 border border-white/10'
            }`}
            onClick={() =>
              isDevRunning ? stopProject(projectId) : startProject(projectId, undefined, undefined, false)
            }
          >
            {isDevRunning ? (
              <><Square className="w-3 h-3" /> Stop Dev</>
            ) : (
              <><Play className="w-3 h-3" /> Run Dev</>
            )}
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 flex flex-col min-h-0 px-6 py-6 overflow-auto">
        <div className="max-w-2xl mx-auto w-full space-y-6">
          {/* Runtime Status Card */}
          <div
            className="rounded-2xl border border-white/5 p-6"
            style={{ background: '#111318' }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-[#e1e4e8] uppercase tracking-wider">
                Claude Runtime
              </h2>
              <span className="text-[11px] text-gray-600 font-mono">
                {session?.sessionName ?? '—'}
              </span>
            </div>

            {/* Status indicators */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="text-center">
                <div
                  className={`w-2.5 h-2.5 rounded-full mx-auto mb-1.5 ${
                    isAttached ? 'bg-emerald-500' : !isStopped ? 'bg-amber-500' : 'bg-gray-600'
                  }`}
                />
                <p className="text-xs text-gray-400">{sessionLabel}</p>
              </div>
              <div className="text-center">
                <div
                  className={`w-2.5 h-2.5 rounded-full mx-auto mb-1.5 ${
                    isAttached ? 'bg-blue-500' : 'bg-gray-600'
                  }`}
                />
                <p className="text-xs text-gray-400">
                  {isAttached ? 'Connected' : 'Disconnected'}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-300 font-mono mb-1.5">
                  {session?.createdAt
                    ? new Date(session.createdAt).toLocaleTimeString()
                    : '—'}
                </p>
                <p className="text-[10px] text-gray-600">Created</p>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3">
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
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
                    onClick={handleOpenTerminal}
                  >
                    <Terminal className="w-4 h-4" />
                    Open Terminal
                  </button>
                  <button
                    disabled={isLoading}
                    className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all text-gray-400 hover:text-gray-200 hover:bg-white/5 border border-white/10 disabled:opacity-50"
                    onClick={handleRestart}
                  >
                    {actionLoading === 'restart' ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                    Restart
                  </button>
                  <button
                    disabled={isLoading}
                    className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20 disabled:opacity-50"
                    onClick={handleStopRuntime}
                  >
                    {actionLoading === 'stop' ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                    Stop
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Recent Activity (placeholder) */}
          <div
            className="rounded-2xl border border-white/5 p-6"
            style={{ background: '#111318' }}
          >
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Recent Activity
            </h3>
            <div className="space-y-2 text-sm font-mono">
              {isStopped ? (
                <p className="text-gray-600">— Press "Start Runtime" to launch Claude</p>
              ) : isAttached ? (
                <p className="text-gray-500">— Claude runtime active, terminal connected</p>
              ) : (
                <p className="text-gray-500">— Session running in background</p>
              )}
            </div>
          </div>

          {/* Runtime Info */}
          <div
            className="rounded-2xl border border-white/5 p-6"
            style={{ background: '#111318' }}
          >
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Runtime Info
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-[11px] text-gray-600 mb-0.5">Session</p>
                <p className="text-[#e1e4e8] font-mono text-xs">{session?.sessionName ?? '—'}</p>
              </div>
              <div>
                <p className="text-[11px] text-gray-600 mb-0.5">Type</p>
                <p className="text-[#e1e4e8]">{project.type}</p>
              </div>
              <div>
                <p className="text-[11px] text-gray-600 mb-0.5">Runtime</p>
                <p className="text-[#e1e4e8] font-mono text-xs">Claude Code</p>
              </div>
              <div>
                <p className="text-[11px] text-gray-600 mb-0.5">Backend</p>
                <p className="text-[#e1e4e8] font-mono text-xs">tmux</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Delete old TerminalPage**

```bash
rm src/renderer/pages/TerminalPage.tsx
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/pages/RuntimePage.tsx
git rm src/renderer/pages/TerminalPage.tsx
git commit -m "feat: replace TerminalPage with RuntimePage (no xterm.js, runtime dashboard)"
```

---

### Task 9: Home page — dark theme redesign

**Files:**
- Modify: `src/renderer/pages/Home.tsx`

- [ ] **Step 1: Rewrite `src/renderer/pages/Home.tsx`**

```typescript
import { useEffect, useCallback, useState, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { ProjectCard } from '../components/ProjectCard'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { ScrollArea } from '../components/ui/scroll-area'
import {
  FolderPlus,
  Search,
  Settings,
  Plus,
  Zap,
} from 'lucide-react'

// ── Toolbar ──────────────────────────────────────────────────────

function Toolbar({
  searchQuery,
  onSearchChange,
  onAddFolder,
  onSettingsClick,
  searchRef,
}: {
  searchQuery: string
  onSearchChange: (q: string) => void
  onAddFolder: () => void
  onSettingsClick: () => void
  searchRef: React.RefObject<HTMLInputElement>
}) {
  return (
    <header
      className="h-14 flex items-center px-6 gap-4 shrink-0 border-b border-white/5"
      style={{ background: '#111318' }}
    >
      <div className="flex items-center gap-2.5 mr-4">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
          <Zap className="w-4 h-4 text-white" />
        </div>
        <span className="text-sm font-semibold text-[#e1e4e8]">Claude Runtime</span>
      </div>

      <div className="flex-1 max-w-lg relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600 pointer-events-none" strokeWidth={1.8} />
        <Input
          ref={searchRef}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search projects..."
          className="h-9 pl-9 text-sm bg-white/5 border-white/10 text-[#e1e4e8] placeholder:text-gray-600 rounded-xl focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-0"
        />
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-gray-500 hover:text-gray-300 hover:bg-white/5"
          onClick={onSettingsClick}
        >
          <Settings className="w-4 h-4" strokeWidth={1.8} />
        </Button>
        <Button size="sm" className="h-9 gap-1.5 text-sm rounded-xl bg-blue-600 hover:bg-blue-700 text-white" onClick={onAddFolder}>
          <Plus className="w-4 h-4" strokeWidth={1.8} />
          New Project
        </Button>
      </div>
    </header>
  )
}

// ── Drag Overlay ─────────────────────────────────────────────────

function DragOverlay() {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center drag-overlay-border border-4 border-dashed rounded-none"
      style={{
        backgroundColor: 'rgba(59, 130, 246, 0.03)',
        borderColor: 'rgba(59, 130, 246, 0.2)',
      }}
    >
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-blue-500/10 flex items-center justify-center">
          <FolderPlus className="w-8 h-8 text-blue-400" strokeWidth={1.5} />
        </div>
        <p className="text-lg font-medium text-blue-400">Drop project folders anywhere</p>
        <p className="text-sm text-gray-500 mt-1">Release to add to your workspace</p>
      </div>
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────

export function HomePage() {
  const projects = useAppStore((s) => s.projects)
  const sessions = useAppStore((s) => s.sessions)
  const searchQuery = useAppStore((s) => s.searchQuery)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const addProject = useAppStore((s) => s.addProject)
  const loadConfig = useAppStore((s) => s.loadConfig)
  const updateLastOpened = useAppStore((s) => s.updateLastOpened)
  const navigate = useNavigate()

  const searchRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounter = useRef(0)

  useEffect(() => { loadConfig() }, [loadConfig])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault()
      dragCounter.current++
      setIsDragOver(true)
    }
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault()
      dragCounter.current--
      if (dragCounter.current === 0) setIsDragOver(false)
    }
    const onDragOver = (e: DragEvent) => { e.preventDefault() }
    const onDrop = async (e: DragEvent) => {
      e.preventDefault()
      dragCounter.current = 0
      setIsDragOver(false)
      const files = e.dataTransfer?.files
      if (files) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i] as File & { path?: string }
          if (file.path) await addProject(file.path)
        }
      }
    }
    const onDragEnd = () => {
      dragCounter.current = 0
      setIsDragOver(false)
    }

    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    document.addEventListener('dragend', onDragEnd)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
      document.removeEventListener('dragend', onDragEnd)
    }
  }, [addProject])

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects
    const q = searchQuery.toLowerCase().trim()
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.path.toLowerCase().includes(q) ||
        p.type.toLowerCase().includes(q)
    )
  }, [projects, searchQuery])

  const pinnedProjects = useMemo(() => filteredProjects.filter((p) => p.pinned), [filteredProjects])
  const recentProjects = useMemo(() => filteredProjects.filter((p) => !p.pinned), [filteredProjects])
  const runningCount = useMemo(
    () => Object.values(sessions).filter((s) => s.status !== 'stopped').length,
    [sessions]
  )

  const handleAddFolder = useCallback(async () => {
    const dirPath = await window.electronAPI.selectDirectory()
    if (dirPath) await addProject(dirPath)
  }, [addProject])

  const handleSelect = useCallback(
    (id: string) => {
      updateLastOpened(id)
      navigate(`/runtime/${id}`)
    },
    [updateLastOpened, navigate]
  )

  // ── Empty state ──
  if (projects.length === 0) {
    return (
      <div className="h-screen flex flex-col bg-[#0b0d10]">
        {isDragOver && <DragOverlay />}
        <header
          className="h-14 flex items-center px-6 shrink-0 border-b border-white/5"
          style={{ background: '#111318' }}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-semibold text-[#e1e4e8]">Claude Runtime</span>
          </div>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-gray-500 hover:text-gray-300 hover:bg-white/5"
            onClick={() => navigate('/settings')}
          >
            <Settings className="w-4 h-4" strokeWidth={1.8} />
          </Button>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center" style={{ background: '#0b0d10' }}>
          <div className="flex flex-col items-center gap-6 max-w-md text-center px-6">
            <div className="w-20 h-20 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
              <FolderPlus className="w-10 h-10 text-gray-700" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-[#e1e4e8] mb-2">Add a project folder</h1>
              <p className="text-sm text-gray-500">Drop a folder or browse to get started</p>
            </div>
            <Button onClick={handleAddFolder} className="gap-2 rounded-xl h-10 px-5 bg-blue-600 hover:bg-blue-700 text-white" size="lg">
              <Plus className="w-4 h-4" strokeWidth={1.8} />
              Add Project Folder
            </Button>
            <p className="text-xs text-gray-600">
              Node.js &middot; Python &middot; Vite &middot; Next.js &middot; Django &middot; more
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── Populated state ──
  return (
    <div className="h-screen flex flex-col bg-[#0b0d10]">
      {isDragOver && <DragOverlay />}
      <Toolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onAddFolder={handleAddFolder}
        onSettingsClick={() => navigate('/settings')}
        searchRef={searchRef}
      />
      <ScrollArea className="flex-1">
        <div className="max-w-5xl mx-auto w-full px-8 py-8">
          <div className="mb-8">
            <h1 className="text-lg font-semibold text-[#e1e4e8]">Projects</h1>
            <p className="text-sm text-gray-500 mt-1 flex items-center gap-2">
              <span>{projects.length} project{projects.length !== 1 ? 's' : ''}</span>
              {runningCount > 0 && (
                <>
                  <span className="text-gray-700">&middot;</span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    {runningCount} runtime{runningCount !== 1 ? 's' : ''} active
                  </span>
                </>
              )}
            </p>
          </div>

          {pinnedProjects.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Pinned</h2>
              </div>
              <div className="flex flex-col gap-2">
                {pinnedProjects.map((project, index) => (
                  <ProjectCard key={project.id} project={project} index={index} onSelect={handleSelect} />
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {pinnedProjects.length > 0 ? 'All Projects' : 'Projects'}
              </h2>
            </div>
            {recentProjects.length > 0 ? (
              <div className="flex flex-col gap-2">
                {recentProjects.map((project, index) => (
                  <ProjectCard key={project.id} project={project} index={index} onSelect={handleSelect} />
                ))}
              </div>
            ) : (
              <div className="text-center py-16 text-sm text-gray-600">
                {searchQuery ? 'No projects match your search' : 'No projects yet'}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/pages/Home.tsx
git commit -m "feat: dark theme Home page with Claude Runtime branding"
```

---

### Task 10: ProjectCard — dark theme redesign

**Files:**
- Modify: `src/renderer/components/ProjectCard.tsx`

- [ ] **Step 1: Rewrite `src/renderer/components/ProjectCard.tsx`**

```typescript
import { useNavigate } from 'react-router-dom'
import type { ProjectInfo } from '../../shared/types'
import { useAppStore } from '../stores/appStore'
import { Badge } from './ui/badge'
import { Pin, Play, Square, Folder, ExternalLink, Trash2, FileText, Zap } from 'lucide-react'

interface ProjectCardProps {
  project: ProjectInfo
  onSelect: (id: string) => void
  index?: number
}

export function ProjectCard({ project, onSelect, index = 0 }: ProjectCardProps) {
  const navigate = useNavigate()

  const devStatus = useAppStore((s) => s.processes[project.id]?.status ?? 'stopped')
  const devUrl = useAppStore((s) => s.processUrls[project.id] || '')
  const startProject = useAppStore((s) => s.startProject)
  const stopProject = useAppStore((s) => s.stopProject)

  const session = useAppStore((s) => s.sessions[project.id])
  const isRuntimeAttached = session?.status === 'attached'
  const isRuntimeDetached = session?.status === 'detached'
  const isRuntimeActive = isRuntimeAttached || isRuntimeDetached

  const togglePin = useAppStore((s) => s.togglePin)
  const removeProject = useAppStore((s) => s.removeProject)
  const isDevRunning = devStatus === 'running'

  return (
    <div
      className="group relative flex items-center gap-4 rounded-xl px-5 py-3.5 cursor-pointer
                 transition-all duration-150 ease-out card-enter"
      style={{
        background: '#111318',
        border: '1px solid rgba(255,255,255,0.05)',
        animationDelay: `${index * 40}ms`,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)' }}
      onClick={() => onSelect(project.id)}
    >
      {/* Icon */}
      <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
        <Folder className="h-4 w-4 text-blue-400" strokeWidth={1.8} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[#e1e4e8] truncate">{project.name}</h3>
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              isRuntimeAttached ? 'bg-emerald-500' : isRuntimeDetached ? 'bg-amber-500' : 'bg-gray-600'
            }`}
            title={
              isRuntimeAttached ? 'Runtime Active' : isRuntimeDetached ? 'Runtime Background' : 'Runtime Offline'
            }
          />
          {isDevRunning && (
            <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" title="Dev server running" />
          )}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <p className="text-xs text-gray-500 truncate max-w-[280px]" title={project.path}>{project.path}</p>
          <Badge variant="secondary" className="text-[10px] h-5 px-1.5 capitalize font-medium shrink-0 bg-white/5 text-gray-400 border-white/10">
            {project.type}
          </Badge>
          {project.packageManager && (
            <Badge variant="secondary" className="text-[10px] h-5 px-1.5 font-medium shrink-0 bg-white/5 text-gray-400 border-white/10">
              {project.packageManager}
            </Badge>
          )}
        </div>
        {isRuntimeActive && session && (
          <p className="text-[10px] text-gray-600 mt-0.5 flex items-center gap-1">
            <Zap className="w-2.5 h-2.5" />
            {session.sessionName}
            {isRuntimeAttached && <span className="text-blue-500/60">· Connected</span>}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {isDevRunning && devUrl && (
          <button
            className="flex items-center gap-1 text-xs text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 rounded-lg px-2.5 py-1.5 transition-colors max-w-[200px]"
            onClick={(e) => { e.stopPropagation(); window.electronAPI.openExternal(devUrl) }}
            title={devUrl}
          >
            <ExternalLink className="h-3 w-3 shrink-0" />
            <span className="truncate">{devUrl}</span>
          </button>
        )}
        {isDevRunning ? (
          <button
            className="h-8 px-3 text-xs rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 flex items-center gap-1 font-medium transition-colors shrink-0"
            onClick={(e) => { e.stopPropagation(); stopProject(project.id) }}
          >
            <Square className="h-3 w-3" />
            <span className="hidden sm:inline">Stop</span>
          </button>
        ) : (
          <button
            className="h-8 px-3 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1 font-medium transition-colors shrink-0"
            onClick={(e) => { e.stopPropagation(); startProject(project.id, undefined, undefined, false) }}
          >
            <Play className="h-3 w-3" />
            <span className="hidden sm:inline">Run</span>
          </button>
        )}
        <button
          className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-600 hover:text-blue-400 hover:bg-white/5 transition-colors"
          title="View details"
          onClick={(e) => { e.stopPropagation(); navigate(`/project/${project.id}`) }}
        >
          <FileText className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
          <button
            className="p-1 rounded-md text-gray-600 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
            title={project.pinned ? 'Unpin' : 'Pin'}
            onClick={(e) => { e.stopPropagation(); togglePin(project.id) }}
          >
            <Pin className={`h-3.5 w-3.5 ${project.pinned ? 'fill-amber-400 text-amber-400' : ''}`} />
          </button>
          <button
            className="p-1 rounded-md text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Remove"
            onClick={(e) => { e.stopPropagation(); removeProject(project.id) }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/ProjectCard.tsx
git commit -m "style: dark theme ProjectCard with runtime status indicators"
```

---

### Task 11: Verify TypeScript compilation

**Note:** MUST run from Windows terminal, NOT WSL (build constraint).

- [ ] **Step 1: Type-check**

```bash
npx tsc --noEmit
```

Expected: No type errors. If errors, fix them before proceeding.

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: final type-check and build verification" --allow-empty
```
