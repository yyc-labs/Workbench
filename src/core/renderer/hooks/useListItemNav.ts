import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'

export interface ListItemNav {
  activeIndex: number
  /** 鼠标悬浮：只切换高亮，绝不滚动列表（悬浮吸附是反交互的，还会和滚轮滚动打架）。 */
  hoverItem: (index: number) => void
  /** 键盘移动激活项（delta 取 ±1，环形）；视口吸附由内部 effect 完成。 */
  moveActive: (delta: 1 | -1, itemCount: number) => void
  /** 重置到第 0 项（如搜索词变化后）。 */
  reset: () => void
  /** 挂到可滚动列表容器上；吸附通过容器内 [data-active="true"] 定位激活项。 */
  listRef: RefObject<HTMLDivElement>
}

/**
 * 「激活项列表」导航逻辑（公共复用单元）：
 *
 * - 鼠标悬浮（hoverItem）：只更新高亮，不触发任何滚动（2026-11-03 用户确认）。
 * - 键盘移动（moveActive）：更新高亮并把激活项滚入可视区（视口吸附）。
 * - 吸附目标由容器内 [data-active="true"] 属性标记，列表项渲染方负责写入。
 *
 * 纯前端交互，不依赖 store / electron。
 */
export function useListItemNav(): ListItemNav {
  const [activeIndex, setActiveIndex] = useState(0)
  /** 最近一次导航来源：只有 keyboard 来源的激活项变化才做视口吸附。 */
  const lastNavSourceRef = useRef<'mouse' | 'keyboard'>('keyboard')
  const listRef = useRef<HTMLDivElement | null>(null)

  const hoverItem = useCallback((index: number) => {
    lastNavSourceRef.current = 'mouse'
    setActiveIndex(index)
  }, [])

  const moveActive = useCallback((delta: 1 | -1, itemCount: number) => {
    if (itemCount <= 0) return
    lastNavSourceRef.current = 'keyboard'
    setActiveIndex((current) => (current + delta + itemCount) % itemCount)
  }, [])

  const reset = useCallback(() => {
    lastNavSourceRef.current = 'keyboard'
    setActiveIndex(0)
  }, [])

  // 视口吸附：仅键盘移动/重置时执行；鼠标悬浮只切高亮不滚动。
  useEffect(() => {
    if (lastNavSourceRef.current !== 'keyboard') return
    const list = listRef.current
    if (!list) return
    const active = list.querySelector<HTMLElement>('[data-active="true"]')
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  return { activeIndex, hoverItem, moveActive, reset, listRef }
}
