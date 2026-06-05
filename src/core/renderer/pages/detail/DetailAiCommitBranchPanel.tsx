import type { MutableRefObject } from 'react'
import { Check, ChevronDown, GitBranch } from 'lucide-react'
import {
  GIT_OPERATION_ITEMS,
  type OperationCardState,
  type PanelGitOperationKind,
} from './detail.gitOperations'
import type { IndexedBranchCandidate } from './detail.aiCommitPanel.types'

type DetailAiCommitBranchPanelProps = {
  branchAhead: number
  branchBehind: number
  currentBranch: string
  filteredLocalMergeCandidates: IndexedBranchCandidate[]
  filteredRemoteMergeCandidates: IndexedBranchCandidate[]
  localMergeCandidates: IndexedBranchCandidate[]
  mergeDropdownOpen: boolean
  mergeDropdownRef: MutableRefObject<HTMLDivElement | null>
  mergeSearchDraft: string
  mergeSearchInputRef: MutableRefObject<HTMLInputElement | null>
  mergeSearchQuery: string
  mergeSearchResultCount: number
  mergeTarget: string
  mergeTargetLabel: string
  onChangeMergeSearchDraft: (value: string) => void
  onOpenCurrentBranchManager: () => void
  onOpenGitGuide: () => void
  onOpenUpstreamManager: () => void
  onRequestGitOperation: (operation: PanelGitOperationKind) => void
  onSelectMergeTarget: (branchName: string) => void
  onToggleMergeDropdown: () => void
  operationStates: Record<PanelGitOperationKind, OperationCardState>
  remoteMergeCandidates: IndexedBranchCandidate[]
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
      </div>
    </div>
  )
}

