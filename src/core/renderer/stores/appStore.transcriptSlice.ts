import type { StateCreator } from 'zustand'
import type {
  TranscriptImportPayload,
  TranscriptSession,
  TranscriptSessionSummary,
  TranscriptViewerMode,
} from '../../shared/types'
import type { AppState } from './appStore.types'

export type TranscriptActionsSlice = Pick<
  AppState,
  | 'importTranscript'
  | 'importCurrentProcessOutputTranscript'
  | 'loadProjectTranscripts'
  | 'loadTranscriptSession'
  | 'openTranscript'
  | 'upsertTranscriptSession'
  | 'openTranscriptReference'
  | 'closeTranscriptReference'
  | 'setTranscriptMode'
  | 'removeTranscriptSession'
>

const MAX_CACHED_TRANSCRIPT_SESSIONS = 12
const pendingProjectTranscriptLoads = new Map<string, Promise<void>>()
const pendingTranscriptSessionLoads = new Map<string, Promise<TranscriptSession | null>>()

function mergeSummaries(
  current: TranscriptSessionSummary[],
  incoming: TranscriptSessionSummary
): TranscriptSessionSummary[] {
  const next = [incoming, ...current.filter((item) => item.id !== incoming.id)]
  return next.sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)
}

function toSummary(session: TranscriptSession): TranscriptSessionSummary {
  return {
    id: session.id,
    projectId: session.projectId,
    sourceType: session.sourceType,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    referenceCount: session.references.length,
  }
}

type UpsertTranscriptSessionOptions = {
  activate?: boolean
  initialMode?: TranscriptViewerMode
}

function buildUpsertTranscriptSessionState(
  state: AppState,
  session: TranscriptSession,
  options?: UpsertTranscriptSessionOptions
): Pick<
  AppState,
  | 'transcriptSessions'
  | 'transcriptSummariesByProjectId'
  | 'activeTranscriptIdByProjectId'
  | 'transcriptModeBySessionId'
  | 'transcriptListStatusByProjectId'
> {
  const activate = options?.activate ?? true
  const nextTranscriptSessions = {
    ...state.transcriptSessions,
    [session.id]: session,
  }
  const transcriptSessionIds = Object.keys(nextTranscriptSessions)
  if (transcriptSessionIds.length > MAX_CACHED_TRANSCRIPT_SESSIONS) {
    const protectedIds = new Set<string>([
      session.id,
      ...Object.values(state.activeTranscriptIdByProjectId).filter((value): value is string => Boolean(value)),
    ])

    const removableIds = transcriptSessionIds
      .filter((id) => !protectedIds.has(id))
      .sort((left, right) => {
        const leftUpdatedAt = nextTranscriptSessions[left]?.updatedAt ?? 0
        const rightUpdatedAt = nextTranscriptSessions[right]?.updatedAt ?? 0
        return leftUpdatedAt - rightUpdatedAt
      })

    while (Object.keys(nextTranscriptSessions).length > MAX_CACHED_TRANSCRIPT_SESSIONS && removableIds.length > 0) {
      const removedId = removableIds.shift()
      if (!removedId) break
      delete nextTranscriptSessions[removedId]
    }
  }

  return {
    transcriptSessions: nextTranscriptSessions,
    transcriptSummariesByProjectId: {
      ...state.transcriptSummariesByProjectId,
      [session.projectId]: mergeSummaries(
        state.transcriptSummariesByProjectId[session.projectId] ?? [],
        toSummary(session)
      ),
    },
    activeTranscriptIdByProjectId: activate
      ? {
        ...state.activeTranscriptIdByProjectId,
        [session.projectId]: session.id,
      }
      : state.activeTranscriptIdByProjectId,
    transcriptModeBySessionId: {
      ...state.transcriptModeBySessionId,
      [session.id]: options?.initialMode ?? state.transcriptModeBySessionId[session.id] ?? 'preview',
    },
    transcriptListStatusByProjectId: {
      ...state.transcriptListStatusByProjectId,
      [session.projectId]: 'ready',
    },
  }
}

