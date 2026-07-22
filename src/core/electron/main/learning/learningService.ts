import type { LearningCategory, LearningCreateCategoryPayload, LearningCreateNotePayload, LearningNote, LearningNoteStatus, LearningNoteSummary, LearningSearchResult, LearningUpdateCategoryPayload, LearningUpdateNotePayload } from '../../../shared/types'
import type { LearningRepository } from './learningRepository'
import { translateMain, type MainLocale } from '../mainI18n'

type LearningServiceDependencies = {
  repository: LearningRepository
  getLocale: () => MainLocale
}

export interface LearningService {
  listCategories: () => Promise<LearningCategory[]>
  createCategory: (payload: LearningCreateCategoryPayload) => Promise<LearningCategory[]>
  updateCategory: (payload: LearningUpdateCategoryPayload) => Promise<LearningCategory[]>
  deleteCategory: (categoryId: string) => Promise<LearningCategory[]>
  listNotes: () => Promise<LearningNoteSummary[]>
  searchNotes: (query: string) => Promise<LearningSearchResult[]>
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
  return [...new Set((value ?? []).map((item) => item.trim()).filter(Boolean))]
}

function normalizeStatus(value: unknown): LearningNoteStatus {
  return value === 'organized' ? 'organized' : 'draft'
}

function createMatchExcerpt(content: string, offset: number, queryLength: number): string {
  const start = Math.max(0, offset - 56)
  const end = Math.min(content.length, offset + queryLength + 96)
  return `${start > 0 ? '…' : ''}${content.slice(start, end).replace(/\s+/g, ' ').trim()}${end < content.length ? '…' : ''}`
}

function normalizeCategoryName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function findCategoryByName(categories: LearningCategory[], name: string, excludeId?: string): LearningCategory | undefined {
  const normalizedName = name.trim().toLowerCase()
  return categories.find((category) => category.id !== excludeId && category.name.trim().toLowerCase() === normalizedName)
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

function defaultContent(locale: MainLocale): string {
  return [`# ${translateMain(locale, 'learning.defaults.newNoteTitle')}`, '', translateMain(locale, 'learning.defaults.introLine'), '', '1. ', '2. ', '3. '].join('\n')
}

export function createLearningService(deps: LearningServiceDependencies): LearningService {
  return {
    listCategories: async () => deps.repository.listCategories(),

    createCategory: async (payload) => {
      const name = normalizeCategoryName(payload.name)
      if (!name) {
        throw new Error('Learning category name is required.')
      }

      const categories = await deps.repository.listCategories()
      if (findCategoryByName(categories, name)) {
        throw new Error('Learning category name already exists.')
      }
      const createdAt = Date.now()
      const nextCategory: LearningCategory = {
        id: createId('lc'),
        name,
        parentId: typeof payload.parentId === 'string' && payload.parentId.trim() ? payload.parentId.trim() : undefined,
        sort: categories.length,
        createdAt,
        updatedAt: createdAt,
      }
      const nextCategories = [...categories, nextCategory]
      await deps.repository.saveCategories(nextCategories)
      return nextCategories
    },

    updateCategory: async (payload) => {
      const categoryId = typeof payload.categoryId === 'string' ? payload.categoryId.trim() : ''
      const name = normalizeCategoryName(payload.name)
      if (!categoryId) {
        throw new Error('Learning category id is required.')
      }
      if (!name) {
        throw new Error('Learning category name is required.')
      }

      const categories = await deps.repository.listCategories()
      const current = categories.find((item) => item.id === categoryId)
      if (!current) {
        throw new Error('Learning category does not exist.')
      }
      if (findCategoryByName(categories, name, categoryId)) {
        throw new Error('Learning category name already exists.')
      }

      const nextCategories = categories.map((category) => (category.id === categoryId ? { ...category, name, updatedAt: Date.now() } : category))
      await deps.repository.saveCategories(nextCategories)
      return nextCategories
    },

    deleteCategory: async (categoryId) => {
      const normalizedCategoryId = typeof categoryId === 'string' ? categoryId.trim() : ''
      if (!normalizedCategoryId) {
        throw new Error('Learning category id is required.')
      }

      const categories = await deps.repository.listCategories()
      const target = categories.find((item) => item.id === normalizedCategoryId)
      if (!target) {
        throw new Error('Learning category does not exist.')
      }

      const nextCategories = categories.filter((item) => item.id !== normalizedCategoryId)
      await deps.repository.saveCategories(nextCategories)
      await deps.repository.clearCategoryReferences(normalizedCategoryId)
      return nextCategories
    },

    listNotes: async () => deps.repository.listNotes(),

    searchNotes: async (query) => {
      const normalizedQuery = query.trim().toLocaleLowerCase()
      if (!normalizedQuery) return []
      const summaries = await deps.repository.listNotes()
      const results: LearningSearchResult[] = []
      for (const summary of summaries) {
        const titleOffset = summary.title.toLocaleLowerCase().indexOf(normalizedQuery)
        if (titleOffset >= 0) {
          results.push({ ...summary, matchKind: 'title', matchExcerpt: createMatchExcerpt(summary.title, titleOffset, normalizedQuery.length), matchOffset: titleOffset })
          continue
        }
        const tag = summary.tags.find((item) => item.toLocaleLowerCase().includes(normalizedQuery))
        if (tag) {
          results.push({ ...summary, matchKind: 'tag', matchExcerpt: tag })
          continue
        }
        const note = await deps.repository.getNote(summary.id)
        const contentOffset = note?.contentMd.toLocaleLowerCase().indexOf(normalizedQuery) ?? -1
        if (note && contentOffset >= 0) {
          results.push({ ...summary, matchKind: 'content', matchExcerpt: createMatchExcerpt(note.contentMd, contentOffset, normalizedQuery.length), matchOffset: contentOffset })
        }
        if (results.length >= 50) break
      }
      return results
    },

    getNote: async (noteId) => deps.repository.getNote(noteId),

    createNote: async (payload) => {
      const now = Date.now()
      const locale = deps.getLocale()
      const contentMd = typeof payload?.contentMd === 'string' && payload.contentMd.trim() ? payload.contentMd : defaultContent(locale)
      const note: LearningNote = {
        id: createId('ln'),
        title: normalizeTitle(payload?.title, contentMd),
        categoryId: typeof payload?.categoryId === 'string' && payload.categoryId.trim() ? payload.categoryId.trim() : undefined,
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
        categoryId: typeof payload.categoryId === 'string' && payload.categoryId.trim() ? payload.categoryId.trim() : undefined,
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
