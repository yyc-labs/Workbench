import type { LearningCategory, LearningNote } from '../../../shared/types'

export function normalizeTagInput(value: string): string[] {
  return [...new Set(
    value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
  )]
}

export function findCategoryByName(categories: LearningCategory[], name: string): LearningCategory | undefined {
  const normalizedName = name.trim().toLowerCase()
  if (!normalizedName) return undefined
  return categories.find((category) => category.name.trim().toLowerCase() === normalizedName)
}

export function emptySelectionState(): LearningNote | null {
  return null
}

export function defaultNoteContent(title: string): string {
  const normalizedTitle = title.trim() || '新学习记录'
  return [
    `# ${normalizedTitle}`,
    '',
    '今天学习到：',
    '',
    '1. ',
    '2. ',
    '3. ',
  ].join('\n')
}
