import path from 'node:path'
import { app, dialog, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectIdFromPath } from '../../shared/rules'
import type { AppConfig, BrowserScreenshotViewerPayload, Capability, TranscriptImportedEvent } from '../../shared/types'
import { createAgentLogService } from './agent-logs/agent-log-service'
import { createAiCommitService } from './ai-commit/ai-commit-service'
import { createAiConnectionService } from './ai-connection/ai-connection-service'
import { AiEnvironmentController } from './ai-environment/environment-controller'
import { createAiGatewayService } from './ai-gateway/gateway-service'
import { createBrowserAiService, createDefaultBrowserAiRepository } from './browser-ai/browserAiService'
import { createBrowserScreenshotService } from './screenshot/screenshotService'
import { createGitService } from './git/git-service'
import { AgentHookGateway } from './hooks/agent-hook-gateway'
import { FeishuNotifier } from './hooks/feishu-notifier'
import { IPC } from './ipc'
import { createLearningRepository } from './learning/learningRepository'
import { createLearningService } from './learning/learningService'
import { createProcessPortService } from './process-ports/process-port-service'
import { translateMain, type MainLocale } from './mainI18n'
import type { ProcessManager } from './runner'
import { createRuntimeService } from './runtime/runtime-service'
import { createSkillRepository } from './skill/skillRepository'
import { createSkillService } from './skill/skillService'
import { listTranscriptImportProjects } from './transcript/transcriptImportProjects'
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
      const normalizedTarget = path.resolve(projectPath)
      const project = options.loadConfig().projects.find((item) => path.resolve(item.path) === normalizedTarget)
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
  })
  const agentLogService = createAgentLogService({
    getAiGatewayLogs: () => aiGatewayService.getRecentLogDetails(),
    getAgentHookLogs: () => agentHookGateway.getRecentLogDetails(),
    clearAiGatewayLogs: () => aiGatewayService.clearRecentLogs(),
    clearAgentHookLogs: () => agentHookGateway.clearRecentLogs(),
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
    aiGatewayService,
    agentHookGateway,
    agentLogService,
  }
}

export type AppServices = ReturnType<typeof createAppServices>
