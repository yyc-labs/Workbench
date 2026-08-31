import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useI18n } from '../../i18n'
import { fileNameFromRelativePath } from './code.markdownShared'

type QuickDrawerTabsCardProps = {
  openTabs: string[]
  activeRelativePath: string | null
  onOpenFile: (relativePath: string) => void
  onCloseTab: (relativePath: string) => void
  children: ReactNode
}

const VIEWPORT_PADDING = 12
const TRIGGER_GAP = 6
const HIDE_DELAY_MS = 150
const CARD_WIDTH = 280
const CARD_MAX_HEIGHT = 320

function QuickDrawerTabsCard({ openTabs, activeRelativePath, onOpenFile, onCloseTab, children }: QuickDrawerTabsCardProps) {
  const { t } = useI18n()
  const [show, setShow] = useState(false)
  const [layout, setLayout] = useState({ top: 0, left: 0, width: CARD_WIDTH, maxHeight: CARD_MAX_HEIGHT })
  const [activeIndex, setActiveIndex] = useState(-1)
  const triggerRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Array<HTMLDivElement | null>>([])
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverStateRef = useRef({ trigger: false, card: false })

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  const isWithinCardArea = useCallback((target: EventTarget | null) => {
    return target instanceof Node && Boolean(triggerRef.current?.contains(target) || cardRef.current?.contains(target))
  }, [])

  const scheduleHide = useCallback(() => {
    clearHideTimer()
    hideTimerRef.current = setTimeout(() => {
      if (hoverStateRef.current.trigger || hoverStateRef.current.card) return
      setShow(false)
    }, HIDE_DELAY_MS)
  }, [clearHideTimer])

  const updateLayout = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(CARD_WIDTH, window.innerWidth - VIEWPORT_PADDING * 2)
    const top = Math.max(VIEWPORT_PADDING, Math.min(rect.bottom + TRIGGER_GAP, window.innerHeight - VIEWPORT_PADDING - 120))
    const maxHeight = Math.max(96, Math.min(CARD_MAX_HEIGHT, window.innerHeight - top - VIEWPORT_PADDING))
    const left = Math.max(VIEWPORT_PADDING, Math.min(rect.left, window.innerWidth - VIEWPORT_PADDING - width))
    setLayout((prev) => (prev.top === top && prev.left === left && prev.width === width && prev.maxHeight === maxHeight ? prev : { top, left, width, maxHeight }))
  }, [])

  const handleTriggerEnter = useCallback(() => {
    hoverStateRef.current.trigger = true
    clearHideTimer()
    if (openTabs.length === 0) return
    updateLayout()
    const activeIdx = activeRelativePath ? openTabs.indexOf(activeRelativePath) : -1
    setActiveIndex(activeIdx >= 0 ? activeIdx : 0)
    setShow(true)
  }, [activeRelativePath, clearHideTimer, openTabs, updateLayout])

  const handleTriggerLeave = (event: ReactMouseEvent<HTMLDivElement>) => {
    hoverStateRef.current.trigger = false
    if (isWithinCardArea(event.relatedTarget)) return
    scheduleHide()
  }

  const handleCardEnter = () => {
    hoverStateRef.current.card = true
    clearHideTimer()
  }

  const handleCardLeave = (event: ReactMouseEvent<HTMLDivElement>) => {
    hoverStateRef.current.card = false
    if (isWithinCardArea(event.relatedTarget)) return
    scheduleHide()
  }

  const openTab = useCallback(
    (path: string) => {
      setShow(false)
      onOpenFile(path)
    },
    [onOpenFile],
  )

  useEffect(() => {
    if (!show) {
      hoverStateRef.current = { trigger: false, card: false }
      return
    }
    if (openTabs.length === 0) {
      setShow(false)
    }
  }, [openTabs.length, show])

  useEffect(() => {
    setActiveIndex((prev) => {
      if (openTabs.length === 0) return -1
      if (prev >= 0 && prev < openTabs.length) return prev
      const idx = activeRelativePath ? openTabs.indexOf(activeRelativePath) : -1
      return idx >= 0 ? idx : 0
    })
  }, [activeRelativePath, openTabs])

  useEffect(() => {
    if (!show || activeIndex < 0) return
    itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, show])

  useEffect(() => {
    if (!show) return

    const handleReposition = () => {
      updateLayout()
    }

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (isWithinCardArea(event.target)) return
      setShow(false)
    }

    window.addEventListener('resize', handleReposition)
    window.addEventListener('scroll', handleReposition, true)
    window.addEventListener('mousedown', handlePointerDown)
    return () => {
      window.removeEventListener('resize', handleReposition)
      window.removeEventListener('scroll', handleReposition, true)
      window.removeEventListener('mousedown', handlePointerDown)
    }
  }, [isWithinCardArea, show, updateLayout])

  useEffect(() => {
    if (!show) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShow(false)
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((prev) => {
          if (openTabs.length === 0) return -1
          const delta = event.key === 'ArrowDown' ? 1 : -1
          const start = prev < 0 ? 0 : prev
          return (start + delta + openTabs.length) % openTabs.length
        })
        return
      }
      if (event.key === 'Enter') {
        if (event.target instanceof Node && cardRef.current?.contains(event.target)) return
        const path = openTabs[activeIndex]
        if (!path) return
        event.preventDefault()
        openTab(path)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [activeIndex, openTab, openTabs, show])

  useEffect(() => {
    return () => {
      clearHideTimer()
    }
  }, [clearHideTimer])

  return (
    <div ref={triggerRef} className="relative inline-flex" onMouseEnter={handleTriggerEnter} onMouseLeave={handleTriggerLeave}>
      {children}
      {show && openTabs.length > 0
        ? createPortal(
            <div
              ref={cardRef}
              className="fixed overflow-hidden rounded-[16px]"
              style={{
                top: layout.top,
                left: layout.left,
                width: layout.width,
                maxHeight: layout.maxHeight,
                zIndex: 9999,
                background: 'var(--color-popover)',
                border: '1px solid var(--color-border)',
                boxShadow: 'var(--shadow-popover)',
                backdropFilter: 'saturate(145%) blur(14px)',
                WebkitBackdropFilter: 'saturate(145%) blur(14px)',
              }}
              role="listbox"
              aria-label={t('codeWorkspace.quickFileDrawer')}
              onMouseEnter={handleCardEnter}
              onMouseLeave={handleCardLeave}
              onPointerDown={(event) => {
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
              }}
            >
              <div className="flex flex-col gap-1 overflow-y-auto p-1.5" style={{ maxHeight: layout.maxHeight, overscrollBehavior: 'contain' }}>
                {openTabs.map((path, index) => {
                  const isCurrent = activeRelativePath === path
                  const isKeyActive = index === activeIndex
                  return (
                    <div
                      key={path}
                      ref={(node) => {
                        itemRefs.current[index] = node
                      }}
                      role="option"
                      aria-selected={isCurrent}
                      aria-current={isKeyActive || undefined}
                      tabIndex={-1}
                      className={`code-open-tab ${isCurrent ? 'is-active' : ''} ${isKeyActive ? 'is-key-active' : ''}`}
                      onClick={() => {
                        openTab(path)
                      }}
                      onMouseEnter={() => {
                        setActiveIndex(index)
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        event.stopPropagation()
                        openTab(path)
                      }}
                    >
                      <span className="code-open-tab-label">{fileNameFromRelativePath(path)}</span>
                      <span className="code-open-tab-path">{path}</span>
                      <span
                        role="button"
                        tabIndex={0}
                        className="code-open-tab-close"
                        aria-label={t('codeWorkspace.closeTab', { path })}
                        onClick={(event) => {
                          event.stopPropagation()
                          onCloseTab(path)
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return
                          event.preventDefault()
                          event.stopPropagation()
                          onCloseTab(path)
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

export { QuickDrawerTabsCard }
