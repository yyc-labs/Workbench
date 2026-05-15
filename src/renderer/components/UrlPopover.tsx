import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink } from 'lucide-react'

interface UrlPopoverProps {
  urls: string[]
  children: React.ReactNode
}

export function UrlPopover({ urls, children }: UrlPopoverProps) {
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  if (urls.length <= 1) return <>{children}</>

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
      className="fixed z-[9999] rounded-xl py-1.5 px-1 min-w-[220px]"
      style={{
        top: pos.top,
        left: pos.left,
        background: 'var(--color-popover)',
        border: '1px solid var(--color-border)',
        boxShadow: '0 16px 40px rgba(0,0,0,0.24)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
      }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={(e) => e.stopPropagation()}
    >
      {urls.map((url) => (
        <div
          key={url}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg group/item hover:bg-[color:var(--color-accent)]/70"
        >
          <button
            className="flex-1 text-left text-xs text-primary hover:text-primary truncate flex items-center gap-1.5 min-w-0"
            onClick={() => window.electronAPI.openExternal(url)}
          >
            <ExternalLink className="w-3 h-3 shrink-0" />
            <span className="truncate">{url}</span>
          </button>
          <button
            className="shrink-0 opacity-0 group-hover/item:opacity-100 px-2 py-0.5 rounded text-[11px] text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)] transition-all"
            onClick={() => navigator.clipboard.writeText(url)}
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
