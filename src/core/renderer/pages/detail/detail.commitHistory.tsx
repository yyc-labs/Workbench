import { type Dispatch, type SetStateAction, useEffect, useState } from 'react'
import { Copy } from 'lucide-react'
import { formatCommitDate } from './detail.aiFlow'
import { translateCurrent } from '../../i18n'
import type { DetailGitSnapshot } from './detail.types'

type GitHistoryCommit = DetailGitSnapshot['recentCommits'][number]
type CopyStatus = 'idle' | 'success' | 'error'

export type CommitHistoryDisplayItem = GitHistoryCommit & {
  withinRecentBatch: boolean
  isLocalHead: boolean
  isUpstreamHead: boolean
  relationLabel: string
}

export function formatFilesChangedLabel(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return translateCurrent('detail.commitHistoryFilesChanged', { count: 0 })
  return count === 1
    ? translateCurrent('detail.commitHistoryFilesChanged', { count })
    : translateCurrent('detail.commitHistoryFilesChangedPlural', { count })
}

export function buildCommitHistoryDisplayItems(
  commits: GitHistoryCommit[],
  options: {
    localHead?: string
    upstreamHead?: string
    hasUpstream: boolean
    upstreamGone: boolean
    branchAhead: number
    branchBehind: number
  }
): CommitHistoryDisplayItem[] {
  const COMMIT_BATCH_WINDOW_MS = 15_000
  const commitTimes = commits.map((commit) => new Date(commit.committedAt).getTime())
  const localHeadLower = options.localHead?.toLowerCase()
  const upstreamHeadLower = options.upstreamHead?.toLowerCase()
  const relationLabel = !options.hasUpstream
    ? translateCurrent('detail.commitHistoryRelationNoUpstream')
    : options.upstreamGone
      ? translateCurrent('detail.commitHistoryRelationUpstreamGone')
      : options.branchAhead === 0 && options.branchBehind === 0
        ? translateCurrent('detail.commitHistoryRelationSynced')
        : options.branchAhead > 0 && options.branchBehind > 0
          ? translateCurrent('detail.commitHistoryRelationAheadBehind', { ahead: options.branchAhead, behind: options.branchBehind })
          : options.branchAhead > 0
            ? translateCurrent('detail.commitHistoryRelationAhead', { ahead: options.branchAhead })
            : options.branchBehind > 0
              ? translateCurrent('detail.commitHistoryRelationBehind', { behind: options.branchBehind })
              : translateCurrent('detail.commitHistoryRelationUnknown')

  return commits.map((commit, index) => {
    const currentTime = commitTimes[index]
    const commitHashLower = commit.hash.toLowerCase()
    const isLocalHead = Boolean(localHeadLower && commitHashLower === localHeadLower)
    const isUpstreamHead = Boolean(upstreamHeadLower && commitHashLower === upstreamHeadLower)
    if (!Number.isFinite(currentTime)) {
      return {
        ...commit,
        withinRecentBatch: false,
        isLocalHead,
        isUpstreamHead,
        relationLabel,
      }
    }

    const prevTime = index > 0 ? commitTimes[index - 1] : Number.NaN
    const nextTime = index < commits.length - 1 ? commitTimes[index + 1] : Number.NaN
    const nearPrev = Number.isFinite(prevTime) && Math.abs(prevTime - currentTime) <= COMMIT_BATCH_WINDOW_MS
    const nearNext = Number.isFinite(nextTime) && Math.abs(nextTime - currentTime) <= COMMIT_BATCH_WINDOW_MS
    const withinRecentBatch = nearPrev || nearNext

    return {
      ...commit,
      withinRecentBatch,
      isLocalHead,
      isUpstreamHead,
      relationLabel,
    }
  })
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fallback below.
    }
  }

  if (typeof document === 'undefined') return false

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '-9999px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)

  textarea.focus()
  textarea.select()

  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  } finally {
    document.body.removeChild(textarea)
  }

  return copied
}

