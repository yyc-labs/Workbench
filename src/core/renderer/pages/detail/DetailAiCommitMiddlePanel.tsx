import type { Dispatch, SetStateAction } from 'react'
import { GitBranch, GitCommitHorizontal, History } from 'lucide-react'
import { CommitHistoryItem, type CommitHistoryDisplayItem } from './detail.commitHistory'
import {
  formatLogTime,
  getOperationLabel,
  getOperationStatusClass,
  getOperationStatusText,
} from './detail.gitOperations'
import type { MiddlePanelMode } from './detail.aiCommitPanel.types'
import type { GitOperationResult } from './detail.types'
import { useI18n } from '../../i18n'

type DetailAiCommitMiddlePanelProps = {
  activeCommitHash: string | null
  aiRawText: string
  commitHistoryItems: CommitHistoryDisplayItem[]
  middlePanelMode: MiddlePanelMode
  onSetMiddlePanelMode: (mode: MiddlePanelMode) => void
  operationLogs: GitOperationResult[]
  setActiveCommitHash: Dispatch<SetStateAction<string | null>>
  showCommitHistoryLoading: boolean
}

function MiddlePanelLoadingState() {
  return (
    <div className="git-panel-loading-surface min-h-0 flex-1 space-y-2 overflow-hidden pr-1">
      <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-3 py-2.5">
        <div className="git-panel-skeleton h-4 w-[76%] rounded-md" />
        <div className="mt-2 flex items-center gap-2">
          <div className="git-panel-skeleton h-5 w-20 rounded-full" />
          <div className="git-panel-skeleton h-5 w-14 rounded-full" />
          <div className="git-panel-skeleton h-4 w-24 rounded-md" />
        </div>
      </div>
      <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-3 py-2.5">
        <div className="git-panel-skeleton h-4 w-[62%] rounded-md" />
        <div className="mt-2 flex items-center gap-2">
          <div className="git-panel-skeleton h-5 w-20 rounded-full" />
          <div className="git-panel-skeleton h-5 w-14 rounded-full" />
          <div className="git-panel-skeleton h-4 w-24 rounded-md" />
        </div>
      </div>
      <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-3 py-2.5">
        <div className="git-panel-skeleton h-4 w-[70%] rounded-md" />
        <div className="mt-2 flex items-center gap-2">
          <div className="git-panel-skeleton h-5 w-20 rounded-full" />
          <div className="git-panel-skeleton h-5 w-14 rounded-full" />
          <div className="git-panel-skeleton h-4 w-24 rounded-md" />
        </div>
      </div>
    </div>
  )
}

function EmptyMiddlePanel({ text }: { text: string }) {
  return (
    <p className="flex min-h-0 flex-1 items-center justify-center rounded-[16px] border border-dashed border-[color:var(--color-border)] px-3 py-5 text-center text-xs text-[color:var(--color-muted-foreground)]">
      {text}
    </p>
  )
}

