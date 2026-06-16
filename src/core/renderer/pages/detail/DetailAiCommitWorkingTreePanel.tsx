import { FileText, RefreshCw } from 'lucide-react'
import {
  formatGitBadgeCount,
  getChangeMeta,
  getScopeLabel,
} from './detail.gitOperations'
import { useI18n } from '../../i18n'
import type { DetailGitSnapshot } from './detail.types'

type GitChangedFile = DetailGitSnapshot['changedFiles'][number]

type DetailAiCommitWorkingTreePanelProps = {
  changedFiles: DetailGitSnapshot['changedFiles']
  changedFileCount: number
  changedFilesSuppressed: boolean
  conflictedCount: number
  fileActionError: string | null
  gitSnapshotLoading: boolean
  onOpenDiff: (filePath: string) => void
  onRefresh: () => void
  onSetFileStaged: (file: GitChangedFile, stage: boolean) => Promise<void> | void
  stagingFilePath: string | null
}

function WorkingTreeStatCard({
  colorClassName,
  label,
  loading,
  value,
}: {
  colorClassName: string
  label: string
  loading: boolean
  value: string
}) {
  return (
    <div className={`rounded-[13px] px-2.5 py-2 ${colorClassName}`}>
      {loading ? (
        <>
          <div className="git-panel-skeleton h-5 w-8 rounded-md" />
          <div className="git-panel-skeleton mt-1.5 h-3 w-11 rounded-md" />
        </>
      ) : (
        <>
          <p className="font-mono text-sm font-semibold text-[color:var(--color-foreground)]">{value}</p>
          <p className="text-[10.5px] text-[color:var(--color-muted-foreground)]">{label}</p>
        </>
      )}
    </div>
  )
}