export function CommitHistoryItem({
  commit,
  activeCommitHash,
  setActiveCommitHash,
}: {
  commit: CommitHistoryDisplayItem
  activeCommitHash: string | null
  setActiveCommitHash: Dispatch<SetStateAction<string | null>>
}) {
  const active = activeCommitHash === commit.hash
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle')
  const hashLabel = copyStatus === 'success' ? translateCurrent('detail.commitHistoryCopied') : copyStatus === 'error' ? translateCurrent('detail.commitHistoryCopyFailed') : commit.shortHash
  const showRelationBadge = commit.isLocalHead || commit.isUpstreamHead

  useEffect(() => {
    if (copyStatus === 'idle') return
    const timer = window.setTimeout(() => {
      setCopyStatus('idle')
    }, 1500)
    return () => {
      window.clearTimeout(timer)
    }
  }, [copyStatus])

  const handleCopyHash = async () => {
    const ok = await copyTextToClipboard(commit.hash)
    setCopyStatus(ok ? 'success' : 'error')
  }

  return (
    <div
      className={`rounded-[14px] border px-3 py-2.5 transition-all duration-200 ${
        active
          ? 'border-[color:var(--color-primary)]/45 bg-[color:var(--color-background)]'
          : commit.withinRecentBatch
            ? 'border-[color:var(--color-warning)]/45 bg-[color:var(--color-warning-background)]/45 hover:border-[color:var(--color-warning)]/65 hover:bg-[color:var(--color-warning-background)]/60'
            : 'border-[color:var(--color-border)] bg-[color:var(--color-card)] hover:border-[color:var(--color-border-hover)] hover:bg-[color:var(--color-background)]/70'
      }`}
    >
      <button
        type="button"
        className="block w-full min-w-0 text-left"
        onClick={() => setActiveCommitHash((prev) => (prev === commit.hash ? null : commit.hash))}
      >
        <p className="truncate text-[13px] font-semibold tracking-[-0.01em] text-[color:var(--color-foreground)]">
          {commit.subject}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10.5px] text-[color:var(--color-muted-foreground)]">
          <span
            className={`inline-flex cursor-pointer select-none items-center gap-1 rounded-full border px-2 py-0.5 font-mono transition-colors ${
              copyStatus === 'success'
                ? 'border-[color:var(--color-success)]/40 bg-[color:var(--color-success-background)] text-[color:var(--color-success)]'
                : copyStatus === 'error'
                  ? 'border-[color:var(--color-destructive)]/40 bg-[color:var(--color-destructive-background)] text-[color:var(--color-destructive)]'
                  : 'border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)] text-[color:var(--color-foreground)] hover:bg-[color:var(--color-background)]'
            }`}
            onClick={(event) => {
              event.stopPropagation()
              void handleCopyHash()
            }}
            title={translateCurrent('detail.commitHistoryCopyHashTooltip')}
          >
            <Copy className="h-3 w-3" />
            {hashLabel}
          </span>
          {showRelationBadge && (
            <>
              {commit.isLocalHead && (
                <span className="rounded-full border border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary)]/12 px-2 py-0.5 text-[color:var(--color-primary)]">
                  {translateCurrent('detail.commitHistoryLocalHead')}
                </span>
              )}
              {commit.isUpstreamHead && (
                <span className="rounded-full border border-[color:var(--color-success)]/45 bg-[color:var(--color-success-background)] px-2 py-0.5 text-[color:var(--color-success)]">
                  {translateCurrent('detail.commitHistoryUpstream')}
                </span>
              )}
              <span className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)] px-2 py-0.5 text-[color:var(--color-foreground)]/80">
                {commit.relationLabel}
              </span>
            </>
          )}
          <span className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)] px-2 py-0.5">
            {formatFilesChangedLabel(commit.filesChanged)}
          </span>
          {commit.withinRecentBatch && (
            <span className="rounded-full border border-[color:var(--color-warning)]/45 bg-[color:var(--color-warning-background)] px-2 py-0.5 text-[color:var(--color-warning)]">
              {translateCurrent('detail.commitHistorySameBatch')}
            </span>
          )}
          <span>{formatCommitDate(commit.committedAt)}</span>
        </div>
      </button>

      {active && (
        <div className="mt-2 rounded-[12px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/70 px-3 py-2">
          <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
            {commit.authorName || translateCurrent('detail.commitHistoryUnknownAuthor')}
            {commit.refs.length > 0 ? ` · ${commit.refs.join(', ')}` : ''}
          </p>
          {commit.bullets.length > 0 && (
            <div className="mt-2 space-y-1">
              {commit.bullets.map((line, idx) => (
                <div key={`${commit.hash}-b-${idx}`} className="flex items-start gap-1.5 text-[11.5px] leading-5 text-[color:var(--color-foreground)]">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[color:var(--color-muted-foreground)]/70" />
                  <span className="min-w-0 break-words">{line.replace(/^-+\s*/, '')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
