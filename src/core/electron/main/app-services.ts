import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path, { dirname, join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { app, dialog, Notification, shell } from 'electron'
import { projectIdFromPath } from '../../shared/rules'
import type { AppConfig, BrowserScreenshotViewerPayload, Capability, TranscriptImportedEvent } from '../../shared/types'
import { createAgentLogService } from './agent-logs/agent-log-service'
import { createAiCommitService } from './ai-commit/ai-commit-service'
import { createAiConnectionService } from './ai-connection/ai-connection-service'
import { AiEnvironmentController } from './ai-environment/environment-controller'
import { createAiGatewayService } from './ai-gateway/gateway-service'
import { resolveAppResourcePath } from './app-resource-path'
import { createBrowserAiService, createDefaultBrowserAiRepository } from './browser-ai/browserAiService'
import { createCalendarService, readBuiltinYearCalendar } from './calendar/calendar-service'
import { createCalendarUpdater } from './calendar/calendar-updater'
import { createGitService } from './git/git-service'
import { AgentHookGateway } from './hooks/agent-hook-gateway'
import { FeishuNotifier } from './hooks/feishu-notifier'
import { readTranscriptImportSkillFile } from './hooks/transcript-import-skill'
import { IPC } from './ipc'
import { createLearningRepository } from './learning/learningRepository'
import { createLearningService } from './learning/learningService'
import { type MainLocale, translateMain } from './mainI18n'
import { createProcessPortService } from './process-ports/process-port-service'
import { createQuickActionDesktopShortcuts } from './quick-actions/quickActionDesktopShortcuts'
import { createQuickActionScheduler, type QuickActionScheduleNotifyEvent } from './quick-actions/quickActionScheduler'
import { createQuickActionService } from './quick-actions/quickActionService'
import type { RunTaskService } from './run-tasks/run-task-service'
import type { ProcessManager } from './runner'
import { createRuntimeService } from './runtime/runtime-service'
import { createPreviewPageCaptureService } from './screenshot/previewCaptureService'
import { createBrowserScreenshotService } from './screenshot/screenshotService'
import { createSkillRepository } from './skill/skillRepository'
import { createSkillService } from './skill/skillService'
import { listTranscriptImportProjects } from './transcript/transcriptImportProjects'
import { normalizeTranscriptProjectPath } from './transcript/transcriptPathMatch'
import { createTranscriptRepository } from './transcript/transcriptRepository'
import { createTranscriptService } from './transcript/transcriptService'
import { createTranscriptShareService } from './transcript/transcriptShareService'

export type RuntimeStateChangedPayload = {
  reason: string
  projectId?: string
  sessionName?: string
}

export type AppServicesOptions = {
  getCapability: () => Capability | null
  setCapability: (capability: Capability) => void
  getProcessManager: () => ProcessManager | null
  getMainWindow: () => BrowserWindow | null
  getBrowserScreenshotWindow: () => BrowserWindow | null
  openBrowserScreenshotViewer: (payload: BrowserScreenshotViewerPayload) => Promise<boolean>
  openBrowserScreenshotWindow: () => Promise<boolean>
  /** RunTaskService is assembled after app-services; quick actions need it lazily. */
  getRunTaskService: () => Pick<RunTaskService, 'start' | 'startAll' | 'getConfig'> | null
  navigateMainWindow: (pathname: string) => void
  ensureWindowVisible: () => void
  loadConfig: () => AppConfig
  updateConfig: (patch: Partial<AppConfig>) => Promise<AppConfig>
  getUserDataPath: () => string
  getLocale: () => MainLocale
  resolveLocale: (locale: AppConfig['locale']) => MainLocale
  emitRuntimeStateChanged: (payload: RuntimeStateChangedPayload) => void
  emitTranscriptImported: (payload: TranscriptImportedEvent) => void
}

/**
 * Build the main-process service graph in one place. The factory receives only
 * boundary callbacks, so services remain independent of Electron globals and
 * the entrypoint can focus on lifecycle/window assembly.
 */
export function createAppServices(options: AppServicesOptions) {
  const aiEnvironmentController = new AiEnvironmentController(
    options.getCapability,
    (capability) => {
      options.setCapability(capability)
      options.getProcessManager()?.updateCapability(capability)
    },
    options.loadConfig,
  )
  const gitService = createGitService({
    getDefaultWslDistro: () => options.getCapability()?.wslDistro || 'Ubuntu',
    getLocale: options.getLocale,
  })
  const runtimeService = createRuntimeService({
    getCapability: options.getCapability,
    getProcessManager: options.getProcessManager,
    aiEnvironmentController,
    emitRuntimeStateChanged: options.emitRuntimeStateChanged,
  })
  const processPortService = createProcessPortService({
    getCapability: options.getCapability,
  })
  const aiCommitService = createAiCommitService({
    getMainWindow: options.getMainWindow,
    getDefaultWslDistro: () => options.getCapability()?.wslDistro || 'Ubuntu',
    aiEnvironmentController,
    getLocale: options.getLocale,
  })
  const aiConnectionService = createAiConnectionService()
  const transcriptService = createTranscriptService({
    repository: createTranscriptRepository(),
    getProjectIdByPath: (projectPath) => {
      const normalizedTarget = normalizeTranscriptProjectPath(path.resolve(projectPath))
      const project = options.loadConfig().projects.find((item) => normalizeTranscriptProjectPath(path.resolve(item.path)) === normalizedTarget)
      return project ? projectIdFromPath(project.path) : null
    },
    getProjectPathById: (projectId) => {
      const project = options.loadConfig().projects.find((item) => projectIdFromPath(item.path) === projectId)
      return project?.path ?? null
    },
  })
  const feishuNotifier = new FeishuNotifier({
    getConfig: () => options.loadConfig().agentHooks,
    getLocale: () => options.loadConfig().locale,
  })
  const transcriptShareService = createTranscriptShareService()
  const learningService = createLearningService({
    repository: createLearningRepository(),
    getLocale: () => options.resolveLocale(options.loadConfig().locale),
  })
  const skillService = createSkillService({ repository: createSkillRepository() })
  const browserAiService = createBrowserAiService({
    repository: createDefaultBrowserAiRepository({
      loadConfig: () => options.loadConfig().browserAi,
      saveConfig: async (config) => {
        const saved = await options.updateConfig({ browserAi: config })
        if (!saved.browserAi) throw new Error('Browser AI configuration was not persisted.')
        return saved.browserAi
      },
      getRecordsRootPath: () => path.join(options.getUserDataPath(), 'browser-ai'),
    }),
    getUserDataPath: options.getUserDataPath,
    launchConfig: (config) => ({ ...config, headless: config.learningHeadless }),
    learningService,
    emitProgress: (event) => {
      options.getMainWindow()?.webContents.send(IPC.BROWSER_AI_PROGRESS, event)
    },
  })
  const browserScreenshotAiService = createBrowserAiService({
    repository: createDefaultBrowserAiRepository({
      loadConfig: () => options.loadConfig().browserAi,
      saveConfig: async (config) => config,
      getRecordsRootPath: () => path.join(options.getUserDataPath(), 'browser-ai'),
    }),
    getUserDataPath: options.getUserDataPath,
    profileName: 'screenshot-edge-profile',
    launchConfig: (config) => config,
    learningService,
    emitProgress: () => undefined,
  })
  const browserScreenshotService = createBrowserScreenshotService({
    browserAiService: browserScreenshotAiService,
    openViewer: options.openBrowserScreenshotViewer,
    openCaptureWindow: options.openBrowserScreenshotWindow,
    getCaptureControlLabels: () => ({
      triggerLabel: translateMain(options.getLocale(), 'browserScreenshot.triggerLabel'),
      fixedPolicy: translateMain(options.getLocale(), 'browserScreenshot.fixedPolicy'),
      keepFixed: translateMain(options.getLocale(), 'browserScreenshot.keepFixed'),
      hideFixed: translateMain(options.getLocale(), 'browserScreenshot.hideFixed'),
      chooseContainer: translateMain(options.getLocale(), 'browserScreenshot.chooseContainer'),
      chooseElements: translateMain(options.getLocale(), 'browserScreenshot.chooseElements'),
      markElement: translateMain(options.getLocale(), 'browserScreenshot.markElement'),
      cancelMark: translateMain(options.getLocale(), 'browserScreenshot.cancelMark'),
      cancelAction: translateMain(options.getLocale(), 'browserScreenshot.cancelAction'),
      viewMarked: translateMain(options.getLocale(), 'browserScreenshot.viewMarked'),
      editMarked: translateMain(options.getLocale(), 'browserScreenshot.editMarked'),
      lastAppearance: translateMain(options.getLocale(), 'browserScreenshot.lastAppearance'),
      firstAppearance: translateMain(options.getLocale(), 'browserScreenshot.firstAppearance'),
      alwaysHide: translateMain(options.getLocale(), 'browserScreenshot.alwaysHide'),
      confirmElements: translateMain(options.getLocale(), 'browserScreenshot.confirmElements'),
      cancelSelection: translateMain(options.getLocale(), 'browserScreenshot.cancelSelection'),
      markedSummary: translateMain(options.getLocale(), 'browserScreenshot.markedSummary'),
      fullPage: translateMain(options.getLocale(), 'browserScreenshot.fullPage'),
      selectArea: translateMain(options.getLocale(), 'browserScreenshot.selectArea'),
    }),
    emitProgress: (event) => {
      options.getMainWindow()?.webContents.send(IPC.BROWSER_SCREENSHOT_PROGRESS, event)
      options.getBrowserScreenshotWindow()?.webContents.send(IPC.BROWSER_SCREENSHOT_PROGRESS, event)
    },
    emitTargetsChanged: (targets) => {
      options.getMainWindow()?.webContents.send(IPC.BROWSER_SCREENSHOT_TARGETS_CHANGED, targets)
      options.getBrowserScreenshotWindow()?.webContents.send(IPC.BROWSER_SCREENSHOT_TARGETS_CHANGED, targets)
    },
    setCaptureWindowVisible: (visible) => {
      const window = options.getBrowserScreenshotWindow()
      if (!window || window.isDestroyed()) return
      if (visible) {
        // Keep the captured browser page in the foreground. Some pages defer
        // scroll-driven painting while their window is blurred or occluded.
        window.showInactive()
      } else {
        window.hide()
      }
    },
    saveFile: async (pngBase64, suggestedName) => {
      const saveOptions = {
        defaultPath: suggestedName,
        filters: [{ name: 'PNG image', extensions: ['png'] }],
      }
      const window = options.getMainWindow()
      const result = window ? await dialog.showSaveDialog(window, saveOptions) : await dialog.showSaveDialog(saveOptions)
      if (result.canceled || !result.filePath) return false
      await writeFile(result.filePath, Buffer.from(pngBase64, 'base64'))
      return true
    },
    openFile: async (pngBase64, suggestedName) => {
      const directory = join(app.getPath('temp'), 'ide-electron-browser-screenshots')
      await mkdir(directory, { recursive: true })
      const filePath = join(directory, `${Date.now()}-${suggestedName.replace(/[\\/:*?"<>|]+/g, '_')}`)
      await writeFile(filePath, Buffer.from(pngBase64, 'base64'))
      const error = await shell.openPath(filePath)
      if (error) throw new Error(error)
      setTimeout(
        () => {
          void import('node:fs/promises').then(({ unlink }) => unlink(filePath).catch(() => undefined))
        },
        24 * 60 * 60 * 1_000,
      )
      return true
    },
  })
  // 本地整页截图：对预览 webview 的 guest WebContents 执行，不依赖外部浏览器。
  const previewPageCaptureService = createPreviewPageCaptureService({
    emitProgress: (event) => {
      options.getMainWindow()?.webContents.send(IPC.BROWSER_SCREENSHOT_PROGRESS, event)
    },
  })
  const aiGatewayService = createAiGatewayService({
    getCapability: options.getCapability,
    isLogCaptureEnabled: () => options.loadConfig().agentLogs?.enabled !== false,
  })
  const agentHookGateway = new AgentHookGateway({
    getConfig: () => options.loadConfig().agentHooks,
    isLogCaptureEnabled: () => options.loadConfig().agentLogs?.enabled !== false,
    onEvent: (event) => {
      options.getMainWindow()?.webContents.send(IPC.AGENT_HOOK_EVENT, event)
      void feishuNotifier.notifyIfNeeded(event).catch(() => undefined)
    },
    listProjects: () => listTranscriptImportProjects(),
    onTranscriptImport: async (payload) => {
      const imported = await transcriptService.importExternalTranscript(payload)
      options.emitTranscriptImported(imported)
      return imported
    },
    // dev 读仓库根 skills/...，packaged 读 resources/skills/...（随 extraResources 打包），读取失败时网关用内置兜底指令。
    transcriptSkillFileProvider: () => readTranscriptImportSkillFile([resolveAppResourcePath('skills', 'transcript-import', 'SKILL.md')]),
  })
  const agentLogService = createAgentLogService({
    getAiGatewayLogs: () => aiGatewayService.getRecentLogDetails(),
    getAgentHookLogs: () => agentHookGateway.getRecentLogDetails(),
    clearAiGatewayLogs: () => aiGatewayService.clearRecentLogs(),
    clearAgentHookLogs: () => agentHookGateway.clearRecentLogs(),
  })
  // 日历基础服务：同步查询 + 内置回退；不知道 Updater 的存在，任何网络状态下行为一致。
  const calendarService = createCalendarService({
    getUserDataDir: () => app.getPath('userData'),
    now: () => new Date(),
    readBuiltin: readBuiltinYearCalendar,
  })
  const quickActionService = createQuickActionService({
    loadConfig: options.loadConfig,
    updateConfig: options.updateConfig,
    getRunTaskService: options.getRunTaskService,
    validateProjectPath: (projectPath) => {
      const target = path.resolve(projectPath)
      return options.loadConfig().projects.some((project) => path.resolve(project.path) === target) && existsSync(target)
    },
    navigateMainWindow: options.navigateMainWindow,
    ensureWindowVisible: options.ensureWindowVisible,
    hasMainWindow: () => {
      const window = options.getMainWindow()
      return Boolean(window && !window.isDestroyed())
    },
    openPath: (target) => shell.openPath(target),
    openExternal: (url) => shell.openExternal(url),
    randomUUID: () => randomUUID(),
    isWorkday: (date) => calendarService.isWorkday(date),
    now: () => new Date(),
    desktopShortcuts: process.platform === 'win32' ? createQuickActionDesktopShortcuts() : undefined,
  })
  // 定时执行结果通知（D9）：成功与重试耗尽失败均发系统通知；点击聚焦主窗口。
  // Windows packaged 已设 appUserModelId（index.ts）；不支持时静默跳过。
  const notifyQuickActionRun = (event: QuickActionScheduleNotifyEvent) => {
    if (!Notification.isSupported()) return
    const locale = options.getLocale()
    const title = translateMain(locale, event.kind === 'success' ? 'quickActions.notification.runTitle' : 'quickActions.notification.failedTitle')
    const body = translateMain(locale, event.kind === 'success' ? 'quickActions.notification.runBody' : 'quickActions.notification.failedBody', { name: event.actionName, time: event.time, error: event.error ?? '' })
    const notification = new Notification({ title, body })
    notification.on('click', () => options.getMainWindow()?.focus())
    notification.show()
  }
  const quickActionScheduler = createQuickActionScheduler({
    getScheduledActions: () => quickActionService.readActions(),
    execute: (id) => quickActionService.execute({ id }, { silent: true }),
    setScheduleRunStamp: (id, stamp) => quickActionService.setScheduleRunStamp(id, stamp),
    isWorkday: (date) => calendarService.isWorkday(date),
    notify: notifyQuickActionRun,
    now: () => new Date(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle),
  })
  // 日历数据低频更新（§7）：持久化限频 + 一次性本地定时器 + 失败退避 + 原子替换。
  // HTTP/文件/定时器一律经 deps 注入封装；更新失败不影响日期查询与定时任务。
  const calendarUpdater = createCalendarUpdater({
    getStatePath: () => join(app.getPath('userData'), 'calendar', 'update-state.json'),
    getCacheDir: () => join(app.getPath('userData'), 'calendar', 'CN'),
    now: () => new Date(),
    fetchYear: async (url) => {
      // 固定 HTTPS 地址；15s 超时；响应体上限 1MB（超限按 error 处理）。
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      const text = await response.text()
      if (Buffer.byteLength(text, 'utf8') > 1024 * 1024) {
        throw new Error('Upstream year payload exceeds the 1MB response limit.')
      }
      return { status: response.status, text }
    },
    readTextFile: async (target) => {
      try {
        return await readFile(target, 'utf8')
      } catch {
        return null
      }
    },
    // 同目录 tmp + rename；失败保留旧文件，不会出现半截年度文件。
    writeFileAtomic: async (target, text) => {
      await mkdir(dirname(target), { recursive: true })
      const temporary = `${target}.tmp`
      await writeFile(temporary, text, 'utf8')
      await rename(temporary, target)
    },
    getLocalYearDays: (year) => calendarService.getYearCalendar(year)?.days ?? null,
    onYearApplied: (year) => calendarService.reload(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle),
  })

  return {
    aiEnvironmentController,
    gitService,
    runtimeService,
    processPortService,
    aiCommitService,
    aiConnectionService,
    transcriptService,
    feishuNotifier,
    transcriptShareService,
    learningService,
    skillService,
    browserAiService,
    browserScreenshotAiService,
    browserScreenshotService,
    previewPageCaptureService,
    aiGatewayService,
    agentHookGateway,
    agentLogService,
    quickActionService,
    quickActionScheduler,
    calendarService,
    calendarUpdater,
  }
}

export type AppServices = ReturnType<typeof createAppServices>
