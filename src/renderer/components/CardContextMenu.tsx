import { useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  Play,
  Square,
  Terminal,
  RefreshCw,
  FolderOpen,
  Code2,
  Zap,
  Bot,
} from 'lucide-react'
import type { CliTool } from '../../shared/types'

interface CardContextMenuProps {
  x: number
  y: number
  onClose: () => void
  isRuntimeActive: boolean
  isDevRunning: boolean
  isOpeningTerminal: boolean
  currentCli: CliTool
  onStartRuntime: () => void | Promise<void>
  onStopRuntime: () => void | Promise<void>
  onOpenTerminal: () => void | Promise<void>
  onSwitchCli: () => void | Promise<void>
  onStartProject: () => void | Promise<void>
  onStopProject: () => void | Promise<void>
  onOpenFolder: () => void | Promise<void>
  onOpenVsCode: () => void | Promise<void>
}

interface MenuItem {
  label: string
  icon: React.ReactNode
  show: boolean
  action: () => void | Promise<void>
  primary?: boolean
  disabled?: boolean
  iconColorClass: string
}

interface MenuSection {
  title: string
  items: MenuItem[]
}

export function CardContextMenu({
  x,
  y,
  onClose,
  isRuntimeActive,
  isDevRunning,
  isOpeningTerminal,
  currentCli,
  onStartRuntime,
  onStopRuntime,
  onOpenTerminal,
  onSwitchCli,
  onStartProject,
  onStopProject,
  onOpenFolder,
  onOpenVsCode,
}: CardContextMenuProps) {
  const handleClick = useCallback(
    async (action: () => void | Promise<void>) => {
      await action()
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

  useEffect(() => {
    const timer = setTimeout(() => {
      const onClick = () => onClose()
      document.addEventListener('click', onClick)
      return () => document.removeEventListener('click', onClick)
    }, 0)
    return () => clearTimeout(timer)
  }, [onClose])

  const cliLabel = currentCli === 'codex' ? 'Codex' : 'Claude'

  const sections: MenuSection[] = [
    {
      title: 'Runtime',
      items: [
        {
          label: `启动 ${cliLabel}`,
          icon: <Zap className="w-4 h-4" />,
          show: !isRuntimeActive,
          action: onStartRuntime,
          primary: true,
          iconColorClass: 'text-primary',
        },
        {
          label: '打开 Terminal',
          icon: isOpeningTerminal
            ? <RefreshCw className="w-4 h-4 animate-spin" />
            : <Terminal className="w-4 h-4" />,
          show: isRuntimeActive,
          action: onOpenTerminal,
          disabled: isOpeningTerminal,
          iconColorClass: 'text-primary',
        },
        {
          label: '停止 Runtime',
          icon: <Square className="w-4 h-4" />,
          show: isRuntimeActive,
          action: onStopRuntime,
          iconColorClass: 'text-red-500',
        },
      ],
    },
    {
      title: 'Project',
      items: [
        {
          label: '启动项目',
          icon: <Play className="w-4 h-4" />,
          show: !isDevRunning,
          action: onStartProject,
          iconColorClass: 'text-emerald-500',
        },
        {
          label: '停止项目',
          icon: <Square className="w-4 h-4" />,
          show: isDevRunning,
          action: onStopProject,
          iconColorClass: 'text-red-500',
        },
      ],
    },
    {
      title: 'Workspace',
      items: [
        {
          label: '打开文件夹',
          icon: <FolderOpen className="w-4 h-4" />,
          show: true,
          action: onOpenFolder,
          iconColorClass: 'text-[color:var(--color-muted-foreground)]',
        },
        {
          label: '打开 VS Code',
          icon: <Code2 className="w-4 h-4" />,
          show: true,
          action: onOpenVsCode,
          iconColorClass: 'text-[color:var(--color-muted-foreground)]',
        },
      ],
    },
    {
      title: 'AI',
      items: [
        {
          label: `切换为 ${currentCli === 'codex' ? 'Claude' : 'Codex'}`,
          icon: <Bot className="w-4 h-4" />,
          show: true,
          action: onSwitchCli,
          iconColorClass: 'text-primary',
        },
      ],
    },
  ]

  const visibleSections = sections
    .map((s) => ({ ...s, items: s.items.filter((i) => i.show) }))
    .filter((s) => s.items.length > 0)

  const totalItemCount = visibleSections.reduce((acc, s) => acc + s.items.length, 0)

  const adjustedX = Math.min(x, window.innerWidth - 235)
  const adjustedY = Math.min(y, window.innerHeight - totalItemCount * 40 - visibleSections.length * 28 - 60)

  return createPortal(
    <div
      className="fixed z-[9998] min-w-[220px] rounded-2xl p-1.5"
      style={{
        top: adjustedY,
        left: adjustedX,
        background: 'var(--color-popover)',
        border: '1px solid var(--color-border)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        boxShadow: '0 14px 40px rgba(0, 0, 0, 0.35)',
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Status header */}
      <div className="flex items-center gap-2 px-3 py-2.5 mb-1 rounded-xl bg-[color:var(--color-accent)]/65 border border-[color:var(--color-border)]">
        <span
          className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
            isRuntimeActive ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]' : 'bg-[color:var(--color-muted-foreground)]'
          }`}
        />
        <span className="text-xs text-[color:var(--color-muted-foreground)]">
          {isRuntimeActive ? (
            <>
              <span className="text-[color:var(--color-foreground)] font-medium">{cliLabel}</span>
              <span> session running</span>
            </>
          ) : (
            'Runtime inactive'
          )}
        </span>
      </div>

      {/* Sections */}
      {visibleSections.map((section) => (
        <div key={section.title}>
          <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-[color:var(--color-muted-foreground)]">
            {section.title}
          </div>
          {section.items.map((item) => (
            <button
              key={item.label}
              disabled={item.disabled}
              className={`group w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] text-[color:var(--color-foreground)] transition-all duration-150 hover:bg-[color:var(--color-accent)]/70 hover:translate-x-0.5 ${
                item.primary
                  ? 'bg-primary/10 border border-primary/20 hover:bg-primary/15'
                  : ''
              } ${item.disabled ? 'opacity-60 cursor-not-allowed hover:translate-x-0 hover:bg-transparent' : ''}`}
              onClick={() => { void handleClick(item.action) }}
            >
              <span
                className={`${item.iconColorClass} ${
                  item.primary
                    ? ''
                    : 'group-hover:text-[color:var(--color-foreground)]'
                } transition-colors duration-150 flex-shrink-0`}
              >
                {item.icon}
              </span>
              <span className={item.primary ? 'text-primary font-medium' : ''}>
                {item.label}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>,
    document.body
  )
}
