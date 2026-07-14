import type { LearningCategory, LearningNote } from '../../../../shared/types'
import { translateCurrent } from '../../../i18n'

export function normalizeTagInput(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ]
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
  const normalizedTitle = title.trim() || translateCurrent('learning.defaults.newNoteTitle')
  return [`# ${normalizedTitle}`, '', translateCurrent('learning.defaults.introLine'), '', '1. ', '2. ', '3. '].join('\n')
}
