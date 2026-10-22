import { useCallback, useLayoutEffect, useRef } from 'react'

/** 列表项根元素标记属性：FLIP 测量与播放的目标选择器。 */
export const FLIP_ID_ATTRIBUTE = 'data-flip-id'

/** 重排补间时长（ms）与缓动：干脆收尾的 ease-out，跟手不拖沓。 */
export const FLIP_DURATION_MS = 240
export const FLIP_EASING = 'cubic-bezier(0.2, 0, 0, 1)'

/**
 * useSortable 的让位过渡参数：与 FLIP 同参数。
 * 拖拽中被拖项自身不套过渡（dnd-kit 保证跟指针），仅 displaced 项让位使用。
 */
export const SORTABLE_REORDER_TRANSITION = { duration: FLIP_DURATION_MS, easing: FLIP_EASING }

type FlipListItem = { id: string }
type FlipContainerRef = { current: HTMLElement | null }

/**
 * FLIP 重排动画：列表顺序变化时，把每个可见项从旧视觉位置补间到新位置。
 *
 * 用法：
 * 1. 调用方持有列表容器 ref，并给每个列表项根元素打上 `data-flip-id={id}`；
 * 2. 在「DOM 仍为旧布局」时（如 dnd-kit onDragEnd 内、setState 前）调用 captureFirst()；
 * 3. 随后按新顺序渲染，布局提交后本 hook 自动完成 Invert + Play。
 *
 * 与 dnd-kit 行内拖拽互补：First 捕获的是含 inline transform 的视觉位置，
 * 播放期由 WAAPI 接管 transform，因此开始新拖拽前必须调用 cancelFlip()。
 */
export function useFlipReorder<T extends FlipListItem>(containerRef: FlipContainerRef, items: T[]) {
  const firstRectsRef = useRef<Map<string, DOMRect> | null>(null)
  const runningAnimationsRef = useRef<Animation[]>([])
  // 顺序敏感键：仅顺序/成员变化才触发播放判定，内容刷新不误触。
  const itemsKey = items.map((item) => item.id).join('\u0000')

  const cancelFlip = useCallback(() => {
    for (const animation of runningAnimationsRef.current) animation.cancel()
    runningAnimationsRef.current = []
  }, [])

  const captureFirst = useCallback(() => {
    cancelFlip()
    const container = containerRef.current
    if (!container) return
    const rects = new Map<string, DOMRect>()
    for (const element of container.querySelectorAll<HTMLElement>(`[${FLIP_ID_ATTRIBUTE}]`)) {
      rects.set(element.dataset.flipId ?? '', element.getBoundingClientRect())
    }
    firstRectsRef.current = rects
  }, [cancelFlip, containerRef])

  useLayoutEffect(() => {
    const firstRects = firstRectsRef.current
    firstRectsRef.current = null
    if (!firstRects || firstRects.size === 0) return
    const container = containerRef.current
    if (!container) return
    const animations: Animation[] = []
    for (const element of container.querySelectorAll<HTMLElement>(`[${FLIP_ID_ATTRIBUTE}]`)) {
      const before = firstRects.get(element.dataset.flipId ?? '')
      if (!before) continue
      const after = element.getBoundingClientRect()
      const dx = before.left - after.left
      const dy = before.top - after.top
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
      animations.push(
        element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0px, 0px)' }], {
          duration: FLIP_DURATION_MS,
          easing: FLIP_EASING,
        }),
      )
    }
    runningAnimationsRef.current = animations
    for (const animation of animations) {
      // cancel 会让 finished reject，必须吞掉；完成后移出运行表。
      animation.finished
        .catch(() => {})
        .finally(() => {
          runningAnimationsRef.current = runningAnimationsRef.current.filter((item) => item !== animation)
        })
    }
  }, [containerRef, itemsKey])

  return { captureFirst, cancelFlip }
}
