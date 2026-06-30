import { createWithEqualityFn } from 'zustand/traditional'
import type { AppState } from './appStore.types'
import { initialThemeMode, loadPersistedProcessUrls } from './appStore.helpers'
import { createInitActionsSlice } from './appStore.initSlice'
import { createSettingsActionsSlice } from './appStore.settingsSlice'
import { createWorkspaceActionsSlice } from './appStore.workspaceSlice'
import { createProcessActionsSlice } from './appStore.processSlice'
import { createRuntimeActionsSlice } from './appStore.runtimeSlice'
import { createTranscriptActionsSlice } from './appStore.transcriptSlice'
import { PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS } from '../lib/projectDocLinks'
import { defaultAiRuntimeProfileIdForCli, defaultAiRuntimeProfiles } from '../../shared/aiRuntimeProfiles'

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
    closeWindowBehavior: 'quit',
    cacheLocation: { mode: 'default' },
    codexProviderApiKeys: {},
    codexSettingsSnapshots: {},
    shortcutPreferences: {
      quickTranscriptCaptureOpenViewer: false,
    },
    docLinkTags: PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS.map((item) => ({ ...item })),
    aiRuntimeProfiles: defaultAiRuntimeProfiles(),
    activeAiRuntimeProfileId: defaultAiRuntimeProfileIdForCli('claude'),
  },
  searchQuery: '',
  homeEnvFilter: 'all',
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

  ...createInitActionsSlice(...args),
  ...createSettingsActionsSlice(...args),
  ...createWorkspaceActionsSlice(...args),
  ...createProcessActionsSlice(...args),
  ...createRuntimeActionsSlice(...args),
  ...createTranscriptActionsSlice(...args),
}))
