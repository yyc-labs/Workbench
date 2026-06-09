import { app, BrowserWindow, globalShortcut, nativeTheme } from 'electron'
import path from 'path'
import { ProcessManager } from './runner'
import { loadConfig } from './config'
import { IPC } from './ipc'
import { capabilityManager } from './capability-manager'
import { createGitService } from './git/git-service'
import { createRuntimeService } from './runtime/runtime-service'
import { createAiCommitService } from './ai-commit/ai-commit-service'
import { createTranscriptRepository } from './transcript/transcriptRepository'
import { createTranscriptService } from './transcript/transcriptService'
import { AgentHookGateway } from './hooks/agent-hook-gateway'
import { FeishuNotifier } from './hooks/feishu-notifier'
import { registerIpcHandlers } from './ipc/registerIpcHandlers'
import { createWindow, applyWindowBackground } from './window/createWindow'
import { projectIdFromPath } from '../../shared/rules'
import type { Capability, TranscriptImportedEvent } from '../../shared/types'

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
const transcriptRepository = createTranscriptRepository()
const transcriptService = createTranscriptService({
  repository: transcriptRepository,
  getProjectIdByPath: (projectPath) => {
    const normalizedTarget = path.resolve(projectPath)
    const project = loadConfig().projects.find((item) => path.resolve(item.path) === normalizedTarget)
    return project ? projectIdFromPath(project.path) : null
  },
  getProjectPathById: (projectId) => {
    const project = loadConfig().projects.find((item) => projectIdFromPath(item.path) === projectId)
    return project?.path ?? null
  },
})
const feishuNotifier = new FeishuNotifier({
  getConfig: () => loadConfig().agentHooks,
})

function listTranscriptImportProjects() {
  return loadConfig().projects.map((project) => {
    const projectId = projectIdFromPath(project.path)
    const name = path.basename(project.path) || project.path
    const customName = project.customName?.trim() || undefined
    return {
      projectId,
      projectPath: project.path,
      name,
      customName,
      displayName: customName || name,
    }
  })
}

const agentHookGateway = new AgentHookGateway({
  getConfig: () => loadConfig().agentHooks,
  onEvent: (event) => {
    mainWindow?.webContents.send(IPC.AGENT_HOOK_EVENT, event)
    void feishuNotifier.notifyIfNeeded(event).catch(() => undefined)
  },
  listProjects: () => listTranscriptImportProjects(),
  onTranscriptImport: async (payload) => {
    const imported = await transcriptService.importExternalTranscript(payload)
    emitTranscriptImported(imported)
    return imported
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

function emitTranscriptImported(payload: TranscriptImportedEvent): void {
  if (!mainWindow && payload.openViewer) {
    createMainWindow()
  }
  if (!mainWindow) return

  if (payload.openViewer) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.show()
    mainWindow.focus()
  }

  const targetWindow = mainWindow
  const send = () => {
    targetWindow?.webContents.send(IPC.TRANSCRIPT_IMPORTED, payload)
  }
  if (targetWindow.webContents.isLoading()) {
    targetWindow.webContents.once('did-finish-load', send)
    return
  }
  send()
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
    transcriptService,
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
