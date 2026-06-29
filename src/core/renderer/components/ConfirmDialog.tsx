import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useI18n } from '../i18n'
import { ModalShell } from './ModalShell'
import { Button } from './ui/button'

type ConfirmDialogProps = {
  open: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  ariaLabel: string
  title: string
  description: string
  confirmLabel: string
  confirmVariant?: 'default' | 'destructive'
  busy?: boolean
  widthClassName?: string
  children?: ReactNode
}

function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  ariaLabel,
  title,
  description,
  confirmLabel,
  confirmVariant = 'default',
  busy = false,
  widthClassName = 'max-w-[560px]',
  children,
}: ConfirmDialogProps) {
  const { t } = useI18n()
  const destructive = confirmVariant === 'destructive'

  return (
    <ModalShell
      open={open}
      onClose={() => {
        if (busy) return
        onClose()
      }}
      widthClassName={widthClassName}
      ariaLabel={ariaLabel}
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div
            className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            style={{
              background: destructive
                ? 'var(--color-destructive-background)'
                : 'color-mix(in srgb, var(--color-primary) 12%, transparent)',
              color: destructive ? 'var(--color-destructive)' : 'var(--color-primary)',
            }}
          >
            <AlertTriangle className="h-5 w-5" strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">
              {title}
            </h3>
            <p className="mt-1 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
              {description}
            </p>
          </div>
        </div>

        {children}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-10 px-4"
            onClick={onClose}
            disabled={busy}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant={confirmVariant}
            className="h-10 px-4"
            onClick={() => void onConfirm()}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </ModalShell>
  )
}

export { ConfirmDialog }
