import { createWithEqualityFn } from 'zustand/traditional'
import { defaultAiRuntimeProfileIdForCli, defaultAiRuntimeProfiles } from '../../shared/aiRuntimeProfiles'
import { PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS } from '../../shared/projectDocLinks'
import { createBrowserAiActionsSlice } from './appStore.browserAiSlice'
import { createDocLinkLibraryActionsSlice } from './appStore.docLinkLibrarySlice'
import { initialThemeMode, loadPersistedProcessUrls } from './appStore.helpers'
import { createInitActionsSlice } from './appStore.initSlice'
import { createMarkdownDocumentActionsSlice } from './appStore.markdownDocumentSlice'
import { createProcessActionsSlice } from './appStore.processSlice'
import { createQuickActionsSlice } from './appStore.quickActionsSlice'
import { createRunTaskActionsSlice } from './appStore.runTasksSlice'
import { createRuntimeActionsSlice } from './appStore.runtimeSlice'
import { createSettingsActionsSlice } from './appStore.settingsSlice'
import { createSkillActionsSlice } from './appStore.skillSlice'
import { createTerminalCollectionSlice } from './appStore.terminalCollectionSlice'
import { createTranscriptActionsSlice } from './appStore.transcriptSlice'
import type { AppState } from './appStore.types'
import { createWorkspaceActionsSlice } from './appStore.workspaceSlice'

export const useAppStore = createWithEqualityFn<AppState>()((...args) => ({
  isAppReady: false,
  projects: [],
  folders: [],
  tags: [],
  processes: {},
  terminalOutputs: {},
  processUrls: loadPersistedProcessUrls(),
  config: {
    projects: [],
    removedProjects: [],
    theme: initialThemeMode,
    locale: 'system',
    launchOnLogin: false,
    launchOnLoginDisplayMode: 'tray',
    closeWindowBehavior: 'quit',
    cacheLocation: { mode: 'default' },
    codexProviderApiKeys: {},
    codexSettingsSnapshots: {},
    agentLogs: {
      enabled: true,
    },
    shortcutPreferences: {
      quickTranscriptCaptureOpenViewer: false,
    },
    docLinkTags: PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS.map((item) => ({ ...item })),
    aiRuntimeProfiles: defaultAiRuntimeProfiles(),
    activeAiRuntimeProfileId: defaultAiRuntimeProfileIdForCli('claude'),
  },
  searchQuery: '',
  homeClassifierFilter: { type: 'all' },
  homeDefaultFilterApplied: false,
  capability: null,
  tmuxSessions: [],
  sessions: {},
  runtimeEntries: {},
  runtimeModeSwitchCooldownUntil: 0,
  transcriptSummariesByProjectId: {},
  transcriptSessions: {},
  activeTranscriptIdByProjectId: {},
  transcriptModeBySessionId: {},
  activeTranscriptReferenceIdBySessionId: {},
  transcriptListStatusByProjectId: {},
  browserAi: null,
  browserAiProgress: null,
  browserAiSteps: [],
  browserAiTaskRecords: [],
  browserAiTaskRecord: null,
  skills: [],
  skillCategories: [],
  selectedSkill: null,
  skillsLoading: false,

  ...createInitActionsSlice(...args),
  ...createSettingsActionsSlice(...args),
  ...createWorkspaceActionsSlice(...args),
  ...createProcessActionsSlice(...args),
  ...createTerminalCollectionSlice(...args),
  ...createRunTaskActionsSlice(...args),
  ...createRuntimeActionsSlice(...args),
  ...createTranscriptActionsSlice(...args),
  ...createBrowserAiActionsSlice(...args),
  ...createSkillActionsSlice(...args),
  ...createMarkdownDocumentActionsSlice(...args),
  ...createDocLinkLibraryActionsSlice(...args),
  ...createQuickActionsSlice(...args),
}))
