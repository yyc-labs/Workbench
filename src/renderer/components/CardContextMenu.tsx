import { useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  Play,
  Square,
  Terminal,
  FolderOpen,
  Code2,
  Zap,
} from 'lucide-react'

interface CardContextMenuProps {
  x: number
  y: number
  onClose: () => void
  isRuntimeActive: boolean
  isDevRunning: boolean
  onStartRuntime: () => void
  onStopRuntime: () => void
  onOpenTerminal: () => void
  onStartProject: () => void
  onStopProject: () => void
  onOpenFolder: () => void
  onOpenVsCode: () => void
}

export function CardContextMenu({
  x,
  y,
  onClose,
  isRuntimeActive,
  isDevRunning,
  onStartRuntime,
  onStopRuntime,
  onOpenTerminal,
  onStartProject,
  onStopProject,
  onOpenFolder,
  onOpenVsCode,
}: CardContextMenuProps) {
  const handleClick = useCallback(
    (action: () => void) => {
      action()
      onClose()
    },
    [onClose]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Click outside
  useEffect(() => {
    const timer = setTimeout(() => {
      const onClick = () => onClose()
      document.addEventListener('click', onClick)
      return () => document.removeEventListener('click', onClick)
    }, 0)
    return () => clearTimeout(timer)
  }, [onClose])

  const items: { label: string; icon: React.ReactNode; show: boolean; action: () => void }[] = [
    {
      label: '启动 Runtime',
      icon: <Zap className="w-3.5 h-3.5" />,
      show: !isRuntimeActive,
      action: onStartRuntime,
    },
    {
      label: '打开 Terminal',
      icon: <Terminal className="w-3.5 h-3.5" />,
      show: isRuntimeActive,
      action: onOpenTerminal,
    },
    {
      label: '停止 Runtime',
      icon: <Square className="w-3.5 h-3.5" />,
      show: isRuntimeActive,
      action: onStopRuntime,
    },
    {
      label: '启动项目',
      icon: <Play className="w-3.5 h-3.5" />,
      show: !isDevRunning,
      action: onStartProject,
    },
    {
      label: '停止项目',
      icon: <Square className="w-3.5 h-3.5" />,
      show: isDevRunning,
      action: onStopProject,
    },
    {
      label: '打开文件夹',
      icon: <FolderOpen className="w-3.5 h-3.5" />,
      show: true,
      action: onOpenFolder,
    },
    {
      label: '打开 VS Code',
      icon: <Code2 className="w-3.5 h-3.5" />,
      show: true,
      action: onOpenVsCode,
    },
  ]

  // Adjust position so menu doesn't overflow viewport
  const adjustedX = Math.min(x, window.innerWidth - 200)
  const adjustedY = Math.min(y, window.innerHeight - items.filter((i) => i.show).length * 36 - 16)

  return createPortal(
    <div
      className="fixed z-[9998] bg-white rounded-xl shadow-lg border border-gray-200 py-1.5 px-1 min-w-[180px]"
      style={{ top: adjustedY, left: adjustedX }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items
        .filter((i) => i.show)
        .map((item) => (
          <button
            key={item.label}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            onClick={() => handleClick(item.action)}
          >
            <span className="text-gray-400">{item.icon}</span>
            {item.label}
          </button>
        ))}
    </div>,
    document.body
  )
}
