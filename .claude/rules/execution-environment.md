# Execution Environment

## Rule

Every call to `startProject()` / `startProcess()` MUST pass an explicit `useWsl` boolean when the caller knows which environment it needs. Never rely on the global default backend.

## Environments

| `useWsl` | Spawns via | Use case |
|-----------|-----------|----------|
| `false` | `cmd.exe /c <command>` (Windows) | Project dev servers (`npm run dev`, `python manage.py runserver`) |
| `true` | `wsl.exe -d <distro> -e bash -lc <command>` (wsl-pty) | Claude (`claude --continue`), Linux-only tools |
| `undefined` | Global backend (boot probe) | Backward compat only; do NOT use in new code |

## Where each value is required

- **Detail page** (`Detail.tsx`): always `useWsl: false` — this page is Windows-native
- **TerminalPage Run button**: `useWsl: false` — dev server runs on Windows host
- **TerminalPage Claude button**: `useWsl: true` — Claude is a Linux binary, requires WSL
- **ProjectCard quick-start**: `useWsl: false` — starts project dev server
- **Reattach**: `useWsl` not passed (empty command triggers tmux attach)

## Env capture

At boot, `CapabilityManager` runs `bash -ilc env` once to capture the full WSL environment (PATH, API keys, proxy, WSL path fixes). The captured env is stored in `Capability.wslEnv`.

Before every WSL command executes, `ProcessManager.wslEnvPrefix()` prepends `export KEY='VAL' && ...` to inject the captured environment. This means WSL commands get the correct PATH (nvm), API keys, proxy settings etc. without needing interactive shells or manual sourcing.

## IPC contract

`process:start` carries `(projectId, command, cwd, useWsl?)` through the chain:
```
renderer (startProject) → preload (startProcess) → main (IPC handler) → runner (ProcessManager.start)
```

Each layer must forward `useWsl` unchanged. Do not drop or coerce it.

## Runner dispatch

```
start(projectId, command, cwd, useWsl)
  useWsl === false && win32  → startHostNative()    // cmd.exe /c
  useWsl === true && hasWsl  → startWithPty()       // wsl-pty (direct, no tmux)
  undefined                  → switch(backend)      // tmux | wsl-pty | direct-pty | spawn
```

`startWithPty` checks `process.platform === 'win32' && hasWsl` (NOT the global backend) to decide whether to route through WSL. This ensures `useWsl: true` works even when the global backend is `tmux`.

## Why

The app runs on Windows. Claude is a Linux binary and must execute inside WSL. Project dev servers (`npm`, `python`, etc.) are Windows-native and must NOT go through WSL — doing so would run them in a Linux environment where Windows-only tools and paths break.

Tmux added session-management complexity without enough benefit for single-session Claude use. Switching to direct wsl-pty simplifies the architecture and eliminates session-recovery edge cases.

## Dependency Safety (WSL)

### Hard constraint

- Never run dependency install/rebuild commands from WSL in this repo path (`/mnt/d/...`).
- Forbidden in WSL: `npm i`, `npm install`, `pnpm i`, `pnpm install`, `yarn install`, `electron-rebuild`, `node-gyp`, `npx electron-rebuild`.
- When dependency changes are required: pause execution, ask user approval, and provide Windows PowerShell commands for manual execution instead of running them in WSL.
