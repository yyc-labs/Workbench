import { ArrowUpRight, BookOpen, FolderOpen, Play } from 'lucide-react'
import type { ProjectDocLink, ProjectInfo } from '../../../shared/types'
import { middleTruncatePath, projectDisplayName } from '../../lib/projectDisplay'
import { UrlPopover } from '../../components/UrlPopover'
import { InfoCard } from './DetailInfoCard'

type DetailWorkspaceCardProps = {
  project: ProjectInfo
  environmentLabel: string
  isRunning: boolean
  processUrls: string[]
  docLinks: ProjectDocLink[]
  defaultDocLink?: ProjectDocLink
}

function DetailWorkspaceCard({
  project,
  environmentLabel,
  isRunning,
  processUrls,
  docLinks,
  defaultDocLink,
}: DetailWorkspaceCardProps) {
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
              <UrlPopover items={docLinks.map((link) => ({ url: link.url, label: link.title }))}>
                <button
                  className="quiet-control inline-flex items-center gap-1.5 rounded-full border-0 px-3 py-1.5 text-xs text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                  onClick={() => window.electronAPI.openExternal(defaultDocLink.url)}
                >
                  <BookOpen className="h-3 w-3" />
                  <span className="max-w-[220px] truncate">Docs: {defaultDocLink.title}</span>
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
