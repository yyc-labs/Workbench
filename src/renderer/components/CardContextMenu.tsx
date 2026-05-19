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
          iconColorClass: 'text-[color:var(--color-destructive)]',
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
          iconColorClass: 'text-[color:var(--color-success)]',
        },
        {
          label: '停止项目',
          icon: <Square className="w-4 h-4" />,
          show: isDevRunning,
          action: onStopProject,
          iconColorClass: 'text-[color:var(--color-destructive)]',
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
      className="fixed z-[9998] min-w-[232px] rounded-[22px] p-2"
      style={{
        top: adjustedY,
        left: adjustedX,
        background: 'var(--color-popover)',
        border: '1px solid var(--color-border)',
        backdropFilter: 'saturate(180%) blur(28px)',
        WebkitBackdropFilter: 'saturate(180%) blur(28px)',
        boxShadow: 'var(--shadow-popover)',
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Status header */}
      <div className="quiet-control flex items-center gap-2 px-3 py-2.5 mb-1 rounded-[18px]">
        <span
          className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
            isRuntimeActive
              ? 'bg-[color:var(--color-success)]'
              : 'bg-[color:var(--color-muted-foreground)]'
          }`}
          style={
            isRuntimeActive
              ? { boxShadow: '0 0 8px color-mix(in srgb, var(--color-success) 48%, transparent)' }
              : undefined
          }
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
              className={`group w-full flex items-center gap-3 px-3 py-2.5 rounded-[16px] text-[13px] text-[color:var(--color-foreground)] transition-all duration-200 hover:bg-[color:var(--color-accent)]/70 ${
                item.primary
                  ? 'bg-primary/10 border border-primary/20 hover:bg-primary/15'
                  : ''
              } ${item.disabled ? 'opacity-60 cursor-not-allowed hover:bg-transparent' : ''}`}
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
