import { Pencil, Trash2 } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useCallback, useEffect } from 'react'
import type { TranscriptSessionSummary } from '../../../shared/types'
import { useI18n } from '../../i18n'

export interface TranscriptTreeContextMenuPayload {
  x: number
  y: number
  summary: TranscriptSessionSummary
}

interface TranscriptTreeContextMenuProps {
  x: number
  y: number
  summary: TranscriptSessionSummary
  onRename: () => void | Promise<void>
  onDelete: () => void | Promise<void>
  onClose: () => void
}

export function TranscriptTreeContextMenu({ x, y, summary, onRename, onDelete, onClose }: TranscriptTreeContextMenuProps) {
  const { t } = useI18n()
  const width = 220
  const height = 132
  const padding = 8
  const left = Math.min(Math.max(padding, x), window.innerWidth - width - padding)
  const top = Math.min(Math.max(padding, y), window.innerHeight - height - padding)

  const handleAction = useCallback(
    async (action: () => void | Promise<void>) => {
      await action()
      onClose()
    },
    [onClose],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    const onPointerDown = () => onClose()
    const timer = window.setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [onClose])

  // 滚动即关闭，scroll 不冒泡，需在 window 捕获阶段监听。
  useEffect(() => {
    const onScroll = () => onClose()
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [onClose])

  return createPortal(
    <div
      className="fixed z-[9998] min-w-[220px] rounded-[16px] border border-[color:var(--color-border)] bg-[color:var(--color-popover)] p-1.5 shadow-[var(--shadow-popover)]"
      style={{ top, left }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] text-[color:var(--color-muted-foreground)]">
        <span className="min-w-0 flex-1 truncate font-medium text-[color:var(--color-foreground)]" title={summary.title}>
          {summary.title}
        </span>
        <span className="shrink-0 font-mono text-[10px]">{t('transcript.refs', { count: summary.referenceCount })}</span>
      </div>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[12px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
        onClick={() => {
          void handleAction(onRename)
        }}
      >
        <Pencil className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
        {t('transcript.renameTranscript')}
      </button>
      <button
        type="button"
        className="mt-0.5 flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[12px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
        onClick={() => {
          void handleAction(onDelete)
        }}
      >
        <Trash2 className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-destructive)]" />
        {t('transcript.deleteTranscript')}
      </button>
    </div>,
    document.body,
  )
}
