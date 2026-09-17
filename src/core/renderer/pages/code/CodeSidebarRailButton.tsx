import { useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '../../components/ui/button'

type CodeSidebarRailButtonProps = {
  side: 'left' | 'right'
  collapsed: boolean
  onClick: () => void
  className: string
  ariaLabel: string
  /** 拖拽进行中：用于高亮反馈，不改变点击语义 */
  resizing?: boolean
  /** 长按进入宽度拖拽调节；长按后的松开不会触发普通点击（避免误折叠） */
  onLongPress?: (event: React.PointerEvent<HTMLButtonElement>) => void
  longPressMs?: number
}

const DEFAULT_LONG_PRESS_MS = 380

export function CodeSidebarRailButton({ side, collapsed, onClick, className, ariaLabel, resizing = false, onLongPress, longPressMs = DEFAULT_LONG_PRESS_MS }: CodeSidebarRailButtonProps) {
  const Icon = side === 'left' ? (collapsed ? ChevronRight : ChevronLeft) : collapsed ? ChevronLeft : ChevronRight

  const longPressTimerRef = useRef<number | null>(null)
  const didLongPressRef = useRef(false)

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!onLongPress) return
    // 捕获指针：按下后即使指针移出按钮范围也不会触发 pointerleave 取消长按，
    // 让「按住即拖拽」更可靠地触发。
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // 个别环境不支持 pointer capture，忽略后降级为原有行为
    }
    clearLongPressTimer()
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null
      didLongPressRef.current = true
      onLongPress(event)
    }, longPressMs)
  }

  const handleClick = () => {
    if (didLongPressRef.current) {
      // 长按已进入拖拽，抑制紧随其后的 click，避免误折叠
      didLongPressRef.current = false
      return
    }
    onClick()
  }

  const resizingClass = resizing ? 'ring-2 ring-[color:var(--color-primary)] bg-[color:var(--color-primary)]/15 text-[color:var(--color-primary)] scale-110 cursor-col-resize' : ''

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      data-resizing={resizing ? 'true' : undefined}
      className={`relative h-8 w-8 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-card)]/96 shadow-[0_8px_20px_rgba(15,23,42,0.10)] backdrop-blur-md transition-transform before:absolute before:-inset-2 before:content-[''] ${resizingClass} ${className}`}
      style={{ touchAction: 'none' }}
      onClick={handleClick}
      onPointerDown={onLongPress ? handlePointerDown : undefined}
      onPointerUp={onLongPress ? clearLongPressTimer : undefined}
      onPointerLeave={onLongPress ? clearLongPressTimer : undefined}
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      <Icon className="h-3.5 w-3.5" />
    </Button>
  )
}
