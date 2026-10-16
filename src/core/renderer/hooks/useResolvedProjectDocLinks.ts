import { useMemo } from 'react'
import { resolveProjectDocLinks } from '../../shared/projectDocLinks'
import type { ProjectInfo, ResolvedProjectDocLink } from '../../shared/types'
import { useAppStore } from '../stores/appStore'

/** 项目私有 docLinks + 订阅共享组合并后的展示列表（只读派生，不落盘） */
export function useResolvedProjectDocLinks(project: Pick<ProjectInfo, 'docLinks' | 'sharedDocLinkGroupIds'> | undefined): ResolvedProjectDocLink[] {
  const sharedGroups = useAppStore((s) => s.sharedDocLinkGroups)
  const sharedLinks = useAppStore((s) => s.sharedDocLinks)
  return useMemo(() => resolveProjectDocLinks({ docLinks: project?.docLinks ?? [], sharedDocLinkGroupIds: project?.sharedDocLinkGroupIds }, { groups: sharedGroups, links: sharedLinks }), [project?.docLinks, project?.sharedDocLinkGroupIds, sharedGroups, sharedLinks])
}
