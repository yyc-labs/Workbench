import type { MouseEvent as ReactMouseEvent, MutableRefObject, ReactNode } from 'react'
import { BookOpen, Bot, Loader2, RotateCcw } from 'lucide-react'
import type { AiCommitUndoState } from '../../../shared/types'
import { ProjectPaneTabs } from '../../components/ProjectPaneTabs'
import { UrlPopover } from '../../components/UrlPopover'
import { useI18n } from '../../i18n'
import type { AiCommitStatus, AiFlowNode } from './detail.types'
import type { ProjectLinkItem } from './detail.aiCommitPanel.types'

function getStepClass(status: AiFlowNode['data']['status']): string {
  if (status === 'success') return 'border-[color:var(--color-success)]/30 bg-[color:var(--color-success-background)] text-[color:var(--color-success)]'
  if (status === 'running') return 'border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]'
  if (status === 'error') return 'border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-background)] text-[color:var(--color-destructive)]'
  return 'border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)] text-[color:var(--color-muted-foreground)]'
}

function getStepDotClass(status: AiFlowNode['data']['status']): string {
  if (status === 'success') return 'bg-[color:var(--color-success)]'
  if (status === 'running') return 'bg-[color:var(--color-warning)] animate-pulse'
  if (status === 'error') return 'bg-[color:var(--color-destructive)]'
  return 'bg-[color:var(--color-muted-foreground)]/45'
}

type DetailAiCommitHeaderProps = {
  activePane: 'code' | 'aicommit'
  aiAutoCommitButtonRef: MutableRefObject<HTMLButtonElement | null>
  aiCommitStatus: AiCommitStatus
  aiCommitUndo: AiCommitUndoState | null
  aiCommitUndoAuthActive: boolean
  aiCommitUndoAvailable: boolean
  aiCommitUndoError: string | null
  aiCommitUndoGraceActive: boolean
  aiCommitUndoGraceRemainingSeconds: number
  aiCommitUndoRemainingSeconds: number
  aiCommitUndoRunning: boolean
  firstProjectLinkItem?: ProjectLinkItem
  flowNodes: AiFlowNode[]
  gitRepositoryControls?: ReactNode
  isAiEnabled: boolean
  onAiAutoCommit: () => void
  onAiAutoCommitContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void
  onOpenTranscript?: () => void
  onUndoAiCommit: () => void
  onOpenProjectLinksManager?: () => void
  onSwitchPane?: (pane: 'code' | 'aicommit') => void
  preflightItems?: Array<{
    key: string
    label: string
    title: string
    tone: 'success' | 'warning' | 'danger' | 'neutral'
  }>
  projectHeaderCollapsed: boolean
  projectLinkItems: ProjectLinkItem[]
  projectName?: string
  statusClass: string
  statusText: string
}

