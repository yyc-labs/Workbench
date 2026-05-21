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
  Pin,
  Trash2,
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
  isPinned?: boolean
  onStartRuntime: () => void | Promise<void>
  onStopRuntime: () => void | Promise<void>
  onOpenTerminal: () => void | Promise<void>
  onSwitchCli: () => void | Promise<void>
  onStartProject: () => void | Promise<void>
  onStopProject: () => void | Promise<void>
  onOpenFolder: () => void | Promise<void>
  onOpenPathTerminal: () => void | Promise<void>
  onOpenVsCode: () => void | Promise<void>
  onTogglePin?: () => void | Promise<void>
  onEditMetadata?: () => void | Promise<void>
  onRemoveProject?: () => void | Promise<void>
}

type MenuTone = 'default' | 'primary' | 'success' | 'warning' | 'danger'

interface MenuAction {
  label: string
  caption?: string
  icon: React.ReactNode
  show?: boolean
  action: () => void | Promise<void>
  disabled?: boolean
  tone?: MenuTone
}

function getIconToneClass(tone: MenuTone = 'default') {
  switch (tone) {
    case 'primary':
      return 'text-primary'
    case 'success':
      return 'text-[color:var(--color-success)]'
    case 'warning':
      return 'text-[color:var(--color-warning)]'
    case 'danger':
      return 'text-[color:var(--color-destructive)]'
    default:
      return 'text-[color:var(--color-muted-foreground)] group-hover:text-[color:var(--color-foreground)]'
  }
}

function getPrimaryActionClass(tone: MenuTone = 'default') {
  switch (tone) {
    case 'primary':
      return 'bg-primary/10 text-primary hover:bg-primary/15'
    case 'success':
      return 'bg-[color:var(--color-success-background)] text-[color:var(--color-success)] hover:bg-[color:var(--color-success-background)]/80'
    case 'danger':
      return 'bg-[color:var(--color-destructive-background)] text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-background)]/80'
    default:
      return 'bg-[color:var(--color-card)]/70 text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]/75'
  }
}

function getToneBorderColor(tone: MenuTone = 'default') {
  switch (tone) {
    case 'primary':
      return 'color-mix(in srgb, var(--color-primary) 26%, transparent)'
    case 'success':
      return 'color-mix(in srgb, var(--color-success) 28%, transparent)'
    case 'warning':
      return 'color-mix(in srgb, var(--color-warning) 28%, transparent)'
    case 'danger':
      return 'color-mix(in srgb, var(--color-destructive) 28%, transparent)'
    default:
      return 'color-mix(in srgb, var(--color-border) 82%, transparent)'
  }
}

