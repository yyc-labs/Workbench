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
  return {
    transcriptSessions: {
      ...state.transcriptSessions,
      [session.id]: session,
    },
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
  },

  loadTranscriptSession: async (projectId, transcriptId) => {
    const existing = get().transcriptSessions[transcriptId]
    if (existing && existing.projectId === projectId) {
      return existing
    }
    try {
      const session = await window.electronAPI.getTranscript(projectId, transcriptId)
      if (!session) return null
      set((state) => ({
        transcriptSessions: {
          ...state.transcriptSessions,
          [session.id]: session,
        },
      }))
      return session
    } catch (error) {
      console.error('[appStore.loadTranscriptSession] failed:', error)
      return null
    }
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
