import { app, BrowserWindow, nativeTheme } from 'electron'
import path from 'path'
import { ProcessManager } from './runner'
import { loadConfig } from './config'
import { IPC } from './ipc'
import { capabilityManager } from './capability-manager'
import { createGitService } from './git/git-service'
import { createRuntimeService } from './runtime/runtime-service'
import { createAiCommitService } from './ai-commit/ai-commit-service'
import { AiEnvironmentController } from './ai-environment/environment-controller'
import { createTranscriptRepository } from './transcript/transcriptRepository'
import { createTranscriptService } from './transcript/transcriptService'
import { createTranscriptShareService } from './transcript/transcriptShareService'
import { createLearningRepository } from './learning/learningRepository'
import { createLearningService } from './learning/learningService'
import { AgentHookGateway } from './hooks/agent-hook-gateway'
import { FeishuNotifier } from './hooks/feishu-notifier'
import { registerIpcHandlers } from './ipc/registerIpcHandlers'
import { listTranscriptImportProjects } from './transcript/transcriptImportProjects'
import { createWindow, applyWindowBackground } from './window/createWindow'
import { applyAppCacheLocation } from './cache-location'
import {
  registerGlobalShortcuts,
  unregisterGlobalShortcuts,
} from './window/globalShortcuts'
import { ensureWindowVisible } from './window/windowFocus'
import {
  isSilentAutostartLaunch,
  isWindowsAutostartLaunch,
  syncWindowsLaunchOnLogin,
} from './launchOnLogin'
import { createAppTray, type AppTrayController } from './tray'
import { projectIdFromPath } from '../../shared/rules'
import type { Capability, TranscriptImportedEvent } from '../../shared/types'

let mainWindow: BrowserWindow | null = null
let processManager: ProcessManager | null = null
let bootCapability: Capability | null = null
let trayController: AppTrayController | null = null
const shouldStartHiddenToTray = isSilentAutostartLaunch(process.argv)
const shouldUseTrayLifecycle = process.platform === 'win32'
const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
}

const aiEnvironmentController = new AiEnvironmentController(
  () => bootCapability,
  (capability) => {
    bootCapability = capability
    processManager?.updateCapability(capability)
  },
  () => loadConfig(),
)
const gitService = createGitService({
  getDefaultWslDistro: () => bootCapability?.wslDistro || 'Ubuntu',
})
const runtimeService = createRuntimeService({
  getCapability: () => bootCapability,
  getProcessManager: () => processManager,
  aiEnvironmentController,
  emitRuntimeStateChanged,
})
const aiCommitService = createAiCommitService({
  getMainWindow: () => mainWindow,
  getDefaultWslDistro: () => bootCapability?.wslDistro || 'Ubuntu',
  aiEnvironmentController,
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
const transcriptShareService = createTranscriptShareService()
const learningRepository = createLearningRepository()
const learningService = createLearningService({
  repository: learningRepository,
})

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
    showOnReady: !(shouldUseTrayLifecycle && shouldStartHiddenToTray),
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
      if (shouldUseTrayLifecycle && !isQuitting && loadConfig().closeWindowBehavior === 'quit') {
        app.quit()
      }
    },
  })

  processManager?.setOutputWindow(mainWindow)

  if (shouldUseTrayLifecycle) {
    mainWindow.on('close', (event) => {
      if (isQuitting) return
      if (loadConfig().closeWindowBehavior !== 'tray') return
      if (!trayController?.ensure()) return
      event.preventDefault()
      mainWindow?.hide()
    })

    mainWindow.on('show', () => {
      trayController?.ensure()
    })

    mainWindow.on('hide', () => {
      trayController?.ensure()
    })
  }
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
    ensureWindowVisible(mainWindow)
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

  const window = ensureWindowVisible(mainWindow)
  if (!window) return
  window.webContents.send(IPC.GLOBAL_HOME_SHORTCUT)
}

