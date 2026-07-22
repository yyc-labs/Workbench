import { app, BrowserWindow, nativeTheme, screen } from 'electron'
import path from 'path'
import { ProcessManager } from './runner'
import { loadConfig, updateConfig } from './config'
import { IPC } from './ipc'
import { capabilityManager } from './capability-manager'
import { createGitService } from './git/git-service'
import { createRuntimeService } from './runtime/runtime-service'
import { createAiCommitService } from './ai-commit/ai-commit-service'
import { createAiConnectionService } from './ai-connection/ai-connection-service'
import { createAgentLogService } from './agent-logs/agent-log-service'
import { createAiGatewayService } from './ai-gateway/gateway-service'
import { flushAiCommitRegistry } from './ai-commit-registry'
import { AiEnvironmentController } from './ai-environment/environment-controller'
import { createTranscriptRepository } from './transcript/transcriptRepository'
import { createTranscriptService } from './transcript/transcriptService'
import { createTranscriptShareService } from './transcript/transcriptShareService'
import { createLearningRepository } from './learning/learningRepository'
import { createLearningService } from './learning/learningService'
import { createSkillRepository } from './skill/skillRepository'
import { createSkillService } from './skill/skillService'
import { createBrowserAiService, createDefaultBrowserAiRepository } from './browser-ai/browserAiService'
import { AgentHookGateway } from './hooks/agent-hook-gateway'
import { FeishuNotifier } from './hooks/feishu-notifier'
import { registerIpcHandlers } from './ipc/registerIpcHandlers'
import { listTranscriptImportProjects } from './transcript/transcriptImportProjects'
import { createWindow, applyWindowBackground } from './window/createWindow'
import { createTranscriptCaptureWindow, TRANSCRIPT_CAPTURE_WINDOW_HEIGHT, TRANSCRIPT_CAPTURE_WINDOW_WIDTH } from './window/createTranscriptCaptureWindow'
import { captureTranscriptCaptureInitialText, emptyTranscriptCaptureInitialText, readTranscriptCaptureClipboardText } from './window/transcriptCaptureSelection'
import { applyAppCacheLocation } from './cache-location'
import { registerGlobalShortcuts, unregisterGlobalShortcuts } from './window/globalShortcuts'
import { ensureWindowVisible } from './window/windowFocus'
import { isSilentAutostartLaunch, isWindowsAutostartLaunch, syncWindowsLaunchOnLogin } from './launchOnLogin'
import { resolveMainLocale, translateMain } from './mainI18n'
import { createAppTray, type AppTrayController } from './tray'
import { projectIdFromPath } from '../../shared/rules'
import type { Capability, TranscriptCaptureInitialText, TranscriptImportedEvent } from '../../shared/types'

let mainWindow: BrowserWindow | null = null
let transcriptCaptureWindow: BrowserWindow | null = null
let transcriptCaptureInitialText: TranscriptCaptureInitialText = emptyTranscriptCaptureInitialText
let transcriptCaptureInitialTextPromise: Promise<TranscriptCaptureInitialText> | null = null
let transcriptCaptureRequestId = 0
let isTranscriptCaptureShortcutPending = false
let shouldFocusTranscriptCaptureWindowOnReady = false
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
  getLocale: () => resolveMainLocale(loadConfig().locale, app.getLocale()),
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
const aiConnectionService = createAiConnectionService()
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
  getLocale: () => loadConfig().locale,
})
const transcriptShareService = createTranscriptShareService()
const learningRepository = createLearningRepository()
const learningService = createLearningService({
  repository: learningRepository,
  getLocale: () => resolveMainLocale(loadConfig().locale, app.getLocale()),
})
const skillService = createSkillService({ repository: createSkillRepository() })
const browserAiRepository = createDefaultBrowserAiRepository({
  loadConfig: () => loadConfig().browserAi,
  saveConfig: async (config) => (await updateConfig({ browserAi: config })).browserAi!,
  getRecordsRootPath: () => path.join(app.getPath('userData'), 'browser-ai'),
})
const browserAiService = createBrowserAiService({
  repository: browserAiRepository,
  getUserDataPath: () => app.getPath('userData'),
  learningService,
  emitProgress: (event) => {
    mainWindow?.webContents.send(IPC.BROWSER_AI_PROGRESS, event)
  },
})
const aiGatewayService = createAiGatewayService({
  getCapability: () => bootCapability,
  isLogCaptureEnabled: () => loadConfig().agentLogs?.enabled !== false,
})

