import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n'

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

const modalStack: number[] = []
let nextModalId = 1

function ModalShell({ open, onClose, children, widthClassName = 'max-w-[760px]', baseZIndex = 10040, ariaLabel, overlayClassName = '', panelClassName = '' }: ModalShellProps) {
  const { t } = useI18n()
  const modalIdRef = useRef<number>(0)

  if (modalIdRef.current === 0) {
    modalIdRef.current = nextModalId
    nextModalId += 1
  }

  useEffect(() => {
    if (!open) return

    const modalId = modalIdRef.current
    modalStack.push(modalId)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (modalStack[modalStack.length - 1] !== modalId) return
      event.preventDefault()
      onClose()
    }

    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      const index = modalStack.lastIndexOf(modalId)
      if (index >= 0) {
        modalStack.splice(index, 1)
      }
    }
  }, [onClose, open])

  if (!open) return null

  return createPortal(
    // Portal 合成事件沿 React 树冒泡：不在容器上截断 contextmenu，弹窗内
    // 右键会冒回宿主卡片/页面的右键处理器（如 ProjectCard 的卡片菜单）。
    // 只 stopPropagation 不 preventDefault，保留默认行为与全局手势 capture。
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: baseZIndex }} onContextMenu={(event) => event.stopPropagation()}>
      <button
        type="button"
        className={`modal-overlay-backdrop absolute inset-0 bg-black/25 backdrop-blur-[1px] ${overlayClassName}`.trim()}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
        }}
        aria-label={t('common.closeDialog')}
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
    document.body,
  )
}

export { ModalShell }
