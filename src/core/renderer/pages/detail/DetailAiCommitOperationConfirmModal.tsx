import { AlertTriangle, X } from 'lucide-react'
import { ModalShell } from '../../components/ModalShell'
import { useI18n } from '../../i18n'

type DetailAiCommitOperationConfirmModalProps = {
  cancelLabel?: string
  confirmExactMatch: string
  confirmLabel?: string
  confirmNeedsTypedMatch: boolean
  confirmTypedMatchPassed: boolean
  helperText?: string
  onChangeOperationConfirmInput: (value: string) => void
  onClose: () => void
  onConfirm: () => void
  open: boolean
  operationConfirmInput: string
  pendingOperationLabel: string
  pendingOperationMessage: string
  riskLevel?: 'normal' | 'high'
  title?: string
}

export function DetailAiCommitOperationConfirmModal({
  cancelLabel,
  confirmExactMatch,
  confirmLabel,
  confirmNeedsTypedMatch,
  confirmTypedMatchPassed,
  helperText,
  onChangeOperationConfirmInput,
  onClose,
  onConfirm,
  open,
  operationConfirmInput,
  pendingOperationLabel,
  pendingOperationMessage,
  riskLevel = 'normal',
  title,
}: DetailAiCommitOperationConfirmModalProps) {
  const { t } = useI18n()
  const resolvedTitle = title || `${pendingOperationLabel} ${t('detail.operationConfirmSuffix')}`
  const resolvedCancelLabel = cancelLabel || t('common.cancel')
  const resolvedConfirmLabel = confirmLabel || t('detail.operationConfirmExecute')

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      widthClassName="max-w-[420px]"
      baseZIndex={1100}
      ariaLabel={resolvedTitle}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="section-label mb-1">{t('detail.operationConfirmRemoteOperation')}</p>
          <p className="text-sm font-semibold text-[color:var(--color-foreground)]">
            {resolvedTitle}
          </p>
        </div>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
          onClick={onClose}
          title={t('detail.operationConfirmClose')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/70 px-3 py-2 text-[12px] text-[color:var(--color-foreground)]">
        {pendingOperationMessage}
      </p>
      {riskLevel === 'high' && (
        <div className="mt-2 rounded-[14px] border border-[color:var(--color-destructive)]/28 bg-[color:var(--color-destructive-background)] px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-[color:var(--color-destructive)]">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t('detail.operationConfirmHighRiskSwitch')}
          </p>
          {confirmNeedsTypedMatch && (
            <>
              <p className="mt-1 text-[10.5px] text-[color:var(--color-destructive)]/90">
                {t('detail.operationConfirmBranchPrompt')} <span className="font-mono">{confirmExactMatch}</span>
              </p>
              <input
                type="text"
                value={operationConfirmInput}
                onChange={(event) => onChangeOperationConfirmInput(event.target.value)}
                className="mt-2 h-8 w-full rounded-[10px] border border-[color:var(--color-destructive)]/28 bg-[color:var(--color-background)] px-2.5 font-mono text-[11.5px] text-[color:var(--color-foreground)] outline-none ring-[color:var(--color-ring)] focus:ring-2"
                placeholder={confirmExactMatch}
                spellCheck={false}
              />
            </>
          )}
        </div>
      )}
      <p className="mt-2 text-[10.5px] text-[color:var(--color-muted-foreground)]">
        {helperText || t('detail.operationConfirmHelper')}
      </p>
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          className="quiet-control inline-flex h-9 items-center justify-center rounded-full border-0 px-4 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
          onClick={onClose}
        >
          {resolvedCancelLabel}
        </button>
        <button
          type="button"
          className={`inline-flex h-9 items-center justify-center rounded-full px-4 text-xs font-medium text-white transition-colors ${
            riskLevel === 'high'
              ? 'bg-[color:var(--color-destructive)] hover:opacity-90'
              : 'bg-primary hover:bg-primary-hover'
          } disabled:cursor-not-allowed disabled:opacity-50`}
          disabled={!confirmTypedMatchPassed}
          onClick={onConfirm}
        >
          {resolvedConfirmLabel}
        </button>
      </div>
    </ModalShell>
  )
}
