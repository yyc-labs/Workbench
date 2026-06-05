import type { MutableRefObject } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { ModalShell } from '../../components/ModalShell'
import type { BranchManagerMode } from './detail.aiCommitPanel.types'

type DetailAiCommitBranchManagerModalProps = {
  branchManagerDangerText: string
  branchManagerError: string | null
  branchManagerLoading: boolean
  currentBranch: string
  currentBranchInputRef: MutableRefObject<HTMLInputElement | null>
  currentManagerDeleteTarget: string
  currentManagerInput: string
  localBranches: string[]
  mode: BranchManagerMode | null
  onChangeCurrentManagerDeleteTarget: (value: string) => void
  onChangeCurrentManagerInput: (value: string) => void
  onChangeUpstreamManagerBranchName: (value: string) => void
  onChangeUpstreamManagerDangerInput: (value: string) => void
  onChangeUpstreamManagerRemoteName: (value: string) => void
  onClose: () => void
  onCreateLocalBranch: () => void
  onCreateRemoteBranchFromUpstream: () => void
  onDeleteLocalBranch: () => void
  onSetUpstream: () => void
  upstreamBranchInputRef: MutableRefObject<HTMLInputElement | null>
  upstreamManagerBranchName: string
  upstreamManagerDangerInput: string
  upstreamManagerRemoteName: string
}

