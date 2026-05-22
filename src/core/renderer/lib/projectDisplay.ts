import type { ProjectInfo } from '../../shared/types'

export function projectDisplayName(project: Pick<ProjectInfo, 'name' | 'customName'>): string {
  return project.customName?.trim() || project.name
}

export function projectDisplayType(project: Pick<ProjectInfo, 'type' | 'customType'>): string {
  return project.customType?.trim() || project.type
}

export function middleTruncatePath(pathValue: string, keepStart = 28, keepEnd = 22): string {
  const normalized = pathValue.trim()
  if (!normalized) return pathValue
  const limit = keepStart + keepEnd + 1
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, keepStart)}…${normalized.slice(normalized.length - keepEnd)}`
}