export function DetailAiCommitHeader({
  activePane,
  aiAutoCommitButtonRef,
  aiCommitStatus,
  aiCommitUndo,
  aiCommitUndoAuthActive,
  aiCommitUndoAvailable,
  aiCommitUndoError,
  aiCommitUndoGraceActive,
  aiCommitUndoGraceRemainingSeconds,
  aiCommitUndoRemainingSeconds,
  aiCommitUndoRunning,
  firstProjectLinkItem,
  flowNodes,
  gitRepositoryControls,
  isAiEnabled,
  onAiAutoCommit,
  onAiAutoCommitContextMenu,
  onOpenTranscript,
  onUndoAiCommit,
  onOpenProjectLinksManager,
  onSwitchPane,
  preflightItems = [],
  projectHeaderCollapsed,
  projectLinkItems,
  projectName,
  statusClass,
  statusText,
}: DetailAiCommitHeaderProps) {
  const { t } = useI18n()
  const undoButtonLabel = aiCommitUndo?.commitCount && aiCommitUndo.commitCount > 1
    ? t('detail.aiCommitUndoCommit', { count: aiCommitUndo.commitCount })
    : t('detail.aiCommitUndoCommit', { count: 1 })
  const undoCountdownLabel = aiCommitUndoGraceActive
    ? `${undoButtonLabel} ${aiCommitUndoGraceRemainingSeconds}s`
    : `${undoButtonLabel} ${aiCommitUndoRemainingSeconds}s`
  const primaryButtonLabel = aiCommitUndoAvailable
    ? undoCountdownLabel
    : aiCommitStatus === 'running'
      ? t('detail.aiCommitRunning')
      : t('common.aiAutoCommit')
  const primaryButtonTitle = aiCommitUndoAvailable
    ? aiCommitUndoAuthActive
      ? t('detail.aiCommitUndoAuthActive')
      : t('detail.aiCommitUndoCurrent')
    : isAiEnabled
      ? t('detail.aiCommitButtonHintEnabled')
      : t('detail.aiCommitButtonHintDisabled')
  const primaryButtonDisabled = aiCommitStatus === 'running' || aiCommitUndoRunning
  const preflightClassByTone: Record<NonNullable<DetailAiCommitHeaderProps['preflightItems']>[number]['tone'], string> = {
    success: 'border-[color:var(--color-success)]/30 bg-[color:var(--color-success-background)] text-[color:var(--color-success)]',
    warning: 'border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]',
    danger: 'border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-background)] text-[color:var(--color-destructive)]',
    neutral: 'border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)] text-[color:var(--color-muted-foreground)]',
  }

  return (
    <div className="shrink-0 space-y-3">
      <section className="min-h-[52px] rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]/62 px-4 py-2">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2.5">
              {projectHeaderCollapsed && (
                <p className="max-w-[140px] truncate text-sm font-medium text-[color:var(--color-foreground)]" title={projectName || t('common.currentProject')}>
                  {projectName || t('common.currentProject')}
                </p>
              )}
              {projectHeaderCollapsed && (
                <>
                  <ProjectPaneTabs
                    activePane={activePane}
                    onSelectPane={(pane) => {
                      if (pane === 'transcript') {
                        onOpenTranscript?.()
                        return
                      }
                      onSwitchPane?.(pane)
                    }}
                  />
                </>
              )}
              {projectHeaderCollapsed && firstProjectLinkItem && (
                <UrlPopover items={projectLinkItems}>
                  <button
                    type="button"
                    className="quiet-control inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                    onClick={() => window.electronAPI.openExternal(firstProjectLinkItem.url)}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      onOpenProjectLinksManager?.()
                    }}
                    title={t('common.leftClickOpenFirstLink')}
                  >
                    <BookOpen className="h-3.5 w-3.5 shrink-0" />
                  </button>
                </UrlPopover>
              )}
            </div>
          </div>
          <div className="flex min-w-0 shrink-0 items-center justify-end gap-2">
            {gitRepositoryControls}
            <button
              ref={aiAutoCommitButtonRef}
              type="button"
              className={`inline-flex h-9 min-w-[150px] items-center justify-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-all ${aiCommitStatus === 'running'
                ? 'bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]'
                : aiCommitUndoAvailable
                  ? 'border-[color:var(--color-warning)]/35 bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)] hover:bg-[color:var(--color-warning-background)]/80'
                : aiCommitStatus === 'error'
                  ? 'text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-background)]'
                  : 'border-[color:var(--color-border)] text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]'
                }`}
              style={
                aiCommitStatus === 'running'
                  ? { borderColor: 'color-mix(in srgb, var(--color-warning) 34%, transparent)' }
                  : aiCommitStatus === 'error'
                    ? { borderColor: 'color-mix(in srgb, var(--color-destructive) 34%, transparent)' }
                    : undefined
              }
              onClick={aiCommitUndoAvailable ? onUndoAiCommit : onAiAutoCommit}
              onContextMenu={(event) => {
                if (aiCommitUndoAvailable) {
                  event.preventDefault()
                  event.stopPropagation()
                  return
                }
                onAiAutoCommitContextMenu(event)
              }}
              disabled={primaryButtonDisabled}
              title={primaryButtonTitle}
            >
              {aiCommitUndoRunning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : aiCommitUndoAvailable ? (
                <RotateCcw className="h-3.5 w-3.5" />
              ) : (
                <Bot className="h-3.5 w-3.5" />
              )}
              <span>{primaryButtonLabel}</span>
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]/62 p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className="section-label">{t('detail.aiCommit')}</p>
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] ${statusClass}`}>
            {statusText}
          </span>
          {preflightItems.map((item) => (
            <span
              key={item.key}
              className={`inline-flex max-w-[220px] items-center truncate rounded-full border px-2.5 py-0.5 text-[11px] ${preflightClassByTone[item.tone]}`}
              title={item.title}
            >
              {item.label}
            </span>
          ))}
          {aiCommitUndoGraceActive && (
            <span className="inline-flex items-center rounded-full border border-[color:var(--color-warning)]/35 bg-[color:var(--color-warning-background)] px-2.5 py-0.5 text-[11px] text-[color:var(--color-warning)]">
              {t('detail.aiCommitUndoAuthActive')} {aiCommitUndoGraceRemainingSeconds}s
            </span>
          )}
          {aiCommitUndoError && (
            <span className="inline-flex max-w-[360px] items-center truncate rounded-full border border-[color:var(--color-destructive)]/25 bg-[color:var(--color-destructive-background)] px-2.5 py-0.5 text-[11px] text-[color:var(--color-destructive)]" title={aiCommitUndoError}>
              {aiCommitUndoError}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {flowNodes.map((node, index) => (
            <div
              key={node.id}
              className={`inline-flex max-w-[190px] items-center gap-2 rounded-full border px-3 py-1.5 text-[11.5px] font-medium ${getStepClass(node.data.status)}`}
              title={node.data.detail || node.data.label}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${getStepDotClass(node.data.status)}`} />
              <span className="shrink-0 font-mono text-[10px] opacity-70">{index + 1}</span>
              <span className="truncate">{node.data.label}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
