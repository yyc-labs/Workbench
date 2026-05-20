import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink } from 'lucide-react'

interface UrlPopoverProps {
  urls?: string[]
  items?: { url: string; label: string }[]
  children: React.ReactNode
}

export function UrlPopover({ urls, items, children }: UrlPopoverProps) {
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const entries = items && items.length > 0
    ? items
    : (urls ?? []).map((url) => ({ url, label: url }))

  if (entries.length <= 1) return <>{children}</>

  const updatePos = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 6, left: rect.left })
    }
  }

  const handleEnter = () => {
    clearTimeout(timerRef.current)
    updatePos()
    setShow(true)
  }

  const handleLeave = () => {
    timerRef.current = setTimeout(() => setShow(false), 150)
  }

  const popover = show && (
    <div
      className="fixed z-[9999] rounded-[20px] py-2 px-1.5 min-w-[220px]"
      style={{
        top: pos.top,
        left: pos.left,
        background: 'var(--color-popover)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-popover)',
        backdropFilter: 'saturate(165%) blur(22px)',
        WebkitBackdropFilter: 'saturate(165%) blur(22px)',
      }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={(e) => e.stopPropagation()}
    >
      {entries.map((entry) => (
        <div
          key={`${entry.label}:${entry.url}`}
          className="group/item flex items-center gap-1.5 rounded-[14px] px-2.5 py-2 hover:bg-[color:var(--color-accent)]/70"
        >
          <button
            className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left text-xs text-[color:var(--color-foreground)]/88 transition-colors hover:text-[color:var(--color-foreground)] cursor-pointer"
            onClick={() => window.electronAPI.openExternal(entry.url)}
            title={entry.url}
          >
            <ExternalLink className="h-3 w-3 shrink-0 text-[color:var(--color-muted-foreground)]" />
            <span className="truncate">{entry.label}</span>
          </button>
          <button
            className="shrink-0 rounded-full px-2 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)] opacity-0 transition-all hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] group-hover/item:opacity-100 cursor-pointer"
            onClick={() => navigator.clipboard.writeText(entry.url)}
          >
            复制
          </button>
        </div>
      ))}
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
