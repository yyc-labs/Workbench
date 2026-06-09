import type { StateCreator } from 'zustand'
import type { AppState } from './appStore.types'
import type { ProjectDocTagOption } from '../../shared/types'

export type SettingsActionsSlice = Pick<
  AppState,
  | 'setTheme'
  | 'setRuntimeLauncherScript'
  | 'setRuntimeKeepAliveOnQuit'
  | 'setAiCommitConfig'
  | 'setAgentHookConfig'
  | 'setDocLinkTags'
  | 'setStartupDefaultFilter'
  | 'setSearchQuery'
  | 'setHomeEnvFilter'
  | 'setHomeClassifierFilter'
  | 'markHomeDefaultFilterApplied'
>

export const createSettingsActionsSlice: StateCreator<AppState, [], [], SettingsActionsSlice> = (set) => ({
  setTheme: async (theme) => {
    const updated = await window.electronAPI.setConfig({ theme })
    set((state) => ({
      config: {
        ...state.config,
        theme: updated.theme,
      },
    }))
  },

  setRuntimeLauncherScript: async (scriptPath) => {
    const updated = await window.electronAPI.setConfig({ runtimeLauncherScript: scriptPath })
    set((state) => ({
      config: {
        ...state.config,
        runtimeLauncherScript: updated.runtimeLauncherScript,
      },
    }))
  },

  setRuntimeKeepAliveOnQuit: async (enabled) => {
    const updated = await window.electronAPI.setConfig({ runtimeKeepAliveOnQuit: enabled })
    set((state) => ({
      config: {
        ...state.config,
        runtimeKeepAliveOnQuit: updated.runtimeKeepAliveOnQuit ?? false,
      },
    }))
  },

  setAiCommitConfig: async (aiCommit) => {
    const updated = await window.electronAPI.setConfig({ aiCommit })
    set((state) => ({
      config: {
        ...state.config,
        aiCommit: updated.aiCommit,
      },
    }))
  },

  setAgentHookConfig: async (agentHooks) => {
    const updated = await window.electronAPI.setConfig({ agentHooks })
    set((state) => ({
      config: {
        ...state.config,
        agentHooks: updated.agentHooks,
      },
    }))
  },

  setDocLinkTags: async (tags: ProjectDocTagOption[]) => {
    const normalized = tags
      .filter((item) => item.value.trim() && item.label.trim())
      .map((item, index) => ({
        value: item.value.trim(),
        label: item.label.trim(),
        sortOrder: index,
      }))
    const updated = await window.electronAPI.setConfig({ docLinkTags: normalized })
    set((state) => ({
      config: {
        ...state.config,
        docLinkTags: updated.docLinkTags,
      },
    }))
  },

  setStartupDefaultFilter: async (filter) => {
    const updated = await window.electronAPI.setConfig({ startupDefaultFilter: filter })
    set((state) => ({
      config: {
        ...state.config,
        startupDefaultFilter: updated.startupDefaultFilter,
      },
    }))
  },

  setSearchQuery: (query) => {
    set({ searchQuery: query })
  },

  setHomeEnvFilter: (filter) => {
    set({ homeEnvFilter: filter })
  },

  setHomeClassifierFilter: (filter) => {
    set({ homeClassifierFilter: filter })
  },

  markHomeDefaultFilterApplied: () => {
    set({ homeDefaultFilterApplied: true })
  },
})
