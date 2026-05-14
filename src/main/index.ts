import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join, basename } from 'path'
import { createHash } from 'crypto'
import { spawn } from 'child_process'
import { ProcessManager } from './runner'
import { detectProject } from './detector'
import { loadConfig, updateConfig } from './config'
import { IPC } from './ipc'
import { capabilityManager } from './capability-manager'
import { tmuxManager } from './tmux-manager'
import { wslBridge } from './wsl-bridge'
import { setRuntimeEntry, listRuntimeEntries, removeRuntimeEntry } from './runtime-registry'
import { terminalHost } from './terminal-host'
import type { Capability } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let processManager: ProcessManager | null = null
let bootCapability: Capability | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: join(__dirname, '../../icon/Y.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  })

  mainWindow.setMenuBarVisibility(false)

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  if (processManager) {
    processManager.setOutputWindow(mainWindow)
  }

  registerIpcHandlers()

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC.DETECT_DIRECTORY, (_event, dirPath: string) => {
    return detectProject(dirPath)
  })

  ipcMain.handle(
    IPC.PROCESS_START,
    (_event, projectId: string, command: string, cwd: string, useWsl?: boolean) => {
      return processManager?.start(projectId, command, cwd, useWsl) ?? false
    }
  )

  ipcMain.handle(IPC.PROCESS_STOP, (_event, projectId: string) => {
    return processManager?.stop(projectId) ?? false
  })

  ipcMain.handle(
    IPC.PROCESS_INPUT,
    (_event, projectId: string, data: string) => {
      processManager?.sendInput(projectId, data)
      return true
    }
  )

  ipcMain.handle(IPC.PROCESS_RESIZE, (_event, projectId: string, cols: number, rows: number) => {
    processManager?.resize(projectId, cols, rows)
    return true
  })

  ipcMain.handle(IPC.CONFIG_GET, () => {
    return loadConfig()
  })

  ipcMain.handle(
    IPC.CONFIG_SET,
    (_event, partial: Record<string, unknown>) => {
      return updateConfig(partial as Partial<{ projects: never; theme: 'system' | 'light' | 'dark' }>)
    }
  )

  ipcMain.handle(IPC.SHELL_OPEN_EXTERNAL, (_event, url: string) => {
    return shell.openExternal(url)
  })

  ipcMain.handle(IPC.DIALOG_SELECT_DIRECTORY, async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    })
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0]
    }
    return null
  })

  // ── Runtime Manager ──────────────────────────────────────

  ipcMain.handle(
    IPC.RUNTIME_START,
    async (_event, projectId: string, projectPath: string) => {
      const distro = bootCapability?.wslDistro || 'Ubuntu'
      const wslPath = wslBridge.toWslPath(projectPath)

      // Match the script's session naming: basename + first 6 chars of MD5(path)
      const md5 = createHash('md5').update(wslPath).digest('hex').slice(0, 6)
      const sessionName = `${basename(projectPath)}-${md5}`

      return new Promise<boolean>((resolve) => {
        const child = spawn(
          'wsl.exe',
          [
            '-d',
            distro,
            '--',
            'bash',
            '-lc',
            `$HOME/tools/claude-code-script/start-claude-with-env.sh '${wslPath}'`
          ],
          {
            detached: true,
            windowsHide: true,
            stdio: 'ignore',
          }
        )

        child.on('error', (err) => {
          console.error('[runtime:start] spawn failed:', err.message)
          resolve(false)
        })

        child.on('spawn', () => {
          setRuntimeEntry({
            projectId,
            sessionName,
            createdAt: Date.now(),
            lastOpened: Date.now(),
          })

          resolve(true)
        })

        child.unref()
      })
    }
  )

  ipcMain.handle(IPC.SHELL_OPEN_TERMINAL, async (_event, sessionName: string) => {
    if (!bootCapability) return false

    // 1. Ensure singleton Windows Terminal + tmux is running
    const ok = await terminalHost.ensureHost(bootCapability)
    if (!ok) return false

    // 2. Switch the client to the target tmux session
    const distro = bootCapability.wslDistro || 'Ubuntu'
    return terminalHost.switchSession(sessionName, distro)
  })

  ipcMain.handle(IPC.RUNTIME_LIST_ENTRIES, () => {
    return listRuntimeEntries()
  })

  // ── WSL / tmux ──────────────────────────────────────────

  ipcMain.handle(IPC.WSL_GET_CAPABILITY, () => {
    return bootCapability
  })

  ipcMain.handle(IPC.TMUX_LIST_SESSIONS, () => {
    return tmuxManager.listLauncherSessions()
  })

  ipcMain.handle(IPC.TMUX_KILL_SESSION, (_event, sessionName: string) => {
    return tmuxManager.killSession(sessionName)
  })

  ipcMain.handle(IPC.TMUX_REHYDRATE, () => {
    return tmuxManager.rehydrate()
  })
}

// ── before-quit ───────────────────────────────────────────

let isQuitting = false

app.on('before-quit', async (e) => {
  if (isQuitting) return
  e.preventDefault()
  isQuitting = true

  // Kill tmux sessions first (async, but we don't await — best-effort)
  tmuxManager.killAllLauncherSessions()

  processManager?.stopAll()

  setTimeout(() => {
    app.quit()
  }, 1500)
})

// ── startup ──────────────────────────────────────────────

app.whenReady().then(async () => {
  // P0 1: One-time capability probe
  await capabilityManager.init()
  bootCapability = capabilityManager.get()

  // P0 2: Rehydrate tmux sessions if available
  if (bootCapability.backend === 'tmux') {
    await tmuxManager.rehydrate()
  }

  // Create ProcessManager with capability injected
  processManager = new ProcessManager(bootCapability)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
