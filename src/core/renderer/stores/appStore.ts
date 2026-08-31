import { createWithEqualityFn } from 'zustand/traditional'
import type { AppState } from './appStore.types'
import { initialThemeMode, loadPersistedProcessUrls } from './appStore.helpers'
import { createInitActionsSlice } from './appStore.initSlice'
import { createSettingsActionsSlice } from './appStore.settingsSlice'
import { createWorkspaceActionsSlice } from './appStore.workspaceSlice'
import { createProcessActionsSlice } from './appStore.processSlice'
import { createRuntimeActionsSlice } from './appStore.runtimeSlice'
import { createTranscriptActionsSlice } from './appStore.transcriptSlice'
import { createBrowserAiActionsSlice } from './appStore.browserAiSlice'
import { createSkillActionsSlice } from './appStore.skillSlice'
import { defaultAiRuntimeProfileIdForCli, defaultAiRuntimeProfiles } from '../../shared/aiRuntimeProfiles'
import { PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS } from '../../shared/projectDocLinks'
import { createMarkdownDocumentActionsSlice } from './appStore.markdownDocumentSlice'

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
  ...createRuntimeActionsSlice(...args),
  ...createTranscriptActionsSlice(...args),
  ...createBrowserAiActionsSlice(...args),
  ...createSkillActionsSlice(...args),
  ...createMarkdownDocumentActionsSlice(...args),
}))
