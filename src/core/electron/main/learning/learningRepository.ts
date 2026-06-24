import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { promises as fs } from 'fs'
import path from 'path'
import type {
  LearningCategory,
  LearningNote,
  LearningNoteSummary,
} from '../../../shared/types'

const LEARNING_DIR = 'learning-center'
const NOTES_DIR = 'notes'
const INDEX_FILE_NAME = 'index.json'
const CATEGORIES_FILE_NAME = 'categories.json'
const NOTE_EXTENSION = '.md'

type LearningIndexRecord = {
  notes: LearningNoteSummary[]
}

export interface LearningRepository {
  listCategories: () => Promise<LearningCategory[]>
  saveCategories: (categories: LearningCategory[]) => Promise<void>
  listNotes: () => Promise<LearningNoteSummary[]>
  getNote: (noteId: string) => Promise<LearningNote | null>
  saveNote: (note: LearningNote) => Promise<void>
  deleteNote: (noteId: string) => Promise<boolean>
  clearCategoryReferences: (categoryId: string) => Promise<void>
}

function ensureDirectory(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

function getRootPath(): string {
  return path.join(app.getPath('userData'), LEARNING_DIR)
}

function getNotesDirectoryPath(): string {
  return path.join(getRootPath(), NOTES_DIR)
}

function getIndexPath(): string {
  return path.join(getRootPath(), INDEX_FILE_NAME)
}

function getCategoriesPath(): string {
  return path.join(getRootPath(), CATEGORIES_FILE_NAME)
}

function getNotePath(noteId: string): string {
  const safeNoteId = assertSafePathSegment(noteId, 'note id')
  return path.join(getNotesDirectoryPath(), `${safeNoteId}${NOTE_EXTENSION}`)
}

function assertSafePathSegment(value: string, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || normalized.includes('/') || normalized.includes('\\') || normalized.includes('\0')) {
    throw new Error(`Invalid ${label}.`)
  }
  return normalized
}

function normalizeTimestamp(value: unknown): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return Date.now()
  const truncated = Math.trunc(numeric)
  const date = new Date(truncated)
  return Number.isNaN(date.getTime()) ? Date.now() : truncated
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
  )]
}

function normalizeCategory(value: unknown): LearningCategory | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<LearningCategory>
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
  const parentId = typeof candidate.parentId === 'string' && candidate.parentId.trim()
    ? candidate.parentId.trim()
    : undefined
  if (!id || !name) return null
  return {
    id,
    name,
    parentId,
    sort: Number.isFinite(candidate.sort) ? Math.max(0, Math.trunc(Number(candidate.sort))) : 0,
    createdAt: normalizeTimestamp(candidate.createdAt),
    updatedAt: normalizeTimestamp(candidate.updatedAt),
  }
}

function normalizeNoteSummary(value: unknown): LearningNoteSummary | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<LearningNoteSummary>
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
  const title = typeof candidate.title === 'string' ? candidate.title.trim() : ''
  if (!id || !title) return null

  return {
    id,
    title,
    categoryId: typeof candidate.categoryId === 'string' && candidate.categoryId.trim()
      ? candidate.categoryId.trim()
      : undefined,
    tags: normalizeTags(candidate.tags),
    status: candidate.status === 'organized' ? 'organized' : 'draft',
    createdAt: normalizeTimestamp(candidate.createdAt),
    updatedAt: normalizeTimestamp(candidate.updatedAt),
    excerpt: typeof candidate.excerpt === 'string' ? candidate.excerpt.trim() : '',
  }
}

function normalizeNote(value: unknown): LearningNote | null {
  if (!value || typeof value !== 'object') return null
  const summary = normalizeNoteSummary(value)
  if (!summary) return null
  const candidate = value as Partial<LearningNote>
  return {
    ...summary,
    contentMd: typeof candidate.contentMd === 'string' ? candidate.contentMd : '',
  }
}

function escapeFrontmatterString(value: string): string {
  return JSON.stringify(value)
}

