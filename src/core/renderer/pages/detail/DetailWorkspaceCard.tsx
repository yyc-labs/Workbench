import { useMemo } from 'react'
import { ArrowUpRight, BookOpen, FolderOpen, Play } from 'lucide-react'
import type { ProjectDocLink, ProjectInfo } from '../../../shared/types'
import { middleTruncatePath, projectDisplayName } from '../../lib/projectDisplay'
import { UrlPopover } from '../../components/UrlPopover'
import { InfoCard } from './DetailInfoCard'
import { normalizeProjectDocLinkTag, projectDocLinkTagLabel } from '../../lib/projectDocLinks'
import { useAppStore } from '../../stores/appStore'

type DetailWorkspaceCardProps = {
  project: ProjectInfo
  environmentLabel: string
  isRunning: boolean
  processUrls: string[]
  docLinks: ProjectDocLink[]
  defaultDocLink?: ProjectDocLink
  onOpenProjectLinksManager?: () => void
}

function DetailWorkspaceCard({
  project,
  environmentLabel,
  isRunning,
  processUrls,
  docLinks,
  defaultDocLink,
  onOpenProjectLinksManager,
}: DetailWorkspaceCardProps) {
  const docLinkTagOptions = useAppStore((s) => s.config.docLinkTags)
  const docMenuItems = useMemo(
    () => docLinks.map((link) => {
      const normalizedTag = normalizeProjectDocLinkTag(link.tag, docLinkTagOptions)
      return {
        url: link.url,
        label: `${projectDocLinkTagLabel(normalizedTag, docLinkTagOptions)}: ${link.title}`,
        tag: normalizedTag,
        tagLabel: projectDocLinkTagLabel(normalizedTag, docLinkTagOptions),
      }
    }),
    [docLinkTagOptions, docLinks]
  )
  return (
    <div className="relative overflow-hidden rounded-[24px] p-6 surface-card">
      <div className="relative">
        <p className="section-label">Workspace Snapshot</p>
        <h2 className="mt-1 text-[26px] font-semibold tracking-[-0.035em] text-[color:var(--color-foreground)]">
          {projectDisplayName(project)}
        </h2>
        <p className="mt-1 truncate text-xs text-[color:var(--color-muted-foreground)]" title={project.path}>
          {middleTruncatePath(project.path)}
        </p>

        <div className="mt-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <InfoCard label="Environment" value={environmentLabel} icon={FolderOpen} />
            <InfoCard label="Dev Status" value={isRunning ? 'Running' : 'Stopped'} icon={Play} />
          </div>
        </div>

        {(processUrls.length > 0 || defaultDocLink) && (
          <div className="mt-5 flex flex-wrap gap-2">
            {processUrls.length > 0 && (
              <UrlPopover urls={processUrls}>
                <button
                  className="quiet-control inline-flex items-center gap-1.5 rounded-full border-0 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-[color:var(--color-accent)]"
                  onClick={() => window.electronAPI.openExternal(processUrls[0])}
                >
                  <ArrowUpRight className="h-3 w-3" />
                  <span className="max-w-[220px] truncate">{processUrls[0]}</span>
                </button>
              </UrlPopover>
            )}
            {defaultDocLink && (
              <UrlPopover items={docMenuItems}>
                <button
                  className="quiet-control inline-flex items-center gap-1.5 rounded-full border-0 px-3 py-1.5 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                  onClick={() => window.electronAPI.openExternal(defaultDocLink.url)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onOpenProjectLinksManager?.()
                  }}
                  title="左键打开默认资料，右键打开资料管理"
                >
                  <BookOpen className="h-3 w-3" />
                  <span className="max-w-[240px] truncate">
                    资料 · {projectDocLinkTagLabel(
                      normalizeProjectDocLinkTag(defaultDocLink.tag, docLinkTagOptions),
                      docLinkTagOptions
                    )}: {defaultDocLink.title}
                  </span>
                </button>
              </UrlPopover>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export { DetailWorkspaceCard }
