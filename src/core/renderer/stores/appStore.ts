import { create } from 'zustand'
import type { AppState } from './appStore.types'
import { initialThemeMode, loadPersistedProcessUrls } from './appStore.helpers'
import { createInitActionsSlice } from './appStore.initSlice'
import { createSettingsActionsSlice } from './appStore.settingsSlice'
import { createWorkspaceActionsSlice } from './appStore.workspaceSlice'
import { createProcessActionsSlice } from './appStore.processSlice'
import { createRuntimeActionsSlice } from './appStore.runtimeSlice'

export const useAppStore = create<AppState>()((...args) => ({
  isAppReady: false,
  projects: [],
  folders: [],
  tags: [],
  processes: {},
  terminalOutputs: {},
  processUrls: loadPersistedProcessUrls(),
  config: { projects: [], theme: initialThemeMode },
  searchQuery: '',
  capability: null,
  tmuxSessions: [],
  sessions: {},
  runtimeEntries: {},

  ...createInitActionsSlice(...args),
  ...createSettingsActionsSlice(...args),
  ...createWorkspaceActionsSlice(...args),
  ...createProcessActionsSlice(...args),
  ...createRuntimeActionsSlice(...args),
}))

