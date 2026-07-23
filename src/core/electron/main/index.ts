import { app, BrowserWindow, nativeTheme, screen } from 'electron'
import type { Capability, TranscriptCaptureInitialText, TranscriptImportedEvent } from '../../shared/types'
import { flushAiCommitRegistry } from './ai-commit-registry'
import { registerAppLifecycle, runAppCleanupSteps, runAppStartupSteps } from './app-lifecycle'
import { createAppServices } from './app-services'
import { applyAppCacheLocation } from './cache-location'
import { capabilityManager } from './capability-manager'
import { loadConfig, updateConfig } from './config'
import { IPC } from './ipc'
import { registerIpcHandlers } from './ipc/registerIpcHandlers'
import { isSilentAutostartLaunch, isWindowsAutostartLaunch, syncWindowsLaunchOnLogin } from './launchOnLogin'
import { resolveMainLocale, translateMain } from './mainI18n'
import { ProcessManager } from './runner'
import { TranscriptCaptureController } from './transcript-capture-controller'
import { type AppTrayController, createAppTray } from './tray'
import { createTranscriptCaptureWindow, TRANSCRIPT_CAPTURE_WINDOW_HEIGHT, TRANSCRIPT_CAPTURE_WINDOW_WIDTH } from './window/createTranscriptCaptureWindow'
import { applyWindowBackground, createWindow } from './window/createWindow'
import { registerGlobalShortcuts, unregisterGlobalShortcuts } from './window/globalShortcuts'
import { captureTranscriptCaptureInitialText, readTranscriptCaptureClipboardText } from './window/transcriptCaptureSelection'
import { ensureWindowVisible } from './window/windowFocus'

let mainWindow: BrowserWindow | null = null
let transcriptCaptureWindow: BrowserWindow | null = null
const transcriptCaptureController = new TranscriptCaptureController()
let processManager: ProcessManager | null = null
let bootCapability: Capability | null = null
let trayController: AppTrayController | null = null
const shouldStartHiddenToTray = isSilentAutostartLaunch(process.argv)
const shouldUseTrayLifecycle = process.platform === 'win32'
const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
}

const services = createAppServices({
  getCapability: () => bootCapability,
  setCapability: (capability) => {
    bootCapability = capability
  },
  getProcessManager: () => processManager,
  getMainWindow: () => mainWindow,
  loadConfig,
  updateConfig,
  getUserDataPath: () => app.getPath('userData'),
  getLocale: () => resolveMainLocale(loadConfig().locale, app.getLocale()),
  resolveLocale: (locale) => resolveMainLocale(locale, app.getLocale()),
  emitRuntimeStateChanged,
  emitTranscriptImported,
})
const { gitService, runtimeService, aiCommitService, aiConnectionService, transcriptService, transcriptShareService, learningService, skillService, browserAiService, aiGatewayService, agentHookGateway, agentLogService } = services

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
    transcriptCaptureController.consumeFocusRequest()
    return
  }
  window.showInactive()
}

function requestTranscriptCaptureWindowFocus(): void {
  if (!transcriptCaptureWindow || transcriptCaptureWindow.isDestroyed()) return
  transcriptCaptureController.requestFocus()
  if (!transcriptCaptureWindow.isVisible()) return
  revealTranscriptCaptureWindow(transcriptCaptureWindow, true)
}