export function DetailAiCommitMiddlePanel({
  activeCommitHash,
  aiRawText,
  commitHistoryItems,
  middlePanelMode,
  onSetMiddlePanelMode,
  operationLogs,
  setActiveCommitHash,
  showCommitHistoryLoading,
}: DetailAiCommitMiddlePanelProps) {
  const { t } = useI18n()
  const middlePanelMeta = middlePanelMode === 'history'
    ? {
      title: t('detail.middlePanelHistoryTitle'),
      description: t('detail.middlePanelHistoryDescription'),
      icon: History,
    }
    : middlePanelMode === 'ai-log'
      ? {
        title: t('detail.middlePanelAiLogTitle'),
        description: t('detail.middlePanelAiLogDescription'),
        icon: GitCommitHorizontal,
      }
      : {
        title: t('detail.middlePanelGitLogTitle'),
        description: t('detail.middlePanelGitLogDescription'),
        icon: GitBranch,
      }
  const MiddlePanelIcon = middlePanelMeta.icon

  return (
    <div
      className="flex min-h-0 flex-col overflow-hidden rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4"
      style={{ contain: 'layout paint', isolation: 'isolate' }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="inline-flex min-w-0 items-center gap-2">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)]">
            <MiddlePanelIcon className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <p className="text-base font-semibold tracking-[-0.02em] text-[color:var(--color-foreground)]">
              {middlePanelMeta.title}
            </p>
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{middlePanelMeta.description}</p>
          </div>
        </div>
        <div className="quiet-control flex shrink-0 items-center gap-1 rounded-full border-0 p-1">
          <button
            type="button"
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${middlePanelMode === 'history'
              ? 'bg-primary text-white'
              : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
              }`}
            onClick={() => onSetMiddlePanelMode('history')}
          >
            {t('detail.middlePanelHistoryTab')}
          </button>
          <button
            type="button"
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${middlePanelMode === 'ai-log'
              ? 'bg-primary text-white'
              : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
              }`}
            onClick={() => onSetMiddlePanelMode('ai-log')}
          >
            {t('detail.middlePanelAiLogTab')}
          </button>
          <button
            type="button"
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${middlePanelMode === 'git-log'
              ? 'bg-primary text-white'
              : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
              }`}
            onClick={() => onSetMiddlePanelMode('git-log')}
          >
            {t('detail.middlePanelGitLogTab')}
          </button>
        </div>
      </div>

      {middlePanelMode === 'history' && (
        <>
          {showCommitHistoryLoading ? (
            <MiddlePanelLoadingState />
          ) : commitHistoryItems.length > 0 ? (
            <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
              {commitHistoryItems.map((commit) => (
                <CommitHistoryItem
                  key={commit.hash}
                  commit={commit}
                  activeCommitHash={activeCommitHash}
                  setActiveCommitHash={setActiveCommitHash}
                />
              ))}
            </div>
          ) : (
            <EmptyMiddlePanel text={t('detail.middlePanelNoHistory')} />
          )}
        </>
      )}

      {middlePanelMode === 'ai-log' && (
        <>
          {aiRawText.trim() ? (
            <div className="min-h-0 flex-1 overflow-auto rounded-[16px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/60 p-3">
              <pre className="whitespace-pre-wrap break-words text-[11px] leading-5 text-[color:var(--color-foreground)]/88">
                {aiRawText}
              </pre>
            </div>
          ) : (
            <EmptyMiddlePanel text={t('detail.middlePanelNoAiLog')} />
          )}
        </>
      )}

      {middlePanelMode === 'git-log' && (
        <>
          {operationLogs.length > 0 ? (
            <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
              {operationLogs.map((result, index) => (
                <div
                  key={`${result.operation}-${result.checkedAt}-${index}`}
                  className={`rounded-[14px] border px-3 py-2 ${getOperationStatusClass(result)}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] font-semibold text-[color:var(--color-foreground)]">
                      {getOperationLabel(result.operation)} · {getOperationStatusText(result)}
                    </p>
                    <p className="text-[10.5px] text-[color:var(--color-muted-foreground)]">
                      {formatLogTime(result.checkedAt)}
                    </p>
                  </div>
                  {result.targetBranch && (
                    <p className="mt-1 text-[10.5px] text-[color:var(--color-muted-foreground)]">
                      {t('detail.middlePanelTargetBranch')}: {result.targetBranch}
                    </p>
                  )}
                  {result.command && (
                    <p className="mt-1 font-mono text-[10.5px] text-[color:var(--color-muted-foreground)]">
                      {result.command}
                    </p>
                  )}
                  <pre className="mt-1 max-h-[140px] overflow-auto whitespace-pre-wrap break-words text-[10.5px] leading-5 text-[color:var(--color-foreground)]/88">
                    {result.output}
                  </pre>
                </div>
              ))}
            </div>
          ) : (
            <EmptyMiddlePanel text={t('detail.middlePanelNoGitLog')} />
          )}
        </>
      )}
    </div>
  )
}
