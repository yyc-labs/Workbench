import type {
  ProjectDocLink,
  ProjectDocLinkKind,
  ProjectDocLinkTag,
  ProjectDocTagOption,
} from '../../shared/types'
import { PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS } from '../../shared/projectDocLinks'
import type { ResolvedLocale } from '../i18n/messages'

export { PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS }

export function normalizeProjectDocLinkKind(value: ProjectDocLinkKind | string | null | undefined): ProjectDocLinkKind {
  return value === 'ssh' ? 'ssh' : 'url'
}

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

export function projectDocLinkAccount(link: Pick<ProjectDocLink, 'kind' | 'account' | 'sshUsername'>): string {
  const kind = normalizeProjectDocLinkKind(link.kind)
  if (kind === 'ssh') {
    return link.sshUsername?.trim() || link.account?.trim() || ''
  }
  return link.account?.trim() || ''
}

export function projectDocLinkSshPort(link: Pick<ProjectDocLink, 'sshPort'>): number {
  const port = Number(link.sshPort)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return 22
  return port
}

export function projectDocLinkTarget(link: Pick<ProjectDocLink, 'kind' | 'url' | 'sshHost' | 'sshPort' | 'sshUsername' | 'account'>): string {
  const kind = normalizeProjectDocLinkKind(link.kind)
  if (kind === 'ssh') {
    const host = link.sshHost?.trim() || ''
    const username = projectDocLinkAccount(link)
    const port = projectDocLinkSshPort(link)
    if (!host) return ''
    const hostWithPort = port !== 22 ? `${host}:${port}` : host
    return username ? `${username}@${hostWithPort}` : hostWithPort
  }
  return link.url?.trim() || ''
}

export function projectDocLinkCopyValue(link: Pick<ProjectDocLink, 'kind' | 'url' | 'sshHost' | 'sshPort' | 'sshUsername' | 'account'>): string {
  const kind = normalizeProjectDocLinkKind(link.kind)
  if (kind === 'ssh') {
    const host = link.sshHost?.trim() || ''
    const username = projectDocLinkAccount(link)
    const port = projectDocLinkSshPort(link)
    if (!host || !username) return ''
    return port !== 22 ? `ssh -p ${port} ${username}@${host}` : `ssh ${username}@${host}`
  }
  return link.url?.trim() || ''
}

export function isSshProjectDocLink(link: Pick<ProjectDocLink, 'kind'>): boolean {
  return normalizeProjectDocLinkKind(link.kind) === 'ssh'
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
