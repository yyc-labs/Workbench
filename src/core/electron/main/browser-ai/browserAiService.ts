import type { Browser, BrowserContext, Page } from 'playwright-core'
import type {
  BrowserAiConfig,
  BrowserAiConnectionTestResult,
  BrowserAiConnectionStatus,
  BrowserAiContextPreview,
  BrowserAiErrorCode,
  BrowserAiRunTaskPayload,
  BrowserAiSaveTaskRecordPayload,
  BrowserAiSaveResultPayload,
  BrowserAiTaskRecord,
  BrowserAiTaskRecordSummary,
  BrowserAiTaskStep,
  BrowserAiSite,
  BrowserAiSnapshot,
  BrowserAiTaskProgressEvent,
  BrowserAiTaskResult,
  BrowserAiTaskStatus,
  LearningNote,
} from '../../../shared/types'
import type { LearningService } from '../learning/learningService'
import { chatgptAdapter } from './site-adapters/chatgptAdapter'
import { genericWebAiAdapter } from './site-adapters/genericWebAiAdapter'
import type { BrowserAiSiteAdapter } from './site-adapters/browserAiSiteAdapter'
import { connectOverCdp, disconnectFromCdp } from './cdpConnection'
import { createEdgeLauncher, type EdgeLauncher } from './edgeLauncher'
import { composeBrowserAiContext } from './contextComposer'
import { createBrowserAiRepository, type BrowserAiRepository } from './browserAiRepository'
import { BrowserAiServiceError, classifyBrowserAiError } from './taskState'
import { isSupportedBrowserAiSiteUrl } from './browserAiConfig'

type BrowserAiServiceDependencies = {
  repository: BrowserAiRepository
  getUserDataPath: () => string
  learningService: LearningService
  emitProgress: (event: BrowserAiTaskProgressEvent) => void
}

export interface BrowserAiService {
  getSnapshot: () => BrowserAiSnapshot
  saveConfig: (config: BrowserAiConfig) => Promise<BrowserAiSnapshot>
  start: () => Promise<BrowserAiSnapshot>
  stop: () => Promise<BrowserAiSnapshot>
  testConnection: () => Promise<BrowserAiConnectionTestResult>
  openLogin: () => Promise<BrowserAiSnapshot>
  composePreview: (payload: BrowserAiRunTaskPayload) => BrowserAiContextPreview
  runTask: (payload: BrowserAiRunTaskPayload) => Promise<BrowserAiTaskResult>
  cancelTask: () => Promise<BrowserAiSnapshot>
  saveResult: (payload: BrowserAiSaveResultPayload) => Promise<LearningNote>
  listTaskRecords: () => Promise<BrowserAiTaskRecordSummary[]>
  getTaskRecord: (recordId: string) => Promise<BrowserAiTaskRecord | null>
  saveTaskRecord: (payload: BrowserAiSaveTaskRecordPayload) => Promise<BrowserAiTaskRecord>
  deleteTaskRecord: (recordId: string) => Promise<boolean>
  cleanupOnBeforeQuit: () => Promise<void>
}

const siteAdapters: Record<BrowserAiSite, BrowserAiSiteAdapter> = {
  'generic-web': genericWebAiAdapter,
  'chatgpt-web': chatgptAdapter,
}

