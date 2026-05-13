# Terminal Behavior

## Rule

The two terminal surfaces in the app are fully isolated — they connect to different processes, render different output, and live in different execution environments. Never mix them.

## Terminal bindings

| Page | Terminal component | Process key | Shows | Environment |
|------|-------------------|-------------|-------|-------------|
| `Detail.tsx` | `<Terminal projectId={projectId} />` | `projectId` | Dev server stdout/stderr | Windows |
| `TerminalPage.tsx` | `<Terminal projectId={claudeProcessId} />` | `{projectId}__claude` | Claude interactive session | WSL (wsl-pty) |

## TerminalPage specifics

- **The terminal panel ONLY shows Claude output.** The `Terminal` component receives `claudeProcessId` (`{projectId}__claude`), never `projectId`.
- **Dev server started from TerminalPage is headless** — its output goes to `terminalOutputs[projectId]` in the store but is NOT rendered in TerminalPage. To see dev server output, the user navigates to the Detail page.
- **The title bar reads "claude — wsl"** to signal the execution environment.
- **The Run button** starts `projectId` with `useWsl: false` (Windows, silent in this page).
- **Claude starts directly via wsl-pty** (no tmux). Env vars (PATH, API keys, proxy) are injected by the runner's env-capture system at spawn time.
- **Reattach** is for legacy tmux sessions only. New Claude sessions do not create tmux sessions.

## Detail page specifics

- **The terminal panel ONLY shows dev server output.** The `Terminal` component receives `projectId`.
- **The title bar reads "terminal"** (Windows-native context is implicit since Detail is the Windows page).
- **The editable command bar** lets users override `project.command` per project. Saved via `setConfig`.

## Terminal performance

- `Terminal` component is wrapped in `React.memo` — parent rerenders won't cascade into xterm.
- Canvas renderer (`rendererType: 'canvas'`) for better GPU perf in Electron.
- Output is batched at rAF rate (60fps flush) instead of writing on every PTY data event.
- Fit is debounced at 80ms to avoid resize-thrash.
- No `backdrop-filter: blur()` on headers (GPU compositing killer).
- Terminal shells use flat dark backgrounds without box-shadows or large border-radius.

## Why

Before this convention, both pages shared the same `projectId` terminal, causing Claude output to appear in Detail and dev output to pollute the Claude session. Separating the process keys and terminal bindings gives each environment its own clean terminal surface.

Tmux was removed from the Claude path because direct wsl-pty is simpler: no session management, no reattach edge cases, and env capture handles PATH/env injection at spawn time.
