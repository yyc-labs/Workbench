import type {
  LearningCategory,
  LearningCreateCategoryPayload,
  LearningCreateNotePayload,
  LearningNote,
  LearningNoteStatus,
  LearningNoteSummary,
  LearningUpdateNotePayload,
} from '../../../shared/types'
import type { LearningRepository } from './learningRepository'

type LearningServiceDependencies = {
  repository: LearningRepository
}

export interface LearningService {
  listCategories: () => Promise<LearningCategory[]>
  createCategory: (payload: LearningCreateCategoryPayload) => Promise<LearningCategory[]>
  listNotes: () => Promise<LearningNoteSummary[]>
  getNote: (noteId: string) => Promise<LearningNote | null>
  createNote: (payload?: LearningCreateNotePayload) => Promise<LearningNote>
  updateNote: (payload: LearningUpdateNotePayload) => Promise<LearningNote>
  deleteNote: (noteId: string) => Promise<boolean>
}

function createId(prefix: 'ln' | 'lc'): string {
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${Date.now().toString(36)}-${random}`
}

function normalizeTags(value: string[] | undefined): string[] {
  return [...new Set(
    (value ?? [])
      .map((item) => item.trim())
      .filter(Boolean)
  )]
}

function normalizeStatus(value: unknown): LearningNoteStatus {
  return value === 'organized' ? 'organized' : 'draft'
}

function normalizeExcerpt(contentMd: string): string {
  const compact = contentMd
    .replace(/^---[\s\S]*?---/m, '')
    .replace(/[`#>*_\-\[\]\(\)!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!compact) return ''
  return compact.slice(0, 120)
}

function normalizeTitle(value: string | undefined, contentMd: string): string {
  const explicit = value?.trim()
  if (explicit) return explicit
  const firstHeading = contentMd
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('# '))
  if (firstHeading) return firstHeading.replace(/^#\s+/, '').trim() || 'Untitled Note'
  return 'Untitled Note'
}

function defaultContent(): string {
  return [
    '# 新学习记录',
    '',
    '今天学习到：',
    '',
    '1. ',
    '2. ',
    '3. ',
  ].join('\n')
}

export function createLearningService(deps: LearningServiceDependencies): LearningService {
  return {
    listCategories: async () => deps.repository.listCategories(),

    createCategory: async (payload) => {
      const name = typeof payload.name === 'string' ? payload.name.trim() : ''
      if (!name) {
        throw new Error('Learning category name is required.')
      }

      const categories = await deps.repository.listCategories()
      const createdAt = Date.now()
      const nextCategory: LearningCategory = {
        id: createId('lc'),
        name,
        parentId: typeof payload.parentId === 'string' && payload.parentId.trim()
          ? payload.parentId.trim()
          : undefined,
        sort: categories.length,
        createdAt,
        updatedAt: createdAt,
      }
      const nextCategories = [...categories, nextCategory]
      await deps.repository.saveCategories(nextCategories)
      return nextCategories
    },

    listNotes: async () => deps.repository.listNotes(),

    getNote: async (noteId) => deps.repository.getNote(noteId),

    createNote: async (payload) => {
      const now = Date.now()
      const contentMd = typeof payload?.contentMd === 'string' && payload.contentMd.trim()
        ? payload.contentMd
        : defaultContent()
      const note: LearningNote = {
        id: createId('ln'),
        title: normalizeTitle(payload?.title, contentMd),
        categoryId: typeof payload?.categoryId === 'string' && payload.categoryId.trim()
          ? payload.categoryId.trim()
          : undefined,
        tags: normalizeTags(payload?.tags),
        status: normalizeStatus(payload?.status),
        createdAt: now,
        updatedAt: now,
        excerpt: normalizeExcerpt(contentMd),
        contentMd,
      }
      await deps.repository.saveNote(note)
      return note
    },

    updateNote: async (payload) => {
      const existing = await deps.repository.getNote(payload.noteId)
      if (!existing) {
        throw new Error(`Unknown learning note id: ${payload.noteId}`)
      }

      const contentMd = typeof payload.contentMd === 'string' ? payload.contentMd : ''
      if (!contentMd.trim()) {
        throw new Error('Learning note content cannot be empty.')
      }

      const note: LearningNote = {
        ...existing,
        title: normalizeTitle(payload.title, contentMd),
        categoryId: typeof payload.categoryId === 'string' && payload.categoryId.trim()
          ? payload.categoryId.trim()
          : undefined,
        tags: normalizeTags(payload.tags),
        status: normalizeStatus(payload.status),
        updatedAt: Date.now(),
        excerpt: normalizeExcerpt(contentMd),
        contentMd,
      }

      await deps.repository.saveNote(note)
      return note
    },

    deleteNote: async (noteId) => deps.repository.deleteNote(noteId),
  }
}