export function DetailAiCommitBranchManagerModal({
  branchManagerDangerText,
  branchManagerError,
  branchManagerLoading,
  currentBranch,
  currentBranchInputRef,
  currentManagerDeleteTarget,
  currentManagerInput,
  localBranches,
  mode,
  onChangeCurrentManagerDeleteTarget,
  onChangeCurrentManagerInput,
  onChangeUpstreamManagerBranchName,
  onChangeUpstreamManagerDangerInput,
  onChangeUpstreamManagerRemoteName,
  onClose,
  onCreateLocalBranch,
  onCreateRemoteBranchFromUpstream,
  onDeleteLocalBranch,
  onSetUpstream,
  upstreamBranchInputRef,
  upstreamManagerBranchName,
  upstreamManagerDangerInput,
  upstreamManagerRemoteName,
}: DetailAiCommitBranchManagerModalProps) {
  return (
    <ModalShell
      open={Boolean(mode)}
      onClose={onClose}
      widthClassName="max-w-[460px]"
      baseZIndex={1120}
      ariaLabel={mode === 'current' ? 'Current Branch 管理' : 'Upstream 管理'}
    >
      {mode === 'current' ? (
        <>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="section-label mb-1">Current Branch</p>
              <p className="text-sm font-semibold text-[color:var(--color-foreground)]">本地分支管理</p>
            </div>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
              onClick={onClose}
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-2">
            <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/62 px-3 py-2">
              <p className="mb-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">新增本地分支</p>
              <input
                ref={(node) => {
                  currentBranchInputRef.current = node
                }}
                type="text"
                value={currentManagerInput}
                onChange={(event) => onChangeCurrentManagerInput(event.target.value)}
                placeholder="feature/new-branch"
                className="h-8 w-full bg-transparent font-mono text-[12px] text-[color:var(--color-foreground)] outline-none placeholder:text-[color:var(--color-muted-foreground)]"
                spellCheck={false}
              />
              <button
                type="button"
                className="mt-2 inline-flex h-8 items-center justify-center rounded-full bg-primary px-3 text-[11px] font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!currentManagerInput.trim() || branchManagerLoading}
                onClick={onCreateLocalBranch}
              >
                {branchManagerLoading ? '执行中...' : '新增'}
              </button>
            </div>

            <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/62 px-3 py-2">
              <p className="mb-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">删除本地分支</p>
              <select
                value={currentManagerDeleteTarget}
                onChange={(event) => onChangeCurrentManagerDeleteTarget(event.target.value)}
                className="h-8 w-full rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 font-mono text-[11.5px] text-[color:var(--color-foreground)] outline-none ring-[color:var(--color-ring)] focus:ring-2"
              >
                <option value="">选择分支（不含当前分支）</option>
                {localBranches
                  .filter((name) => name !== currentBranch)
                  .map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
              </select>
              <button
                type="button"
                className="mt-2 inline-flex h-8 items-center justify-center rounded-full bg-[color:var(--color-destructive)] px-3 text-[11px] font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!currentManagerDeleteTarget || branchManagerLoading}
                onClick={onDeleteLocalBranch}
              >
                {branchManagerLoading ? '执行中...' : '删除'}
              </button>
            </div>
          </div>
          {branchManagerError && (
            <p className="mt-2 rounded-[12px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-background)] px-3 py-2 text-[11px] text-[color:var(--color-destructive)]">
              {branchManagerError}
            </p>
          )}
        </>
      ) : (
        <>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="section-label mb-1">Upstream</p>
              <p className="text-sm font-semibold text-[color:var(--color-foreground)]">远程绑定管理（仅新增）</p>
            </div>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
              onClick={onClose}
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="rounded-[14px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-background)] px-3 py-2">
            <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-[color:var(--color-destructive)]">
              <AlertTriangle className="h-3.5 w-3.5" />
              高危操作：会修改当前分支的 upstream 绑定
            </p>
          </div>
          <div className="mt-2 space-y-2">
            <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/62 px-3 py-2">
              <p className="mb-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">Remote</p>
              <input
                type="text"
                value={upstreamManagerRemoteName}
                onChange={(event) => onChangeUpstreamManagerRemoteName(event.target.value)}
                placeholder="origin"
                className="h-8 w-full bg-transparent font-mono text-[12px] text-[color:var(--color-foreground)] outline-none placeholder:text-[color:var(--color-muted-foreground)]"
                spellCheck={false}
              />
            </div>
            <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/62 px-3 py-2">
              <p className="mb-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">Branch</p>
              <input
                ref={(node) => {
                  upstreamBranchInputRef.current = node
                }}
                type="text"
                value={upstreamManagerBranchName}
                onChange={(event) => onChangeUpstreamManagerBranchName(event.target.value)}
                placeholder="feature/new-branch"
                className="h-8 w-full bg-transparent font-mono text-[12px] text-[color:var(--color-foreground)] outline-none placeholder:text-[color:var(--color-muted-foreground)]"
                spellCheck={false}
              />
            </div>
            <div className="rounded-[14px] border border-[color:var(--color-destructive)]/28 bg-[color:var(--color-destructive-background)]/55 px-3 py-2">
              <p className="text-[10.5px] text-[color:var(--color-destructive)]/92">
                请输入以下目标以确认：
                <span className="ml-1 font-mono">{branchManagerDangerText}</span>
              </p>
              <input
                type="text"
                value={upstreamManagerDangerInput}
                onChange={(event) => onChangeUpstreamManagerDangerInput(event.target.value)}
                placeholder={branchManagerDangerText}
                className="mt-2 h-8 w-full rounded-[10px] border border-[color:var(--color-destructive)]/28 bg-[color:var(--color-background)] px-2 font-mono text-[11.5px] text-[color:var(--color-foreground)] outline-none ring-[color:var(--color-ring)] focus:ring-2"
                spellCheck={false}
              />
            </div>
          </div>
          {branchManagerError && (
            <p className="mt-2 rounded-[12px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-background)] px-3 py-2 text-[11px] text-[color:var(--color-destructive)]">
              {branchManagerError}
            </p>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-xs font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              disabled={
                branchManagerLoading
                || !upstreamManagerBranchName.trim()
                || upstreamManagerDangerInput.trim() !== branchManagerDangerText
              }
              onClick={onCreateRemoteBranchFromUpstream}
            >
              {branchManagerLoading ? '执行中...' : '创建远程分支'}
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-full bg-[color:var(--color-destructive)] px-4 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={
                branchManagerLoading
                || !upstreamManagerBranchName.trim()
                || upstreamManagerDangerInput.trim() !== branchManagerDangerText
              }
              onClick={onSetUpstream}
            >
              {branchManagerLoading ? '执行中...' : '仅绑定 upstream'}
            </button>
          </div>
        </>
      )}
    </ModalShell>
  )
}
