import { MessageSquareText } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TranscriptFileReference } from '../../../shared/types'
import { useI18n } from '../../i18n'
import type { TranscriptGutterHover } from './useMonacoTranscriptGutter'

const HOVER_CARD_Z_INDEX = 1140
const HOVER_CARD_OFFSET_Y = 12
const HOVER_CARD_MARGIN = 8

type TranscriptReferenceHoverCardProps = {
  hover: TranscriptGutterHover
  onOpenReference: (item: TranscriptFileReference) => void
  onDismiss: () => void
  /** 鼠标进入卡片时取消宽限期收起。 */
  onHoverHold: () => void
}

function formatReferencePosition(item: TranscriptFileReference): string {
  const line = item.reference.lineNumber ?? 1
  const column = item.reference.column ? `:${item.reference.column}` : ''
  return `${item.reference.relativePath}:${line}${column}`
}

/** 悬浮卡片定位：以 (x, y+12) 为起点，超出视口底部向上翻转，x 做视口钳制。 */
function useHoverCardPosition(hover: TranscriptGutterHover) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState(() => ({ left: hover.x, top: hover.y + HOVER_CARD_OFFSET_Y }))

  useLayoutEffect(() => {
    const element = cardRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    let left = hover.x
    let top = hover.y + HOVER_CARD_OFFSET_Y
    if (left + rect.width + HOVER_CARD_MARGIN > window.innerWidth) {
      left = window.innerWidth - rect.width - HOVER_CARD_MARGIN
    }
    if (top + rect.height + HOVER_CARD_MARGIN > window.innerHeight) {
      top = Math.max(HOVER_CARD_MARGIN, hover.y - rect.height - HOVER_CARD_OFFSET_Y)
    }
    setPosition((current) => (current.left === left && current.top === top ? current : { left, top }))
  }, [hover])

  return { cardRef, position }
}

/** 转录引用选择卡片：悬浮 gutter 蓝点即显示，用户点选要打开的转录；离开卡片区域即关闭。 */
export function TranscriptReferenceHoverCard({ hover, onOpenReference, onDismiss, onHoverHold }: TranscriptReferenceHoverCardProps) {
  const { t } = useI18n()
  const { cardRef, position } = useHoverCardPosition(hover)

  // 无全屏 backdrop：backdrop 会拦截编辑器鼠标事件，导致卡片离开即收起的语义失效。
  // 收起路径：点选条目、离开卡片、编辑器内移出蓝点（宽限期）、滚动、切换文件。
  return createPortal(
    <div
      ref={cardRef}
      data-transcript-ref-card
      className="pointer-events-auto fixed max-h-[50vh] w-[300px] overflow-y-auto rounded-[12px] border border-[color:var(--color-border)] bg-[color:var(--color-popover)]/95 p-1 shadow-[var(--shadow-popover)] backdrop-blur"
      style={{ left: position.left, top: position.top, zIndex: HOVER_CARD_Z_INDEX }}
      role="dialog"
      aria-label={t('codeWorkspace.transcriptRefPickerTitle')}
      onMouseEnter={onHoverHold}
      onMouseLeave={onDismiss}
    >
      {hover.items.map((item) => (
        <button key={`${item.transcriptId}:${item.reference.id}`} type="button" className="flex w-full min-w-0 flex-col gap-0.5 rounded-[8px] px-2.5 py-1.5 text-left transition-colors hover:bg-[color:var(--color-accent)]" onClick={() => onOpenReference(item)}>
          <span className="flex min-w-0 items-center gap-1.5">
            <MessageSquareText className="h-3 w-3 shrink-0 text-[color:var(--color-muted-foreground)]" />
            <span className="truncate text-[12px] font-medium text-[color:var(--color-foreground)]">{item.transcriptTitle}</span>
          </span>
          <span className="truncate pl-[18px] font-mono text-[11px] text-[color:var(--color-muted-foreground)]">{formatReferencePosition(item)}</span>
        </button>
      ))}
    </div>,
    document.body,
  )
}