function showTranscriptCaptureWindow(options: { focus?: boolean } = {}): void {
  const shouldFocus = options.focus !== false
  if (shouldFocus) {
    transcriptCaptureController.requestFocus()
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
    revealTranscriptCaptureWindow(transcriptCaptureWindow, shouldFocus || transcriptCaptureController.consumeFocusRequest())
  })
  transcriptCaptureWindow.on('blur', () => {
    transcriptCaptureWindow?.close()
  })
  transcriptCaptureWindow.on('closed', () => {
    transcriptCaptureWindow = null
    transcriptCaptureController.reset()
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
  return transcriptCaptureController.begin({
    capture: captureTranscriptCaptureInitialText,
    fallback: () => readTranscriptCaptureClipboardText(),
  })
}

function consumeTranscriptCaptureInitialText(): Promise<TranscriptCaptureInitialText> {
  return transcriptCaptureController.consume()
}

function sendGlobalTranscriptCaptureShortcut(): void {
  if (transcriptCaptureController.isShortcutPending()) {
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

// ── before-quit ───────────────────────────────────────────

let isQuitting = false

const handleBeforeQuit = async (e: { preventDefault: () => void }) => {
  if (isQuitting) return
  e.preventDefault()
  isQuitting = true
  trayController?.destroy()

  const { runtimeKeepAliveOnQuit = false } = loadConfig()
  await runAppCleanupSteps([
    ...(!runtimeKeepAliveOnQuit ? [{ name: 'runtime', run: () => runtimeService.cleanupOnBeforeQuit() }] : []),
    { name: 'ai-commit', run: () => aiCommitService.cleanupOnBeforeQuit() },
    { name: 'process-manager', run: () => processManager?.stopAll() },
    { name: 'agent-hooks', run: () => agentHookGateway.stop() },
    { name: 'ai-gateway', run: () => aiGatewayService.shutdown() },
    { name: 'transcript-share', run: () => transcriptShareService.shutdown() },
    { name: 'browser-ai', run: () => browserAiService.cleanupOnBeforeQuit() },
  ])

  setTimeout(() => {
    flushAiCommitRegistry()
    app.quit()
  }, 1500)
}

registerAppLifecycle(app, {
  onSecondInstance: (_event, argv) => {
    if (isWindowsAutostartLaunch(argv) && isSilentAutostartLaunch(argv)) return
    showMainWindowFromTray()
  },
  onBeforeQuit: handleBeforeQuit,
  onWillQuit: () => {
    flushAiCommitRegistry()
    trayController?.destroy()
    unregisterGlobalShortcuts()
  },
  onActivate: () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  },
  onWindowAllClosed: () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  },
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

  try {
    await runAppStartupSteps(
      [
        {
          name: 'capability',
          run: async () => {
            await capabilityManager.init()
            bootCapability = capabilityManager.get()
          },
        },
        {
          name: 'process-manager',
          run: () => {
            if (!bootCapability) throw new Error('Capability is not initialized')
            processManager = new ProcessManager(bootCapability)
          },
          rollback: async () => {
            await processManager?.stopAll()
            processManager = null
          },
        },
        {
          name: 'tray',
          run: () => {
            if (!shouldUseTrayLifecycle) return
            trayController = createAppTray({
              getTooltip: () => 'IDE Electron',
              buildMenu: buildTrayMenuTemplate,
              onOpenMainWindow: openMainWindowFromTray,
            })
          },
          rollback: () => {
            trayController?.destroy()
            trayController = null
          },
        },
        {
          name: 'ipc',
          run: () => {
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
          },
        },
        {
          name: 'main-window',
          run: createMainWindow,
          rollback: () => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy()
            mainWindow = null
          },
        },
        {
          name: 'tray-visibility',
          run: () => {
            if (!shouldUseTrayLifecycle || !trayController) return
            if (shouldStartHiddenToTray && !trayController.ensure()) {
              showMainWindowFromTray()
            } else {
              trayController.ensure()
            }
          },
        },
      ],
      (name, error) => {
        console.error(`[startup] Failed at ${name}`, error)
      },
    )
  } catch {
    app.quit()
    return
  }

  syncWindowsLaunchOnLogin(bootConfig)
  registerGlobalShortcuts(sendGlobalHomeShortcut, sendGlobalThemeShortcut, sendGlobalTranscriptCaptureShortcut)
  agentHookGateway.start()
  void aiGatewayService.start(false).catch((error) => {
    console.warn('[ai-gateway] Failed to start from saved config.', error)
  })
})
