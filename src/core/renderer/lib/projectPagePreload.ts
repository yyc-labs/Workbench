import type {
  ProjectPanePreloadHandle,
  ProjectPanePreloadOptions,
  ProjectPaneTab,
} from '../components/ProjectPaneTabs'

type HomePageModule = typeof import('../pages/Home')
type DetailPageModule = typeof import('../pages/Detail')
type TranscriptPageModule = typeof import('../pages/TranscriptPage')
type SettingsPageModule = typeof import('../pages/Settings')
type CodeWorkspacePanelModule = typeof import('../pages/code/CodeWorkspacePanel')
type DetailAiCommitPaneHostModule = typeof import('../pages/detail/DetailAiCommitPaneHost')
type MonacoPreloadModule = typeof import('./monacoPreload')

const NOOP_PRELOAD_HANDLE: ProjectPanePreloadHandle = { cancel() {} }
const PROJECT_PANE_INTENT_DELAY_MS = 220
const MONACO_PRELOAD_FALLBACK_DELAY_MS = 350
const MONACO_PRELOAD_IDLE_TIMEOUT_MS = 1500

let homePageModulePromise: Promise<HomePageModule> | null = null
let detailPageModulePromise: Promise<DetailPageModule> | null = null
let transcriptPageModulePromise: Promise<TranscriptPageModule> | null = null
let settingsPageModulePromise: Promise<SettingsPageModule> | null = null
let codeWorkspacePanelModulePromise: Promise<CodeWorkspacePanelModule> | null = null
let detailAiCommitPaneHostModulePromise: Promise<DetailAiCommitPaneHostModule> | null = null
let monacoPreloadModulePromise: Promise<MonacoPreloadModule> | null = null
let monacoEditorPreloadScheduled = false
let projectPaneIntentPreloadHandle: ProjectPanePreloadHandle | null = null

export function loadHomePageModule(): Promise<HomePageModule> {
  homePageModulePromise ??= import('../pages/Home')
  return homePageModulePromise
}

export function loadDetailPageModule(): Promise<DetailPageModule> {
  detailPageModulePromise ??= import('../pages/Detail')
  return detailPageModulePromise
}

export function loadTranscriptPageModule(): Promise<TranscriptPageModule> {
  transcriptPageModulePromise ??= import('../pages/TranscriptPage')
  return transcriptPageModulePromise
}

export function loadSettingsPageModule(): Promise<SettingsPageModule> {
  settingsPageModulePromise ??= import('../pages/Settings')
  return settingsPageModulePromise
}

export function loadCodeWorkspacePanelModule(): Promise<CodeWorkspacePanelModule> {
  codeWorkspacePanelModulePromise ??= import('../pages/code/CodeWorkspacePanel')
  return codeWorkspacePanelModulePromise
}

export function loadDetailAiCommitPaneHostModule(): Promise<DetailAiCommitPaneHostModule> {
  detailAiCommitPaneHostModulePromise ??= import('../pages/detail/DetailAiCommitPaneHost')
  return detailAiCommitPaneHostModulePromise
}

function preloadMonacoEditorModule(): void {
  monacoPreloadModulePromise ??= import('./monacoPreload')
  void monacoPreloadModulePromise.then((module) => module.preloadMonacoEditorModule())
}

function cancelProjectPaneIntentPreload(): void {
  projectPaneIntentPreloadHandle?.cancel()
  projectPaneIntentPreloadHandle = null
}

function scheduleProjectPaneIntentPreload(run: () => void): ProjectPanePreloadHandle {
  cancelProjectPaneIntentPreload()

  if (typeof window === 'undefined') {
    run()
    return NOOP_PRELOAD_HANDLE
  }

  let canceled = false
  const timerId = window.setTimeout(() => {
    if (canceled) return
    if (projectPaneIntentPreloadHandle === handle) {
      projectPaneIntentPreloadHandle = null
    }
    run()
  }, PROJECT_PANE_INTENT_DELAY_MS)

  const handle: ProjectPanePreloadHandle = {
    cancel() {
      if (canceled) return
      canceled = true
      window.clearTimeout(timerId)
      if (projectPaneIntentPreloadHandle === handle) {
        projectPaneIntentPreloadHandle = null
      }
    },
  }

  projectPaneIntentPreloadHandle = handle
  return handle
}

function scheduleMonacoEditorPreload(): void {
  if (monacoEditorPreloadScheduled) return
  monacoEditorPreloadScheduled = true

  const run = () => {
    monacoEditorPreloadScheduled = false
    preloadMonacoEditorModule()
  }

  if (typeof window === 'undefined') {
    run()
    return
  }

  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
  }

  if (idleWindow.requestIdleCallback) {
    idleWindow.requestIdleCallback(run, { timeout: MONACO_PRELOAD_IDLE_TIMEOUT_MS })
    return
  }

  window.setTimeout(run, MONACO_PRELOAD_FALLBACK_DELAY_MS)
}

function normalizeProjectPane(pane: string | undefined): ProjectPaneTab {
  if (pane === 'aicommit' || pane === 'git') return 'aicommit'
  if (pane === 'transcript') return 'transcript'
  return 'code'
}

function preloadProjectPaneNow(activePane: ProjectPaneTab): void {
  if (activePane === 'transcript') {
    void loadTranscriptPageModule()
    return
  }

  void loadDetailPageModule()
  if (activePane === 'aicommit') {
    void loadDetailAiCommitPaneHostModule()
    return
  }

  void loadCodeWorkspacePanelModule()
  scheduleMonacoEditorPreload()
}

export function preloadProjectPane(
  pane: string | undefined,
  options: ProjectPanePreloadOptions = {}
): ProjectPanePreloadHandle {
  const activePane = normalizeProjectPane(pane)

  if (options.intent === 'intent') {
    return scheduleProjectPaneIntentPreload(() => preloadProjectPaneNow(activePane))
  }

  cancelProjectPaneIntentPreload()
  preloadProjectPaneNow(activePane)
  return NOOP_PRELOAD_HANDLE
}
