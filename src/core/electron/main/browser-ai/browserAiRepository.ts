import { existsSync, mkdirSync, readFileSync } from 'fs'
import { promises as fs } from 'fs'
import path from 'path'
import { normalizeBrowserAiConfig } from './browserAiConfig'
import type {
  BrowserAiConfig,
  BrowserAiErrorCode,
  BrowserAiTaskRecord,
  BrowserAiTaskRecordSource,
  BrowserAiTaskRecordStatus,
  BrowserAiTaskRecordSummary,
  BrowserAiTaskStep,
} from '../../../shared/types'

const RECORDS_DIR = 'records'
const INDEX_FILE_NAME = 'index.json'

export interface BrowserAiRepository {
  getConfig: () => BrowserAiConfig
  saveConfig: (config: BrowserAiConfig) => Promise<BrowserAiConfig>
  listTaskRecords: () => Promise<BrowserAiTaskRecordSummary[]>
  getTaskRecord: (recordId: string) => Promise<BrowserAiTaskRecord | null>
  saveTaskRecord: (record: BrowserAiTaskRecord) => Promise<void>
  renameTaskRecord: (recordId: string, title: string) => Promise<BrowserAiTaskRecord | null>
  deleteTaskRecord: (recordId: string) => Promise<boolean>
}

type BrowserAiRepositoryDependencies = {
  loadConfig: () => BrowserAiConfig | undefined
  saveConfig: (config: BrowserAiConfig) => Promise<BrowserAiConfig>
  getRecordsRootPath: () => string
}

function assertSafePathSegment(value: string, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || normalized.includes('/') || normalized.includes('\\') || normalized.includes('\0')) {
    throw new Error(`Invalid ${label}.`)
  }
  return normalized
}

function ensureDirectory(dirPath: string): void {
  if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true })
}

function normalizeTimestamp(value: unknown): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return Date.now()
  return Math.trunc(numeric)
}

function normalizeStatus(value: unknown): BrowserAiTaskRecordStatus {
  return value === 'completed' || value === 'failed' || value === 'cancelled' || value === 'running'
    ? value
    : 'failed'
}

function normalizeErrorCode(value: unknown): BrowserAiErrorCode | undefined {
  return typeof value === 'string' && value.trim() ? value as BrowserAiErrorCode : undefined
}

function normalizeSteps(value: unknown): BrowserAiTaskStep[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id as BrowserAiTaskStep['id'] : 'failed',
      status: item.status === 'active' || item.status === 'completed' || item.status === 'cancelled'
        ? item.status
        : 'failed',
      startedAt: Number.isFinite(Number(item.startedAt)) ? Number(item.startedAt) : undefined,
      updatedAt: normalizeTimestamp(item.updatedAt),
      completedAt: Number.isFinite(Number(item.completedAt)) ? Number(item.completedAt) : undefined,
      elapsedMs: Number.isFinite(Number(item.elapsedMs)) ? Math.max(0, Number(item.elapsedMs)) : undefined,
      message: typeof item.message === 'string' ? item.message : undefined,
      detail: typeof item.detail === 'string' ? item.detail : undefined,
    }))
}

function normalizeSources(value: unknown): BrowserAiTaskRecordSource[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => {
      const content = typeof item.content === 'string' ? item.content : undefined
      return {
        kind: item.kind === 'skill' || item.kind === 'learning-note' || item.kind === 'personal-context' || item.kind === 'task'
          ? item.kind
          : 'learning-note',
        label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : 'Untitled source',
        referenceId: typeof item.referenceId === 'string' && item.referenceId.trim() ? item.referenceId.trim() : undefined,
        included: item.included !== false,
        sensitive: item.sensitive === true || item.kind === 'personal-context',
        characterCount: Number.isFinite(Number(item.characterCount)) ? Math.max(0, Math.trunc(Number(item.characterCount))) : 0,
        content: content && content.length > 0 ? content : undefined,
      }
    })
}

function normalizeRecord(value: unknown): BrowserAiTaskRecord | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<BrowserAiTaskRecord>
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'Browser AI task'
  const site = raw.site && typeof raw.site === 'object' ? raw.site : undefined
  const input = raw.input && typeof raw.input === 'object' ? raw.input : {}
  if (!id || !site || typeof (site as { url?: unknown }).url !== 'string') return null

  const normalizedSources = normalizeSources(raw.sources)
  return {
    id,
    title,
    createdAt: normalizeTimestamp(raw.createdAt),
    updatedAt: normalizeTimestamp(raw.updatedAt),
    startedAt: normalizeTimestamp(raw.startedAt),
    completedAt: Number.isFinite(Number(raw.completedAt)) ? Number(raw.completedAt) : undefined,
    site: {
      site: (site as { site?: BrowserAiTaskRecord['site']['site'] }).site === 'chatgpt-web' ? 'chatgpt-web' : 'generic-web',
      name: typeof (site as { name?: unknown }).name === 'string' ? (site as { name: string }).name : 'Web AI',
      url: (site as { url: string }).url,
    },
    sources: normalizedSources,
    status: normalizeStatus(raw.status),
    answer: typeof raw.answer === 'string' ? raw.answer : undefined,
    steps: normalizeSteps(raw.steps),
    errorCode: normalizeErrorCode(raw.errorCode),
    errorMessage: typeof raw.errorMessage === 'string' ? raw.errorMessage : undefined,
    input: {
      task: typeof (input as { task?: unknown }).task === 'string' ? (input as { task: string }).task : undefined,
      responseFormat: typeof (input as { responseFormat?: unknown }).responseFormat === 'string'
        ? (input as { responseFormat: string }).responseFormat
        : undefined,
      sources: normalizeSources((input as { sources?: unknown }).sources ?? normalizedSources),
      promptSaved: (input as { promptSaved?: unknown }).promptSaved === true,
    },
  }
}