function WorkingTreeFileItem({
  file,
  onOpenDiff,
  onSetFileStaged,
  stagingFilePath,
}: {
  file: GitChangedFile
  onOpenDiff: (filePath: string) => void
  onSetFileStaged: (file: GitChangedFile, stage: boolean) => Promise<void> | void
  stagingFilePath: string | null
}) {
  const { t } = useI18n()
  const meta = getChangeMeta(file.kind)
  const isBusy = stagingFilePath === file.path
  const canStage = (file.unstaged || file.scope === 'untracked') && file.scope !== 'conflicted'
  const canUnstage = file.staged && file.scope !== 'conflicted'

  return (
    <div
      className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background)]/72 px-3 py-2.5"
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => onOpenDiff(file.path)}
        >
          <div className="flex items-start gap-2">
            <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${meta.className}`}>
              {meta.label}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[12px] text-[color:var(--color-foreground)]" title={file.path}>{file.path}</p>
              {file.originalPath && (
                <p className="mt-0.5 truncate font-mono text-[10.5px] text-[color:var(--color-muted-foreground)]" title={file.originalPath}>
                  {t('detail.workingTreeFrom', { path: file.originalPath })}
                </p>
              )}
            </div>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2.5 py-1 text-[10.5px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              void onSetFileStaged(file, true)
            }}
            disabled={!canStage || Boolean(stagingFilePath)}
            title={canStage ? t('detail.workingTreeStage') : t('detail.workingTreeStageUnavailable')}
          >
            {isBusy && canStage ? t('detail.workingTreeStaging') : t('detail.workingTreeStage')}
          </button>
          <button
            type="button"
            className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2.5 py-1 text-[10.5px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              void onSetFileStaged(file, false)
            }}
            disabled={!canUnstage || Boolean(stagingFilePath)}
            title={canUnstage ? t('detail.workingTreeUnstage') : t('detail.workingTreeUnstageUnavailable')}
          >
            {isBusy && canUnstage ? t('detail.workingTreeUnstaging') : t('detail.workingTreeUnstage')}
          </button>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[10.5px] text-[color:var(--color-muted-foreground)]">
        <span>{getScopeLabel(file)}</span>
        <span className="font-mono">{file.indexStatus}{file.worktreeStatus}</span>
      </div>
    </div>
  )
}

export function DetailAiCommitWorkingTreePanel({
  changedFiles,
  changedFileCount,
  changedFilesSuppressed,
  conflictedCount,
  fileActionError,
  gitSnapshotLoading,
  onOpenDiff,
  onRefresh,
  onSetFileStaged,
  stagingFilePath,
}: DetailAiCommitWorkingTreePanelProps) {
  const { t } = useI18n()
  const stagedCount = changedFiles.filter((file) => file.staged).length
  const unstagedCount = changedFiles.filter((file) => file.unstaged).length
  const untrackedCount = changedFiles.filter((file) => file.scope === 'untracked').length

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="inline-flex min-w-0 items-center gap-2">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]">
            <FileText className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <p className="text-base font-semibold tracking-[-0.02em] text-[color:var(--color-foreground)]">{t('detail.workingTreeTitle')}</p>
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('detail.workingTreeDescription')}</p>
          </div>
        </div>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2.5 py-1 text-[11px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
          onClick={onRefresh}
          disabled={gitSnapshotLoading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${gitSnapshotLoading ? 'animate-spin' : ''}`} />
          {t('detail.workingTreeRefresh')}
        </button>
      </div>

      <div className="mb-3 grid grid-cols-4 gap-2">
        <WorkingTreeStatCard
          colorClassName="bg-[color:var(--color-background-sunken)]/60"
          label={t('detail.workingTreeAll')}
          loading={gitSnapshotLoading}
          value={formatGitBadgeCount(changedFileCount)}
        />
        <WorkingTreeStatCard
          colorClassName="bg-[color:var(--color-success-background)]"
          label={t('detail.workingTreeStaged')}
          loading={gitSnapshotLoading}
          value={formatGitBadgeCount(stagedCount)}
        />
        <WorkingTreeStatCard
          colorClassName="bg-[color:var(--color-warning-background)]"
          label={t('detail.workingTreeUnstaged')}
          loading={gitSnapshotLoading}
          value={formatGitBadgeCount(unstagedCount)}
        />
        <WorkingTreeStatCard
          colorClassName="bg-[color:var(--color-background-sunken)]/60"
          label={t('detail.workingTreeUntracked')}
          loading={gitSnapshotLoading}
          value={formatGitBadgeCount(untrackedCount)}
        />
      </div>

      {!gitSnapshotLoading && conflictedCount > 0 && (
        <div className="mb-3 rounded-[13px] border border-[color:var(--color-destructive)]/25 bg-[color:var(--color-destructive-background)] px-3 py-2 text-xs text-[color:var(--color-destructive)]">
          {t('detail.workingTreeConflictHint', { count: conflictedCount })}
        </div>
      )}

      {fileActionError && (
        <div className="mb-3 rounded-[13px] border border-[color:var(--color-destructive)]/25 bg-[color:var(--color-destructive-background)] px-3 py-2 text-xs text-[color:var(--color-destructive)]">
          {fileActionError}
        </div>
      )}

      {gitSnapshotLoading ? (
        <div className="git-panel-loading-surface flex min-h-0 flex-1 flex-col gap-2 rounded-[16px] border border-[color:var(--color-border)] bg-[color:var(--color-background)]/45 px-3 py-3">
          <div className="git-panel-skeleton h-4 w-24 rounded-md" />
          <div className="git-panel-skeleton h-[68px] w-full rounded-[12px]" />
          <div className="git-panel-skeleton h-[68px] w-full rounded-[12px]" />
          <div className="git-panel-skeleton h-[68px] w-[86%] rounded-[12px]" />
        </div>
      ) : changedFilesSuppressed ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-[16px] border border-dashed border-[color:var(--color-border)] px-4 py-5 text-center">
          <div>
            <p className="text-base font-semibold text-[color:var(--color-foreground)]">{t('detail.workingTreeSuppressedTitle')}</p>
            <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
              {t('detail.workingTreeSuppressedDescription')}
            </p>
          </div>
        </div>
      ) : changedFiles.length > 0 ? (
        <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
          {changedFiles.map((file) => (
            <WorkingTreeFileItem
              key={`${file.path}-${file.indexStatus}-${file.worktreeStatus}`}
              file={file}
              onOpenDiff={onOpenDiff}
              onSetFileStaged={onSetFileStaged}
              stagingFilePath={stagingFilePath}
            />
          ))}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-[16px] border border-dashed border-[color:var(--color-border)] bg-[color:var(--color-background)]/45 px-3 py-5 text-center">
          <div>
            <p className="text-base font-semibold text-[color:var(--color-foreground)]">{t('detail.workingTreeCleanTitle')}</p>
            <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">{t('detail.workingTreeCleanDescription')}</p>
          </div>
        </div>
      )}
    </div>
  )
}
