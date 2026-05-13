# Process Key Naming Convention

## Rule

Every running process in `store.processes` is keyed by a unique string. Two keys MUST NOT map to the same logical process, and two logical processes MUST NOT share a key.

## Key allocation

| Key | Process | Environment | Who reads it |
|-----|---------|------------|--------------|
| `projectId` | Dev server (project command) | Windows (cmd.exe) | Detail, TerminalPage, ProjectCard |
| `{projectId}__claude` | Claude session | WSL (wsl-pty) | TerminalPage only |

## Constraints

- **Dev server key = `projectId`** — exactly the project's hash ID. This is the shared key that enables state sync across all views. Detail page, TerminalPage Run button, and ProjectCard all start/stop this same key.
- **Claude key = `{projectId}__claude`** — suffixed to avoid collision with the dev server key. Only TerminalPage touches this key.
- **No other suffixes** — `__dev`, `__server`, etc. are deprecated. The `__dev` suffix was replaced by direct `projectId` usage for the dev server.
- **`processId` parameter**: the `startProject` store method accepts an optional `processId` (3rd positional arg, before `useWsl`). When omitted, it defaults to `projectId`. Use `processId` only when the caller needs a key different from `projectId` (i.e., Claude sessions).

## Environment routing

| `useWsl` | Backend | Shell |
|-----------|---------|-------|
| `false` | `startHostNative()` | `cmd.exe /c <command>` |
| `true` | `startWithPty()` (wsl-pty) | `wsl.exe -d <distro> -e bash -lc <command>` |
| `undefined` | Global backend switch | tmux / wsl-pty / direct-pty / spawn |

`startWithPty` uses `process.platform === 'win32' && hasWsl` (not the global backend) to decide WSL routing. This keeps `useWsl: true` working regardless of whether tmux is installed.

## Env injection

Before every WSL command executes, `wslEnvPrefix()` prepends the captured environment as `export KEY='VAL' && ...` statements. The captured env comes from `bash -ilc env` at boot (see `execution-environment.md`). This means Claude inherits the user's full WSL PATH, API keys, proxy settings, and WSL path fixes without manual sourcing.

## Why

Before this convention, TerminalPage's Claude button and Detail's Run button both used `projectId` as the process key. Starting Claude would overwrite the dev server's state and vice versa. The suffix convention (`__claude`) eliminates the collision while keeping the dev server key simple for cross-view sync.

Claude moved from tmux to direct wsl-pty for simplicity: no session management, no reattach edge cases, and env capture handles PATH/env injection at spawn time.