export const createTranscriptActionsSlice: StateCreator<AppState, [], [], TranscriptActionsSlice> = (set, get) => ({
  importTranscript: async (payload: TranscriptImportPayload) => {
    try {
      const session = await window.electronAPI.importTranscript(payload)
      get().upsertTranscriptSession(session, { activate: true })
      return session
    } catch (error) {
      console.error('[appStore.importTranscript] failed:', error)
      return null
    }
  },

  upsertTranscriptSession: (session, options) => {
    set((state) => buildUpsertTranscriptSessionState(state, session, options))
  },

  importCurrentProcessOutputTranscript: async (projectId, title) => {
    const rawText = get().terminalOutputs[projectId] ?? ''
    if (!rawText.trim()) return null
    return get().importTranscript({
      projectId,
      sourceType: 'process-output',
      rawText,
      title,
      capturedAt: Date.now(),
    })
  },

  loadProjectTranscripts: async (projectId) => {
    const existingLoad = pendingProjectTranscriptLoads.get(projectId)
    if (existingLoad) return existingLoad

    const loadPromise = (async () => {
      set((state) => ({
        transcriptListStatusByProjectId: {
          ...state.transcriptListStatusByProjectId,
          [projectId]: 'loading',
        },
      }))
      try {
        const summaries = await window.electronAPI.listProjectTranscripts(projectId)
        set((state) => ({
          transcriptSummariesByProjectId: {
            ...state.transcriptSummariesByProjectId,
            [projectId]: summaries,
          },
          transcriptListStatusByProjectId: {
            ...state.transcriptListStatusByProjectId,
            [projectId]: 'ready',
          },
          activeTranscriptIdByProjectId: {
            ...state.activeTranscriptIdByProjectId,
            [projectId]: state.activeTranscriptIdByProjectId[projectId] ?? summaries[0]?.id,
          },
        }))
      } catch (error) {
        console.error('[appStore.loadProjectTranscripts] failed:', error)
        set((state) => ({
          transcriptListStatusByProjectId: {
            ...state.transcriptListStatusByProjectId,
            [projectId]: 'error',
          },
        }))
      }
    })()

    pendingProjectTranscriptLoads.set(projectId, loadPromise)
    void loadPromise.finally(() => {
      if (pendingProjectTranscriptLoads.get(projectId) === loadPromise) {
        pendingProjectTranscriptLoads.delete(projectId)
      }
    })
    return loadPromise
  },

  loadTranscriptSession: async (projectId, transcriptId) => {
    const existing = get().transcriptSessions[transcriptId]
    if (existing && existing.projectId === projectId) {
      return existing
    }

    const pendingKey = `${projectId}:${transcriptId}`
    const existingLoad = pendingTranscriptSessionLoads.get(pendingKey)
    if (existingLoad) return existingLoad

    const loadPromise = (async () => {
      try {
        const session = await window.electronAPI.getTranscript(projectId, transcriptId)
        if (!session) return null
        set((state) => buildUpsertTranscriptSessionState(state, session, { activate: false }))
        return session
      } catch (error) {
        console.error('[appStore.loadTranscriptSession] failed:', error)
        return null
      }
    })()

    pendingTranscriptSessionLoads.set(pendingKey, loadPromise)
    void loadPromise.finally(() => {
      if (pendingTranscriptSessionLoads.get(pendingKey) === loadPromise) {
        pendingTranscriptSessionLoads.delete(pendingKey)
      }
    })
    return loadPromise
  },

  openTranscript: async ({ projectId, transcriptId, initialMode }) => {
    const session = await get().loadTranscriptSession(projectId, transcriptId)
    if (!session) return
    set((state) => ({
      activeTranscriptIdByProjectId: {
        ...state.activeTranscriptIdByProjectId,
        [projectId]: transcriptId,
      },
      transcriptModeBySessionId: {
        ...state.transcriptModeBySessionId,
        [transcriptId]: initialMode ?? state.transcriptModeBySessionId[transcriptId] ?? 'preview',
      },
    }))
  },

  openTranscriptReference: (sessionId, referenceId) => {
    set((state) => ({
      activeTranscriptReferenceIdBySessionId: {
        ...state.activeTranscriptReferenceIdBySessionId,
        [sessionId]: referenceId,
      },
    }))
  },

  closeTranscriptReference: (sessionId) => {
    set((state) => ({
      activeTranscriptReferenceIdBySessionId: {
        ...state.activeTranscriptReferenceIdBySessionId,
        [sessionId]: undefined,
      },
    }))
  },

  setTranscriptMode: (sessionId, mode: TranscriptViewerMode) => {
    set((state) => ({
      transcriptModeBySessionId: {
        ...state.transcriptModeBySessionId,
        [sessionId]: mode,
      },
    }))
  },

  removeTranscriptSession: async (projectId, transcriptId) => {
    const ok = await window.electronAPI.deleteTranscript(projectId, transcriptId)
    if (!ok) return
    set((state) => {
      const nextSessions = { ...state.transcriptSessions }
      delete nextSessions[transcriptId]
      const nextModes = { ...state.transcriptModeBySessionId }
      delete nextModes[transcriptId]
      const nextRefs = { ...state.activeTranscriptReferenceIdBySessionId }
      delete nextRefs[transcriptId]
      const nextSummaries = (state.transcriptSummariesByProjectId[projectId] ?? []).filter((item) => item.id !== transcriptId)
      const nextActiveId = state.activeTranscriptIdByProjectId[projectId] === transcriptId
        ? nextSummaries[0]?.id
        : state.activeTranscriptIdByProjectId[projectId]
      return {
        transcriptSessions: nextSessions,
        transcriptModeBySessionId: nextModes,
        activeTranscriptReferenceIdBySessionId: nextRefs,
        transcriptSummariesByProjectId: {
          ...state.transcriptSummariesByProjectId,
          [projectId]: nextSummaries,
        },
        activeTranscriptIdByProjectId: {
          ...state.activeTranscriptIdByProjectId,
          [projectId]: nextActiveId,
        },
      }
    })
  },
})
