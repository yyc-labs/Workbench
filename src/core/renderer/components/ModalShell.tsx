import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

type ModalShellProps = {
  open: boolean
  onClose: () => void
  children: ReactNode
  widthClassName?: string
  baseZIndex?: number
  ariaLabel?: string
  overlayClassName?: string
  panelClassName?: string
}

function ModalShell({
  open,
  onClose,
  children,
  widthClassName = 'max-w-[760px]',
  baseZIndex = 1000,
  ariaLabel,
  overlayClassName = '',
  panelClassName = '',
}: ModalShellProps) {
  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center px-4"
      style={{ zIndex: baseZIndex }}
    >
      <button
        type="button"
        className={`absolute inset-0 bg-black/25 backdrop-blur-[1px] ${overlayClassName}`.trim()}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
        }}
        aria-label="关闭弹窗"
      />
      <div
        className={`relative w-full ${widthClassName} rounded-[20px] border p-5 ${panelClassName}`.trim()}
        style={{
          zIndex: baseZIndex + 1,
          background: 'var(--color-popover)',
          borderColor: 'var(--color-border)',
          boxShadow: 'var(--shadow-popover)',
        }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}

export { ModalShell }
