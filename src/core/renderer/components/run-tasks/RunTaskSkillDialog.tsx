import { Check, ChevronDown, ClipboardCopy, TriangleAlert } from 'lucide-react'
import { memo, useState } from 'react'
import { useI18n } from '../../i18n'
import { ModalShell } from '../ModalShell'

type RunTaskSkillDialogProps = {
  open: boolean
  /** Localized agent prompt; static per locale so the memo below holds. */
  skillPrompt: string
  /** Windows + non-ASCII project path: surface the Java tooling warning. */
  hasNonAsciiPath: boolean
  /** Copy feedback shared with the host dialog's header copy button. */
  copied: boolean
  onCopy: () => void
  baseZIndex?: number
  onClose: () => void
}

// Memoized: the host re-renders on run-task progress events and the periodic
// reconcile while this dialog is open; with stable props the large prompt
// text is not re-diffed with them. The overlay drops its backdrop blur —
// stacking a second full-screen blur layer over the host modal makes every
// repaint underneath (task rows updating) re-composite the blur. Note the
// flat class is a real CSS rule: Tailwind's backdrop-blur-0 generates no CSS
// and would leave the base backdrop-blur-[1px] in effect.
export const RunTaskSkillDialog = memo(function RunTaskSkillDialog({ open, skillPrompt, hasNonAsciiPath, copied, onCopy, baseZIndex, onClose }: RunTaskSkillDialogProps) {
  const { t } = useI18n()
  const [warningOpen, setWarningOpen] = useState(false)

  return (
    <ModalShell open={open} onClose={onClose} widthClassName="max-w-[760px]" baseZIndex={baseZIndex} ariaLabel={t('runTasks.skillDialog.title')} panelClassName="h-[min(640px,calc(100vh-116px))] overflow-hidden p-0" overlayClassName="modal-overlay-backdrop-flat bg-black/40">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-[color:var(--color-border)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('runTasks.skillDialog.title')}</h2>
            <p className="mt-0.5 text-[11px] leading-relaxed text-[color:var(--color-muted-foreground)]">{t('runTasks.skillDialog.hint')}</p>
          </div>
          <button type="button" className="quiet-control inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-[color:var(--color-foreground)]" onClick={onCopy}>
            {copied ? <Check className="h-3.5 w-3.5 text-[color:var(--color-success)]" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
            {copied ? t('common.copied') : t('common.copy')}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {hasNonAsciiPath && (
            <div className="mb-3">
              <button type="button" className="quiet-control inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-[color:var(--color-warning)]" onClick={() => setWarningOpen((value) => !value)}>
                <TriangleAlert className="h-3.5 w-3.5" />
                {t('runTasks.nonAsciiPathWarningTitle')}
                <ChevronDown className={`h-3 w-3 transition-transform ${warningOpen ? 'rotate-180' : ''}`} />
              </button>
              {warningOpen && <p className="mt-2 rounded-xl border border-[color:var(--color-warning)]/25 bg-[color:var(--color-warning-background)] px-3 py-2 text-xs leading-relaxed text-[color:var(--color-warning)]">{t('runTasks.nonAsciiPathWarning')}</p>}
            </div>
          )}
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[color:var(--color-foreground)]">{skillPrompt}</pre>
        </div>
      </div>
    </ModalShell>
  )
})
