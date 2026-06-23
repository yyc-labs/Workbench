import { useMemo } from 'react'
import { ArrowUpRight, FolderOpen, Play } from 'lucide-react'
import type { ProjectDocLink, ProjectInfo } from '../../../shared/types'
import { ProjectLinksTrigger } from '../../components/ProjectLinksTrigger'
import { middleTruncatePath, projectDisplayName } from '../../lib/projectDisplay'
import { UrlPopover } from '../../components/UrlPopover'
import { InfoCard } from './DetailInfoCard'
import { normalizeProjectDocLinkTag, projectDocLinkCopyValue, projectDocLinkTagLabel, projectDocLinkTarget } from '../../lib/projectDocLinks'
import { useAppStore } from '../../stores/appStore'
import { useI18n } from '../../i18n'
import { useProjectDocLinks } from './useProjectDocLinks'

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
  const { t } = useI18n()
  const docLinkTagOptions = useAppStore((s) => s.config.docLinkTags)
  const { handleCopyDocLinkAccount, handleCopyDocLinkSecret, handleOpenDocLink } = useProjectDocLinks({ project })
  const docMenuItems = useMemo(
    () => docLinks.map((link) => {
      const normalizedTag = normalizeProjectDocLinkTag(link.tag, docLinkTagOptions)
      const isSsh = (link.kind ?? 'url') === 'ssh'
      return {
        url: link.url ?? '',
        label: `${projectDocLinkTagLabel(normalizedTag, docLinkTagOptions)}: ${link.title}`,
        tag: normalizedTag,
        tagLabel: projectDocLinkTagLabel(normalizedTag, docLinkTagOptions),
        onOpen: () => handleOpenDocLink(link),
        kind: link.kind ?? 'url',
        description: projectDocLinkTarget(link),
        copyValue: projectDocLinkCopyValue(link),
        credentialActions: [
          ...((link.account?.trim() || link.sshUsername?.trim())
            ? [{
              key: 'account',
              label: t('documentation.copyAccount'),
              icon: 'account' as const,
              onCopy: async () => await handleCopyDocLinkAccount(link.id),
            }]
            : []),
          ...(link.hasSecret
            ? [{
              key: 'password',
              label: t('documentation.copyPassword'),
              icon: 'password' as const,
              onCopy: async () => await handleCopyDocLinkSecret(link.id),
            }]
            : []),
        ],
      }
    }),
    [docLinkTagOptions, docLinks, handleCopyDocLinkAccount, handleCopyDocLinkSecret, handleOpenDocLink, t]
  )
  return (
    <div className="relative overflow-hidden rounded-[24px] p-6 surface-card">
      <div className="relative">
        <p className="section-label">{t('detail.workspaceSnapshot')}</p>
        <h2 className="mt-1 text-[26px] font-semibold tracking-[-0.035em] text-[color:var(--color-foreground)]">
          {projectDisplayName(project)}
        </h2>
        <p className="mt-1 truncate text-xs text-[color:var(--color-muted-foreground)]" title={project.path}>
          {middleTruncatePath(project.path)}
        </p>

        <div className="mt-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <InfoCard label={t('detail.environment')} value={environmentLabel} icon={FolderOpen} />
            <InfoCard label={t('detail.devStatus')} value={isRunning ? t('detail.running') : t('detail.stopped')} icon={Play} />
          </div>
        </div>

        {(processUrls.length > 0 || defaultDocLink) && (
          <div className="mt-5 flex flex-wrap gap-2">
            {processUrls.length > 0 && (
              <UrlPopover urls={processUrls}>
                <button
                  className="quiet-control inline-flex items-center gap-1.5 rounded-full border-0 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-[color:var(--color-accent)] hover:text-primary"
                  onClick={() => window.electronAPI.openExternal(processUrls[0])}
                >
                  <ArrowUpRight className="h-3 w-3" />
                  <span className="max-w-[220px] truncate">{processUrls[0]}</span>
                </button>
              </UrlPopover>
            )}
            {defaultDocLink && (
              <ProjectLinksTrigger
                items={docMenuItems}
                tagOptions={docLinkTagOptions}
                onOpenDefault={() => handleOpenDocLink(defaultDocLink)}
                onOpenManager={onOpenProjectLinksManager}
                size="icon"
                title={projectDocLinkTarget(defaultDocLink)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export { DetailWorkspaceCard }
