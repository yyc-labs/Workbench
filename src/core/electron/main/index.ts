import { app, BrowserWindow, nativeTheme, screen, type Rectangle } from 'electron'
import type { BrowserScreenshotViewerPayload, Capability, TranscriptCaptureInitialText, TranscriptImportedEvent } from '../../shared/types'
import { flushAiCommitRegistry } from './ai-commit-registry'
import { registerAppLifecycle, runAppCleanupSteps, runAppStartupSteps } from './app-lifecycle'
import { createAppServices } from './app-services'
import { applyAppCacheLocation } from './cache-location'
import { capabilityManager } from './capability-manager'
import { loadConfig, updateConfig } from './config'
import { IPC } from './ipc'
import { registerIpcHandlers } from './ipc/registerIpcHandlers'
import { registerYycWorkbenchHandler, registerYycWorkbenchScheme } from './project-file/project-file-protocol'
import { MarkdownDocumentRepository } from './markdown-document/markdownDocumentRepository'
import { MarkdownDocumentService } from './markdown-document/markdownDocumentService'
import { MarkdownDocumentOpenRequestStore } from './markdown-document/markdownDocumentOpenRequest'
import { parseMarkdownDocumentOpenRequest } from './markdown-document/markdownDocumentOpenRequest'
import { isSilentAutostartLaunch, isWindowsAutostartLaunch, syncWindowsLaunchOnLogin } from './launchOnLogin'
import { resolveMainLocale, translateMain } from './mainI18n'
import { ProcessManager } from './runner'
import { TranscriptCaptureController } from './transcript-capture-controller'
import { type AppTrayController, createAppTray } from './tray'
import { createTranscriptCaptureWindow, TRANSCRIPT_CAPTURE_WINDOW_HEIGHT, TRANSCRIPT_CAPTURE_WINDOW_WIDTH } from './window/createTranscriptCaptureWindow'
import { createBrowserScreenshotWindow, BROWSER_SCREENSHOT_DOCK_SIZE, BROWSER_SCREENSHOT_WINDOW_HEIGHT, BROWSER_SCREENSHOT_WINDOW_WIDTH } from './window/createBrowserScreenshotWindow'
import { createBrowserScreenshotViewerWindow } from './window/createBrowserScreenshotViewerWindow'
import { createAppViewWindow, APP_VIEW_WINDOW_TITLES } from './window/createAppViewWindow'
import { applyWindowBackground, createWindow } from './window/createWindow'
import { registerGlobalShortcuts, unregisterGlobalShortcuts } from './window/globalShortcuts'
import { captureTranscriptCaptureInitialText, readTranscriptCaptureClipboardText } from './window/transcriptCaptureSelection'
import { ensureWindowVisible } from './window/windowFocus'

let mainWindow: BrowserWindow | null = null
let transcriptCaptureWindow: BrowserWindow | null = null
let browserScreenshotWindow: BrowserWindow | null = null
let browserScreenshotWindowPromise: Promise<void> | null = null
let browserScreenshotViewerWindow: BrowserWindow | null = null
const appViewWindows = new Map<string, BrowserWindow>()
let latestBrowserScreenshotViewerPayload: BrowserScreenshotViewerPayload | null = null
let browserScreenshotWindowCollapsed = false
let browserScreenshotWindowExpandedBounds: Rectangle | null = null
let browserScreenshotWindowAdjusting = false
let browserScreenshotDockTimer: ReturnType<typeof setTimeout> | null = null
const transcriptCaptureController = new TranscriptCaptureController()
let processManager: ProcessManager | null = null
let bootCapability: Capability | null = null
let trayController: AppTrayController | null = null
const shouldStartHiddenToTray = isSilentAutostartLaunch(process.argv)
const shouldUseTrayLifecycle = process.platform === 'win32'
const gotSingleInstanceLock = app.requestSingleInstanceLock()
const markdownDocumentOpenRequestStore = new MarkdownDocumentOpenRequestStore()
markdownDocumentOpenRequestStore.setFromArgv(process.argv)

if (!gotSingleInstanceLock) {
  app.quit()
}

registerYycWorkbenchScheme()

