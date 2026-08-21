import { useEffect, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BookOpen, Bot, Check, ChevronRight, Code2, FolderOpen, Pin, Play, RefreshCw, Square, Terminal, Trash2, Zap } from 'lucide-react'
import type { AiRuntimeProfile, CliTool } from '../../shared/types'
import { getAiRuntimeProfileCli, getAiRuntimeProfileLabel } from '../../shared/aiRuntimeProfiles'
import { useI18n } from '../i18n'
import { UrlPopover, type UrlPopoverItem } from './UrlPopover'

export type CardContextMenuInfo = {
  /** 项目文档链接,与 Home 卡片上的链接展示一致。 */
  items: UrlPopoverItem[]
  tagOptions?: ReadonlyArray<{ value: string; label: string }>
}

interface CardContextMenuProps {
  x: number
  y: number
  onClose: () => void
  isRuntimeActive: boolean
  usesTmuxRuntime: boolean
  isDevRunning: boolean
  isDevStopping: boolean
  isOpeningTerminal: boolean
  isStartingRuntime: boolean
  isStoppingRuntime: boolean
  currentCli: CliTool
  defaultRuntimeProfileLabel?: string
  defaultRuntimeProfileCli?: CliTool
  isUsingDefaultAiRuntimeProfile?: boolean
  currentRuntimeProfileLabel?: string
  currentRuntimeProfileId?: string
  aiRuntimeProfiles?: AiRuntimeProfile[]
  isPinned?: boolean
  onStartRuntime: () => void | Promise<unknown>
  onStopRuntime: () => void | Promise<unknown>
  onOpenTerminal: () => void | Promise<unknown>
  onSwitchCli: () => void | Promise<unknown>
  onSelectAiRuntimeProfile?: (profileId: string) => void | Promise<unknown>
  onUseAiRuntimeProfile?: (profileId: string) => void | Promise<unknown>
  onSwitchAndUseAiRuntimeProfile?: (profileId: string) => void | Promise<unknown>
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
  /** 展示在主要操作右侧的信息 popover 数据;传入时渲染 hover 触发的信息按钮。 */
  info?: CardContextMenuInfo
  /** Stacking layer for the menu surface (default 9998, matching the original CSS). */
  zIndex?: number
}

type MenuTone = 'default' | 'primary' | 'success' | 'warning' | 'danger'

interface MenuAction {
  key: string
  label: string
  caption?: string
  icon: React.ReactNode
  show?: boolean
  action: () => void | Promise<unknown>
  disabled?: boolean
  tone?: MenuTone
}

interface AiProfileSubmenuLayout {
  top: number
  left: number
  width: number
  maxHeight: number
}

const AI_PROFILE_SUBMENU_WIDTH = 360
const AI_PROFILE_SUBMENU_MAX_HEIGHT = 280
const AI_PROFILE_SUBMENU_MIN_HEIGHT = 96
const AI_PROFILE_SUBMENU_GAP = 8

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
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

