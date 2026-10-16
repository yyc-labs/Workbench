import type { DocLinkLibraryFile, ProjectDocLink, ProjectDocTagOption, ProjectInfo, ResolvedProjectDocLink, SharedDocLink } from './types'

export const PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS: ReadonlyArray<ProjectDocTagOption> = []

function normalizeDedupePort(value: number | null | undefined): number {
  const port = Number(value)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return 22
  return port
}

/**
 * 链接去重键（严格一致）：url 类比归一化后的 URL；ssh 类比 用户名@主机:端口。
 * 大小写不敏感（与新增时的 duplicateUrl/duplicateSsh 判定一致）；标题/备注/账号等
 * 展示字段不参与比对——同一目标即视为同一条链接。
 */
export function projectDocLinkDedupeKey(link: Pick<ProjectDocLink, 'kind' | 'url' | 'sshHost' | 'sshPort' | 'sshUsername' | 'account'>): string {
  if ((link.kind ?? 'url') === 'ssh') {
    const host = (link.sshHost ?? '').trim().toLowerCase()
    const port = normalizeDedupePort(link.sshPort)
    const username = (link.sshUsername ?? link.account ?? '').trim().toLowerCase()
    return `ssh:${username}@${host}:${port}`
  }
  return `url:${(link.url ?? '').trim().toLowerCase()}`
}

/**
 * 合并项目私有 docLinks 与订阅的共享组链接。
 * - 私有在前（默认链接 = 私有首项的语义不变）；
 * - 共享按组 sortOrder 升序、组内按库中数组顺序追加；
 * - 去重（严格一致）：共享链接与已出现链接目标相同则跳过（私有优先保留）；
 *   先出现的共享链接同样计入去重集合，跨组重复只展示第一条；
 * - 订阅组已删除 / 条目缺失时静默忽略（容错，展示端不报错）。
 */
export function resolveProjectDocLinks(project: Pick<ProjectInfo, 'docLinks' | 'sharedDocLinkGroupIds'>, library: Pick<DocLinkLibraryFile, 'groups' | 'links'>): ResolvedProjectDocLink[] {
  const resolved: ResolvedProjectDocLink[] = []
  const seenKeys = new Set<string>()
  for (const link of project.docLinks ?? []) {
    seenKeys.add(projectDocLinkDedupeKey(link))
    resolved.push({ ...link, source: 'private' })
  }
  const subscribed = new Set(project.sharedDocLinkGroupIds ?? [])
  if (subscribed.size === 0) return resolved

  const orderedGroups = library.groups.filter((group) => subscribed.has(group.id)).sort((a, b) => a.sortOrder - b.sortOrder)

  const linksByGroup = new Map<string, SharedDocLink[]>()
  for (const link of library.links) {
    if (!subscribed.has(link.groupId)) continue
    const bucket = linksByGroup.get(link.groupId)
    if (bucket) bucket.push(link)
    else linksByGroup.set(link.groupId, [link])
  }

  for (const group of orderedGroups) {
    for (const link of linksByGroup.get(group.id) ?? []) {
      const key = projectDocLinkDedupeKey(link)
      if (seenKeys.has(key)) continue
      seenKeys.add(key)
      const { groupId: _groupId, createdAt: _createdAt, ...rest } = link
      resolved.push({ ...rest, source: 'shared', sharedGroupId: group.id })
    }
  }
  return resolved
}
