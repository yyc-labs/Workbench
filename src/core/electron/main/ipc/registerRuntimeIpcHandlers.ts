import { ipcMain } from 'electron'
import { IPC } from '../ipc'
import { tmuxManager } from '../tmux-manager'
import { openSshTerminal, openTerminalAtPath } from '../shell/openers'
import type {
  TerminalProcessInventory,
  TerminalStopAllResult,
} from '../../../shared/types'
import {
  getBootDistro,
  type RegisterIpcHandlersDependencies,
} from './registerIpcHandlers.shared'

export function registerRuntimeIpcHandlers(
  deps: RegisterIpcHandlersDependencies
): void {
  ipcMain.handle(
    IPC.RUNTIME_START,
    async (_event, projectId: string, projectPath: string, cli?: 'claude' | 'codex') => {
      return deps.runtimeService.startRuntime(projectId, projectPath, cli)
    }
  )

  ipcMain.handle(IPC.SHELL_OPEN_TERMINAL, async (_event, sessionName: string, statusHint?: string) => {
    return deps.runtimeService.openRuntimeTerminal(sessionName, statusHint)
  })

  ipcMain.handle(IPC.SHELL_OPEN_PATH_TERMINAL, async (_event, folderPath: string, command?: string) => {
    return openTerminalAtPath(folderPath, getBootDistro(deps), command)
  })

  ipcMain.handle(
    IPC.SHELL_OPEN_SSH_TERMINAL,
    async (
      _event,
      payload: {
        host: string
        port?: number
        username: string
        password?: string | null
        route?: 'wsl' | 'windows'
      }
    ) => {
      return openSshTerminal(getBootDistro(deps), payload)
    }
  )

  ipcMain.handle(IPC.RUNTIME_LIST_ENTRIES, () => {
    return deps.runtimeService.listRuntimeEntries()
  })

  ipcMain.handle(IPC.RUNTIME_LIST_SESSIONS, () => {
    return deps.runtimeService.listRuntimeSessions()
  })

  ipcMain.handle(IPC.RUNTIME_DIAGNOSTICS, async () => {
    return deps.runtimeService.diagnoseRuntime()
  })

  ipcMain.handle(IPC.WSL_GET_CAPABILITY, () => {
    return deps.getBootCapability()
  })

  ipcMain.handle(IPC.TMUX_LIST_SESSIONS, () => {
    return tmuxManager.listLauncherSessions()
  })

  ipcMain.handle(IPC.TMUX_KILL_SESSION, (_event, sessionName: string) => {
    return deps.runtimeService.killTmuxSession(sessionName)
  })

  ipcMain.handle(IPC.TERMINAL_LIST_ALL, async (): Promise<TerminalProcessInventory> => {
    return deps.runtimeService.listTerminalInventory()
  })

  ipcMain.handle(IPC.TERMINAL_STOP_ALL, async (): Promise<TerminalStopAllResult> => {
    return deps.runtimeService.stopAllTerminals()
  })
}