function frontmatterValueToString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed)
      return typeof parsed === 'string' ? parsed : trimmed.slice(1, -1)
    } catch {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

function parseFrontmatterArray(value: string | undefined): string[] {
  if (!value) return []
  const trimmed = value.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return []
  try {
    const parsed = JSON.parse(trimmed)
    return normalizeTags(parsed)
  } catch {
    return []
  }
}

function splitFrontmatter(markdown: string): { frontmatter: Record<string, string>; contentMd: string } {
  if (!markdown.startsWith('---\n')) {
    return { frontmatter: {}, contentMd: markdown }
  }

  const endMarker = '\n---\n'
  const endIndex = markdown.indexOf(endMarker, 4)
  if (endIndex < 0) {
    return { frontmatter: {}, contentMd: markdown }
  }

  const block = markdown.slice(4, endIndex)
  const contentMd = markdown.slice(endIndex + endMarker.length)
  const frontmatter: Record<string, string> = {}

  for (const line of block.split('\n')) {
    const separatorIndex = line.indexOf(':')
    if (separatorIndex <= 0) continue
    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()
    if (key) {
      frontmatter[key] = value
    }
  }

  return { frontmatter, contentMd }
}

function serializeNote(note: LearningNote): string {
  const frontmatterLines = [
    '---',
    `id: ${escapeFrontmatterString(note.id)}`,
    `title: ${escapeFrontmatterString(note.title)}`,
    `categoryId: ${note.categoryId ? escapeFrontmatterString(note.categoryId) : '""'}`,
    `tags: ${JSON.stringify(note.tags)}`,
    `status: ${note.status}`,
    `createdAt: ${note.createdAt}`,
    `updatedAt: ${note.updatedAt}`,
    '---',
    '',
  ]
  return `${frontmatterLines.join('\n')}${note.contentMd}`
}

function parseNoteMarkdown(markdown: string): LearningNote | null {
  const { frontmatter, contentMd } = splitFrontmatter(markdown)
  const id = frontmatterValueToString(frontmatter.id)
  const title = frontmatterValueToString(frontmatter.title)
  if (!id || !title) return null

  return normalizeNote({
    id,
    title,
    categoryId: frontmatterValueToString(frontmatter.categoryId),
    tags: parseFrontmatterArray(frontmatter.tags),
    status: frontmatter.status === 'organized' ? 'organized' : 'draft',
    createdAt: Number(frontmatter.createdAt),
    updatedAt: Number(frontmatter.updatedAt),
    excerpt: '',
    contentMd,
  })
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    const raw = readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function readCategories(): LearningCategory[] {
  const parsed = readJsonFile<unknown[]>(getCategoriesPath(), [])
  return parsed
    .map(normalizeCategory)
    .filter((item): item is LearningCategory => Boolean(item))
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
}

function readIndex(): LearningIndexRecord {
  const parsed = readJsonFile<{ notes?: unknown[] }>(getIndexPath(), { notes: [] })
  return {
    notes: (parsed.notes ?? [])
      .map(normalizeNoteSummary)
      .filter((item): item is LearningNoteSummary => Boolean(item))
      .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt),
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  ensureDirectory(path.dirname(filePath))
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8')
}

export function createLearningRepository(): LearningRepository {
  return {
    listCategories: async () => readCategories(),

    saveCategories: async (categories) => {
      await writeJsonFile(getCategoriesPath(), categories)
    },

    listNotes: async () => readIndex().notes,

    getNote: async (noteId) => {
      try {
        const raw = await fs.readFile(getNotePath(noteId), 'utf-8')
        return parseNoteMarkdown(raw)
      } catch {
        return null
      }
    },

    saveNote: async (note) => {
      ensureDirectory(getNotesDirectoryPath())
      await fs.writeFile(getNotePath(note.id), serializeNote(note), 'utf-8')
      const current = readIndex().notes.filter((item) => item.id !== note.id)
      const summary: LearningNoteSummary = {
        id: note.id,
        title: note.title,
        categoryId: note.categoryId,
        tags: note.tags,
        status: note.status,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        excerpt: note.excerpt,
      }
      await writeJsonFile(getIndexPath(), {
        notes: [summary, ...current].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt),
      })
    },

    deleteNote: async (noteId) => {
      try {
        await fs.unlink(getNotePath(noteId))
      } catch {
        return false
      }
      const nextNotes = readIndex().notes.filter((item) => item.id !== noteId)
      await writeJsonFile(getIndexPath(), { notes: nextNotes })
      return true
    },

    clearCategoryReferences: async (categoryId) => {
      const normalizedCategoryId = assertSafePathSegment(categoryId, 'category id')
      const currentNotes = readIndex().notes
      let changed = false
      const nextNotes = await Promise.all(currentNotes.map(async (summary) => {
        if (summary.categoryId !== normalizedCategoryId) return summary
        const note = await (async () => {
          try {
            const raw = await fs.readFile(getNotePath(summary.id), 'utf-8')
            return parseNoteMarkdown(raw)
          } catch {
            return null
          }
        })()
        if (!note) {
          changed = true
          return {
            ...summary,
            categoryId: undefined,
          }
        }
        changed = true
        const updatedNote: LearningNote = {
          ...note,
          categoryId: undefined,
          updatedAt: Date.now(),
        }
        await fs.writeFile(getNotePath(updatedNote.id), serializeNote(updatedNote), 'utf-8')
        return {
          id: updatedNote.id,
          title: updatedNote.title,
          categoryId: updatedNote.categoryId,
          tags: updatedNote.tags,
          status: updatedNote.status,
          createdAt: updatedNote.createdAt,
          updatedAt: updatedNote.updatedAt,
          excerpt: updatedNote.excerpt,
        }
      }))
      if (!changed) return
      await writeJsonFile(getIndexPath(), {
        notes: nextNotes.sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt),
      })
    },
  }
}
