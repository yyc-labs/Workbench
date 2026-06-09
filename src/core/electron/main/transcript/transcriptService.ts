import { statSync } from 'fs'
import path from 'path'
import { buildTranscriptSession } from '../../../shared/transcript/transcript.parser'
import type {
  TranscriptExternalImportPayload,
  TranscriptImportedEvent,
  TranscriptImportPayload,
  TranscriptSession,
  TranscriptSessionSummary,
  TranscriptSourceType,
} from '../../../shared/types'
import type { TranscriptRepository } from './transcriptRepository'

type TranscriptServiceDependencies = {
  repository: TranscriptRepository
  getProjectIdByPath: (projectPath: string) => string | null
  getProjectPathById: (projectId: string) => string | null
}

export interface TranscriptService {
  importTranscript: (payload: TranscriptImportPayload) => Promise<TranscriptSession>
  importExternalTranscript: (payload: TranscriptExternalImportPayload) => Promise<TranscriptImportedEvent>
  listProjectTranscripts: (projectId: string) => Promise<TranscriptSessionSummary[]>
  listAllTranscripts: () => Promise<Array<{ projectId: string; summaries: TranscriptSessionSummary[] }>>
  getTranscript: (projectId: string, transcriptId: string) => Promise<TranscriptSession | null>
  deleteTranscript: (projectId: string, transcriptId: string) => Promise<boolean>
}

function isProjectFilePath(projectPath: string, relativePath: string): boolean {
  try {
    return statSync(path.join(projectPath, relativePath)).isFile()
  } catch {
    return false
  }
}

function createSessionId(): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `ts-${Date.now().toString(36)}-${random}`
}

function normalizeFilesystemPath(value: string): string {
  return path.resolve(value.trim())
}

function normalizeTimestamp(value: unknown): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return Date.now()
  const truncated = Math.trunc(numeric)
  const date = new Date(truncated)
  return Number.isNaN(date.getTime()) ? Date.now() : truncated
}

function isTranscriptSourceType(value: unknown): value is TranscriptSourceType {
  return value === 'process-output'
    || value === 'tmux-capture'
    || value === 'agent-hook'
    || value === 'manual-markdown'
    || value === 'imported-file'
}

function normalizeTitle(payload: TranscriptImportPayload): string {
  const explicit = payload.title?.trim()
  if (explicit) return explicit
  const sourceLabel = payload.sourceLabel?.trim()
  if (sourceLabel) return sourceLabel
  switch (payload.sourceType) {
    case 'process-output':
      return 'Process Output Transcript'
    case 'tmux-capture':
      return 'Tmux Capture Transcript'
    case 'agent-hook':
      return 'Agent Hook Transcript'
    case 'manual-markdown':
      return 'Manual Markdown Transcript'
    case 'imported-file':
      return 'Imported Transcript'
    default:
      return 'Transcript'
  }
}

function validateImportPayload(payload: TranscriptImportPayload): TranscriptImportPayload {
  const projectId = typeof payload.projectId === 'string' ? payload.projectId.trim() : ''
  const rawText = typeof payload.rawText === 'string' ? payload.rawText : ''
  if (!projectId) {
    throw new Error('Transcript import requires a project id.')
  }
  if (!rawText.trim()) {
    throw new Error('Transcript import requires non-empty raw text.')
  }
  return {
    ...payload,
    projectId,
    rawText,
  }
}

export function createTranscriptService(deps: TranscriptServiceDependencies): TranscriptService {
  const importNormalizedTranscript = async (inputPayload: TranscriptImportPayload): Promise<TranscriptSession> => {
    const payload = validateImportPayload(inputPayload)
    const projectPath = deps.getProjectPathById(payload.projectId)
    if (!projectPath) {
      throw new Error(`Unknown project id: ${payload.projectId}`)
    }

    const createdAt = normalizeTimestamp(payload.capturedAt)
    const sessionId = createSessionId()
    const title = normalizeTitle(payload)
    const session = buildTranscriptSession(payload, {
      sessionId,
      projectPath,
      createdAt,
      isProjectFilePath: (relativePath) => isProjectFilePath(projectPath, relativePath),
      title,
    })

    await deps.repository.saveSession(session)
    return session
  }

  return {
    importTranscript: importNormalizedTranscript,

    importExternalTranscript: async (inputPayload) => {
      const projectIdFromPayload = typeof inputPayload.projectId === 'string' ? inputPayload.projectId.trim() : ''
      const projectPathFromPayload = typeof inputPayload.projectPath === 'string' && inputPayload.projectPath.trim()
        ? normalizeFilesystemPath(inputPayload.projectPath)
        : ''
      const resolvedProjectId = projectIdFromPayload || (projectPathFromPayload
        ? deps.getProjectIdByPath(projectPathFromPayload) ?? ''
        : '')
      if (!resolvedProjectId) {
        throw new Error('Transcript import requires a valid projectId or registered projectPath.')
      }
      const registeredProjectPath = deps.getProjectPathById(resolvedProjectId)
      if (!registeredProjectPath) {
        throw new Error(`Unknown project id: ${resolvedProjectId}`)
      }
      if (
        projectPathFromPayload
        && normalizeFilesystemPath(registeredProjectPath) !== projectPathFromPayload
      ) {
        throw new Error('Provided projectPath does not match the registered project.')
      }
      const sourceType = isTranscriptSourceType(inputPayload.sourceType)
        ? inputPayload.sourceType
        : 'imported-file'
      const session = await importNormalizedTranscript({
        projectId: resolvedProjectId,
        sourceType,
        rawText: inputPayload.rawText,
        title: inputPayload.title,
        sourceLabel: inputPayload.sourceLabel,
        processId: inputPayload.processId,
        capturedAt: inputPayload.capturedAt,
      })
      return {
        session,
        openViewer: Boolean(inputPayload.openViewer),
      }
    },

    listProjectTranscripts: async (projectId) => {
      return deps.repository.listSessions(projectId)
    },

    listAllTranscripts: async () => {
      return deps.repository.listAllSessions()
    },

    getTranscript: async (projectId, transcriptId) => {
      return deps.repository.getSession(projectId, transcriptId)
    },

    deleteTranscript: async (projectId, transcriptId) => {
      return deps.repository.deleteSession(projectId, transcriptId)
    },
  }
}