function getClampedMenuPosition({ x, y, menuWidth, menuHeight, viewportPadding, pointerGap }: { x: number; y: number; menuWidth: number; menuHeight: number; viewportPadding: number; pointerGap: number }) {
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

function getClampedAiProfileSubmenuPosition({ triggerRect, viewportPadding, gap }: { triggerRect: DOMRect; viewportPadding: number; gap: number }): AiProfileSubmenuLayout {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const width = Math.min(AI_PROFILE_SUBMENU_WIDTH, Math.max(180, viewportWidth - viewportPadding * 2))
  const usableHeight = Math.max(64, viewportHeight - viewportPadding * 2)
  const minHeight = Math.min(AI_PROFILE_SUBMENU_MIN_HEIGHT, usableHeight)
  const sideMaxHeight = Math.min(AI_PROFILE_SUBMENU_MAX_HEIGHT, usableHeight)
  const rightLeft = triggerRect.right + gap
  const leftLeft = triggerRect.left - width - gap
  const canOpenRight = rightLeft + width <= viewportWidth - viewportPadding
  const canOpenLeft = leftLeft >= viewportPadding

  if (canOpenRight || canOpenLeft) {
    return {
      left: canOpenRight ? rightLeft : leftLeft,
      top: clamp(triggerRect.top, viewportPadding, Math.max(viewportPadding, viewportHeight - viewportPadding - sideMaxHeight)),
      width,
      maxHeight: sideMaxHeight,
    }
  }

  const availableBelow = viewportHeight - triggerRect.bottom - gap - viewportPadding
  const availableAbove = triggerRect.top - gap - viewportPadding
  const opensBelow = availableBelow >= minHeight || availableBelow >= availableAbove
  const availableHeight = opensBelow ? availableBelow : availableAbove
  const maxHeight = Math.min(AI_PROFILE_SUBMENU_MAX_HEIGHT, Math.max(minHeight, availableHeight))
  const preferredTop = opensBelow ? triggerRect.bottom + gap : triggerRect.top - gap - maxHeight

  return {
    left: clamp(triggerRect.left, viewportPadding, Math.max(viewportPadding, viewportWidth - viewportPadding - width)),
    top: clamp(preferredTop, viewportPadding, Math.max(viewportPadding, viewportHeight - viewportPadding - maxHeight)),
    width,
    maxHeight,
  }
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
  isStartingRuntime,
  isStoppingRuntime,
  currentCli,
  defaultRuntimeProfileLabel,
  defaultRuntimeProfileCli,
  isUsingDefaultAiRuntimeProfile = false,
  currentRuntimeProfileLabel,
  currentRuntimeProfileId,
  aiRuntimeProfiles = [],
  isPinned,
  onStartRuntime,
  onStopRuntime,
  onOpenTerminal,
  onSwitchCli,
  onSelectAiRuntimeProfile,
  onUseAiRuntimeProfile,
  onSwitchAndUseAiRuntimeProfile,
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
  info,
  zIndex = 9998,
}: CardContextMenuProps) {
  const { t } = useI18n()
  const [actionError, setActionError] = useState<string | null>(null)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [profileSubmenuLayout, setProfileSubmenuLayout] = useState<AiProfileSubmenuLayout | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const profileMenuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const profileSubmenuRef = useRef<HTMLDivElement | null>(null)

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
    [onClose],
  )

  const infoItems = info?.items.map((item) =>
    item.onOpen
      ? {
          ...item,
          onOpen: async () => {
            await item.onOpen?.()
            onClose()
          },
        }
      : item,
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && (menuRef.current?.contains(target) || profileSubmenuRef.current?.contains(target))) {
        return
      }
      onClose()
    }
    const timer = window.setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [onClose])

  const cliLabel = currentRuntimeProfileLabel || (currentCli === 'codex' ? 'Codex' : 'Claude')
  const runtimeStatusLabel = isRuntimeActive ? `${cliLabel} ${t('common.runtime')} · ${t('common.active')}` : `${t('common.runtime')} · ${t('common.offline')}`
  const devStatusLabel = isDevStopping ? `${t('common.dev')} ${t('common.stopping')}` : isDevRunning ? `${t('common.dev')} ${t('common.running')}` : `${t('common.dev')} ${t('common.offline')}`
  const runtimeActionLabel = usesTmuxRuntime ? t('common.runtimeTerminal') : t('common.runtimeLaunch')
  const runtimeActionCaption = isRuntimeActive ? (isOpeningTerminal ? t('common.opening') : usesTmuxRuntime ? t('common.openSession') : t('common.openTerminalLaunch')) : t('common.connectAiRuntime')
  const canChooseAiRuntimeProfile = Boolean(onSelectAiRuntimeProfile && aiRuntimeProfiles.length > 0)
  const canUseAiRuntimeProfile = Boolean(onUseAiRuntimeProfile && onSwitchAndUseAiRuntimeProfile)
  const renderProfileActions = (profileId: string) => {
    if (!canUseAiRuntimeProfile) return null

    return (
      <span className="ml-2 flex shrink-0 items-center gap-1">
        <button
          type="button"
          className="rounded-full px-2 py-1 text-[10px] font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-card)] hover:text-[color:var(--color-foreground)]"
          aria-label={t('common.useAiProfileOnce')}
          title={t('common.useAiProfileOnce')}
          onClick={() => {
            void handleClick(async () => {
              await onUseAiRuntimeProfile?.(profileId)
            })
          }}
        >
          {t('common.useAiProfileOnce')}
        </button>
        <button
          type="button"
          className="rounded-full bg-[color:var(--color-accent)] px-2 py-1 text-[10px] font-medium text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-primary)]/15"
          aria-label={t('common.useAndSwitchAiProfile')}
          title={t('common.useAndSwitchAiProfile')}
          onClick={() => {
            void handleClick(async () => {
              await onSwitchAndUseAiRuntimeProfile?.(profileId)
            })
          }}
        >
          {t('common.useAndSwitchAiProfile')}
        </button>
      </span>
    )
  }
  const updateProfileSubmenuLayout = useCallback(() => {
    const trigger = profileMenuTriggerRef.current
    if (!trigger) {
      setProfileSubmenuLayout(null)
      return
    }

    setProfileSubmenuLayout(
      getClampedAiProfileSubmenuPosition({
        triggerRect: trigger.getBoundingClientRect(),
        viewportPadding: 10,
        gap: AI_PROFILE_SUBMENU_GAP,
      }),
    )
  }, [])

  useLayoutEffect(() => {
    if (!profileMenuOpen || !canChooseAiRuntimeProfile) {
      setProfileSubmenuLayout(null)
      return
    }

    updateProfileSubmenuLayout()
    const frame = window.requestAnimationFrame(() => {
      updateProfileSubmenuLayout()
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [canChooseAiRuntimeProfile, profileMenuOpen, updateProfileSubmenuLayout])

  useEffect(() => {
    if (!profileMenuOpen || !canChooseAiRuntimeProfile) return

    const handleLayout = () => {
      updateProfileSubmenuLayout()
    }
    let observer: ResizeObserver | null = null

    if (typeof ResizeObserver !== 'undefined' && profileMenuTriggerRef.current) {
      observer = new ResizeObserver(handleLayout)
      observer.observe(profileMenuTriggerRef.current)
    }

    window.addEventListener('resize', handleLayout)
    window.addEventListener('scroll', handleLayout, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', handleLayout)
      window.removeEventListener('scroll', handleLayout, true)
    }
  }, [canChooseAiRuntimeProfile, profileMenuOpen, updateProfileSubmenuLayout])

  const profileSubmenuMaxHeight = profileSubmenuLayout?.maxHeight ?? AI_PROFILE_SUBMENU_MAX_HEIGHT
  const profileSubmenuListMaxHeight = Math.max(48, profileSubmenuMaxHeight - 38)

  const primaryActionItems: MenuAction[] = [
    {
      key: 'runtime',
      label: isStartingRuntime ? `${t('common.run')} ${cliLabel}` : isRuntimeActive ? runtimeActionLabel : `${t('common.run')} ${cliLabel}`,
      caption: isStartingRuntime ? t('common.starting') : runtimeActionCaption,
      icon: isStartingRuntime ? <RefreshCw className="h-4 w-4 animate-spin" /> : isRuntimeActive ? isOpeningTerminal ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Terminal className="h-4 w-4" /> : <Zap className="h-4 w-4" />,
      action: isRuntimeActive ? onOpenTerminal : onStartRuntime,
      disabled: isStartingRuntime || (isRuntimeActive && isOpeningTerminal),
      tone: 'primary',
    },
    {
      key: 'dev',
      label: isDevStopping ? t('common.stopping') : isDevRunning ? t('common.stopProject') : t('common.startProject'),
      caption: isDevStopping ? t('common.waitForExit') : isDevRunning ? t('common.terminateDevProcess') : t('common.runDevService'),
      icon: isDevStopping ? <RefreshCw className="h-4 w-4 animate-spin" /> : isDevRunning ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />,
      action: isDevRunning || isDevStopping ? onStopProject : onStartProject,
      disabled: isDevStopping,
      tone: isDevRunning || isDevStopping ? 'danger' : 'success',
    },
    {
      key: 'ai-commit',
      label: aiCommitStatus === 'running' ? `AI ${t('common.stopping')}` : t('common.aiAutoCommit'),
      caption: t('common.defaultParams'),
      icon: aiCommitStatus === 'running' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />,
      show: Boolean(onAiAutoCommit),
      action: onAiAutoCommit ?? (() => undefined),
      disabled: aiCommitStatus === 'running',
      tone: aiCommitStatus === 'error' ? 'danger' : 'default',
    },
  ]
  const primaryActions = primaryActionItems.filter((item) => item.show !== false)

  const openActions: MenuAction[] = [
    {
      key: 'folder',
      label: t('common.folder'),
      caption: t('common.browse'),
      icon: <FolderOpen className="h-4 w-4" />,
      action: onOpenFolder,
      tone: 'default',
    },
    {
      key: 'terminal',
      label: t('common.terminal'),
      caption: t('common.currentPath'),
      icon: <Terminal className="h-4 w-4" />,
      action: onOpenPathTerminal,
      tone: 'primary',
    },
    {
      key: 'vscode',
      label: 'VS Code',
      caption: t('common.edit'),
      icon: <Code2 className="h-4 w-4" />,
      action: onOpenVsCode,
      tone: 'success',
    },
  ]

  const utilityActionItems: MenuAction[] = [
    {
      key: 'ai-profile',
      label: t('common.switchAndUseAiProfile'),
      icon: <Bot className="h-3.5 w-3.5" />,
      action: onSwitchCli,
      tone: 'primary',
    },
    {
      key: 'pin',
      label: isPinned ? t('common.unpinProject') : t('common.pinProject'),
      icon: <Pin className="h-3.5 w-3.5" />,
      show: Boolean(onTogglePin),
      action: onTogglePin ?? (() => undefined),
      tone: isPinned ? 'warning' : 'default',
    },
    {
      key: 'metadata',
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
      key: 'stop-runtime',
      label: isStoppingRuntime ? t('common.stopping') : t('common.stopRuntime'),
      icon: isStoppingRuntime ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />,
      show: isRuntimeActive,
      action: onStopRuntime,
      disabled: isStoppingRuntime,
      tone: 'danger',
    },
    {
      key: 'remove-project',
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
    <div className={`grid gap-1.5 border-[color:var(--color-border)] ${opensUpward ? 'border-b pb-2' : 'border-t pt-2'}`} style={{ gridTemplateColumns: `repeat(${dangerActions.length}, minmax(0, 1fr))` }}>
      {dangerActions.map((item) => (
        <button
          key={item.label}
          disabled={item.disabled}
          className={`group flex min-w-0 items-center justify-center gap-1.5 rounded-[14px] px-2.5 py-2 text-[12px] font-medium text-[color:var(--color-destructive)] transition-colors hover:bg-[color:var(--color-destructive-background)] ${item.disabled ? 'cursor-not-allowed opacity-60' : ''}`}
          onClick={() => {
            void handleClick(item.action)
          }}
        >
          <span className="shrink-0">{item.icon}</span>
          <span className="truncate">{item.label}</span>
        </button>
      ))}
    </div>
  )

  const profileSubmenu =
    profileMenuOpen && canChooseAiRuntimeProfile ? (
      <div
        ref={profileSubmenuRef}
        role="menu"
        className="fixed overflow-hidden rounded-[18px] border border-[color:var(--color-border)] bg-[color:var(--color-popover)]/98 p-1.5 text-[color:var(--color-popover-foreground)] shadow-[var(--shadow-popover)] backdrop-blur-[18px]"
        style={{
          zIndex: zIndex + 22,
          top: profileSubmenuLayout?.top ?? 0,
          left: profileSubmenuLayout?.left ?? 0,
          width: profileSubmenuLayout?.width ?? AI_PROFILE_SUBMENU_WIDTH,
          maxHeight: profileSubmenuMaxHeight,
          visibility: profileSubmenuLayout ? 'visible' : 'hidden',
          WebkitBackdropFilter: 'saturate(160%) blur(18px)',
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="px-2 pb-1.5 pt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">{t('common.useAiProfile')}</div>
        <div className="overflow-auto" style={{ maxHeight: profileSubmenuListMaxHeight }}>
          <div
            role="menuitemradio"
            aria-checked={isUsingDefaultAiRuntimeProfile}
            className={`group flex w-full min-w-0 items-center gap-2 rounded-[13px] px-2.5 py-2 text-left text-xs transition-colors ${isUsingDefaultAiRuntimeProfile ? 'bg-primary/10 text-primary' : 'text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]'}`}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
              onClick={() => {
                void handleClick(async () => {
                  await onSelectAiRuntimeProfile?.('')
                })
              }}
            >
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[color:var(--color-accent)]">{(defaultRuntimeProfileCli ?? currentCli) === 'codex' ? <Terminal className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {t('common.default')} · {defaultRuntimeProfileLabel ?? currentRuntimeProfileLabel ?? currentCli}
                </span>
                <span className="mt-0.5 block truncate text-[10px] text-[color:var(--color-muted-foreground)]">{t('settingsRuntime.activeRuntimeProfile')}</span>
              </span>
              {isUsingDefaultAiRuntimeProfile ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
            </button>
            {renderProfileActions('')}
          </div>
          {aiRuntimeProfiles.map((profile) => {
            const selected = !isUsingDefaultAiRuntimeProfile && profile.id === currentRuntimeProfileId
            const profileCli = getAiRuntimeProfileCli(profile, currentCli)

            return (
              <div
                key={profile.id}
                role="menuitemradio"
                aria-checked={selected}
                className={`group flex w-full min-w-0 items-center gap-2 rounded-[13px] px-2.5 py-2 text-left text-xs transition-colors ${selected ? 'bg-primary/10 text-primary' : 'text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]'}`}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
                  onClick={() => {
                    void handleClick(async () => {
                      await onSelectAiRuntimeProfile?.(profile.id)
                    })
                  }}
                >
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[color:var(--color-accent)]">{profileCli === 'codex' ? <Terminal className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{getAiRuntimeProfileLabel(profile, currentCli)}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-[color:var(--color-muted-foreground)]">{profile.kind === 'custom' ? profile.command || profileCli : profileCli}</span>
                  </span>
                  {selected ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                </button>
                {renderProfileActions(profile.id)}
              </div>
            )
          })}
        </div>
      </div>
    ) : null

  return createPortal(
    <>
      <div
        ref={menuRef}
        className="fixed rounded-[24px] p-2"
        style={{
          zIndex,
          top: menuTop,
          left: menuLeft,
          width: menuWidth,
          background: 'linear-gradient(180deg, color-mix(in srgb, var(--color-popover) 96%, var(--color-primary) 4%) 0%, var(--color-popover) 100%)',
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
          <div className="pointer-events-none absolute -right-6 -top-8 h-20 w-20 rounded-full blur-2xl" style={{ background: 'color-mix(in srgb, var(--color-primary) 20%, transparent)' }} />
          <div className="relative flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">{t('common.projectActions')}</div>
              <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs font-medium text-[color:var(--color-foreground)]">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isRuntimeActive ? 'bg-[color:var(--color-success)]' : 'bg-[color:var(--color-muted-foreground)]/55'}`} />
                <span className="truncate">{runtimeStatusLabel}</span>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-[10px] font-medium text-primary">{cliLabel}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${isDevRunning || isDevStopping ? 'bg-[color:var(--color-success-background)] text-[color:var(--color-success)]' : 'bg-[color:var(--color-secondary)] text-[color:var(--color-muted-foreground)]'}`}>{devStatusLabel}</span>
            </div>
          </div>
        </div>

        <div className="mt-2 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.max(1, primaryActions.length + (info ? 1 : 0))}, minmax(0, 1fr))` }}>
          {primaryActions.map((item) => (
            <button
              key={item.label}
              disabled={item.disabled}
              className={`group min-w-0 rounded-[17px] border px-3 py-2.5 text-left transition-colors ${getPrimaryActionClass(item.tone)} ${item.disabled ? 'cursor-not-allowed opacity-60 hover:bg-transparent' : ''}`}
              style={{ borderColor: getToneBorderColor(item.tone) }}
              onClick={() => {
                void handleClick(item.action)
              }}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] bg-[color:var(--color-card)]/80">{item.icon}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold tracking-[-0.01em]">{item.label}</span>
                  <span className="mt-0.5 block truncate text-[10px] font-normal opacity-70">{item.caption}</span>
                </span>
              </span>
            </button>
          ))}
          {info && (
            <UrlPopover items={infoItems ?? []} tagOptions={info.tagOptions} zIndex={zIndex + 20} forcePopover triggerClassName="w-full">
              <button
                type="button"
                className="group flex h-full min-w-0 w-full items-center gap-2.5 rounded-[17px] border px-3 py-2.5 text-left transition-colors hover:bg-[color:var(--color-accent)]/75"
                style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, transparent)' }}
                aria-label={t('common.projectInfo')}
                title={t('common.projectInfo')}
              >
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] bg-[color:var(--color-card)]/80">
                  <BookOpen className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold tracking-[-0.01em]">{t('common.links')}</span>
                  <span className="mt-0.5 block truncate text-[10px] font-normal opacity-70">{t('common.projectInfo')}</span>
                </span>
              </button>
            </UrlPopover>
          )}
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
              onClick={() => {
                void handleClick(item.action)
              }}
            >
              <span className={`inline-flex h-6 w-6 items-center justify-center rounded-md bg-[color:var(--color-accent)] ${getIconToneClass(item.tone)}`}>{item.icon}</span>
              <span className="mt-1 block truncate text-[11px] font-medium text-[color:var(--color-foreground)]">{item.label}</span>
              <span className="mt-0.5 block truncate text-[10px] text-[color:var(--color-muted-foreground)]">{item.caption}</span>
            </button>
          ))}
        </div>

        {utilityActions.length > 0 && (
          <div className="mt-2 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${utilityActions.length}, minmax(0, 1fr))` }}>
            {utilityActions.map((item) => {
              const isAiProfileAction = item.key === 'ai-profile'

              return (
                <div key={item.key} className="relative min-w-0">
                  <button
                    ref={isAiProfileAction ? profileMenuTriggerRef : undefined}
                    className="group flex w-full min-w-0 items-center justify-center gap-1.5 rounded-[14px] px-2.5 py-2 text-[12px] font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)]/70 hover:text-[color:var(--color-foreground)]"
                    aria-haspopup={isAiProfileAction && canChooseAiRuntimeProfile ? 'menu' : undefined}
                    aria-expanded={isAiProfileAction && canChooseAiRuntimeProfile ? profileMenuOpen : undefined}
                    onClick={() => {
                      if (isAiProfileAction && canChooseAiRuntimeProfile) {
                        setProfileMenuOpen((current) => !current)
                        return
                      }
                      void handleClick(item.action)
                    }}
                  >
                    <span className={`shrink-0 ${getIconToneClass(item.tone)}`}>{item.icon}</span>
                    <span className="truncate">{item.label}</span>
                    {isAiProfileAction && canChooseAiRuntimeProfile ? <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${profileMenuOpen ? 'rotate-90' : ''}`} /> : null}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {!opensUpward && dangerActionsBlock && <div className="mt-2">{dangerActionsBlock}</div>}
      </div>
      {profileSubmenu}
    </>,
    document.body,
  )
}
