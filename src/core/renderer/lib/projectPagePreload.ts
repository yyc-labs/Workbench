import type { ProjectPaneTab } from '../components/ProjectPaneTabs'
import { preloadMonacoEditorModule } from './monacoPreload'

type HomePageModule = typeof import('../pages/Home')
type DetailPageModule = typeof import('../pages/Detail')
type TranscriptPageModule = typeof import('../pages/TranscriptPage')
type SettingsPageModule = typeof import('../pages/Settings')
type CodeWorkspacePanelModule = typeof import('../pages/code/CodeWorkspacePanel')
type DetailAiCommitPaneHostModule = typeof import('../pages/detail/DetailAiCommitPaneHost')

let homePageModulePromise: Promise<HomePageModule> | null = null
let detailPageModulePromise: Promise<DetailPageModule> | null = null
let transcriptPageModulePromise: Promise<TranscriptPageModule> | null = null
let settingsPageModulePromise: Promise<SettingsPageModule> | null = null
let codeWorkspacePanelModulePromise: Promise<CodeWorkspacePanelModule> | null = null
let detailAiCommitPaneHostModulePromise: Promise<DetailAiCommitPaneHostModule> | null = null

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

function normalizeProjectPane(pane: string | undefined): ProjectPaneTab {
  if (pane === 'aicommit' || pane === 'git') return 'aicommit'
  if (pane === 'transcript') return 'transcript'
  return 'code'
}

export function preloadProjectPane(pane: string | undefined): void {
  const activePane = normalizeProjectPane(pane)

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
  preloadMonacoEditorModule()
}
