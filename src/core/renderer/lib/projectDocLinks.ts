import type { ProjectDocLinkTag, ProjectDocTagOption } from '../../shared/types'
import type { ResolvedLocale } from '../i18n/messages'

export const PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS: ReadonlyArray<ProjectDocTagOption> = []

export function normalizeProjectDocLinkTag(
  value: ProjectDocLinkTag | string | null | undefined,
  options: ReadonlyArray<Pick<ProjectDocTagOption, 'value'>> = PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS
): ProjectDocLinkTag {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return ''
  const set = new Set(options.map((item) => item.value))
  if (set.has(trimmed)) {
    return trimmed
  }
  return ''
}

export function projectDocLinkTagLabel(
  value: ProjectDocLinkTag | string | null | undefined,
  options: ReadonlyArray<Pick<ProjectDocTagOption, 'value' | 'label'>> = PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS,
  locale: ResolvedLocale = 'zh-CN'
): string {
  const tag = normalizeProjectDocLinkTag(value, options)
  if (!tag) {
    return locale === 'zh-CN' ? '未分类' : 'Uncategorized'
  }
  const option = options.find((item) => item.value === tag)
  return option?.label ?? (locale === 'zh-CN' ? '未分类' : 'Uncategorized')
}
