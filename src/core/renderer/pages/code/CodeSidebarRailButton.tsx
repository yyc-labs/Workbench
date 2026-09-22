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
  /** 按住后拖动进入宽度调节；位移未超过阈值时松开仍视为普通点击（避免误触发拖拽） */
  onLongPress?: (event: React.PointerEvent<HTMLButtonElement>) => void
  longPressMs?: number
}

const DEFAULT_LONG_PRESS_MS = 380
/** 位移小于该距离时不视为拖拽，松开后仍触发点击 */
const DRAG_THRESHOLD_PX = 12

export function CodeSidebarRailButton({ side, collapsed, onClick, className, ariaLabel, resizing = false, onLongPress, longPressMs = DEFAULT_LONG_PRESS_MS }: CodeSidebarRailButtonProps) {
  const Icon = side === 'left' ? (collapsed ? ChevronRight : ChevronLeft) : collapsed ? ChevronLeft : ChevronRight

  const longPressTimerRef = useRef<number | null>(null)
  /** 长按计时已到，等待位移达到阈值后进入拖拽 */
  const dragArmedRef = useRef(false)
  /** 拖拽已实际开始：松开后的 click 需要被抑制 */
  const didDragRef = useRef(false)
  const pointerStartRef = useRef({ x: 0, y: 0 })

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!onLongPress) return
    pointerStartRef.current = { x: event.clientX, y: event.clientY }
    dragArmedRef.current = false
    didDragRef.current = false
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
      dragArmedRef.current = true
    }, longPressMs)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!onLongPress || !dragArmedRef.current || didDragRef.current) return
    const dx = event.clientX - pointerStartRef.current.x
    const dy = event.clientY - pointerStartRef.current.y
    // 位移达到阈值才真正进入拖拽，避免轻微抖动误触发
    if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
      didDragRef.current = true
      dragArmedRef.current = false
      onLongPress(event)
    }
  }

  const handleClick = () => {
    if (didDragRef.current) {
      // 拖拽已发生，抑制紧随其后的 click，避免误折叠
      didDragRef.current = false
      return
    }
    dragArmedRef.current = false
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
      onPointerMove={onLongPress ? handlePointerMove : undefined}
      onPointerUp={onLongPress ? clearLongPressTimer : undefined}
      onPointerLeave={onLongPress ? clearLongPressTimer : undefined}
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      <Icon className="h-3.5 w-3.5" />
    </Button>
  )
}
