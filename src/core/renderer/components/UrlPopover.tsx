import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink } from 'lucide-react'

interface UrlPopoverProps {
  urls?: string[]
  items?: { url: string; label: string }[]
  children: React.ReactNode
}

function isFuzzySubsequence(query: string, candidate: string): boolean {
  if (!query) return true
  let queryIndex = 0
  for (let i = 0; i < candidate.length && queryIndex < query.length; i += 1) {
    if (candidate[i] === query[queryIndex]) {
      queryIndex += 1
    }
  }
  return queryIndex === query.length
}

export function UrlPopover({ urls, items, children }: UrlPopoverProps) {
  const [show, setShow] = useState(false)
  const [layout, setLayout] = useState({ top: 0, left: 0, maxHeight: 320 })
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const triggerRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const entries = useMemo(
    () => (
      items && items.length > 0
        ? items
        : (urls ?? []).map((url) => ({ url, label: url }))
    ),
    [items, urls]
  )
  const hasPopover = entries.length > 1
  const normalizedQuery = query.trim().toLowerCase()
  const filteredEntries = useMemo(() => {
    if (!normalizedQuery) return entries

    return entries.filter((entry) => {
      const label = entry.label.toLowerCase()
      const url = entry.url.toLowerCase()
      const text = `${label} ${url}`
      if (text.includes(normalizedQuery)) return true
      return (
        isFuzzySubsequence(normalizedQuery, label)
        || isFuzzySubsequence(normalizedQuery, url)
      )
    })
  }, [entries, normalizedQuery])

  const updatePos = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      const viewportPadding = 12
      const triggerGap = 6
      const minVisibleHeight = 140
      const maxPopoverHeight = 420
      const minPopoverWidth = 220

      const preferredTop = rect.bottom + triggerGap
      const highestTopForMinHeight = window.innerHeight - viewportPadding - minVisibleHeight
      const top = Math.max(viewportPadding, Math.min(preferredTop, highestTopForMinHeight))
      const availableHeight = window.innerHeight - top - viewportPadding
      const maxHeight = Math.max(96, Math.min(maxPopoverHeight, availableHeight))
      const left = Math.max(
        viewportPadding,
        Math.min(rect.left, window.innerWidth - viewportPadding - minPopoverWidth),
      )

      setLayout({ top, left, maxHeight })
    }
  }

  const handleEnter = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    updatePos()
    setShow(true)
  }

  const handleLeave = () => {
    timerRef.current = setTimeout(() => {
      setShow(false)
    }, 150)
  }

  const handleCopy = (key: string, url: string) => {
    void navigator.clipboard.writeText(url)
    setCopiedKey(key)
    if (copiedTimerRef.current) {
      clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = null
    }
    copiedTimerRef.current = setTimeout(() => {
      setCopiedKey((current) => (current === key ? null : current))
    }, 700)
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!show) {
      setQuery('')
      setCopiedKey(null)
    }
  }, [show])

  if (!hasPopover) return <>{children}</>

  const popover = show && (
    <div
      className="fixed z-[9999] min-w-[220px] overflow-y-auto rounded-[20px] px-1.5 py-2"
      style={{
        top: layout.top,
        left: layout.left,
        maxHeight: layout.maxHeight,
        background: 'var(--color-popover)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-popover)',
        backdropFilter: 'saturate(165%) blur(22px)',
        WebkitBackdropFilter: 'saturate(165%) blur(22px)',
        overscrollBehavior: 'contain',
      }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="sticky top-0 z-[1] px-1.5 pb-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              setQuery('')
            }
          }}
          placeholder="输入关键字模糊筛选链接"
          className="quiet-control h-8 w-full rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)]"
        />
      </div>

      {filteredEntries.length === 0 ? (
        <div className="px-3 py-3 text-xs text-[color:var(--color-muted-foreground)]">
          没有匹配的链接
        </div>
      ) : (
        filteredEntries.map((entry) => {
          const key = `${entry.label}:${entry.url}`
          const isCopied = copiedKey === key
          return (
            <div
              key={key}
              className="group/item flex cursor-pointer items-center gap-1.5 rounded-[14px] px-2.5 py-2 hover:bg-[color:var(--color-accent)]/70"
              role="button"
              tabIndex={0}
              onClick={() => window.electronAPI.openExternal(entry.url)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  window.electronAPI.openExternal(entry.url)
                }
              }}
              title={entry.url}
            >
              <div className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left text-xs text-[color:var(--color-foreground)]/88 transition-colors hover:text-[color:var(--color-foreground)]">
                <ExternalLink className="h-3 w-3 shrink-0 text-[color:var(--color-muted-foreground)]" />
                <span className="truncate">{entry.label}</span>
              </div>
              <button
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] opacity-0 transition-all duration-300 group-hover/item:opacity-100 cursor-pointer active:scale-95 ${
                  isCopied
                    ? 'scale-105 bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]'
                    : 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
                }`}
                onClick={(e) => {
                  e.stopPropagation()
                  handleCopy(key, entry.url)
                }}
              >
                {isCopied ? '已复制' : '复制'}
              </button>
            </div>
          )
        })
      )}
    </div>
  )

  return (
    <div
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {children}
      {createPortal(popover, document.body)}
    </div>
  )
}
