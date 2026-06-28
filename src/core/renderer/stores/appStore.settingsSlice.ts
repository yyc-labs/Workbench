import type { StateCreator } from 'zustand'
import type { AppState } from './appStore.types'
import type { AiRuntimeProfile, ClaudeRuntimeProfile, CodexSettingsInput, CodexSettingsSnapshot, ProjectDocTagOption } from '../../shared/types'
import { getCodexScopeCacheKey } from '../../shared/codexScope'

const RUNTIME_MODE_SWITCH_COOLDOWN_MS = 1200

export type SettingsActionsSlice = Pick<
  AppState,
  | 'setTheme'
  | 'setLocale'
  | 'setLaunchOnLogin'
  | 'setAiEnvironmentConfig'
  | 'setRuntimeLauncherScript'
  | 'setRuntimeKeepAliveOnQuit'
  | 'setAiCommitConfig'
  | 'setAiRuntimeProfiles'
  | 'loadCodexSettings'
  | 'saveCodexSettings'
  | 'setAgentHookConfig'
  | 'setClaudeRuntimeProfiles'
  | 'setDocLinkTags'
  | 'setStartupDefaultFilter'
  | 'setSearchQuery'
  | 'setHomeEnvFilter'
  | 'setHomeClassifierFilter'
  | 'markHomeDefaultFilterApplied'
>

export const createSettingsActionsSlice: StateCreator<AppState, [], [], SettingsActionsSlice> = (set, get) => ({
  setTheme: async (theme) => {
    const updated = await window.electronAPI.setConfig({ theme })
    set((state) => ({
      config: {
        ...state.config,
        theme: updated.theme,
      },
    }))
  },

  setLocale: async (locale) => {
    const updated = await window.electronAPI.setConfig({ locale })
    set((state) => ({
      config: {
        ...state.config,
        locale: updated.locale,
      },
    }))
  },

  setLaunchOnLogin: async (enabled) => {
    const updated = await window.electronAPI.setConfig({ launchOnLogin: enabled })
    set((state) => ({
      config: {
        ...state.config,
        launchOnLogin: updated.launchOnLogin ?? false,
      },
    }))
  },

  setAiEnvironmentConfig: async (aiEnvironment) => {
    const previousMode = get().config.aiEnvironment?.mode
    const updated = await window.electronAPI.setConfig({ aiEnvironment })
    const nextMode = updated.aiEnvironment?.mode
    const modeChanged = previousMode !== nextMode
    set((state) => ({
      config: {
        ...state.config,
        aiEnvironment: updated.aiEnvironment,
      },
      runtimeModeSwitchCooldownUntil: modeChanged
        ? Date.now() + RUNTIME_MODE_SWITCH_COOLDOWN_MS
        : state.runtimeModeSwitchCooldownUntil,
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

  setAiRuntimeProfiles: async (profiles: AiRuntimeProfile[], activeProfileId: string) => {
    const updated = await window.electronAPI.setConfig({
      aiRuntimeProfiles: profiles,
      activeAiRuntimeProfileId: activeProfileId,
    })
    set((state) => ({
      config: {
        ...state.config,
        aiRuntimeProfiles: updated.aiRuntimeProfiles,
        activeAiRuntimeProfileId: updated.activeAiRuntimeProfileId,
      },
    }))
  },

  loadCodexSettings: async (): Promise<CodexSettingsSnapshot> => {
    const snapshot = await window.electronAPI.getCodexSettings()
    const scopeKey = getCodexScopeCacheKey(snapshot.scope)
    const currentConfig = window.electronAPI.getConfig
      ? await window.electronAPI.getConfig()
      : undefined
    const updated = await window.electronAPI.setConfig({
      codexProviderApiKeys: {
        ...(currentConfig?.codexProviderApiKeys ?? {}),
        [scopeKey]: snapshot.providerApiKeys,
      },
      codexSettingsSnapshots: {
        ...(currentConfig?.codexSettingsSnapshots ?? {}),
        [scopeKey]: snapshot,
      },
    })
    set({
      config: updated,
    })
    return snapshot
  },

  saveCodexSettings: async (payload: CodexSettingsInput): Promise<CodexSettingsSnapshot> => {
    const { snapshot, appConfig } = await window.electronAPI.setCodexSettings(payload)
    set({
      config: appConfig,
    })
    return snapshot
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

  setClaudeRuntimeProfiles: async (profiles: ClaudeRuntimeProfile[], activeProfileId: string) => {
    const updated = await window.electronAPI.setConfig({
      claudeRuntimeProfiles: profiles,
      activeClaudeRuntimeProfileId: activeProfileId,
    })
    set((state) => ({
      config: {
        ...state.config,
        claudeRuntimeProfiles: updated.claudeRuntimeProfiles,
        activeClaudeRuntimeProfileId: updated.activeClaudeRuntimeProfileId,
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
