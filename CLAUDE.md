# IDE Electron — Project Launcher

## Architecture

- Electron app with React renderer (Zustand + React Router + xterm.js)
- `src/core/electron/main/` — Electron main process (runner, capability detection, env capture, WSL bridge)
- `src/core/renderer/` — React UI (pages, components, stores)
- `src/core/electron/preload/` — contextBridge API between main and renderer
- `src/core/shared/` — shared types and detection rules

## Environment isolation

Dev `Run` (Home / Detail / RuntimePage) must follow project environment:
- Windows project path -> run in Windows native (`useWsl: false`)
- WSL/Ubuntu project path -> run in WSL (`useWsl: true`)
- Do not mix environments for the same project run action.

`appStore.startProject` now auto-resolves `useWsl` from `detectProjectEnvironment(project.path)` and then calls `startProcess`.
Only pass explicit `useWsl` when a callsite has a very specific override reason.

Runtime (Claude/Codex tmux session) remains WSL-based by design.
See `.claude/rules/` for detailed constraints.

## Build constraint

Never run `npm install` or `npm run build` from WSL on `/mnt/d/` paths.
Permission errors will corrupt node_modules. Code edits from WSL are fine; all npm ops must run from Windows terminal.

### Hard safety rule (must follow)

- In WSL, do **not** execute any dependency install/rebuild command in this repo.
- Forbidden in WSL: `npm i`, `npm install`, `pnpm i`, `pnpm install`, `yarn install`, `electron-rebuild`, `node-gyp`, `npx electron-rebuild`.
- If dependency changes are needed, stop and ask the user first, then only provide Windows PowerShell commands for the user to run manually.

## Key files

| File | Role |
|------|------|
| `src/core/electron/main/runner.ts` | ProcessManager — `useWsl:false`→host-native, `useWsl:true`→wsl-pty, legacy tmux/spawn |
| `src/core/electron/main/capability-manager.ts` | Boot-time probe for WSL/tmux/node-pty + env capture via `bash -ilc env` |
| `src/core/renderer/stores/appStore.ts` | Zustand store — single source of truth for all process state |
| `src/core/renderer/lib/projectEnvironment.ts` | Path-based environment detection (Windows vs Ubuntu/WSL) |
| `src/core/renderer/pages/RuntimePage.tsx` | Runtime dashboard + dev server Run button |
| `src/core/renderer/pages/Detail.tsx` | Project detail + dev server terminal |
| `src/core/renderer/pages/Home.tsx` | Project launcher dashboard |