const services = createAppServices({
  getCapability: () => bootCapability,
  setCapability: (capability) => {
    bootCapability = capability
  },
  getProcessManager: () => processManager,
  getMainWindow: () => mainWindow,
  getBrowserScreenshotWindow: () => browserScreenshotWindow,
  openBrowserScreenshotViewer,
  openBrowserScreenshotWindow: async () => {
    await showBrowserScreenshotWindow()
    return true
  },
  loadConfig,
  updateConfig,
  getUserDataPath: () => app.getPath('userData'),
  getLocale: () => resolveMainLocale(loadConfig().locale, app.getLocale()),
  resolveLocale: (locale) => resolveMainLocale(locale, app.getLocale()),
  emitRuntimeStateChanged,
  emitTranscriptImported,
})
const markdownDocumentService = new MarkdownDocumentService(new MarkdownDocumentRepository(app.getPath('userData')), () => mainWindow)
const { gitService, runtimeService, processPortService, aiCommitService, aiConnectionService, transcriptService, transcriptShareService, learningService, skillService, browserAiService, browserScreenshotAiService, browserScreenshotService, aiGatewayService, agentHookGateway, agentLogService } = services

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
  const y = Math.round(display.workArea.y + (display.workArea.height - TRANSCRIPT_CAPTURE_WINDOW_HEIGHT) / 2)
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

function sendGlobalBrowserScreenshotShortcut(): void {
  void (async () => {
    try {
      const { context } = await browserScreenshotAiService.ensureBrowserConnection()
      const page = context.pages().at(-1)
      if (page && !page.isClosed()) await page.bringToFront().catch(() => undefined)
      await browserScreenshotService.listTargets()
      if (browserScreenshotWindow && !browserScreenshotWindow.isDestroyed()) browserScreenshotWindow.hide()
    } catch (error) {
      console.warn('[browser-screenshot] Failed to open the browser.', error)
      await showBrowserScreenshotWindow()
    }
  })()
}

function positionBrowserScreenshotWindow(window: BrowserWindow): void {
  const cursorPoint = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursorPoint)
  const x = Math.round(display.workArea.x + (display.workArea.width - BROWSER_SCREENSHOT_WINDOW_WIDTH) / 2)
  const y = Math.round(display.workArea.y + (display.workArea.height - BROWSER_SCREENSHOT_WINDOW_HEIGHT) / 2)
  window.setBounds({ x, y, width: BROWSER_SCREENSHOT_WINDOW_WIDTH, height: BROWSER_SCREENSHOT_WINDOW_HEIGHT })
}

function expandBrowserScreenshotWindow(): boolean {
  if (!browserScreenshotWindow || browserScreenshotWindow.isDestroyed()) return false
  if (!browserScreenshotWindowCollapsed) {
    browserScreenshotWindow.show()
    browserScreenshotWindow.focus()
    return true
  }

  const bounds = browserScreenshotWindowExpandedBounds
  browserScreenshotWindowAdjusting = true
  browserScreenshotWindow.setMinimumSize(BROWSER_SCREENSHOT_WINDOW_WIDTH, BROWSER_SCREENSHOT_WINDOW_HEIGHT)
  browserScreenshotWindow.setMaximumSize(BROWSER_SCREENSHOT_WINDOW_WIDTH, BROWSER_SCREENSHOT_WINDOW_HEIGHT)
  if (bounds) {
    const display = screen.getDisplayMatching(bounds)
    const workArea = display.workArea
    const x = bounds.x <= workArea.x + 12 ? workArea.x + 24 : workArea.x + workArea.width - bounds.width - 24
    browserScreenshotWindow.setBounds({ ...bounds, x })
  }
  browserScreenshotWindowCollapsed = false
  browserScreenshotWindowAdjusting = false
  browserScreenshotWindow.show()
  browserScreenshotWindow.focus()
  return true
}

function collapseBrowserScreenshotWindow(window: BrowserWindow): void {
  if (browserScreenshotWindowAdjusting || browserScreenshotWindowCollapsed || window.isDestroyed()) return
  const bounds = window.getBounds()
  const display = screen.getDisplayMatching(bounds)
  const workArea = display.workArea
  const nearLeft = bounds.x <= workArea.x + 12
  const nearRight = bounds.x + bounds.width >= workArea.x + workArea.width - 12
  if (!nearLeft && !nearRight) return

  browserScreenshotWindowExpandedBounds = bounds
  const x = nearLeft ? workArea.x : workArea.x + workArea.width - BROWSER_SCREENSHOT_DOCK_SIZE
  const y = Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - BROWSER_SCREENSHOT_DOCK_SIZE)
  browserScreenshotWindowAdjusting = true
  window.setMinimumSize(BROWSER_SCREENSHOT_DOCK_SIZE, BROWSER_SCREENSHOT_DOCK_SIZE)
  window.setMaximumSize(BROWSER_SCREENSHOT_DOCK_SIZE, BROWSER_SCREENSHOT_DOCK_SIZE)
  window.setBounds({ x, y, width: BROWSER_SCREENSHOT_DOCK_SIZE, height: BROWSER_SCREENSHOT_DOCK_SIZE })
  browserScreenshotWindowCollapsed = true
  browserScreenshotWindowAdjusting = false
}

