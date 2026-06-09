import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { promises as fs } from 'fs'
import path from 'path'
import type {
  TranscriptSession,
  TranscriptSessionSummary,
} from '../../../shared/types'

const TRANSCRIPTS_DIR = 'transcripts'
const INDEX_FILE_NAME = 'index.json'

export interface TranscriptRepository {
  saveSession: (session: TranscriptSession) => Promise<void>
  getSession: (projectId: string, sessionId: string) => Promise<TranscriptSession | null>
  listSessions: (projectId: string) => Promise<TranscriptSessionSummary[]>
  listAllSessions: () => Promise<Array<{ projectId: string; summaries: TranscriptSessionSummary[] }>>
  deleteSession: (projectId: string, sessionId: string) => Promise<boolean>
}

function assertSafePathSegment(value: string, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || normalized.includes('/') || normalized.includes('\\') || normalized.includes('\0')) {
    throw new Error(`Invalid ${label}.`)
  }
  return normalized
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

function getTranscriptsRootPath(): string {
  return path.join(app.getPath('userData'), TRANSCRIPTS_DIR)
}

function getProjectDirectory(projectId: string): string {
  const safeProjectId = assertSafePathSegment(projectId, 'project id')
  return path.join(getTranscriptsRootPath(), safeProjectId)
}

function getIndexPath(projectId: string): string {
  return path.join(getProjectDirectory(projectId), INDEX_FILE_NAME)
}

function getSessionPath(projectId: string, sessionId: string): string {
  const safeSessionId = assertSafePathSegment(sessionId, 'session id')
  return path.join(getProjectDirectory(projectId), `${safeSessionId}.json`)
}

function ensureDirectory(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

function normalizeTimestamp(value: unknown): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return Date.now()
  const truncated = Math.trunc(numeric)
  const date = new Date(truncated)
  return Number.isNaN(date.getTime()) ? Date.now() : truncated
}

function parseSummaryList(value: unknown): TranscriptSessionSummary[] {
  if (!Array.isArray(value)) return []
  const result: TranscriptSessionSummary[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Partial<TranscriptSessionSummary>
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
    const projectId = typeof candidate.projectId === 'string' ? candidate.projectId.trim() : ''
    const sourceType = candidate.sourceType
    const title = typeof candidate.title === 'string' ? candidate.title.trim() : ''
    const createdAt = normalizeTimestamp(candidate.createdAt)
    const updatedAt = normalizeTimestamp(candidate.updatedAt)
    const referenceCount = Number(candidate.referenceCount)
    if (!id || !projectId || !title) continue
    if (
      sourceType !== 'process-output'
      && sourceType !== 'tmux-capture'
      && sourceType !== 'agent-hook'
      && sourceType !== 'manual-markdown'
      && sourceType !== 'imported-file'
    ) {
      continue
    }
    result.push({
      id,
      projectId,
      sourceType,
      title,
      createdAt,
      updatedAt,
      referenceCount: Number.isFinite(referenceCount) ? Math.max(0, Math.trunc(referenceCount)) : 0,
    })
  }
  return result.sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)
}

function readSummaryIndex(projectId: string): TranscriptSessionSummary[] {
  const indexPath = getIndexPath(projectId)
  try {
    const raw = readFileSync(indexPath, 'utf-8')
    return parseSummaryList(JSON.parse(raw))
  } catch {
    return []
  }
}

