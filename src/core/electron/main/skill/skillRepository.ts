import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { promises as fs } from 'fs'
import path from 'path'
import type { Skill, SkillCategory, SkillSummary } from '../../../shared/types'

const ROOT_DIR = 'skills'
const ITEMS_DIR = 'items'
const INDEX_FILE = 'index.json'
const CATEGORIES_FILE = 'categories.json'

type SkillIndex = { skills: SkillSummary[] }

export interface SkillRepository {
  listCategories: () => Promise<SkillCategory[]>
  saveCategories: (categories: SkillCategory[]) => Promise<void>
  listSkills: () => Promise<SkillSummary[]>
  getSkill: (skillId: string) => Promise<Skill | null>
  saveSkill: (skill: Skill) => Promise<void>
  deleteSkill: (skillId: string) => Promise<boolean>
  clearCategoryReferences: (categoryId: string) => Promise<void>
}

function ensureDirectory(directory: string): void {
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true })
}

function rootPath(): string { return path.join(app.getPath('userData'), ROOT_DIR) }
function itemsPath(): string { return path.join(rootPath(), ITEMS_DIR) }
function indexPath(): string { return path.join(rootPath(), INDEX_FILE) }
function categoriesPath(): string { return path.join(rootPath(), CATEGORIES_FILE) }

function safeSegment(value: string, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || normalized.includes('/') || normalized.includes('\\') || normalized.includes('\0')) {
    throw new Error(`Invalid ${label}.`)
  }
  return normalized
}

function skillPath(skillId: string): string {
  return path.join(itemsPath(), `${safeSegment(skillId, 'skill id')}.md`)
}

function timestamp(value: unknown): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return Date.now()
  const normalized = Math.trunc(numeric)
  return Number.isNaN(new Date(normalized).getTime()) ? Date.now() : normalized
}

function tags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]
}

function normalizeCategory(value: unknown): SkillCategory | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<SkillCategory>
  const id = typeof item.id === 'string' ? item.id.trim() : ''
  const name = typeof item.name === 'string' ? item.name.trim() : ''
  if (!id || !name) return null
  return {
    id,
    name,
    parentId: typeof item.parentId === 'string' && item.parentId.trim() ? item.parentId.trim() : undefined,
    sort: Number.isFinite(Number(item.sort)) ? Math.max(0, Math.trunc(Number(item.sort))) : 0,
    createdAt: timestamp(item.createdAt),
    updatedAt: timestamp(item.updatedAt),
  }
}

function normalizeSummary(value: unknown): SkillSummary | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<SkillSummary>
  const id = typeof item.id === 'string' ? item.id.trim() : ''
  const title = typeof item.title === 'string' ? item.title.trim() : ''
  if (!id || !title) return null
  return {
    id,
    title,
    categoryId: typeof item.categoryId === 'string' && item.categoryId.trim() ? item.categoryId.trim() : undefined,
    tags: tags(item.tags),
    enabled: item.enabled !== false,
    createdAt: timestamp(item.createdAt),
    updatedAt: timestamp(item.updatedAt),
    excerpt: typeof item.excerpt === 'string' ? item.excerpt.trim() : '',
  }
}

function normalizeSkill(value: unknown): Skill | null {
  const summary = normalizeSummary(value)
  if (!summary) return null
  const item = value as Partial<Skill>
  return { ...summary, contentMd: typeof item.contentMd === 'string' ? item.contentMd : '' }
}

function readJson<T>(filePath: string, fallback: T): T {
  try { return JSON.parse(readFileSync(filePath, 'utf8')) as T } catch { return fallback }
}

function frontmatterString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed)
      return typeof parsed === 'string' ? parsed : undefined
    } catch { return trimmed.slice(1, -1) }
  }
  return trimmed
}

function frontmatterTags(value: string | undefined): string[] {
  if (!value) return []
  try { return tags(JSON.parse(value)) } catch { return [] }
}