function snapCollapsedBrowserScreenshotWindow(window: BrowserWindow): void {
  if (browserScreenshotWindowAdjusting || !browserScreenshotWindowCollapsed || window.isDestroyed()) return
  const bounds = window.getBounds()
  const workArea = screen.getDisplayMatching(bounds).workArea
  const attachRight = bounds.x + bounds.width / 2 >= workArea.x + workArea.width / 2
  const x = attachRight ? workArea.x + workArea.width - BROWSER_SCREENSHOT_DOCK_SIZE : workArea.x
  const y = Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - BROWSER_SCREENSHOT_DOCK_SIZE)
  browserScreenshotWindowAdjusting = true
  window.setBounds({ x, y, width: BROWSER_SCREENSHOT_DOCK_SIZE, height: BROWSER_SCREENSHOT_DOCK_SIZE })
  browserScreenshotWindowAdjusting = false
}

function scheduleBrowserScreenshotDockCheck(window: BrowserWindow): void {
  if (browserScreenshotDockTimer !== null) clearTimeout(browserScreenshotDockTimer)
  browserScreenshotDockTimer = setTimeout(() => {
    browserScreenshotDockTimer = null
    if (browserScreenshotWindowCollapsed) snapCollapsedBrowserScreenshotWindow(window)
    else collapseBrowserScreenshotWindow(window)
  }, 260)
}

function toggleBrowserScreenshotWindow(): Promise<boolean> {
  return Promise.resolve(expandBrowserScreenshotWindow())
}

function markBrowserScreenshotViewerReady(senderId: number): Promise<boolean> {
  if (!browserScreenshotViewerWindow || browserScreenshotViewerWindow.isDestroyed() || browserScreenshotViewerWindow.webContents.id !== senderId) return Promise.resolve(false)
  browserScreenshotViewerWindow.show()
  browserScreenshotViewerWindow.focus()
  return Promise.resolve(true)
}

async function showBrowserScreenshotWindow(): Promise<void> {
  if (browserScreenshotWindow && !browserScreenshotWindow.isDestroyed()) {
    if (browserScreenshotWindowCollapsed) {
      expandBrowserScreenshotWindow()
      return
    }
    positionBrowserScreenshotWindow(browserScreenshotWindow)
    browserScreenshotWindow.show()
    browserScreenshotWindow.focus()
    return
  }

  if (browserScreenshotWindowPromise) return browserScreenshotWindowPromise

  browserScreenshotWindowPromise = (async () => {
    try {
      await browserAiService.ensureBrowserConnection()
    } catch (error) {
      console.warn('[browser-screenshot] Failed to prepare the browser connection.', error)
    }

    const config = loadConfig()
    browserScreenshotWindow = createBrowserScreenshotWindow({ theme: config.theme, shouldUseDarkColors: nativeTheme.shouldUseDarkColors })
    browserScreenshotWindow.on('move', () => {
      if (browserScreenshotWindow) scheduleBrowserScreenshotDockCheck(browserScreenshotWindow)
    })
    browserScreenshotWindow.once('ready-to-show', () => {
      if (!browserScreenshotWindow || browserScreenshotWindow.isDestroyed()) return
      positionBrowserScreenshotWindow(browserScreenshotWindow)
      browserScreenshotWindow.show()
      browserScreenshotWindow.focus()
    })
    browserScreenshotWindow.on('closed', () => {
      if (browserScreenshotDockTimer !== null) clearTimeout(browserScreenshotDockTimer)
      browserScreenshotDockTimer = null
      browserScreenshotWindow = null
      browserScreenshotWindowCollapsed = false
      browserScreenshotWindowExpandedBounds = null
    })
  })().finally(() => {
    browserScreenshotWindowPromise = null
  })

  return browserScreenshotWindowPromise
}

function openBrowserScreenshotViewer(payload: BrowserScreenshotViewerPayload): Promise<boolean> {
  latestBrowserScreenshotViewerPayload = payload
  if (browserScreenshotWindow && !browserScreenshotWindow.isDestroyed()) browserScreenshotWindow.hide()
  if (browserScreenshotViewerWindow && !browserScreenshotViewerWindow.isDestroyed()) {
    browserScreenshotViewerWindow.hide()
    browserScreenshotViewerWindow.webContents.send(IPC.BROWSER_SCREENSHOT_VIEWER_DATA, payload)
    return Promise.resolve(true)
  }

  const config = loadConfig()
  const viewerWindow = createBrowserScreenshotViewerWindow({ theme: config.theme, shouldUseDarkColors: nativeTheme.shouldUseDarkColors })
  browserScreenshotViewerWindow = viewerWindow
  viewerWindow.webContents.once('did-finish-load', () => {
    if (!viewerWindow.isDestroyed()) viewerWindow.webContents.send(IPC.BROWSER_SCREENSHOT_VIEWER_DATA, payload)
  })
  viewerWindow.on('closed', () => {
    if (browserScreenshotViewerWindow === viewerWindow) browserScreenshotViewerWindow = null
    if (browserScreenshotWindow && !browserScreenshotWindow.isDestroyed()) {
      browserScreenshotWindow.show()
      browserScreenshotWindow.focus()
    }
  })
  return Promise.resolve(true)
}

