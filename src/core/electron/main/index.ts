import { app, BrowserWindow, globalShortcut, nativeTheme } from 'electron'
import { ProcessManager } from './runner'
import { loadConfig } from './config'
import { IPC } from './ipc'
import { capabilityManager } from './capability-manager'
import { createGitService } from './git/git-service'
import { createRuntimeService } from './runtime/runtime-service'
import { createAiCommitService } from './ai-commit/ai-commit-service'
import { AgentHookGateway } from './hooks/agent-hook-gateway'
import { FeishuNotifier } from './hooks/feishu-notifier'
import { registerIpcHandlers } from './ipc/registerIpcHandlers'
import { createWindow, applyWindowBackground } from './window/createWindow'
import type { Capability } from '../../shared/types'

let mainWindow: BrowserWindow | null = null
let processManager: ProcessManager | null = null
let bootCapability: Capability | null = null
const GLOBAL_HOME_SHORTCUT_ACCELERATOR = 'CommandOrControl+Alt+H'
const GLOBAL_THEME_SHORTCUT_ACCELERATOR = 'CommandOrControl+Alt+L'
const gitService = createGitService({
  getDefaultWslDistro: () => bootCapability?.wslDistro || 'Ubuntu',
})
const runtimeService = createRuntimeService({
  getCapability: () => bootCapability,
  getProcessManager: () => processManager,
  emitRuntimeStateChanged,
})
const aiCommitService = createAiCommitService({
  getMainWindow: () => mainWindow,
  getDefaultWslDistro: () => bootCapability?.wslDistro || 'Ubuntu',
})
const feishuNotifier = new FeishuNotifier({
  getConfig: () => loadConfig().agentHooks,
})
const agentHookGateway = new AgentHookGateway({
  getConfig: () => loadConfig().agentHooks,
  onEvent: (event) => {
    mainWindow?.webContents.send(IPC.AGENT_HOOK_EVENT, event)
    void feishuNotifier.notifyIfNeeded(event).catch(() => undefined)
  },
})

function createMainWindow(): void {
  const config = loadConfig()

  mainWindow = createWindow({
    theme: config.theme,
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
    onToggleViewMode: () => {
      mainWindow?.webContents.send(IPC.CODE_TOGGLE_VIEW_MODE)
    },
    onFocusSearch: () => {
      mainWindow?.webContents.send(IPC.CODE_FOCUS_SEARCH)
    },
    onWindowStateChange: (isMaximized) => {
      mainWindow?.webContents.send(IPC.WINDOW_STATE, { isMaximized })
    },
    onClosed: () => {
      processManager?.setOutputWindow(null)
      mainWindow = null
    },
  })

  processManager?.setOutputWindow(mainWindow)
}

function emitRuntimeStateChanged(payload: { reason: string; projectId?: string; sessionName?: string }): void {
  mainWindow?.webContents.send(IPC.RUNTIME_STATE_CHANGED, payload)
}

function sendGlobalHomeShortcut(): void {
  if (!mainWindow) {
    createMainWindow()
  }

  if (!mainWindow) return
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()
  mainWindow.webContents.send(IPC.GLOBAL_HOME_SHORTCUT)
}

function sendGlobalThemeShortcut(): void {
  if (!mainWindow) {
    createMainWindow()
  }

  mainWindow?.webContents.send(IPC.GLOBAL_THEME_SHORTCUT)
}

function registerGlobalShortcut(accelerator: string, action: () => void): void {
  const registered = globalShortcut.register(accelerator, action)
  if (!registered) {
    console.warn(`[globalShortcut] failed to register ${accelerator}`)
  }
}

function registerGlobalShortcuts(): void {
  registerGlobalShortcut(GLOBAL_HOME_SHORTCUT_ACCELERATOR, sendGlobalHomeShortcut)
  registerGlobalShortcut(GLOBAL_THEME_SHORTCUT_ACCELERATOR, sendGlobalThemeShortcut)
}

// ── before-quit ───────────────────────────────────────────

let isQuitting = false

app.on('before-quit', async (e) => {
  if (isQuitting) return
  e.preventDefault()
  isQuitting = true

  const { runtimeKeepAliveOnQuit = false } = loadConfig()
  if (!runtimeKeepAliveOnQuit) {
    await runtimeService.cleanupOnBeforeQuit()
  }

  processManager?.stopAll()
  await agentHookGateway.stop()

  setTimeout(() => {
    app.quit()
  }, 1500)
})

app.on('will-quit', () => {
  globalShortcut.unregister(GLOBAL_HOME_SHORTCUT_ACCELERATOR)
  globalShortcut.unregister(GLOBAL_THEME_SHORTCUT_ACCELERATOR)
})

// ── startup ──────────────────────────────────────────────

if (process.platform === 'win32' && app.isPackaged) {
  app.setAppUserModelId('com.yaoyuchen.yyc')
}

app.whenReady().then(async () => {
  nativeTheme.on('updated', () => {
    const { theme } = loadConfig()
    if (theme === 'system') {
      applyWindowBackground(mainWindow, theme, nativeTheme.shouldUseDarkColors)
    }
  })

  // P0 1: One-time capability probe
  await capabilityManager.init()
  bootCapability = capabilityManager.get()

  // Create ProcessManager with capability injected
  processManager = new ProcessManager(bootCapability)

  registerIpcHandlers({
    getMainWindow: () => mainWindow,
    getProcessManager: () => processManager,
    getBootCapability: () => bootCapability,
    emitRuntimeStateChanged,
    aiCommitService,
    agentHookGateway,
    gitService,
    runtimeService,
  })
  createMainWindow()
  registerGlobalShortcuts()
  agentHookGateway.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
