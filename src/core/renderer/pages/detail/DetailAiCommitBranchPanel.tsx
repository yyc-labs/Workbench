import { useMemo } from 'react'
import { GitBranch, GitCommitHorizontal, RotateCcw } from 'lucide-react'
import { Combobox, type ComboboxGroup } from '../../components/ui/combobox'
import { getGitOperationItems, type OperationCardState, type PanelGitOperationKind } from './detail.gitOperations'
import type { IndexedBranchCandidate } from './detail.aiCommitPanel.types'
import { useI18n } from '../../i18n'

type DetailAiCommitBranchPanelProps = {
  branchAhead: number
  branchBehind: number
  commitBlockedReason: string | null
  commitPending: boolean
  commitUndoAvailable: boolean
  commitUndoRemainingSeconds: number
  commitUndoRunning: boolean
  currentBranch: string
  localMergeCandidates: IndexedBranchCandidate[]
  remoteMergeCandidates: IndexedBranchCandidate[]
  mergeTarget: string
  mergeSearchValue: string
  onChangeMergeSearchValue: (value: string) => void
  onRequestCommit: () => void
  onRequestUndoCommit: () => void
  onOpenCurrentBranchManager: () => void
  onOpenGitGuide: () => void
  onOpenUpstreamManager: () => void
  onRequestGitOperation: (operation: PanelGitOperationKind) => void
  onSelectMergeTarget: (branchName: string) => void
  operationStates: Record<PanelGitOperationKind, OperationCardState>
  runningOperation: PanelGitOperationKind | null
  showBranchRemoteLoading: boolean
  upstreamBranch: string
}

function BranchPanelLoadingState() {
  return (
    <div className="git-panel-loading-surface">
      <div className="mb-3 flex items-center justify-between">
        <div className="inline-flex min-w-0 items-center gap-2">
          <div className="git-panel-skeleton h-9 w-9 rounded-full" />
          <div className="min-w-0">
            <div className="git-panel-skeleton h-5 w-24 rounded-md" />
            <div className="git-panel-skeleton mt-1.5 h-3.5 w-52 rounded-md" />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div className="git-panel-skeleton h-6 w-12 rounded-full" />
          <div className="git-panel-skeleton h-6 w-12 rounded-full" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/62 px-3 py-2">
          <div className="git-panel-skeleton h-3 w-16 rounded-md" />
          <div className="git-panel-skeleton mt-2 h-4 w-28 rounded-md" />
        </div>
        <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/62 px-3 py-2">
          <div className="git-panel-skeleton h-3 w-16 rounded-md" />
          <div className="git-panel-skeleton mt-2 h-4 w-32 rounded-md" />
        </div>
      </div>
      <div className="mt-3">
        <div className="git-panel-skeleton h-3 w-24 rounded-md" />
        <div className="git-panel-skeleton mt-1.5 h-10 w-full rounded-[14px]" />
        <div className="git-panel-skeleton mt-1.5 h-3 w-36 rounded-md" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="git-panel-skeleton h-[62px] rounded-[14px]" />
        <div className="git-panel-skeleton h-[62px] rounded-[14px]" />
        <div className="git-panel-skeleton h-[62px] rounded-[14px]" />
        <div className="git-panel-skeleton h-[62px] rounded-[14px]" />
        <div className="git-panel-skeleton h-[62px] rounded-[14px]" />
        <div className="git-panel-skeleton h-[62px] rounded-[14px]" />
      </div>
    </div>
  )
}

