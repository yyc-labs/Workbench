import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Copy, ExternalLink } from 'lucide-react'

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
      className="fixed z-[9999] bg-white rounded-xl shadow-lg border border-gray-200 py-1.5 px-1 min-w-[300px]"
      style={{ top: pos.top, left: pos.left }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {urls.map((url) => (
        <div
          key={url}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-gray-50 group/item"
        >
          <button
            className="flex-1 text-left text-xs text-blue-600 hover:text-blue-800 truncate flex items-center gap-1.5 min-w-0"
            onClick={() => window.electronAPI.openExternal(url)}
          >
            <ExternalLink className="w-3 h-3 shrink-0" />
            <span className="truncate">{url}</span>
          </button>
          <button
            className="shrink-0 opacity-0 group-hover/item:opacity-100 px-2 py-0.5 rounded text-[11px] text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-all"
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