export function DetailAiCommitBranchPanel({
  branchAhead,
  branchBehind,
  currentBranch,
  filteredLocalMergeCandidates,
  filteredRemoteMergeCandidates,
  localMergeCandidates,
  mergeDropdownOpen,
  mergeDropdownRef,
  mergeSearchDraft,
  mergeSearchInputRef,
  mergeSearchQuery,
  mergeSearchResultCount,
  mergeTarget,
  mergeTargetLabel,
  onChangeMergeSearchDraft,
  onOpenCurrentBranchManager,
  onOpenGitGuide,
  onOpenUpstreamManager,
  onRequestGitOperation,
  onSelectMergeTarget,
  onToggleMergeDropdown,
  operationStates,
  remoteMergeCandidates,
  runningOperation,
  showBranchRemoteLoading,
  upstreamBranch,
}: DetailAiCommitBranchPanelProps) {
  return (
    <div className="min-h-0 rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
      {showBranchRemoteLoading ? (
        <BranchPanelLoadingState />
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between">
            <div className="inline-flex min-w-0 items-center gap-2">
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)] transition-colors hover:bg-[color:var(--color-primary)]/18"
                onClick={onOpenGitGuide}
                title="打开 Git 操作指南"
              >
                <GitBranch className="h-4.5 w-4.5" />
              </button>
              <div className="min-w-0">
                <p className="text-base font-semibold tracking-[-0.02em] text-[color:var(--color-foreground)]">分支与远程</p>
                <p className="text-xs text-[color:var(--color-muted-foreground)]">状态摘要与常用远程操作（点左侧图标看指南）</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span className="rounded-full bg-[color:var(--color-success-background)] px-2 py-0.5 text-[10.5px] font-medium text-[color:var(--color-success)]">
                ↑ {branchAhead}
              </span>
              <span className="rounded-full bg-[color:var(--color-warning-background)] px-2 py-0.5 text-[10.5px] font-medium text-[color:var(--color-warning)]">
                ↓ {branchBehind}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/62 px-3 py-2 text-left transition-colors hover:border-[color:var(--color-border-hover)] hover:bg-[color:var(--color-background-sunken)]"
              onClick={onOpenCurrentBranchManager}
              title="管理本地分支（新增/删除）"
            >
              <p className="text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">Current</p>
              <p className="mt-1 truncate font-mono text-[12px] text-[color:var(--color-foreground)]" title={currentBranch}>{currentBranch}</p>
            </button>
            <button
              type="button"
              className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/62 px-3 py-2 text-left transition-colors hover:border-[color:var(--color-border-hover)] hover:bg-[color:var(--color-background-sunken)]"
              onClick={onOpenUpstreamManager}
              title="管理 upstream（仅新增绑定，高危）"
            >
              <p className="text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">Upstream</p>
              <p className="mt-1 truncate font-mono text-[12px] text-[color:var(--color-foreground)]" title={upstreamBranch}>{upstreamBranch}</p>
            </button>
          </div>

          <div className="mt-3">
            <label className="block">
              <p className="mb-1 text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">
                Merge Target
              </p>
              <div
                ref={(node) => {
                  mergeDropdownRef.current = node
                }}
                className="relative"
              >
                <button
                  type="button"
                  className={`quiet-control flex h-10 w-full items-center justify-between rounded-[14px] px-3 text-left text-[12px] transition-colors ${
                    mergeDropdownOpen
                      ? 'border-[color:var(--color-ring)]/65 ring-2 ring-[color:var(--color-ring)]/22'
                      : 'hover:border-[color:var(--color-border-hover)]'
                  }`}
                  aria-haspopup="listbox"
                  aria-expanded={mergeDropdownOpen}
                  onClick={onToggleMergeDropdown}
                >
                  <span className={mergeTarget ? 'font-mono text-[color:var(--color-foreground)]' : 'text-[color:var(--color-muted-foreground)]'}>
                    {mergeTargetLabel}
                  </span>
                  <ChevronDown className={`h-3.5 w-3.5 text-[color:var(--color-muted-foreground)] transition-transform ${mergeDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {mergeDropdownOpen && (
                  <div
                    className="surface-card absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-[14px]"
                    role="listbox"
                    aria-label="Merge target branches"
                  >
                    <div className="max-h-[240px] overflow-auto p-1">
                      <div className="sticky top-0 z-10 px-1 pb-2 pt-1">
                        <div className="surface-card rounded-[10px] border border-[color:var(--color-border)] px-2">
                          <input
                            ref={(node) => {
                              mergeSearchInputRef.current = node
                            }}
                            type="text"
                            value={mergeSearchDraft}
                            onChange={(event) => onChangeMergeSearchDraft(event.target.value)}
                            placeholder="搜索分支..."
                            className="h-8 w-full bg-transparent text-[11.5px] text-[color:var(--color-foreground)] outline-none placeholder:text-[color:var(--color-muted-foreground)]"
                            spellCheck={false}
                          />
                        </div>
                      </div>
                      {filteredLocalMergeCandidates.length > 0 && (
                        <div className="mb-1">
                          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">
                            本地分支
                          </p>
                          {filteredLocalMergeCandidates.map((candidate) => {
                            const active = mergeTarget === candidate.name
                            return (
                              <button
                                key={`local-${candidate.name}`}
                                type="button"
                                className={`flex w-full items-center justify-between rounded-[10px] px-2.5 py-1.5 text-left text-[11.5px] transition-colors ${
                                  active
                                    ? 'bg-[color:var(--color-primary)]/12 text-[color:var(--color-foreground)]'
                                    : 'text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]'
                                }`}
                                onClick={() => onSelectMergeTarget(candidate.name)}
                              >
                                <span className="truncate font-mono">{candidate.name}</span>
                                {active && <Check className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-primary)]" />}
                              </button>
                            )
                          })}
                        </div>
                      )}
                      {filteredRemoteMergeCandidates.length > 0 && (
                        <div>
                          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">
                            远程分支
                          </p>
                          {filteredRemoteMergeCandidates.map((candidate) => {
                            const active = mergeTarget === candidate.name
                            return (
                              <button
                                key={`remote-${candidate.name}`}
                                type="button"
                                className={`flex w-full items-center justify-between rounded-[10px] px-2.5 py-1.5 text-left text-[11.5px] transition-colors ${
                                  active
                                    ? 'bg-[color:var(--color-primary)]/12 text-[color:var(--color-foreground)]'
                                    : 'text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]'
                                }`}
                                onClick={() => onSelectMergeTarget(candidate.name)}
                              >
                                <span className="truncate font-mono">{candidate.name}</span>
                                {active && <Check className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-primary)]" />}
                              </button>
                            )
                          })}
                        </div>
                      )}
                      {filteredLocalMergeCandidates.length === 0 && filteredRemoteMergeCandidates.length === 0 && (
                        <p className="px-2 py-2 text-[11px] text-[color:var(--color-muted-foreground)]">
                          {mergeSearchQuery ? '未找到匹配分支' : '暂无可选分支'}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <p className="mt-1 text-[10.5px] text-[color:var(--color-muted-foreground)]">
                本地 {localMergeCandidates.length} 个 · 远程 {remoteMergeCandidates.length} 个{mergeSearchQuery ? ` · 匹配 ${mergeSearchResultCount} 个` : ''}
              </p>
            </label>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            {GIT_OPERATION_ITEMS.map((item) => {
              const Icon = item.icon
              const opState = operationStates[item.key]
              const running = runningOperation === item.key
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`rounded-[14px] border border-[color:var(--color-border)] px-3 py-2 text-left transition-colors ${
                    opState.disabled
                      ? 'cursor-not-allowed bg-[color:var(--color-background-sunken)]/40 opacity-55'
                      : 'bg-[color:var(--color-background-sunken)]/65 hover:bg-[color:var(--color-background)]'
                  }`}
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
          </div>
        </>
      )}
    </div>
  )
}
