import type { MouseEvent as ReactMouseEvent, MutableRefObject, ReactNode } from 'react'
import { BookOpen, Bot, Code2, Loader2, RotateCcw } from 'lucide-react'
import type { AiCommitUndoState } from '../../../shared/types'
import { UrlPopover } from '../../components/UrlPopover'
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
  aiCommitUndoAvailable: boolean
  aiCommitUndoError: string | null
  aiCommitUndoRemainingSeconds: number
  aiCommitUndoRunning: boolean
  firstProjectLinkItem?: ProjectLinkItem
  flowNodes: AiFlowNode[]
  gitRepositoryControls?: ReactNode
  isAiEnabled: boolean
  onAiAutoCommit: () => void
  onAiAutoCommitContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void
  onUndoAiCommit: () => void
  onOpenProjectLinksManager?: () => void
  onSwitchPane?: (pane: 'code' | 'aicommit') => void
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
  aiCommitUndoAvailable,
  aiCommitUndoError,
  aiCommitUndoRemainingSeconds,
  aiCommitUndoRunning,
  firstProjectLinkItem,
  flowNodes,
  gitRepositoryControls,
  isAiEnabled,
  onAiAutoCommit,
  onAiAutoCommitContextMenu,
  onUndoAiCommit,
  onOpenProjectLinksManager,
  onSwitchPane,
  projectHeaderCollapsed,
  projectLinkItems,
  projectName,
  statusClass,
  statusText,
}: DetailAiCommitHeaderProps) {
  const undoButtonLabel = aiCommitUndo?.commitCount && aiCommitUndo.commitCount > 1
    ? `撤回 ${aiCommitUndo.commitCount} 个提交`
    : '撤回提交'

  return (
    <div className="shrink-0 space-y-3">
      <section className="min-h-[52px] rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]/62 px-4 py-2">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {projectHeaderCollapsed && (
                <p className="max-w-[320px] truncate text-sm font-medium text-[color:var(--color-foreground)]" title={projectName || '当前项目'}>
                  {projectName || '当前项目'}
                </p>
              )}
              {projectHeaderCollapsed && (
                <div className="quiet-control flex items-center gap-1 rounded-full border border-[color:var(--color-border)] p-1">
                  <button
                    type="button"
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      activePane === 'code'
                        ? 'bg-primary text-white'
                        : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
                    }`}
                    onClick={() => onSwitchPane?.('code')}
                  >
                    <Code2 className="h-3.5 w-3.5" />
                    Code
                  </button>
                  <button
                    type="button"
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      activePane === 'aicommit'
                        ? 'bg-primary text-white'
                        : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
                    }`}
                    onClick={() => onSwitchPane?.('aicommit')}
                  >
                    <Bot className="h-3.5 w-3.5" />
                    AI Commit
                  </button>
                </div>
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
                    title="左键打开首个链接，右键打开资料管理"
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
              className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-all ${aiCommitStatus === 'running'
                ? 'bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]'
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
              onClick={onAiAutoCommit}
              onContextMenu={onAiAutoCommitContextMenu}
              disabled={aiCommitStatus === 'running'}
              title={isAiEnabled ? 'Left click: run commit. Right click: quick config.' : 'AI disabled in Settings, local commit message only'}
            >
              <Bot className="h-3.5 w-3.5" />
              {aiCommitStatus === 'running' ? 'AI Committing...' : 'AI Auto Commit'}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-card)]/62 p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className="section-label">AI Commit</p>
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] ${statusClass}`}>
            {statusText}
          </span>
          {aiCommitUndoAvailable && (
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[color:var(--color-warning)]/35 bg-[color:var(--color-warning-background)] px-2.5 text-[11px] font-medium text-[color:var(--color-warning)] transition-colors hover:bg-[color:var(--color-warning-background)]/80 disabled:opacity-70"
              onClick={onUndoAiCommit}
              disabled={aiCommitUndoRunning}
              title="撤回本次 AI Commit"
            >
              {aiCommitUndoRunning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              <span>{undoButtonLabel}</span>
              <span className="font-mono">{aiCommitUndoRemainingSeconds}s</span>
            </button>
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
