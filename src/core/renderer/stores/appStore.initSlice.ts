import type { StateCreator } from 'zustand'
import type { AppState } from './appStore.types'
import { applySavedProjectSnapshot, createFallbackProject } from './appStore.helpers'
import { detectProjectEnvironment } from '../lib/projectEnvironment'
import { shouldUseWslForRuntimeEntrypoint } from '../../shared/runtimeEntrypoint'
import type { AppConfig, Capability, SavedProject, TmuxSessionInfo } from '../../shared/types'

let initAppPromise: Promise<void> | null = null
let browserAiSubscriptionInitialized = false

export type InitActionsSlice = Pick<
  AppState,
  'initApp' | 'loadConfig'
>

async function loadSavedProjects(
  savedProjects: AppState['config']['projects'],
  logPrefix: string,
  options?: {
    skipWslProjectProbe?: boolean
  },
): Promise<AppState['projects']> {
  const projects: AppState['projects'] = []
  for (const saved of savedProjects) {
    let project = null
    const skipProbe = options?.skipWslProjectProbe && isSavedWslProjectPath(saved)
    if (!skipProbe) {
      try {
        project = await window.electronAPI.detectProjects(saved.path)
      } catch (err) {
        console.warn(`${logPrefix} detectProjects failed, fallback to unknown:`, saved.path, err)
      }
    }
    const ensured = project ?? createFallbackProject(saved.path)
    projects.push(applySavedProjectSnapshot(ensured, saved))
  }
  return projects
}

function isSavedWslProjectPath(saved: Pick<SavedProject, 'path'>): boolean {
  return detectProjectEnvironment(saved.path) === 'ubuntu'
}

function shouldSkipWslProjectProbe(config: AppConfig, capability: Capability | null): boolean {
  if (capability?.hostPlatform !== 'windows') return false

  const mode = config.aiEnvironment?.mode
  if (mode === 'windows-wsl') return false
  if (mode === 'custom-script' && shouldUseWslForRuntimeEntrypoint(config.aiEnvironment)) {
    return false
  }

  return true
}

export const createInitActionsSlice: StateCreator<AppState, [], [], InitActionsSlice> = (set, get) => ({
  initApp: async () => {
    if (get().isAppReady) return
    if (initAppPromise) return initAppPromise

    initAppPromise = (async () => {
      const config = await window.electronAPI.getConfig()
      const capability = await window.electronAPI.getCapability()
      const projects = await loadSavedProjects(config.projects, '[appStore.initApp]', {
        skipWslProjectProbe: shouldSkipWslProjectProbe(config, capability),
      })
      set({
        config,
        projects,
        folders: (config.folders ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder),
        tags: (config.tags ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder),
        capability,
        isAppReady: true,
      })

      if (!browserAiSubscriptionInitialized && typeof window.electronAPI.onBrowserAiProgress === 'function') {
        browserAiSubscriptionInitialized = true
        window.electronAPI.onBrowserAiProgress((progress) => {
          set((state) => ({
            browserAiProgress: progress,
            browserAi: state.browserAi
              ? {
                ...state.browserAi,
                taskStatus: progress.status,
                activeTaskId: progress.status === 'completed'
                  || progress.status === 'failed'
                  || progress.status === 'cancelled'
                  ? undefined
                  : progress.taskId,
                errorCode: progress.errorCode ?? state.browserAi.errorCode,
                errorMessage: progress.message ?? state.browserAi.errorMessage,
              }
              : state.browserAi,
          }))
        })
      }

      get().rehydrateProcessUrlsFromStorage()

      void (async () => {
        try {
          let tmuxSessions: TmuxSessionInfo[] = []
          if (capability?.hasTmux) {
            try {
              tmuxSessions = await window.electronAPI.listTmuxSessions()
            } catch {
              tmuxSessions = []
            }
          }
          set({ tmuxSessions })

          await get().loadRuntimeEntries()
          if (config.aiEnvironment?.mode === 'windows-wsl' && Object.keys(get().runtimeEntries).length > 0) {
            await get().refreshSessions()
          }
          await get().syncManagedProcesses()
        } catch (err) {
          console.warn('[appStore.initApp] background runtime hydration failed:', err)
        }
      })()
    })()

    try {
      await initAppPromise
    } finally {
      initAppPromise = null
    }
  },

  loadConfig: async () => {
    const config = await window.electronAPI.getConfig()
    const capability = get().capability ?? await window.electronAPI.getCapability()
    const projects = await loadSavedProjects(config.projects, '[appStore.loadConfig]', {
      skipWslProjectProbe: shouldSkipWslProjectProbe(config, capability),
    })
    set({
      config,
      projects,
      folders: (config.folders ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder),
      tags: (config.tags ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder),
      capability,
    })
  },
})