function createTaskId(): string {
  return `browser-ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function errorMessage(errorCode: BrowserAiErrorCode): string {
  switch (errorCode) {
    case 'BROWSER_NOT_FOUND': return 'Microsoft Edge could not be started.'
    case 'CDP_UNAVAILABLE': return 'The Edge debugging connection is unavailable.'
    case 'LOGIN_REQUIRED': return 'Please sign in to the configured web AI site in the managed Edge profile.'
    case 'SITE_NOT_RECOGNIZED': return 'The connected page is not the configured web AI site.'
    case 'COMPOSER_NOT_FOUND': return 'The web AI message composer could not be found.'
    case 'SUBMIT_FAILED': return 'The prompt could not be sent to the configured web AI site.'
    case 'RESPONSE_TIMEOUT': return 'The web AI site did not finish before the timeout.'
    case 'RESPONSE_EMPTY': return 'The web AI site completed without a readable answer.'
    case 'BROWSER_DISCONNECTED': return 'The Edge browser connection was closed.'
    case 'SITE_LIMIT_OR_ERROR': return 'The configured web AI site reported a limit or site error.'
    case 'TASK_CANCELLED': return 'The browser AI task was cancelled.'
    case 'TASK_ALREADY_RUNNING': return 'Another browser AI task is already running.'
    default: return 'The browser AI task could not be completed.'
  }
}

function isSameConnectionConfig(left: BrowserAiConfig, right: BrowserAiConfig): boolean {
  return left.mode === right.mode
    && left.edgeExecutablePath === right.edgeExecutablePath
    && left.cdpPort === right.cdpPort
    && left.site === right.site
    && left.siteUrl === right.siteUrl
    && left.headless === right.headless
}

function defaultTaskRecordTitle(config: BrowserAiConfig, startedAt: number): string {
  const activeSite = config.sites.find((site) => site.id === config.activeSiteId)
  const siteName = activeSite?.name || config.site
  return `${siteName} · ${new Date(startedAt).toLocaleString()}`
}

export function createBrowserAiService(deps: BrowserAiServiceDependencies): BrowserAiService {
  const launcher: EdgeLauncher = createEdgeLauncher()
  let browser: Browser | null = null
  let context: BrowserContext | null = null
  let connection: BrowserAiConnectionStatus = 'disconnected'
  let connectionErrorCode: BrowserAiErrorCode | undefined
  let connectionErrorMessage: string | undefined
  let cdpPort: number | undefined
  let activePage: Page | null = null
  let loginPage: Page | null = null
  let activeTaskId: string | undefined
  let taskStatus: BrowserAiTaskStatus = 'idle'
  let cancelRequested = false
  let lastResult: BrowserAiTaskResult | undefined
  let profilePath = ''
  let taskSteps: BrowserAiTaskStep[] = []
  let currentStepId: BrowserAiTaskStep['id'] | undefined

  const getConfig = () => deps.repository.getConfig()

  const getAdapter = (site: BrowserAiSite): BrowserAiSiteAdapter => {
    const config = getConfig()
    if (site !== config.site || !isSupportedBrowserAiSiteUrl(config.siteUrl)) {
      throw new BrowserAiServiceError('SITE_NOT_RECOGNIZED', 'The configured web AI site URL is not supported.')
    }
    const adapter = siteAdapters[site]
    if (!adapter) {
      throw new BrowserAiServiceError('SITE_NOT_RECOGNIZED', 'The configured web AI adapter is not available.')
    }
    if (!adapter.matchesPage(config.siteUrl, config.siteUrl)) {
      throw new BrowserAiServiceError('SITE_NOT_RECOGNIZED', 'The selected web AI adapter does not match the configured site URL.')
    }
    return adapter
  }

  const emit = (
    taskId: string,
    status: BrowserAiTaskStatus,
    sourceLabels: string[] = [],
    extra?: Pick<BrowserAiTaskProgressEvent, 'characterCount' | 'message' | 'errorCode'>,
  ) => {
    taskStatus = status
    deps.emitProgress({ taskId, status, sourceLabels, steps: taskSteps, ...extra })
  }

  const emitStep = (
    taskId: string,
    status: BrowserAiTaskStatus,
    sourceLabels: string[],
    stepId: BrowserAiTaskStep['id'],
    stepStatus: BrowserAiTaskStep['status'],
    message?: string,
    detail?: string,
    elapsedMs?: number,
  ) => {
    const now = Date.now()
    taskSteps = taskSteps.map((step) => {
      if (step.id === stepId) return step
      if (step.status !== 'active' || stepStatus !== 'active') return step
      return {
        ...step,
        status: 'completed',
        updatedAt: now,
        completedAt: now,
        elapsedMs: step.startedAt ? now - step.startedAt : step.elapsedMs,
      }
    })
    const existing = taskSteps.find((step) => step.id === stepId)
    const startedAt = existing?.startedAt ?? (stepStatus === 'active' ? now : undefined)
    const nextStep: BrowserAiTaskStep = {
      id: stepId,
      status: stepStatus,
      startedAt,
      updatedAt: now,
      completedAt: stepStatus === 'completed' || stepStatus === 'failed' || stepStatus === 'cancelled' ? now : undefined,
      elapsedMs: elapsedMs ?? (startedAt && stepStatus !== 'active' ? now - startedAt : undefined),
      message: message ?? existing?.message,
      detail: detail ?? existing?.detail,
    }
    taskSteps = [...taskSteps.filter((step) => step.id !== stepId), nextStep]
    currentStepId = stepStatus === 'active' ? stepId : currentStepId === stepId ? undefined : currentStepId
    taskStatus = status
    deps.emitProgress({ taskId, status, sourceLabels, steps: taskSteps, step: nextStep })
  }

  const getTaskRecordSite = (config: BrowserAiConfig) => {
    const activeSite = config.sites.find((site) => site.id === config.activeSiteId)
    return {
      site: config.site,
      name: activeSite?.name || config.site,
      url: config.siteUrl,
    }
  }

  const buildTaskRecord = (
    taskId: string,
    payload: BrowserAiRunTaskPayload,
    preview: BrowserAiContextPreview,
    startedAt: number,
    status: BrowserAiTaskRecord['status'],
    completedAt?: number,
    answer?: string,
    errorCode?: BrowserAiErrorCode,
    errorMessage?: string,
  ): BrowserAiTaskRecord => {
    const savePrompt = payload.savePrompt === true
    const sources = preview.sources.map((summary) => {
      const source = payload.sources.find((item) => item.kind === summary.kind && item.label.trim() === summary.label)
      return {
        kind: summary.kind,
        label: summary.label,
        referenceId: source?.referenceId,
        included: summary.included,
        sensitive: summary.sensitive,
        characterCount: summary.characterCount,
        content: savePrompt ? source?.content : undefined,
      }
    })
    return {
      id: taskId,
      title: defaultTaskRecordTitle(getConfig(), startedAt),
      createdAt: startedAt,
      updatedAt: completedAt ?? Date.now(),
      startedAt,
      completedAt,
      site: getTaskRecordSite(getConfig()),
      sources,
      status,
      answer,
      steps: taskSteps,
      errorCode,
      errorMessage,
      input: {
        task: payload.task?.trim() || undefined,
        responseFormat: payload.responseFormat?.trim() || undefined,
        sources,
        promptSaved: savePrompt,
      },
    }
  }

  const getSnapshot = (): BrowserAiSnapshot => ({
    config: getConfig(),
    connection,
    browserRunning: Boolean(browser?.isConnected()) || launcher.isRunning(),
    profilePath,
    taskStatus,
    activeTaskId,
    lastResult,
    errorCode: connectionErrorCode,
    errorMessage: connectionErrorMessage,
  })

  const closeOwnedPage = async (page: Page | null): Promise<void> => {
    if (!page || page.isClosed()) return
    await page.close().catch(() => undefined)
  }

  const disconnect = async (stopManagedBrowser: boolean): Promise<void> => {
    await closeOwnedPage(activePage)
    activePage = null
    await closeOwnedPage(loginPage)
    loginPage = null
    await disconnectFromCdp(browser)
    browser = null
    context = null
    cdpPort = undefined
    connection = 'disconnected'
    if (stopManagedBrowser) await launcher.stop()
  }

  const ensureConnected = async (): Promise<void> => {
    if (browser?.isConnected() && context && cdpPort) {
      connection = 'connected'
      return
    }

    const config = getConfig()
    if (!config.enabled) {
      throw new BrowserAiServiceError('CDP_UNAVAILABLE', 'Browser AI is disabled.')
    }
    connection = 'connecting'
    connectionErrorCode = undefined
    connectionErrorMessage = undefined

    try {
      if (config.mode === 'managed-edge') {
        const launched = await launcher.start(config, deps.getUserDataPath())
        cdpPort = launched.port
        profilePath = launched.profilePath
      } else {
        if (!config.cdpPort) {
          throw new BrowserAiServiceError('CDP_UNAVAILABLE', 'An external CDP port is required.')
        }
        cdpPort = config.cdpPort
        profilePath = ''
      }

      const connected = await connectOverCdp(config.cdpHost, cdpPort, { attempts: 40, timeoutMs: 1_000 })
      browser = connected.browser
      context = connected.context
      const connectedBrowser = connected.browser
      connectedBrowser.once('disconnected', () => {
        if (browser !== connectedBrowser) return
        browser = null
        context = null
        cdpPort = undefined
        connection = 'disconnected'
        if (activeTaskId) {
          connectionErrorCode = 'BROWSER_DISCONNECTED'
          connectionErrorMessage = errorMessage('BROWSER_DISCONNECTED')
        }
      })
      connection = 'connected'
    } catch (error) {
      const classified = classifyBrowserAiError(error)
      connection = 'error'
      connectionErrorCode = classified.code
      connectionErrorMessage = classified.message
      if (config.mode === 'managed-edge') await launcher.stop()
      throw classified
    }
  }

  const navigateAndDetectLogin = async (
    page: Page,
    adapter: BrowserAiSiteAdapter,
  ): Promise<'logged-in' | 'needs-login'> => {
    if (!adapter.matchesPage(page.url(), getConfig().siteUrl)) {
      throw new BrowserAiServiceError('SITE_NOT_RECOGNIZED', 'The connected page is not the configured web AI site.')
    }
    const loginState = await adapter.detectLoginState(page)
    if (loginState === 'needs-login') {
      connection = 'needs-login'
      return 'needs-login'
    }
    if (loginState !== 'logged-in') {
      throw new BrowserAiServiceError('COMPOSER_NOT_FOUND', 'The web AI message composer could not be found.')
    }
    connection = 'connected'
    return 'logged-in'
  }

  const testConnection = async (): Promise<BrowserAiConnectionTestResult> => {
    try {
      const config = getConfig()
      const adapter = getAdapter(config.site)
      await ensureConnected()
      const page = await context!.newPage()
      try {
        await adapter.openNewConversation(page, config.siteUrl)
        if (!adapter.matchesPage(page.url(), config.siteUrl)) {
          throw new BrowserAiServiceError('SITE_NOT_RECOGNIZED', 'The connected page is not the configured web AI site.')
        }
        const loginState = await adapter.detectLoginState(page)
        if (loginState === 'needs-login') {
          connection = 'needs-login'
          return { status: 'needs-login', site: adapter.site, loggedIn: false, errorCode: 'LOGIN_REQUIRED' }
        }
        if (loginState !== 'logged-in') {
          throw new BrowserAiServiceError('COMPOSER_NOT_FOUND', 'The web AI message composer could not be found.')
        }
        return { status: 'connected', site: adapter.site, loggedIn: true }
      } finally {
        await closeOwnedPage(page)
      }
    } catch (error) {
      const classified = classifyBrowserAiError(error)
      connectionErrorCode = classified.code
      connectionErrorMessage = classified.message
      return {
        status: connection === 'needs-login' ? 'needs-login' : 'error',
        site: getConfig().site,
        loggedIn: false,
        message: classified.message,
        errorCode: classified.code,
      }
    }
  }

  return {
    getSnapshot,

    saveConfig: async (nextConfig) => {
      const currentConfig = getConfig()
      const normalized = await deps.repository.saveConfig(nextConfig)
      if (!activeTaskId && !isSameConnectionConfig(currentConfig, normalized)) {
        await disconnect(currentConfig.mode === 'managed-edge' || normalized.mode === 'managed-edge')
      }
      return getSnapshot()
    },

    start: async () => {
      try {
        getAdapter(getConfig().site)
        await ensureConnected()
      } catch (error) {
        const classified = classifyBrowserAiError(error)
        connection = 'error'
        connectionErrorCode = classified.code
        connectionErrorMessage = classified.message
      }
      return getSnapshot()
    },

    stop: async () => {
      cancelRequested = true
      await disconnect(true)
      activeTaskId = undefined
      taskStatus = 'idle'
      connectionErrorCode = undefined
      connectionErrorMessage = undefined
      return getSnapshot()
    },

    testConnection,

    openLogin: async () => {
      try {
        const config = getConfig()
        const adapter = getAdapter(config.site)
        await ensureConnected()
        await closeOwnedPage(loginPage)
        loginPage = await context!.newPage()
        await adapter.openNewConversation(loginPage, config.siteUrl)
        const loginState = await adapter.detectLoginState(loginPage)
        connection = loginState === 'needs-login' ? 'needs-login' : 'connected'
        return getSnapshot()
      } catch (error) {
        const classified = classifyBrowserAiError(error)
        connection = 'error'
        connectionErrorCode = classified.code
        connectionErrorMessage = classified.message
        return getSnapshot()
      }
    },

    composePreview: (payload) => composeBrowserAiContext(payload),

    runTask: async (payload) => {
      const taskId = createTaskId()
      const startedAt = Date.now()
      if (activeTaskId) {
        return {
          taskId,
          status: 'failed',
          sourceLabels: [],
          startedAt,
          completedAt: Date.now(),
          steps: [],
          errorCode: 'TASK_ALREADY_RUNNING',
          errorMessage: errorMessage('TASK_ALREADY_RUNNING'),
        }
      }

      let preview: BrowserAiContextPreview
      try {
        preview = composeBrowserAiContext(payload)
      } catch (error) {
        const classified = error instanceof BrowserAiServiceError
          ? error
          : error instanceof Error && 'code' in error
            ? new BrowserAiServiceError((error as { code: BrowserAiErrorCode }).code, error.message)
            : new BrowserAiServiceError('CONTEXT_INVALID', 'The browser AI context is invalid.')
        return {
          taskId,
          status: 'failed',
          sourceLabels: [],
          startedAt,
          completedAt: Date.now(),
          steps: [],
          errorCode: classified.code,
          errorMessage: classified.message,
        }
      }

      let adapter: BrowserAiSiteAdapter
      try {
        adapter = getAdapter(payload.site)
      } catch (error) {
        const classified = classifyBrowserAiError(error)
        const result: BrowserAiTaskResult = {
          taskId,
          status: 'failed',
          sourceLabels: preview.sourceLabels,
          startedAt,
          completedAt: Date.now(),
          steps: [],
          errorCode: classified.code,
          errorMessage: classified.message,
        }
        lastResult = result
        emit(taskId, 'failed', preview.sourceLabels, {
          errorCode: classified.code,
          message: classified.message,
        })
        return result
      }

      activeTaskId = taskId
      cancelRequested = false
      connectionErrorCode = undefined
      connectionErrorMessage = undefined
      taskSteps = []
      currentStepId = undefined
      emitStep(taskId, 'starting', preview.sourceLabels, 'prepare-task', 'active', 'Preparing browser AI task.')
      const initialRecord = buildTaskRecord(taskId, payload, preview, startedAt, 'running')
      await deps.repository.saveTaskRecord(initialRecord).catch(() => undefined)

      try {
        emitStep(taskId, 'connecting', preview.sourceLabels, 'connect-edge', 'active', 'Connecting to Edge.')
        await ensureConnected()
        emitStep(taskId, 'connecting', preview.sourceLabels, 'connect-edge', 'completed', 'Connected to Edge.')
        activePage = await context!.newPage()
        emitStep(taskId, 'opening-page', preview.sourceLabels, 'open-conversation', 'active', 'Opening a new AI conversation.')
        await adapter.openNewConversation(activePage, getConfig().siteUrl)
        if (!adapter.matchesPage(activePage.url(), getConfig().siteUrl)) {
          throw new BrowserAiServiceError('SITE_NOT_RECOGNIZED', 'The connected page is not the configured web AI site.')
        }
        emitStep(taskId, 'opening-page', preview.sourceLabels, 'open-conversation', 'completed', 'AI conversation opened.')
        emitStep(taskId, 'opening-page', preview.sourceLabels, 'check-login', 'active', 'Checking login state.')
        const loginState = await navigateAndDetectLogin(activePage, adapter)
        if (loginState === 'needs-login') {
          emitStep(taskId, 'needs-login', preview.sourceLabels, 'check-login', 'failed', errorMessage('LOGIN_REQUIRED'))
          throw new BrowserAiServiceError('LOGIN_REQUIRED', errorMessage('LOGIN_REQUIRED'))
        }
        emitStep(taskId, 'opening-page', preview.sourceLabels, 'check-login', 'completed', 'Login state confirmed.')
        await adapter.submitPrompt(activePage, preview.prompt, (step) => {
          emitStep(taskId, 'sending', preview.sourceLabels, step.id, step.status, step.message, step.detail, step.elapsedMs)
        })
        emitStep(taskId, 'waiting-response', preview.sourceLabels, 'wait-response', 'active', 'Waiting for the answer.')
        await adapter.waitForCompletion(
          activePage,
          getConfig().responseTimeoutMs,
          () => cancelRequested,
          (step) => emitStep(taskId, 'waiting-response', preview.sourceLabels, step.id, step.status, step.message, step.detail, step.elapsedMs),
        )
        emitStep(taskId, 'waiting-response', preview.sourceLabels, 'wait-response', 'completed', 'The answer is ready.')
        emitStep(taskId, 'waiting-response', preview.sourceLabels, 'read-answer', 'active', 'Reading the answer.')
        const answer = (await adapter.readAnswer(activePage)).trim()
        if (!answer) throw new BrowserAiServiceError('RESPONSE_EMPTY', errorMessage('RESPONSE_EMPTY'))
        emitStep(taskId, 'waiting-response', preview.sourceLabels, 'read-answer', 'completed', 'Answer read.')
        emitStep(taskId, 'completed', preview.sourceLabels, 'completed', 'completed', 'Browser AI task completed.')

        const completedAt = Date.now()
        const record = buildTaskRecord(taskId, payload, preview, startedAt, 'completed', completedAt, answer)
        await deps.repository.saveTaskRecord(record).catch(() => undefined)
        const result: BrowserAiTaskResult = {
          taskId,
          status: 'completed',
          answer,
          sourceLabels: preview.sourceLabels,
          startedAt,
          completedAt,
          recordId: taskId,
          steps: taskSteps,
        }
        lastResult = result
        emit(taskId, 'completed', preview.sourceLabels, { characterCount: answer.length })
        return result
      } catch (error) {
        const classified = cancelRequested
          ? new BrowserAiServiceError('TASK_CANCELLED', errorMessage('TASK_CANCELLED'))
          : classifyBrowserAiError(error)
        const status = classified.code === 'TASK_CANCELLED' ? 'cancelled' : 'failed'
        const terminalStepId: BrowserAiTaskStep['id'] = status === 'cancelled' ? 'cancelled' : 'failed'
        if (currentStepId) {
          emitStep(taskId, status, preview.sourceLabels, currentStepId, status === 'cancelled' ? 'cancelled' : 'failed', classified.message)
        }
        emitStep(taskId, status, preview.sourceLabels, terminalStepId, 'completed', classified.message)
        const completedAt = Date.now()
        const record = buildTaskRecord(taskId, payload, preview, startedAt, status, completedAt, undefined, classified.code, classified.message)
        await deps.repository.saveTaskRecord(record).catch(() => undefined)
        const result: BrowserAiTaskResult = {
          taskId,
          status,
          sourceLabels: preview.sourceLabels,
          startedAt,
          completedAt,
          recordId: taskId,
          steps: taskSteps,
          errorCode: classified.code,
          errorMessage: classified.message,
        }
        lastResult = result
        if (classified.code === 'LOGIN_REQUIRED') connection = 'needs-login'
        if (classified.code === 'BROWSER_DISCONNECTED') connection = 'disconnected'
        emit(taskId, status, preview.sourceLabels, { errorCode: classified.code, message: classified.message })
        return result
      } finally {
        await closeOwnedPage(activePage)
        activePage = null
        activeTaskId = undefined
        cancelRequested = false
        currentStepId = undefined
        if (taskStatus !== 'completed' && taskStatus !== 'failed' && taskStatus !== 'cancelled') {
          taskStatus = 'idle'
        }
      }
    },

    cancelTask: async () => {
      if (!activeTaskId) return getSnapshot()
      cancelRequested = true
      await closeOwnedPage(activePage)
      activePage = null
      return getSnapshot()
    },

    saveResult: async (payload) => {
      const answer = typeof payload.answer === 'string' ? payload.answer.trim() : ''
      if (!answer) throw new BrowserAiServiceError('SAVE_RESULT_FAILED', 'The answer is empty.')

      if (payload.mode === 'new-note') {
        return deps.learningService.createNote({
          title: payload.title?.trim() || 'Browser AI result',
          contentMd: answer,
          status: 'draft',
          tags: ['browser-ai'],
        })
      }

      const noteId = payload.noteId?.trim() || ''
      if (!noteId) throw new BrowserAiServiceError('LEARNING_NOTE_NOT_FOUND', 'A learning note is required.')
      const existing = await deps.learningService.getNote(noteId)
      if (!existing) throw new BrowserAiServiceError('LEARNING_NOTE_NOT_FOUND', 'The learning note was not found.')
      return deps.learningService.updateNote({
        noteId,
        title: existing.title,
        categoryId: existing.categoryId,
        tags: existing.tags,
        status: existing.status,
        contentMd: `${existing.contentMd.trimEnd()}\n\n${answer}\n`,
      })
    },

    listTaskRecords: () => deps.repository.listTaskRecords(),

    getTaskRecord: (recordId) => deps.repository.getTaskRecord(recordId),

    saveTaskRecord: async (payload) => {
      const record = await deps.repository.getTaskRecord(payload.recordId)
      if (!record) throw new BrowserAiServiceError('TASK_RECORD_NOT_FOUND', 'The browser AI task record was not found.')
      const title = payload.title.trim()
      if (!title) throw new BrowserAiServiceError('TASK_RECORD_SAVE_FAILED', 'A browser AI task name is required.')
      if (payload.savePrompt === true && !record.input.promptSaved) {
        throw new BrowserAiServiceError('TASK_RECORD_SAVE_FAILED', 'The complete prompt was not retained for this task.')
      }
      const updated = await deps.repository.renameTaskRecord(record.id, title)
      if (!updated) throw new BrowserAiServiceError('TASK_RECORD_NOT_FOUND', 'The browser AI task record was not found.')
      return updated
    },

    deleteTaskRecord: (recordId) => deps.repository.deleteTaskRecord(recordId),

    cleanupOnBeforeQuit: async () => {
      cancelRequested = true
      await disconnect(!getConfig().keepBrowserRunning)
      activeTaskId = undefined
      taskStatus = 'idle'
    },
  }
}

export function createDefaultBrowserAiRepository(deps: {
  loadConfig: () => BrowserAiConfig | undefined
  saveConfig: (config: BrowserAiConfig) => Promise<BrowserAiConfig>
  getRecordsRootPath: () => string
}): BrowserAiRepository {
  return createBrowserAiRepository(deps)
}
