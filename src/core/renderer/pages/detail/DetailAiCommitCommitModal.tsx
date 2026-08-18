import { Bot, GitCommitHorizontal, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ModalShell } from '../../components/ModalShell'
import { Textarea } from '../../components/ui/textarea'
import type { AiCommitStatus } from './detail.types'
import { useI18n } from '../../i18n'

type DetailAiCommitCommitModalProps = {
  blockedReason: string | null
  aiCommitStatus?: AiCommitStatus
  isAiEnabled?: boolean
  commitError: string | null
  commitMessage: string
  committing: boolean
  onChangeCommitMessage: (value: string) => void
  onClose: () => void
  onAiCommit?: () => void
  onCommit: () => void
  open: boolean
  stagedFileCount: number
}

export function DetailAiCommitCommitModal({ blockedReason, aiCommitStatus, isAiEnabled, commitError, commitMessage, committing, onChangeCommitMessage, onClose, onAiCommit, onCommit, open, stagedFileCount }: DetailAiCommitCommitModalProps) {
  const { t } = useI18n()
  const [commitMode, setCommitMode] = useState<'manual' | 'ai'>('manual')
  const aiCommitRunning = aiCommitStatus === 'running'
  const aiCommitAvailable = (isAiEnabled ?? false) && !aiCommitRunning
  const aiCommitDisabledReason = aiCommitRunning ? t('detail.commitStagedModeAiRunning') : t('detail.commitStagedModeAiDisabled')
  const canCommit = !committing && !blockedReason && (commitMode === 'ai' ? aiCommitAvailable : Boolean(commitMessage.trim()))

  useEffect(() => {
    if (!open) return
    setCommitMode('manual')
  }, [open])

  return (
    <ModalShell open={open} onClose={onClose} widthClassName="max-w-[460px]" baseZIndex={1160} ariaLabel={t('detail.commitStagedTitle')}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)]">
            <GitCommitHorizontal className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="section-label mb-1">{t('detail.gitOpCommit')}</p>
            <p className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('detail.commitStagedTitle')}</p>
          </div>
        </div>
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
          onClick={onClose}
          disabled={committing}
          title={t('detail.operationConfirmClose')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/70 px-3 py-2 text-[12px] text-[color:var(--color-foreground)]">{t('detail.commitStagedDescription', { count: stagedFileCount })}</p>

      <div className="mt-3 space-y-2">
        <p className="text-[11px] font-medium text-[color:var(--color-foreground)]">{t('detail.commitStagedModeLabel')}</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={`rounded-[14px] border px-3 py-2 text-left transition-colors ${
              commitMode === 'manual'
                ? 'border-[color:var(--color-primary)]/30 bg-[color:var(--color-primary)]/10 text-[color:var(--color-foreground)]'
                : 'border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/55 text-[color:var(--color-foreground)] hover:bg-[color:var(--color-background-sunken)]'
            }`}
            onClick={() => setCommitMode('manual')}
            disabled={committing}
          >
            <div className="flex items-center gap-2 text-[12px] font-medium">
              <GitCommitHorizontal className="h-3.5 w-3.5 text-[color:var(--color-primary)]" />
              {t('detail.commitStagedModeManual')}
            </div>
            <p className="mt-1 text-[10px] text-[color:var(--color-muted-foreground)]">{t('detail.commitStagedModeManualHint')}</p>
          </button>
          <button
            type="button"
            className={`rounded-[14px] border px-3 py-2 text-left transition-colors ${
              commitMode === 'ai' ? 'border-[color:var(--color-primary)]/30 bg-[color:var(--color-primary)]/10 text-[color:var(--color-foreground)]' : 'border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/55 text-[color:var(--color-foreground)] hover:bg-[color:var(--color-background-sunken)]'
            } ${!aiCommitAvailable ? 'cursor-not-allowed opacity-55' : ''}`}
            onClick={() => {
              if (!aiCommitAvailable) return
              setCommitMode('ai')
            }}
            disabled={committing || !aiCommitAvailable}
          >
            <div className="flex items-center gap-2 text-[12px] font-medium">
              <Bot className="h-3.5 w-3.5 text-[color:var(--color-primary)]" />
              {t('detail.commitStagedModeAi')}
            </div>
            <p className="mt-1 text-[10px] text-[color:var(--color-muted-foreground)]">{aiCommitAvailable ? t('detail.commitStagedModeAiHint') : aiCommitDisabledReason}</p>
          </button>
        </div>
      </div>

      {commitMode === 'manual' ? (
        <label className="mt-3 block">
          <span className="mb-1 block text-[11px] font-medium text-[color:var(--color-foreground)]">{t('detail.commitStagedMessageLabel')}</span>
          <Textarea value={commitMessage} disabled={committing || Boolean(blockedReason)} onChange={(event) => onChangeCommitMessage(event.target.value)} placeholder={t('detail.commitStagedMessagePlaceholder')} className="min-h-[104px] resize-y px-3 py-2 text-[12px] leading-5" autoFocus />
        </label>
      ) : (
        <div className="mt-3 rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/55 px-3 py-3 text-[11px] leading-5 text-[color:var(--color-muted-foreground)]">{aiCommitAvailable ? t('detail.commitStagedModeAiHint') : aiCommitDisabledReason}</div>
      )}

      {(commitError || blockedReason) && <p className="mt-2 rounded-[12px] border border-[color:var(--color-destructive)]/25 bg-[color:var(--color-destructive-background)] px-3 py-2 text-[11px] leading-5 text-[color:var(--color-destructive)]">{commitError || blockedReason}</p>}

      {commitMode === 'manual' && !committing && !blockedReason && !commitMessage.trim() && <p className="mt-2 text-[10.5px] text-[color:var(--color-muted-foreground)]">{t('detail.commitStagedMessageRequired')}</p>}

      <div className="mt-4 flex items-center justify-end gap-2">
        <button type="button" className="quiet-control inline-flex h-9 items-center justify-center rounded-full border-0 px-4 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50" onClick={onClose} disabled={committing}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-primary px-4 text-xs font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canCommit}
          onClick={() => {
            if (commitMode === 'ai') {
              onClose()
              onAiCommit?.()
              return
            }
            onCommit()
          }}
        >
          {commitMode === 'ai' ? <Bot className={`h-3.5 w-3.5 ${aiCommitRunning ? 'animate-pulse' : ''}`} /> : <GitCommitHorizontal className={`h-3.5 w-3.5 ${committing ? 'animate-pulse' : ''}`} />}
          {commitMode === 'ai' ? (aiCommitRunning ? t('detail.aiCommitRunning') : t('detail.commitStagedAiButton')) : committing ? t('detail.commitStagedCommitting') : t('detail.commitStagedButton')}
        </button>
      </div>
    </ModalShell>
  )
}
