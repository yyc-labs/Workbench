import { FileCode2, MessageSquareText } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TranscriptFileReference } from '../../../shared/types'
import type { TranscriptGutterHover } from './useMonacoTranscriptGutter'

const HOVER_CARD_Z_INDEX = 1140
const HOVER_CARD_OFFSET_Y = 12
const HOVER_CARD_MARGIN = 8

type TranscriptReferenceHoverCardProps = {
  hover: TranscriptGutterHover
  onMouseEnter: () => void
  onOpenReference: (item: TranscriptFileReference) => void
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

export function TranscriptReferenceHoverCard({ hover, onMouseEnter, onOpenReference }: TranscriptReferenceHoverCardProps) {
  const { cardRef, position } = useHoverCardPosition(hover)

  return createPortal(
    <div
      ref={cardRef}
      className="pointer-events-auto fixed max-h-[50vh] max-w-[320px] overflow-y-auto rounded-[12px] border border-[color:var(--color-border)] bg-[color:var(--color-popover)]/95 shadow-[var(--shadow-popover)] backdrop-blur"
      style={{ left: position.left, top: position.top, zIndex: HOVER_CARD_Z_INDEX }}
      onMouseEnter={onMouseEnter}
      role="tooltip"
    >
      <div className="flex flex-col py-1.5">
        {hover.items.map((item) => (
          <button key={`${item.transcriptId}:${item.reference.id}`} type="button" className="flex min-w-0 max-w-[320px] flex-col gap-0.5 px-3 py-1.5 text-left transition-colors hover:bg-[color:var(--color-accent)]" onClick={() => onOpenReference(item)}>
            <span className="flex min-w-0 items-center gap-1.5">
              <MessageSquareText className="h-3 w-3 shrink-0 text-[color:var(--color-muted-foreground)]" />
              <span className="truncate text-[12px] font-medium text-[color:var(--color-foreground)]">{item.transcriptTitle}</span>
            </span>
            <span className="flex min-w-0 items-center gap-1.5 pl-[18px]">
              <FileCode2 className="h-3 w-3 shrink-0 text-[color:var(--color-muted-foreground)]" />
              <span className="truncate font-mono text-[11px] text-[color:var(--color-muted-foreground)]">{formatReferencePosition(item)}</span>
            </span>
            {item.reference.label && <span className="truncate pl-[18px] text-[11px] text-[color:var(--color-muted-foreground)]">{item.reference.label}</span>}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  )
}
