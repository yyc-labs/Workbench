# State Synchronization

## Rule

The Zustand store (`appStore.ts`) is the single source of truth for all process state. Every component reads from the same `store.processes` map. When choosing a process key, ask: "will this key give me the right shared state?"

## How sync works

All three views read the dev server status from the same store key:

```
Detail.tsx:        processes[projectId]?.status   → status badge + Run button state
TerminalPage.tsx:  processes[projectId!]?.status  → Run button state (dev is headless here)
ProjectCard.tsx:   processes[project.id]?.status  → card indicator + inline Open/Stop button
```

Because they all subscribe to `processes[projectId]`, any state change is instantly reflected everywhere — no manual event bus, no polling, no prop drilling.

## What triggers state changes

| Action | Store mutation |
|--------|---------------|
| `startProject(id)` | `processes[id] = { status: 'running' }` |
| `stopProject(id)` | `processes[id] = { status: 'stopped' }` |
| `handleProcessExit(id)` (IPC `process:exit`) | `processes[id] = { status: 'stopped' }` |
| `updateProcessStatus(id, status)` (IPC `process:status`) | `processes[id].status = status` |
| `markProjectDetached(id)` | `processes[id] = { status: 'detached' }` |

## Constraints

- **Never bypass the store.** Always call `startProject()` / `stopProject()` rather than invoking `window.electronAPI.startProcess()` directly. The store action sets local state BEFORE the IPC call so the UI is immediately responsive.
- **Claude state is NOT synced across views.** `processes[{projectId}__claude]` is only read by TerminalPage. Detail and ProjectCard do not need to know about Claude state.
- **Dev server state IS synced across views.** This is the intentional design — if the user starts the dev server from anywhere, all views show it as running.
- **`reattachProject` is for legacy tmux sessions only.** New Claude sessions use direct wsl-pty (no tmux), so the detached→reattach flow no longer applies to Claude. It sets `status: 'running'` optimistically, then sends an empty command to the runner (which only attaches to existing tmux sessions).

## Env capture

At boot, `CapabilityManager` captures the full WSL environment via `bash -ilc env`. The captured env is stored in `Capability.wslEnv` and injected into every WSL PTY spawn via `wslEnvPrefix()`. This avoids the need for interactive shells or manual sourcing of `.bashrc`/`.profile`/`nvm.sh` at process start time.

## Why

Before this convention, TerminalPage's Claude button and Detail's Run button used different process keys for the same dev server, causing state desync. When a user started the dev server from TerminalPage, the Detail page showed "Stopped" because it was watching a different key. Unifying on `projectId` for the dev server eliminated this.