function splitFrontmatter(markdown: string): { values: Record<string, string>; contentMd: string } {
  if (!markdown.startsWith('---\n')) return { values: {}, contentMd: markdown }
  const marker = '\n---\n'
  const end = markdown.indexOf(marker, 4)
  if (end < 0) return { values: {}, contentMd: markdown }
  const values: Record<string, string> = {}
  for (const line of markdown.slice(4, end).split('\n')) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
  }
  return { values, contentMd: markdown.slice(end + marker.length) }
}

function serializeSkill(skill: Skill): string {
  return [
    '---',
    `id: ${JSON.stringify(skill.id)}`,
    `title: ${JSON.stringify(skill.title)}`,
    `categoryId: ${skill.categoryId ? JSON.stringify(skill.categoryId) : '""'}`,
    `tags: ${JSON.stringify(skill.tags)}`,
    `enabled: ${skill.enabled}`,
    `createdAt: ${skill.createdAt}`,
    `updatedAt: ${skill.updatedAt}`,
    '---',
    '',
    skill.contentMd,
  ].join('\n')
}

function parseSkill(markdown: string): Skill | null {
  const { values, contentMd } = splitFrontmatter(markdown)
  return normalizeSkill({
    id: frontmatterString(values.id),
    title: frontmatterString(values.title),
    categoryId: frontmatterString(values.categoryId),
    tags: frontmatterTags(values.tags),
    enabled: values.enabled !== 'false',
    createdAt: Number(values.createdAt),
    updatedAt: Number(values.updatedAt),
    excerpt: '',
    contentMd,
  })
}

function readCategories(): SkillCategory[] {
  return readJson<unknown[]>(categoriesPath(), [])
    .map(normalizeCategory)
    .filter((item): item is SkillCategory => Boolean(item))
    .sort((left, right) => left.sort - right.sort || left.name.localeCompare(right.name))
}

function readIndex(): SkillSummary[] {
  const parsed = readJson<SkillIndex>(indexPath(), { skills: [] })
  return (parsed.skills ?? [])
    .map(normalizeSummary)
    .filter((item): item is SkillSummary => Boolean(item))
    .sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt)
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  ensureDirectory(path.dirname(filePath))
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8')
}

export function createSkillRepository(): SkillRepository {
  return {
    listCategories: async () => readCategories(),
    saveCategories: async (categories) => writeJson(categoriesPath(), categories),
    listSkills: async () => readIndex(),
    getSkill: async (skillId) => {
      try { return parseSkill(await fs.readFile(skillPath(skillId), 'utf8')) } catch { return null }
    },
    saveSkill: async (skill) => {
      ensureDirectory(itemsPath())
      await fs.writeFile(skillPath(skill.id), serializeSkill(skill), 'utf8')
      const current = readIndex().filter((item) => item.id !== skill.id)
      const summary: SkillSummary = {
        id: skill.id,
        title: skill.title,
        categoryId: skill.categoryId,
        tags: skill.tags,
        enabled: skill.enabled,
        createdAt: skill.createdAt,
        updatedAt: skill.updatedAt,
        excerpt: skill.excerpt,
      }
      await writeJson(indexPath(), { skills: [summary, ...current].sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt) })
    },
    deleteSkill: async (skillId) => {
      try { await fs.unlink(skillPath(skillId)) } catch { return false }
      await writeJson(indexPath(), { skills: readIndex().filter((item) => item.id !== skillId) })
      return true
    },
    clearCategoryReferences: async (categoryId) => {
      const normalizedCategoryId = safeSegment(categoryId, 'category id')
      const current = readIndex()
      const next = [] as SkillSummary[]
      for (const summary of current) {
        if (summary.categoryId !== normalizedCategoryId) {
          next.push(summary)
          continue
        }
        const skill = await (async () => {
          try { return parseSkill(await fs.readFile(skillPath(summary.id), 'utf8')) } catch { return null }
        })()
        if (skill) {
          const updated = { ...skill, categoryId: undefined, updatedAt: Date.now() }
          await fs.writeFile(skillPath(updated.id), serializeSkill(updated), 'utf8')
          next.push({ ...summary, categoryId: undefined, updatedAt: updated.updatedAt })
        } else {
          next.push({ ...summary, categoryId: undefined })
        }
      }
      await writeJson(indexPath(), { skills: next.sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt) })
    },
  }
}
