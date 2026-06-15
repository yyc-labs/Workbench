import { useEffect, useCallback, useState } from 'react'
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
import { useI18n } from '../i18n'

interface CardContextMenuProps {
  x: number
  y: number
  onClose: () => void
  isRuntimeActive: boolean
  usesTmuxRuntime: boolean
  isDevRunning: boolean
  isDevStopping: boolean
  isOpeningTerminal: boolean
  currentCli: CliTool
  isPinned?: boolean
  onStartRuntime: () => void | Promise<unknown>
  onStopRuntime: () => void | Promise<unknown>
  onOpenTerminal: () => void | Promise<unknown>
  onSwitchCli: () => void | Promise<unknown>
  onStartProject: () => void | Promise<unknown>
  onStopProject: () => void | Promise<unknown>
  onAiAutoCommit?: () => void | Promise<unknown>
  aiCommitStatus?: 'idle' | 'running' | 'success' | 'error'
  onOpenFolder: () => void | Promise<unknown>
  onOpenPathTerminal: () => void | Promise<unknown>
  onOpenVsCode: () => void | Promise<unknown>
  onTogglePin?: () => void | Promise<unknown>
  onEditMetadata?: () => void | Promise<unknown>
  onRemoveProject?: () => void | Promise<unknown>
}

type MenuTone = 'default' | 'primary' | 'success' | 'warning' | 'danger'

interface MenuAction {
  label: string
  caption?: string
  icon: React.ReactNode
  show?: boolean
  action: () => void | Promise<unknown>
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

function getClampedMenuPosition({
  x,
  y,
  menuWidth,
  menuHeight,
  viewportPadding,
  pointerGap,
}: {
  x: number
  y: number
  menuWidth: number
  menuHeight: number
  viewportPadding: number
  pointerGap: number
}) {
  const maxLeft = Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding)
  const menuLeft = Math.min(Math.max(viewportPadding, x), maxLeft)
  const spaceBelow = window.innerHeight - y - viewportPadding - pointerGap
  const spaceAbove = y - viewportPadding - pointerGap
  const opensUpward = spaceBelow < menuHeight && spaceAbove > spaceBelow
  const preferredTop = opensUpward ? y - menuHeight - pointerGap : y + pointerGap
  const maxTop = Math.max(viewportPadding, window.innerHeight - menuHeight - viewportPadding)
  const menuTop = Math.min(Math.max(viewportPadding, preferredTop), maxTop)

  return { menuLeft, menuTop, opensUpward }
}

