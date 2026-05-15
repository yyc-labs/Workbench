import { useState, useRef } from 'react'
import { Copy, ExternalLink } from 'lucide-react'

interface UrlPopoverProps {
  urls: string[]
  children: React.ReactNode
}

export function UrlPopover({ urls, children }: UrlPopoverProps) {
  const [show, setShow] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  if (urls.length <= 1) return <>{children}</>

  const handleEnter = () => {
    clearTimeout(timerRef.current)
    setShow(true)
  }

  const handleLeave = () => {
    timerRef.current = setTimeout(() => setShow(false), 150)
  }

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {children}
      {show && (
        <div
          className="absolute top-full left-0 mt-1.5 z-50 bg-white rounded-xl shadow-lg border border-gray-200 py-1.5 px-1 min-w-[300px]"
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
      )}
    </div>
  )
}
