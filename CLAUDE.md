# IDE Electron — Project Launcher

## Architecture

- Electron app with React renderer (Zustand + React Router + xterm.js)
- `src/main/` — Electron main process (runner, capability detection, env capture, WSL bridge)
- `src/renderer/` — React UI (pages, components, stores)
- `src/preload/` — contextBridge API between main and renderer
- `src/shared/` — shared types and detection rules

## Environment isolation

Detail page = Windows native. TerminalPage Claude = WSL.
Every `startProcess` call passes `useWsl?: boolean` to select the execution environment.
See `.claude/rules/` for detailed constraints.

## Build constraint

Never run `npm install` or `npm run build` from WSL on `/mnt/d/` paths.
Permission errors will corrupt node_modules. Code edits from WSL are fine; all npm ops must run from Windows terminal.

## Key files

| File | Role |
|------|------|
| `src/main/runner.ts` | ProcessManager — `useWsl:false`→host-native, `useWsl:true`→wsl-pty, legacy tmux/spawn |
| `src/main/capability-manager.ts` | Boot-time probe for WSL/tmux/node-pty + env capture via `bash -ilc env` |
| `src/renderer/stores/appStore.ts` | Zustand store — single source of truth for all process state |
| `src/renderer/pages/TerminalPage.tsx` | Claude terminal (WSL) + headless dev server Run button |
| `src/renderer/pages/Detail.tsx` | Project detail + dev server terminal (Windows) |
| `src/renderer/pages/Home.tsx` | Project launcher dashboard |