export function CardContextMenu({
  x,
  y,
  onClose,
  isRuntimeActive,
  usesTmuxRuntime,
  isDevRunning,
  isDevStopping,
  isOpeningTerminal,
  currentCli,
  isPinned,
  onStartRuntime,
  onStopRuntime,
  onOpenTerminal,
  onSwitchCli,
  onStartProject,
  onStopProject,
  onAiAutoCommit,
  aiCommitStatus = 'idle',
  onOpenFolder,
  onOpenPathTerminal,
  onOpenVsCode,
  onTogglePin,
  onEditMetadata,
  onRemoveProject,
}: CardContextMenuProps) {
  const { t } = useI18n()
  const [actionError, setActionError] = useState<string | null>(null)

  const handleClick = useCallback(
    async (action: () => void | Promise<unknown>) => {
      setActionError(null)
      try {
        await action()
        onClose()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setActionError(message || 'Action failed')
      }
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
  const runtimeStatusLabel = isRuntimeActive ? `${cliLabel} ${t('common.runtime')} · ${t('common.active')}` : `${t('common.runtime')} · ${t('common.offline')}`
  const devStatusLabel = isDevStopping ? `${t('common.dev')} ${t('common.stopping')}` : isDevRunning ? `${t('common.dev')} ${t('common.running')}` : `${t('common.dev')} ${t('common.offline')}`
  const runtimeActionLabel = usesTmuxRuntime ? t('common.runtimeTerminal') : t('common.runtimeLaunch')
  const runtimeActionCaption = isRuntimeActive
    ? (isOpeningTerminal ? t('common.opening') : (usesTmuxRuntime ? t('common.openSession') : t('common.openTerminalLaunch')))
    : t('common.connectAiRuntime')

  const primaryActionItems: MenuAction[] = [
    {
      label: isRuntimeActive ? runtimeActionLabel : `${t('common.run')} ${cliLabel}`,
      caption: runtimeActionCaption,
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
      label: isDevStopping ? t('common.stopping') : isDevRunning ? t('common.stopProject') : t('common.startProject'),
      caption: isDevStopping ? t('common.waitForExit') : isDevRunning ? t('common.terminateDevProcess') : t('common.runDevService'),
      icon: isDevStopping
        ? <RefreshCw className="h-4 w-4 animate-spin" />
        : isDevRunning
          ? <Square className="h-4 w-4" />
          : <Play className="h-4 w-4" />,
      action: isDevRunning || isDevStopping ? onStopProject : onStartProject,
      disabled: isDevStopping,
      tone: isDevRunning || isDevStopping ? 'danger' : 'success',
    },
    {
      label: aiCommitStatus === 'running' ? `AI ${t('common.stopping')}` : t('common.aiAutoCommit'),
      caption: t('common.defaultParams'),
      icon: aiCommitStatus === 'running'
        ? <RefreshCw className="h-4 w-4 animate-spin" />
        : <Bot className="h-4 w-4" />,
      show: Boolean(onAiAutoCommit),
      action: onAiAutoCommit ?? (() => undefined),
      disabled: aiCommitStatus === 'running',
      tone: aiCommitStatus === 'error' ? 'danger' : 'default',
    },
  ]
  const primaryActions = primaryActionItems.filter((item) => item.show !== false)

  const openActions: MenuAction[] = [
    {
      label: t('common.folder'),
      caption: t('common.browse'),
      icon: <FolderOpen className="h-4 w-4" />,
      action: onOpenFolder,
      tone: 'default',
    },
    {
      label: t('common.terminal'),
      caption: t('common.currentPath'),
      icon: <Terminal className="h-4 w-4" />,
      action: onOpenPathTerminal,
      tone: 'primary',
    },
    {
      label: 'VS Code',
      caption: t('common.edit'),
      icon: <Code2 className="h-4 w-4" />,
      action: onOpenVsCode,
      tone: 'success',
    },
  ]

  const utilityActionItems: MenuAction[] = [
    {
      label: currentCli === 'codex' ? t('common.switchToClaude') : t('common.switchToCodex'),
      icon: <Bot className="h-3.5 w-3.5" />,
      action: onSwitchCli,
      tone: 'primary',
    },
    {
      label: isPinned ? t('common.unpinProject') : t('common.pinProject'),
      icon: <Pin className="h-3.5 w-3.5" />,
      show: Boolean(onTogglePin),
      action: onTogglePin ?? (() => undefined),
      tone: isPinned ? 'warning' : 'default',
    },
    {
      label: t('common.classificationTags'),
      icon: <FolderOpen className="h-3.5 w-3.5" />,
      show: Boolean(onEditMetadata),
      action: onEditMetadata ?? (() => undefined),
      tone: 'default',
    },
  ]
  const utilityActions = utilityActionItems.filter((item) => item.show !== false)

  const dangerActionItems: MenuAction[] = [
    {
      label: t('common.stopRuntime'),
      icon: <Square className="h-3.5 w-3.5" />,
      show: isRuntimeActive,
      action: onStopRuntime,
      tone: 'danger',
    },
    {
      label: t('common.removeProject'),
      icon: <Trash2 className="h-3.5 w-3.5" />,
      show: Boolean(onRemoveProject),
      action: onRemoveProject ?? (() => undefined),
      tone: 'danger',
    },
  ]
  const dangerActions = dangerActionItems.filter((item) => item.show !== false)

  const viewportPadding = 10
  const pointerGap = 8
  const menuWidth = Math.min(372, Math.max(300, window.innerWidth - viewportPadding * 2))
  const estimatedMenuHeight = 218 + (utilityActions.length > 0 ? 44 : 0) + (dangerActions.length > 0 ? 44 : 0)
  const { menuLeft, menuTop, opensUpward } = getClampedMenuPosition({
    x,
    y,
    menuWidth,
    menuHeight: estimatedMenuHeight,
    viewportPadding,
    pointerGap,
  })

  const dangerActionsBlock = dangerActions.length > 0 && (
    <div
      className={`grid gap-1.5 border-[color:var(--color-border)] ${
        opensUpward ? 'border-b pb-2' : 'border-t pt-2'
      }`}
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
  )

  return createPortal(
    <div
      className="fixed z-[9998] rounded-[24px] p-2"
      style={{
        top: menuTop,
        left: menuLeft,
        width: menuWidth,
        background:
          'linear-gradient(180deg, color-mix(in srgb, var(--color-popover) 96%, var(--color-primary) 4%) 0%, var(--color-popover) 100%)',
        border: '1px solid var(--color-border)',
        backdropFilter: 'saturate(132%) blur(10px)',
        WebkitBackdropFilter: 'saturate(132%) blur(10px)',
        boxShadow: 'var(--shadow-popover)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {actionError && (
        <div
          className="mb-2 rounded-[16px] border px-3 py-2 text-xs whitespace-pre-line"
          style={{
            borderColor: 'color-mix(in srgb, var(--color-destructive) 35%, transparent)',
            background: 'color-mix(in srgb, var(--color-destructive-background) 88%, transparent)',
            color: 'var(--color-destructive)',
          }}
        >
          {actionError}
        </div>
      )}

      {opensUpward && dangerActionsBlock}

      <div
        className={`relative overflow-hidden rounded-[18px] border px-3 py-2.5 ${opensUpward && dangerActions.length > 0 ? 'mt-2' : ''}`}
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
              {t('common.projectActions')}
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
                isDevRunning || isDevStopping
                  ? 'bg-[color:var(--color-success-background)] text-[color:var(--color-success)]'
                  : 'bg-[color:var(--color-secondary)] text-[color:var(--color-muted-foreground)]'
              }`}
            >
              {devStatusLabel}
            </span>
          </div>
        </div>
      </div>

      <div
        className="mt-2 grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, primaryActions.length)}, minmax(0, 1fr))` }}
      >
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

      {!opensUpward && dangerActionsBlock && <div className="mt-2">{dangerActionsBlock}</div>}
    </div>,
    document.body
  )
}