async function listProjectDirectories(): Promise<string[]> {
  const rootPath = getTranscriptsRootPath()
  try {
    const entries = await fs.readdir(rootPath, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

async function writeSummaryIndex(projectId: string, summaries: TranscriptSessionSummary[]): Promise<void> {
  const projectDir = getProjectDirectory(projectId)
  ensureDirectory(projectDir)
  await fs.writeFile(getIndexPath(projectId), JSON.stringify(summaries, null, 2), 'utf-8')
}

function normalizeSession(value: unknown): TranscriptSession | null {
  if (!value || typeof value !== 'object') return null
  const session = value as Partial<TranscriptSession>
  const id = typeof session.id === 'string' ? session.id.trim() : ''
  const projectId = typeof session.projectId === 'string' ? session.projectId.trim() : ''
  const title = typeof session.title === 'string' ? session.title.trim() : ''
  const rawText = typeof session.rawText === 'string' ? session.rawText : ''
  const markdownText = typeof session.markdownText === 'string' ? session.markdownText : ''
  const sourceType = session.sourceType
  const createdAt = normalizeTimestamp(session.createdAt)
  const updatedAt = normalizeTimestamp(session.updatedAt)
  if (!id || !projectId || !title || !rawText) return null
  if (
    sourceType !== 'process-output'
    && sourceType !== 'tmux-capture'
    && sourceType !== 'agent-hook'
    && sourceType !== 'manual-markdown'
    && sourceType !== 'imported-file'
  ) {
    return null
  }

  const references = Array.isArray(session.references)
    ? session.references
      .filter((item): item is TranscriptSession['references'][number] => Boolean(item && typeof item === 'object'))
      .map((item) => ({
        id: typeof item.id === 'string' ? item.id : '',
        sessionId: typeof item.sessionId === 'string' ? item.sessionId : '',
        relativePath: typeof item.relativePath === 'string' ? item.relativePath : '',
        lineNumber: typeof item.lineNumber === 'number' ? item.lineNumber : undefined,
        column: typeof item.column === 'number' ? item.column : undefined,
        label: typeof item.label === 'string' ? item.label : '',
        rawText: typeof item.rawText === 'string' ? item.rawText : '',
        href: typeof item.href === 'string' ? item.href : '',
        messageRange: {
          startOffset: Number(item.messageRange?.startOffset) || 0,
          endOffset: Number(item.messageRange?.endOffset) || 0,
          startLine: Number(item.messageRange?.startLine) || 1,
          endLine: Number(item.messageRange?.endLine) || 1,
        },
      }))
      .filter((item) => item.id && item.sessionId && item.relativePath && item.label && item.href)
    : []

  return {
    id,
    projectId,
    sourceType,
    title,
    rawText,
    markdownText,
    references,
    createdAt,
    updatedAt,
  }
}

export function createTranscriptRepository(): TranscriptRepository {
  return {
    saveSession: async (session) => {
      const projectId = assertSafePathSegment(session.projectId, 'project id')
      const sessionId = assertSafePathSegment(session.id, 'session id')
      const projectDir = getProjectDirectory(projectId)
      ensureDirectory(projectDir)

      await fs.writeFile(
        getSessionPath(projectId, sessionId),
        JSON.stringify(session, null, 2),
        'utf-8'
      )

      const nextSummary = toSummary(session)
      const existing = readSummaryIndex(projectId).filter((item) => item.id !== session.id)
      await writeSummaryIndex(projectId, [nextSummary, ...existing].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt))
    },

    getSession: async (projectId, sessionId) => {
      try {
        const raw = await fs.readFile(getSessionPath(projectId, sessionId), 'utf-8')
        return normalizeSession(JSON.parse(raw))
      } catch {
        return null
      }
    },

    listSessions: async (projectId) => {
      return readSummaryIndex(projectId)
    },

    listAllSessions: async () => {
      const projectIds = await listProjectDirectories()
      return projectIds
        .map((projectId) => ({
          projectId,
          summaries: readSummaryIndex(projectId),
        }))
        .filter((item) => item.summaries.length > 0)
    },

    deleteSession: async (projectId, sessionId) => {
      try {
        await fs.unlink(getSessionPath(projectId, sessionId))
      } catch {
        return false
      }
      const nextSummaries = readSummaryIndex(projectId).filter((item) => item.id !== sessionId)
      await writeSummaryIndex(projectId, nextSummaries)
      return true
    },
  }
}