const agentHookGateway = new AgentHookGateway({
  getConfig: () => loadConfig().agentHooks,
  isLogCaptureEnabled: () => loadConfig().agentLogs?.enabled !== false,
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

const agentLogService = createAgentLogService({
  getAiGatewayLogs: () => aiGatewayService.getRecentLogDetails(),
  getAgentHookLogs: () => agentHookGateway.getRecentLogDetails(),
  clearAiGatewayLogs: () => aiGatewayService.clearRecentLogs(),
  clearAgentHookLogs: () => agentHookGateway.clearRecentLogs(),
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

function positionTranscriptCaptureWindow(window: BrowserWindow): void {
  const cursorPoint = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursorPoint)
  const x = Math.round(display.workArea.x + (display.workArea.width - TRANSCRIPT_CAPTURE_WINDOW_WIDTH) / 2)
  const y = Math.round(display.workArea.y + Math.max(48, (display.workArea.height - TRANSCRIPT_CAPTURE_WINDOW_HEIGHT) / 4))
  window.webContents.setZoomFactor(1)
  window.setBounds({
    x,
    y,
    width: TRANSCRIPT_CAPTURE_WINDOW_WIDTH,
    height: TRANSCRIPT_CAPTURE_WINDOW_HEIGHT,
  })
}

function revealTranscriptCaptureWindow(window: BrowserWindow, focus: boolean): void {
  positionTranscriptCaptureWindow(window)
  if (focus) {
    window.show()
    window.focus()
    shouldFocusTranscriptCaptureWindowOnReady = false
    return
  }
  window.showInactive()
}

function requestTranscriptCaptureWindowFocus(): void {
  if (!transcriptCaptureWindow || transcriptCaptureWindow.isDestroyed()) return
  shouldFocusTranscriptCaptureWindowOnReady = true
  if (!transcriptCaptureWindow.isVisible()) return
  revealTranscriptCaptureWindow(transcriptCaptureWindow, true)
}

function resetTranscriptCaptureRequest(): void {
  transcriptCaptureRequestId += 1
  transcriptCaptureInitialText = emptyTranscriptCaptureInitialText
  transcriptCaptureInitialTextPromise = null
  isTranscriptCaptureShortcutPending = false
  shouldFocusTranscriptCaptureWindowOnReady = false
}

function showTranscriptCaptureWindow(options: { focus?: boolean } = {}): void {
  const shouldFocus = options.focus !== false
  if (shouldFocus) {
    shouldFocusTranscriptCaptureWindowOnReady = true
  }

  if (transcriptCaptureWindow && !transcriptCaptureWindow.isDestroyed()) {
    revealTranscriptCaptureWindow(transcriptCaptureWindow, shouldFocus)
    return
  }

  const config = loadConfig()
  transcriptCaptureWindow = createTranscriptCaptureWindow({
    theme: config.theme,
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
  })
  transcriptCaptureWindow.once('ready-to-show', () => {
    if (!transcriptCaptureWindow || transcriptCaptureWindow.isDestroyed()) return
    revealTranscriptCaptureWindow(transcriptCaptureWindow, shouldFocus || shouldFocusTranscriptCaptureWindowOnReady)
  })
  transcriptCaptureWindow.on('blur', () => {
    transcriptCaptureWindow?.close()
  })
  transcriptCaptureWindow.on('closed', () => {
    transcriptCaptureWindow = null
    resetTranscriptCaptureRequest()
  })
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

function beginTranscriptCaptureInitialText(): Promise<TranscriptCaptureInitialText> {
  const requestId = ++transcriptCaptureRequestId
  isTranscriptCaptureShortcutPending = true
  transcriptCaptureInitialText = emptyTranscriptCaptureInitialText

  const capturePromise = (async () => {
    try {
      return await captureTranscriptCaptureInitialText()
    } catch (error) {
      console.warn('[transcript-capture] Failed to capture selected text.', error)
      return readTranscriptCaptureClipboardText()
    }
  })()

  transcriptCaptureInitialTextPromise = capturePromise
  void capturePromise
    .then((initialText) => {
      if (transcriptCaptureRequestId !== requestId || transcriptCaptureInitialTextPromise !== capturePromise) {
        return
      }
      transcriptCaptureInitialText = initialText
    })
    .finally(() => {
      if (transcriptCaptureRequestId !== requestId || transcriptCaptureInitialTextPromise !== capturePromise) {
        return
      }
      transcriptCaptureInitialTextPromise = null
      isTranscriptCaptureShortcutPending = false
    })

  return capturePromise
}

async function consumeTranscriptCaptureInitialText(): Promise<TranscriptCaptureInitialText> {
  const pendingCapture = transcriptCaptureInitialTextPromise
  const requestId = transcriptCaptureRequestId
  if (pendingCapture) {
    const snapshot = await pendingCapture
    if (transcriptCaptureRequestId === requestId && transcriptCaptureInitialTextPromise === pendingCapture) {
      transcriptCaptureInitialTextPromise = null
      isTranscriptCaptureShortcutPending = false
    }
    if (transcriptCaptureRequestId === requestId) {
      transcriptCaptureInitialText = emptyTranscriptCaptureInitialText
    }
    return snapshot
  }

  const snapshot = transcriptCaptureInitialText
  transcriptCaptureInitialText = emptyTranscriptCaptureInitialText
  return snapshot
}

function sendGlobalTranscriptCaptureShortcut(): void {
  if (isTranscriptCaptureShortcutPending) {
    showTranscriptCaptureWindow({ focus: false })
    return
  }

  if (transcriptCaptureWindow && !transcriptCaptureWindow.isDestroyed()) {
    showTranscriptCaptureWindow()
    return
  }

  const capturePromise = beginTranscriptCaptureInitialText()
  showTranscriptCaptureWindow({ focus: false })
  void capturePromise.finally(requestTranscriptCaptureWindowFocus)
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
  const locale = resolveMainLocale(loadConfig().locale, app.getLocale())
  return [
    {
      label: isVisible ? translateMain(locale, 'tray.hideMainWindow') : translateMain(locale, 'tray.showMainWindow'),
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
      label: translateMain(locale, 'tray.openHome'),
      click: () => {
        navigateMainWindow('/')
      },
    },
    {
      label: translateMain(locale, 'tray.openSettings'),
      click: () => {
        navigateMainWindow('/settings/general')
      },
    },
    {
      type: 'separator' as const,
    },
    {
      label: translateMain(locale, 'tray.quitApp'),
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

  aiCommitService.cleanupOnBeforeQuit()
  processManager?.stopAll()
  await agentHookGateway.stop()
  await aiGatewayService.shutdown()
  await transcriptShareService.shutdown()
  await browserAiService.cleanupOnBeforeQuit()

  setTimeout(() => {
    flushAiCommitRegistry()
    app.quit()
  }, 1500)
})

app.on('will-quit', () => {
  flushAiCommitRegistry()
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
    emitTranscriptImported,
    consumeTranscriptCaptureInitialText,
    agentLogService,
    aiCommitService,
    aiConnectionService,
    aiGatewayService,
    browserAiService,
    agentHookGateway,
    gitService,
    runtimeService,
    learningService,
    skillService,
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
  registerGlobalShortcuts(sendGlobalHomeShortcut, sendGlobalThemeShortcut, sendGlobalTranscriptCaptureShortcut)
  agentHookGateway.start()
  void aiGatewayService.start(false).catch((error) => {
    console.warn('[ai-gateway] Failed to start from saved config.', error)
  })

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