export function CardContextMenu({
  x,
  y,
  onClose,
  isRuntimeActive,
  isDevRunning,
  isOpeningTerminal,
  currentCli,
  isPinned,
  onStartRuntime,
  onStopRuntime,
  onOpenTerminal,
  onSwitchCli,
  onStartProject,
  onStopProject,
  onOpenFolder,
  onOpenPathTerminal,
  onOpenVsCode,
  onTogglePin,
  onEditMetadata,
  onRemoveProject,
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
    const onPointerDown = () => onClose()
    const timer = window.setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [onClose])

  const cliLabel = currentCli === 'codex' ? 'Codex' : 'Claude'
  const runtimeStatusLabel = isRuntimeActive ? `${cliLabel} Runtime 已连接` : 'Runtime 未连接'
  const devStatusLabel = isDevRunning ? 'Dev running' : 'Dev stopped'

  const primaryActions: MenuAction[] = [
    {
      label: isRuntimeActive ? 'Runtime 终端' : `启动 ${cliLabel}`,
      caption: isRuntimeActive ? (isOpeningTerminal ? '正在打开...' : '进入会话') : '连接 AI 运行时',
      icon: isRuntimeActive
        ? isOpeningTerminal
          ? <RefreshCw className="h-4 w-4 animate-spin" />
          : <Terminal className="h-4 w-4" />
        : <Zap className="h-4 w-4" />,
      action: isRuntimeActive ? onOpenTerminal : onStartRuntime,
      disabled: isRuntimeActive && isOpeningTerminal,
      tone: 'primary',
    },
    {
      label: isDevRunning ? '停止项目' : '启动项目',
      caption: isDevRunning ? '结束 dev 进程' : '运行开发服务',
      icon: isDevRunning ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />,
      action: isDevRunning ? onStopProject : onStartProject,
      tone: isDevRunning ? 'danger' : 'success',
    },
  ]

  const openActions: MenuAction[] = [
    {
      label: '文件夹',
      caption: '浏览',
      icon: <FolderOpen className="h-4 w-4" />,
      action: onOpenFolder,
      tone: 'default',
    },
    {
      label: '终端',
      caption: '当前路径',
      icon: <Terminal className="h-4 w-4" />,
      action: onOpenPathTerminal,
      tone: 'primary',
    },
    {
      label: 'VS Code',
      caption: '编辑',
      icon: <Code2 className="h-4 w-4" />,
      action: onOpenVsCode,
      tone: 'success',
    },
  ]

  const utilityActionItems: MenuAction[] = [
    {
      label: `切到 ${currentCli === 'codex' ? 'Claude' : 'Codex'}`,
      icon: <Bot className="h-3.5 w-3.5" />,
      action: onSwitchCli,
      tone: 'primary',
    },
    {
      label: isPinned ? '取消固定' : '固定项目',
      icon: <Pin className="h-3.5 w-3.5" />,
      show: Boolean(onTogglePin),
      action: onTogglePin ?? (() => undefined),
      tone: isPinned ? 'warning' : 'default',
    },
    {
      label: '分类标签',
      icon: <FolderOpen className="h-3.5 w-3.5" />,
      show: Boolean(onEditMetadata),
      action: onEditMetadata ?? (() => undefined),
      tone: 'default',
    },
  ]
  const utilityActions = utilityActionItems.filter((item) => item.show !== false)

  const dangerActionItems: MenuAction[] = [
    {
      label: '停止 Runtime',
      icon: <Square className="h-3.5 w-3.5" />,
      show: isRuntimeActive,
      action: onStopRuntime,
      tone: 'danger',
    },
    {
      label: '移除项目',
      icon: <Trash2 className="h-3.5 w-3.5" />,
      show: Boolean(onRemoveProject),
      action: onRemoveProject ?? (() => undefined),
      tone: 'danger',
    },
  ]
  const dangerActions = dangerActionItems.filter((item) => item.show !== false)

  const viewportPadding = 10
  const menuWidth = Math.min(372, Math.max(300, window.innerWidth - viewportPadding * 2))
  const estimatedMenuHeight = 218 + (utilityActions.length > 0 ? 44 : 0) + (dangerActions.length > 0 ? 44 : 0)
  const menuLeft = Math.min(
    Math.max(viewportPadding, x),
    Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding)
  )
  const menuTop = Math.min(
    Math.max(viewportPadding, y),
    Math.max(viewportPadding, window.innerHeight - estimatedMenuHeight - viewportPadding)
  )

  return createPortal(
    <div
      className="card-enter fixed z-[9998] rounded-[24px] p-2"
      style={{
        top: menuTop,
        left: menuLeft,
        width: menuWidth,
        background:
          'linear-gradient(180deg, color-mix(in srgb, var(--color-popover) 96%, var(--color-primary) 4%) 0%, var(--color-popover) 100%)',
        border: '1px solid var(--color-border)',
        backdropFilter: 'saturate(170%) blur(24px)',
        WebkitBackdropFilter: 'saturate(170%) blur(24px)',
        boxShadow: 'var(--shadow-popover)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="relative overflow-hidden rounded-[18px] border px-3 py-2.5"
        style={{
          borderColor: 'color-mix(in srgb, var(--color-border) 84%, transparent)',
          // background:
          //   'linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 12%, transparent), color-mix(in srgb, var(--color-card) 92%, transparent))',
        }}
      >
        <div
          className="pointer-events-none absolute -right-6 -top-8 h-20 w-20 rounded-full blur-2xl"
          style={{ background: 'color-mix(in srgb, var(--color-primary) 20%, transparent)' }}
        />
        <div className="relative flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">
              Project actions
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs font-medium text-[color:var(--color-foreground)]">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  isRuntimeActive ? 'bg-[color:var(--color-success)]' : 'bg-[color:var(--color-muted-foreground)]/55'
                }`}
              />
              <span className="truncate">{runtimeStatusLabel}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-[10px] font-medium text-primary">
              {cliLabel}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] ${
                isDevRunning
                  ? 'bg-[color:var(--color-success-background)] text-[color:var(--color-success)]'
                  : 'bg-[color:var(--color-secondary)] text-[color:var(--color-muted-foreground)]'
              }`}
            >
              {devStatusLabel}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {primaryActions.map((item) => (
          <button
            key={item.label}
            disabled={item.disabled}
            className={`group min-w-0 rounded-[17px] border px-3 py-2.5 text-left transition-colors ${getPrimaryActionClass(
              item.tone
            )} ${item.disabled ? 'cursor-not-allowed opacity-60 hover:bg-transparent' : ''}`}
            style={{ borderColor: getToneBorderColor(item.tone) }}
            onClick={() => { void handleClick(item.action) }}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] bg-[color:var(--color-card)]/80">
                {item.icon}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold tracking-[-0.01em]">{item.label}</span>
                <span className="mt-0.5 block truncate text-[10px] font-normal opacity-70">{item.caption}</span>
              </span>
            </span>
          </button>
        ))}
      </div>

      <div
        className="mt-2 grid grid-cols-3 gap-1.5 rounded-[18px] border p-1.5"
        style={{
          borderColor: 'color-mix(in srgb, var(--color-border) 78%, transparent)',
          background: 'color-mix(in srgb, var(--color-background-sunken) 34%, transparent)',
        }}
      >
        {openActions.map((item) => (
          <button
            key={item.label}
            className="group min-w-0 rounded-[13px] px-2 py-2 text-left transition-colors hover:bg-[color:var(--color-accent)]/75"
            onClick={() => { void handleClick(item.action) }}
          >
            <span className={`inline-flex h-6 w-6 items-center justify-center rounded-md bg-[color:var(--color-accent)] ${getIconToneClass(item.tone)}`}>
              {item.icon}
            </span>
            <span className="mt-1 block truncate text-[11px] font-medium text-[color:var(--color-foreground)]">
              {item.label}
            </span>
            <span className="mt-0.5 block truncate text-[10px] text-[color:var(--color-muted-foreground)]">
              {item.caption}
            </span>
          </button>
        ))}
      </div>

      {utilityActions.length > 0 && (
        <div
          className="mt-2 grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${utilityActions.length}, minmax(0, 1fr))` }}
        >
          {utilityActions.map((item) => (
            <button
              key={item.label}
              className="group flex min-w-0 items-center justify-center gap-1.5 rounded-[14px] px-2.5 py-2 text-[12px] font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)]/70 hover:text-[color:var(--color-foreground)]"
              onClick={() => { void handleClick(item.action) }}
            >
              <span className={`shrink-0 ${getIconToneClass(item.tone)}`}>{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      )}

      {dangerActions.length > 0 && (
        <div
          className="mt-2 grid gap-1.5 border-t border-[color:var(--color-border)] pt-2"
          style={{ gridTemplateColumns: `repeat(${dangerActions.length}, minmax(0, 1fr))` }}
        >
          {dangerActions.map((item) => (
            <button
              key={item.label}
              className="group flex min-w-0 items-center justify-center gap-1.5 rounded-[14px] px-2.5 py-2 text-[12px] font-medium text-[color:var(--color-destructive)] transition-colors hover:bg-[color:var(--color-destructive-background)]"
              onClick={() => { void handleClick(item.action) }}
            >
              <span className="shrink-0">{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body
  )
}