export function DetailAiCommitBranchPanel({
  branchAhead,
  branchBehind,
  commitBlockedReason,
  commitPending,
  commitUndoAvailable,
  commitUndoRemainingSeconds,
  commitUndoRunning,
  currentBranch,
  localMergeCandidates,
  remoteMergeCandidates,
  mergeTarget,
  mergeSearchValue,
  onChangeMergeSearchValue,
  onRequestCommit,
  onRequestUndoCommit,
  onOpenCurrentBranchManager,
  onOpenGitGuide,
  onOpenUpstreamManager,
  onRequestGitOperation,
  onSelectMergeTarget,
  operationStates,
  runningOperation,
  showBranchRemoteLoading,
  upstreamBranch,
}: DetailAiCommitBranchPanelProps) {
  const { t } = useI18n()
  const gitOperationItems = getGitOperationItems()
  const mergeSearchQuery = mergeSearchValue.trim().toLowerCase()
  const mergeGroups = useMemo<ComboboxGroup[]>(
    () =>
      [
        {
          key: 'local',
          label: t('detail.branchPanelLocalBranches'),
          options: localMergeCandidates.map((candidate) => ({
            value: candidate.name,
            label: candidate.name,
          })),
        },
        {
          key: 'remote',
          label: t('detail.branchPanelRemoteBranches'),
          options: remoteMergeCandidates.map((candidate) => ({
            value: candidate.name,
            label: candidate.name,
          })),
        },
      ].filter((group) => group.options.length > 0),
    [localMergeCandidates, remoteMergeCandidates, t],
  )
  const filteredLocalCount = useMemo(() => localMergeCandidates.filter((candidate) => !mergeSearchQuery || candidate.searchText.includes(mergeSearchQuery)).length, [localMergeCandidates, mergeSearchQuery])
  const filteredRemoteCount = useMemo(() => remoteMergeCandidates.filter((candidate) => !mergeSearchQuery || candidate.searchText.includes(mergeSearchQuery)).length, [remoteMergeCandidates, mergeSearchQuery])
  const mergeSearchResultCount = filteredLocalCount + filteredRemoteCount
  const mergeTargetLabel = mergeTarget || t('detail.mergeTargetPlaceholder')
  return (
    <div className="flex min-h-0 flex-col overflow-auto rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
      {showBranchRemoteLoading ? (
        <BranchPanelLoadingState />
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between">
            <div className="inline-flex min-w-0 items-center gap-2">
              <button type="button" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)] transition-colors hover:bg-[color:var(--color-primary)]/18" onClick={onOpenGitGuide} title={t('detail.branchPanelOpenGuide')}>
                <GitBranch className="h-4.5 w-4.5" />
              </button>
              <div className="min-w-0">
                <p className="text-base font-semibold tracking-[-0.02em] text-[color:var(--color-foreground)]">{t('detail.branchPanelTitle')}</p>
                <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('detail.branchPanelDescription')}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span className="rounded-full bg-[color:var(--color-success-background)] px-2 py-0.5 text-[10.5px] font-medium text-[color:var(--color-success)]">↑ {branchAhead}</span>
              <span className="rounded-full bg-[color:var(--color-warning-background)] px-2 py-0.5 text-[10.5px] font-medium text-[color:var(--color-warning)]">↓ {branchBehind}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/62 px-3 py-2 text-left transition-colors hover:border-[color:var(--color-border-hover)] hover:bg-[color:var(--color-background-sunken)]"
              onClick={onOpenCurrentBranchManager}
              title={t('detail.branchPanelManageCurrent')}
            >
              <p className="text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">{t('detail.branchPanelCurrent')}</p>
              <p className="mt-1 truncate font-mono text-[12px] text-[color:var(--color-foreground)]" title={currentBranch}>
                {currentBranch}
              </p>
            </button>
            <button
              type="button"
              className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/62 px-3 py-2 text-left transition-colors hover:border-[color:var(--color-border-hover)] hover:bg-[color:var(--color-background-sunken)]"
              onClick={onOpenUpstreamManager}
              title={t('detail.branchPanelManageUpstream')}
            >
              <p className="text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">{t('detail.branchPanelUpstream')}</p>
              <p className="mt-1 truncate font-mono text-[12px] text-[color:var(--color-foreground)]" title={upstreamBranch}>
                {upstreamBranch}
              </p>
            </button>
          </div>

          <div className="mt-3">
            <label className="block">
              <p className="mb-1 text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">{t('detail.branchPanelMergeTarget')}</p>
              <Combobox
                ariaLabel={t('detail.branchPanelMergeTarget')}
                value={mergeTarget}
                searchValue={mergeSearchValue}
                onSearchValueChange={onChangeMergeSearchValue}
                options={[]}
                groups={mergeGroups}
                onChange={onSelectMergeTarget}
                editable="open"
                clearSearchOnClose
                triggerPlaceholder={mergeTargetLabel}
                inputPlaceholder={mergeTarget || t('detail.branchPanelSearchPlaceholder')}
                toggleAriaLabel={t('detail.branchPanelCloseList')}
                emptyText={mergeSearchQuery ? t('detail.branchPanelNoMatch') : t('detail.branchPanelNoBranches')}
                inputClassName="h-10 rounded-[14px] px-3 font-mono text-[12px]"
                triggerClassName="h-10 rounded-[14px] px-3 text-[12px] hover:border-[color:var(--color-border-hover)]"
                contentClassName="surface-card rounded-[14px] p-1"
                optionClassName="rounded-[10px] px-2.5 py-1.5 text-[11.5px]"
                groupLabelClassName="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]"
                renderDisplayValue={() => <span className={mergeTarget ? 'font-mono text-[12px] text-[color:var(--color-foreground)]' : 'font-sans text-[12px] text-[color:var(--color-muted-foreground)]'}>{mergeTargetLabel}</span>}
                renderOption={(option, state) => (
                  <>
                    <span className="truncate font-mono">{option.label}</span>
                    {state.selected ? <span className="h-3.5 w-3.5 shrink-0 rounded-full bg-[color:var(--color-primary)]" /> : null}
                  </>
                )}
                filterOption={(option, query) => option.value.toLowerCase().includes(query.trim().toLowerCase())}
              />
              <p className="mt-1 text-[10.5px] text-[color:var(--color-muted-foreground)]">
                {t('detail.branchPanelSelectedCount', {
                  localCount: localMergeCandidates.length,
                  remoteCount: remoteMergeCandidates.length,
                  matchCount: mergeSearchQuery ? t('detail.branchPanelMatchCount', { count: mergeSearchResultCount }) : '',
                })}
              </p>
            </label>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            {gitOperationItems.map((item) => {
              const Icon = item.icon
              const opState = operationStates[item.key]
              const running = runningOperation === item.key
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`rounded-[14px] border border-[color:var(--color-border)] px-3 py-2 text-left transition-colors ${opState.disabled ? 'cursor-not-allowed bg-[color:var(--color-background-sunken)]/40 opacity-55' : 'bg-[color:var(--color-background-sunken)]/65 hover:bg-[color:var(--color-background)]'}`}
                  title={`${item.description} · ${opState.hint}`}
                  disabled={opState.disabled}
                  onClick={() => onRequestGitOperation(item.key)}
                >
                  <div className="flex items-center gap-2 text-[12px] font-semibold text-[color:var(--color-foreground)]">
                    <Icon className={`h-3.5 w-3.5 ${running ? 'animate-pulse text-[color:var(--color-warning)]' : 'text-[color:var(--color-primary)]'}`} />
                    {running ? `${item.label}...` : item.label}
                  </div>
                  <p className="mt-1 text-[10px] text-[color:var(--color-muted-foreground)]/85">{opState.hint}</p>
                </button>
              )
            })}
            <button
              type="button"
              className={`rounded-[14px] border border-[color:var(--color-border)] px-3 py-2 text-left transition-colors ${
                commitBlockedReason || commitPending ? 'cursor-not-allowed bg-[color:var(--color-background-sunken)]/40 opacity-55' : 'bg-[color:var(--color-background-sunken)]/65 hover:bg-[color:var(--color-background)]'
              }`}
              title={`${commitUndoAvailable ? t('detail.gitOpUndoCommit') : t('detail.commitStagedTitle')} · ${commitBlockedReason || t('detail.commitStagedActionHint')}`}
              disabled={(!commitUndoAvailable && Boolean(commitBlockedReason)) || commitPending || commitUndoRunning}
              onClick={commitUndoAvailable ? onRequestUndoCommit : onRequestCommit}
            >
              <div className="flex items-center gap-2 text-[12px] font-semibold text-[color:var(--color-foreground)]">
                {commitUndoAvailable ? (
                  <RotateCcw className={`h-3.5 w-3.5 ${commitUndoRunning ? 'animate-pulse text-[color:var(--color-warning)]' : 'text-[color:var(--color-warning)]'}`} />
                ) : (
                  <GitCommitHorizontal className={`h-3.5 w-3.5 ${commitPending ? 'animate-pulse text-[color:var(--color-warning)]' : 'text-[color:var(--color-primary)]'}`} />
                )}
                {commitUndoRunning ? `${t('detail.gitOpUndoCommit')}...` : commitUndoAvailable ? `${t('detail.gitOpUndoCommit')} ${commitUndoRemainingSeconds}s` : commitPending ? `${t('detail.gitOpCommit')}...` : t('detail.gitOpCommit')}
              </div>
              <p className="mt-1 text-[10px] text-[color:var(--color-muted-foreground)]/85">{commitUndoAvailable ? t('detail.gitUndoCommitHint') : commitPending ? t('detail.commitStagedCommitting') : commitBlockedReason || t('detail.commitStagedActionHint')}</p>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
