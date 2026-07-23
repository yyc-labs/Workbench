import path from 'node:path'
import type { BrowserWindow } from 'electron'
import { projectIdFromPath } from '../../shared/rules'
import type { AppConfig, Capability, TranscriptImportedEvent } from '../../shared/types'
import { createAgentLogService } from './agent-logs/agent-log-service'
import { createAiCommitService } from './ai-commit/ai-commit-service'
import { createAiConnectionService } from './ai-connection/ai-connection-service'
import { AiEnvironmentController } from './ai-environment/environment-controller'
import { createAiGatewayService } from './ai-gateway/gateway-service'
import { createBrowserAiService, createDefaultBrowserAiRepository } from './browser-ai/browserAiService'
import { createGitService } from './git/git-service'
import { AgentHookGateway } from './hooks/agent-hook-gateway'
import { FeishuNotifier } from './hooks/feishu-notifier'
import { IPC } from './ipc'
import { createLearningRepository } from './learning/learningRepository'
import { createLearningService } from './learning/learningService'
import type { MainLocale } from './mainI18n'
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
  const aiCommitService = createAiCommitService({
    getMainWindow: options.getMainWindow,
    getDefaultWslDistro: () => options.getCapability()?.wslDistro || 'Ubuntu',
    aiEnvironmentController,
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
    learningService,
    emitProgress: (event) => {
      options.getMainWindow()?.webContents.send(IPC.BROWSER_AI_PROGRESS, event)
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
    aiCommitService,
    aiConnectionService,
    transcriptService,
    feishuNotifier,
    transcriptShareService,
    learningService,
    skillService,
    browserAiService,
    aiGatewayService,
    agentHookGateway,
    agentLogService,
  }
}

export type AppServices = ReturnType<typeof createAppServices>