function sendGlobalThemeShortcut(): void {
  if (!mainWindow) {
    createMainWindow()
  }

  mainWindow?.webContents.send(IPC.GLOBAL_THEME_SHORTCUT)
}

function hideMainWindowToTray(): void {
  if (!mainWindow) return
  mainWindow.hide()
}

function showMainWindowFromTray(): void {
  if (!mainWindow) {
    createMainWindow()
  }
  ensureWindowVisible(mainWindow)
}

function navigateMainWindow(pathname: string): void {
  showMainWindowFromTray()
  if (!mainWindow) return

  const send = () => {
    mainWindow?.webContents.send(IPC.APP_NAVIGATE, { path: pathname })
  }

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', send)
    return
  }

  send()
}

function openMainWindowFromTray(): void {
  if (!mainWindow) {
    createMainWindow()
    ensureWindowVisible(mainWindow)
    return
  }

  showMainWindowFromTray()
}

function buildTrayMenuTemplate() {
  const isVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible())
  return [
    {
      label: isVisible ? '隐藏主窗口' : '显示主窗口',
      click: () => {
        if (isVisible) {
          hideMainWindowToTray()
        } else {
          showMainWindowFromTray()
        }
      },
    },
    {
      type: 'separator' as const,
    },
    {
      label: '打开首页',
      click: () => {
        navigateMainWindow('/')
      },
    },
    {
      label: '打开设置',
      click: () => {
        navigateMainWindow('/settings/general')
      },
    },
    {
      type: 'separator' as const,
    },
    {
      label: '退出 IDE Electron',
      click: () => {
        app.quit()
      },
    },
  ]
}

app.on('second-instance', (_event, argv) => {
  if (isWindowsAutostartLaunch(argv) && isSilentAutostartLaunch(argv)) return
  showMainWindowFromTray()
})

// ── before-quit ───────────────────────────────────────────

let isQuitting = false

app.on('before-quit', async (e) => {
  if (isQuitting) return
  e.preventDefault()
  isQuitting = true
  trayController?.destroy()

  const { runtimeKeepAliveOnQuit = false } = loadConfig()
  if (!runtimeKeepAliveOnQuit) {
    await runtimeService.cleanupOnBeforeQuit()
  }

  processManager?.stopAll()
  await agentHookGateway.stop()
  await transcriptShareService.shutdown()

  setTimeout(() => {
    app.quit()
  }, 1500)
})

app.on('will-quit', () => {
  trayController?.destroy()
  unregisterGlobalShortcuts()
})

// ── startup ──────────────────────────────────────────────

if (process.platform === 'win32' && app.isPackaged) {
  app.setAppUserModelId('com.yaoyuchen.yyc')
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return

  const bootConfig = loadConfig()
  try {
    applyAppCacheLocation(bootConfig.cacheLocation)
  } catch (error) {
    console.warn('[cache-location] Failed to apply cache location.', error)
  }

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
  if (shouldUseTrayLifecycle) {
    trayController = createAppTray({
      getTooltip: () => 'IDE Electron',
      buildMenu: buildTrayMenuTemplate,
      onOpenMainWindow: openMainWindowFromTray,
    })
  }

  registerIpcHandlers({
    getMainWindow: () => mainWindow,
    getProcessManager: () => processManager,
    getCapability: () => bootCapability,
    emitRuntimeStateChanged,
    aiCommitService,
    agentHookGateway,
    gitService,
    runtimeService,
    learningService,
    transcriptService,
    transcriptShareService,
  })
  syncWindowsLaunchOnLogin(bootConfig)
  createMainWindow()
  if (shouldUseTrayLifecycle && trayController) {
    if (shouldStartHiddenToTray && !trayController.ensure()) {
      showMainWindowFromTray()
    } else {
      trayController.ensure()
    }
  }
  registerGlobalShortcuts(sendGlobalHomeShortcut, sendGlobalThemeShortcut)
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
