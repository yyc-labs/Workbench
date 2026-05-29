import type { ProjectDocLinkTag, ProjectDocTagOption } from '../../shared/types'

export const PROJECT_DOC_LINK_DEFAULT_TAG: ProjectDocLinkTag = 'api-doc'

export const PROJECT_DOC_LINK_FALLBACK_TAG: ProjectDocLinkTag = 'other'

export const PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS: ReadonlyArray<ProjectDocTagOption> = [
  { value: 'api-doc', label: '接口文档', sortOrder: 0 },
  { value: 'deploy-url', label: '部署地址', sortOrder: 1 },
  { value: 'admin-account', label: '后台账号', sortOrder: 2 },
  { value: 'design', label: '设计稿', sortOrder: 3 },
  { value: 'other', label: '其他资料', sortOrder: 4 },
]

export function normalizeProjectDocLinkTag(
  value: ProjectDocLinkTag | string | null | undefined,
  options: ReadonlyArray<Pick<ProjectDocTagOption, 'value'>> = PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS
): ProjectDocLinkTag {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return PROJECT_DOC_LINK_FALLBACK_TAG
  const set = new Set(options.map((item) => item.value))
  if (set.has(trimmed)) {
    return trimmed
  }
  return PROJECT_DOC_LINK_FALLBACK_TAG
}

export function projectDocLinkTagLabel(
  value: ProjectDocLinkTag | string | null | undefined,
  options: ReadonlyArray<Pick<ProjectDocTagOption, 'value' | 'label'>> = PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS
): string {
  const tag = normalizeProjectDocLinkTag(value, options)
  const option = options.find((item) => item.value === tag)
  return option?.label ?? '未分类'
}
