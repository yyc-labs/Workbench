import { ipcRenderer } from 'electron'
import { IPC } from '../main/ipc'
import type { AiRuntimeProfile } from '../../shared/types'

export function createRuntimeInvokeApi() {
  return {
    getCapability: () => ipcRenderer.invoke(IPC.WSL_GET_CAPABILITY),

    listTmuxSessions: () => ipcRenderer.invoke(IPC.TMUX_LIST_SESSIONS),

    killTmuxSession: (sessionName: string) => ipcRenderer.invoke(IPC.TMUX_KILL_SESSION, sessionName),

    listTerminalProcesses: () => ipcRenderer.invoke(IPC.TERMINAL_LIST_ALL),

    stopAllTerminalProcesses: () => ipcRenderer.invoke(IPC.TERMINAL_STOP_ALL),

    startRuntime: (
      projectId: string,
      projectPath: string,
      profile?: AiRuntimeProfile | null,
      cli?: 'claude' | 'codex',
    ) => ipcRenderer.invoke(IPC.RUNTIME_START, projectId, projectPath, profile, cli),

    getRuntimeDiagnostics: (profile?: AiRuntimeProfile | null) =>
      ipcRenderer.invoke(IPC.RUNTIME_DIAGNOSTICS, profile),

    listRuntimeSessions: () => ipcRenderer.invoke(IPC.RUNTIME_LIST_SESSIONS),

    listRuntimeEntries: () => ipcRenderer.invoke(IPC.RUNTIME_LIST_ENTRIES),

    openTerminal: (sessionName: string, statusHint?: string) =>
      ipcRenderer.invoke(IPC.SHELL_OPEN_TERMINAL, sessionName, statusHint),

    openPathTerminal: (folderPath: string, command?: string) =>
      ipcRenderer.invoke(IPC.SHELL_OPEN_PATH_TERMINAL, folderPath, command),

    openSshTerminal: (
      payload: {
        host: string
        port?: number
        username: string
        password?: string | null
        route?: 'wsl' | 'windows'
      }
    ) => ipcRenderer.invoke(IPC.SHELL_OPEN_SSH_TERMINAL, payload) as Promise<{
      ok: boolean
      mode: 'wsl-expect' | 'native-ssh'
      autoLogin: boolean
      message?: string
      reason?:
        | 'invalid-input'
        | 'windows-host-required'
        | 'wsl-not-installed'
        | 'wsl-distro-unavailable'
        | 'wsl-bash-unavailable'
        | 'wsl-expect-unavailable'
        | 'terminal-launch-failed'
    }>,
  }
}