function openAppViewWindow(viewPath: string): Promise<boolean> {
  if (!APP_VIEW_WINDOW_TITLES[viewPath]) return Promise.resolve(false)

  const existing = appViewWindows.get(viewPath)
  if (existing && !existing.isDestroyed()) {
    ensureWindowVisible(existing)
    return Promise.resolve(true)
  }

  const config = loadConfig()
  const viewWindow = createAppViewWindow({ path: viewPath, theme: config.theme, shouldUseDarkColors: nativeTheme.shouldUseDarkColors })
  appViewWindows.set(viewPath, viewWindow)
  viewWindow.on('closed', () => {
    if (appViewWindows.get(viewPath) === viewWindow) appViewWindows.delete(viewPath)
  })
  viewWindow.once('ready-to-show', () => {
    if (!viewWindow.isDestroyed()) viewWindow.show()
  })
  return Promise.resolve(true)
}

function hasAppViewWindow(viewPath: string): Promise<boolean> {
  const viewWindow = appViewWindows.get(viewPath)
  return Promise.resolve(Boolean(viewWindow && !viewWindow.isDestroyed()))
}

/**
 * 全局 Markdown 文档打开请求的路由:优先送到已存在的 Markdown 独立窗口,否则回落到主窗口。
 * 事件定向送达后立即清空待处理路径,避免主窗口后续挂载 markdown 页面时重复消费造成双开编辑。
 */
function routeMarkdownDocumentOpenRequest(markdownPath: string): void {
  if (!parseMarkdownDocumentOpenRequest([markdownPath])) return
  markdownDocumentOpenRequestStore.setFromArgv([markdownPath])

  const markdownViewWindow = appViewWindows.get('/markdown')
  if (markdownViewWindow && !markdownViewWindow.isDestroyed() && !markdownViewWindow.webContents.isLoading()) {
    ensureWindowVisible(markdownViewWindow)
    markdownViewWindow.webContents.send(IPC.MARKDOWN_DOCUMENT_OPEN_REQUESTED, { path: markdownPath })
    markdownDocumentOpenRequestStore.consume()
    return
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow()
  }
  showMainWindowFromTray()
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send(IPC.MARKDOWN_DOCUMENT_OPEN_REQUESTED, { path: markdownPath })
  }
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
    { name: 'browser-screenshot-ai', run: () => browserScreenshotAiService.cleanupOnBeforeQuit() },
    { name: 'browser-screenshot', run: () => browserScreenshotService.cleanupOnBeforeQuit() },
  ])

  setTimeout(() => {
    flushAiCommitRegistry()
    app.quit()
  }, 1500)
}

registerAppLifecycle(app, {
  onSecondInstance: (_event, argv) => {
    if (isWindowsAutostartLaunch(argv) && isSilentAutostartLaunch(argv)) return
    const markdownPath = parseMarkdownDocumentOpenRequest(argv)
    if (markdownPath) {
      routeMarkdownDocumentOpenRequest(markdownPath)
      return
    }
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
              getTooltip: () => 'Workbench',
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
              browserScreenshotService,
              openBrowserScreenshotViewer,
              getBrowserScreenshotViewerData: () => latestBrowserScreenshotViewerPayload,
              toggleBrowserScreenshotWindow,
              markBrowserScreenshotViewerReady,
              openAppViewWindow,
              hasAppViewWindow,
              agentHookGateway,
              gitService,
              runtimeService,
              processPortService,
              learningService,
              skillService,
              transcriptService,
              transcriptShareService,
              markdownDocumentService,
              markdownDocumentOpenRequestStore,
              routeMarkdownDocumentOpen: routeMarkdownDocumentOpenRequest,
            })
          },
        },
        {
          name: 'yyc-workbench-protocol',
          run: () => {
            registerYycWorkbenchHandler()
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
  registerGlobalShortcuts(sendGlobalHomeShortcut, sendGlobalThemeShortcut, sendGlobalTranscriptCaptureShortcut, sendGlobalBrowserScreenshotShortcut)
  agentHookGateway.start()
  void aiGatewayService.start(false).catch((error) => {
    console.warn('[ai-gateway] Failed to start from saved config.', error)
  })
})