function toSummary(record: BrowserAiTaskRecord): BrowserAiTaskRecordSummary {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    status: record.status,
    siteName: record.site.name,
    sourceLabels: record.sources.filter((source) => source.included).map((source) => source.label),
    answerExcerpt: (record.answer ?? record.errorMessage ?? '').replace(/\s+/g, ' ').trim().slice(0, 180),
    errorCode: record.errorCode,
  }
}

function sortSummaries(summaries: BrowserAiTaskRecordSummary[]): BrowserAiTaskRecordSummary[] {
  return summaries.sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt)
}

function normalizeSummaryList(value: unknown): BrowserAiTaskRecordSummary[] {
  if (!Array.isArray(value)) return []
  return sortSummaries(value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => {
      const status = normalizeStatus(item.status)
      return {
        id: typeof item.id === 'string' ? item.id.trim() : '',
        title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : 'Browser AI task',
        createdAt: normalizeTimestamp(item.createdAt),
        updatedAt: normalizeTimestamp(item.updatedAt),
        startedAt: normalizeTimestamp(item.startedAt),
        completedAt: Number.isFinite(Number(item.completedAt)) ? Number(item.completedAt) : undefined,
        status,
        siteName: typeof item.siteName === 'string' && item.siteName.trim() ? item.siteName.trim() : 'Web AI',
        sourceLabels: Array.isArray(item.sourceLabels)
          ? item.sourceLabels.filter((label): label is string => typeof label === 'string').map((label) => label.trim()).filter(Boolean)
          : [],
        answerExcerpt: typeof item.answerExcerpt === 'string' ? item.answerExcerpt : '',
        errorCode: normalizeErrorCode(item.errorCode),
      }
    })
    .filter((item) => Boolean(item.id)))
}

export function createBrowserAiRepository(deps: BrowserAiRepositoryDependencies): BrowserAiRepository {
  const getRootPath = () => path.join(deps.getRecordsRootPath(), RECORDS_DIR)
  const getIndexPath = () => path.join(getRootPath(), INDEX_FILE_NAME)
  const getRecordPath = (recordId: string) => path.join(getRootPath(), `${assertSafePathSegment(recordId, 'record id')}.json`)

  const readIndex = (): BrowserAiTaskRecordSummary[] => {
    try {
      return normalizeSummaryList(JSON.parse(readFileSync(getIndexPath(), 'utf-8')))
    } catch {
      return []
    }
  }

  const writeIndex = async (summaries: BrowserAiTaskRecordSummary[]) => {
    ensureDirectory(getRootPath())
    await fs.writeFile(getIndexPath(), JSON.stringify(sortSummaries(summaries), null, 2), 'utf-8')
  }

  return {
    getConfig: () => normalizeBrowserAiConfig(deps.loadConfig()),
    saveConfig: (config) => deps.saveConfig(normalizeBrowserAiConfig(config)),
    listTaskRecords: async () => readIndex(),
    getTaskRecord: async (recordId) => {
      try {
        const raw = await fs.readFile(getRecordPath(recordId), 'utf-8')
        return normalizeRecord(JSON.parse(raw))
      } catch {
        return null
      }
    },
    saveTaskRecord: async (record) => {
      const normalized = normalizeRecord(record)
      if (!normalized) throw new Error('Invalid browser AI task record.')
      ensureDirectory(getRootPath())
      await fs.writeFile(getRecordPath(normalized.id), JSON.stringify(normalized, null, 2), 'utf-8')
      await writeIndex([toSummary(normalized), ...readIndex().filter((item) => item.id !== normalized.id)])
    },
    renameTaskRecord: async (recordId, title) => {
      const record = await (async () => {
        try {
          const raw = await fs.readFile(getRecordPath(recordId), 'utf-8')
          return normalizeRecord(JSON.parse(raw))
        } catch {
          return null
        }
      })()
      if (!record) return null
      const normalizedTitle = title.trim()
      if (!normalizedTitle) throw new Error('A browser AI task title is required.')
      const updated = { ...record, title: normalizedTitle, updatedAt: Date.now() }
      await fs.writeFile(getRecordPath(recordId), JSON.stringify(updated, null, 2), 'utf-8')
      await writeIndex([toSummary(updated), ...readIndex().filter((item) => item.id !== recordId)])
      return updated
    },
    deleteTaskRecord: async (recordId) => {
      try {
        await fs.unlink(getRecordPath(recordId))
      } catch {
        return false
      }
      await writeIndex(readIndex().filter((item) => item.id !== recordId))
      return true
    },
  }
}
