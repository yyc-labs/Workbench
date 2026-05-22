import type { StateCreator } from 'zustand'
import type { AppState } from './appStore.types'

export type SettingsActionsSlice = Pick<
  AppState,
  | 'setTheme'
  | 'setRuntimeLauncherScript'
  | 'setRuntimeKeepAliveOnQuit'
  | 'setAiCommitConfig'
  | 'setStartupDefaultFilter'
  | 'setSearchQuery'
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
})

