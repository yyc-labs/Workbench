import { AlignLeft, Check, ChevronRight, ClipboardCopy, ClipboardPaste, Contrast, FoldVertical, MessageSquarePlus, MessageSquareQuote, Moon, Palette, ScanText, Scissors, Sun, UnfoldVertical } from 'lucide-react'
import type { Selection } from 'monaco-editor'
import type { ReactNode } from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { dropdownSurfaceClassName, dropdownSurfaceStyle } from '../../components/ui/dropdown'
import { useI18n } from '../../i18n'
import type { MonacoThemeName } from '../../lib/monacoEnvironment'

export interface MonacoEditorContextMenuItem {
  id: string
  label: string
  icon: ReactNode
  actionId: string
  disabled?: boolean
}

export interface MonacoEditorContextMenuSection {
  id: string
  items: MonacoEditorContextMenuItem[]
}

interface MonacoEditorContextMenuProps {
  x: number
  y: number
  selection: Selection | null
  isReadOnly: boolean
  canComment: boolean
  canFormat: boolean
  currentTheme: MonacoThemeName
  onThemeChange: (theme: MonacoThemeName) => void
  onAction: (actionId: string) => void
  onClose: () => void
}

const MENU_WIDTH = 200
const MENU_ESTIMATED_HEIGHT = 300
const MENU_BOTTOM_MARGIN = 34
const VIEWPORT_PADDING = 8
const THEME_PANEL_WIDTH = 200
const THEME_PANEL_GAP = 8
const THEME_PANEL_ESTIMATED_HEIGHT = 96

type ThemeOption = {
  id: MonacoThemeName
  label: string
  icon: ReactNode
}

const LIGHT_THEME_IDS: MonacoThemeName[] = ['vs', 'hc-light']
const DARK_THEME_IDS: MonacoThemeName[] = ['vs-dark', 'hc-black']

function isDarkTheme(theme: MonacoThemeName): boolean {
  return theme === 'vs-dark' || theme === 'hc-black'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function MonacoEditorContextMenu({ x, y, selection, isReadOnly, canComment, canFormat, currentTheme, onThemeChange, onAction, onClose }: MonacoEditorContextMenuProps) {
  const { t } = useI18n()
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)

  const themeOptions = useMemo<ThemeOption[]>(() => {
    const themeIds = isDarkTheme(currentTheme) ? DARK_THEME_IDS : LIGHT_THEME_IDS
    return themeIds.map((id) => {
      const label = id === 'vs' ? t('codeWorkspace.editorContextMenu.themeLight') : id === 'vs-dark' ? t('codeWorkspace.editorContextMenu.themeDark') : id === 'hc-light' ? t('codeWorkspace.editorContextMenu.themeHighContrastLight') : t('codeWorkspace.editorContextMenu.themeHighContrastDark')
      const icon = id === 'vs' ? <Sun className="h-4 w-4" /> : id === 'vs-dark' ? <Moon className="h-4 w-4" /> : <Contrast className="h-4 w-4" />
      return { id, label, icon }
    })
  }, [currentTheme, t])

  const menuRef = useRef<HTMLDivElement | null>(null)
  const [menuHeight, setMenuHeight] = useState(MENU_ESTIMATED_HEIGHT)
  const themeCloseTimerRef = useRef<number | null>(null)
  const themeTriggerRef = useRef<HTMLButtonElement | null>(null)

  const cancelThemeMenuClose = () => {
    if (themeCloseTimerRef.current != null) {
      window.clearTimeout(themeCloseTimerRef.current)
      themeCloseTimerRef.current = null
    }
  }

  const scheduleThemeMenuClose = () => {
    cancelThemeMenuClose()
    themeCloseTimerRef.current = window.setTimeout(() => {
      setThemeMenuOpen(false)
    }, 120)
  }

  useEffect(() => {
    return () => {
      if (themeCloseTimerRef.current != null) {
        window.clearTimeout(themeCloseTimerRef.current)
      }
    }
  }, [])

  const sections = useMemo(() => {
    const hasSelection = Boolean(selection && !selection.isEmpty())
    const iconClassName = 'h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]'

    const groups: MonacoEditorContextMenuSection[] = [
      {
        id: 'clipboard',
        items: [
          {
            id: 'cut',
            label: t('codeWorkspace.editorContextMenu.cut'),
            icon: <Scissors className={iconClassName} />,
            actionId: 'editor.action.clipboardCutAction',
            disabled: !hasSelection || isReadOnly,
          },
          {
            id: 'copy',
            label: t('codeWorkspace.editorContextMenu.copy'),
            icon: <ClipboardCopy className={iconClassName} />,
            actionId: 'editor.action.clipboardCopyAction',
            disabled: !hasSelection,
          },
          {
            id: 'paste',
            label: t('codeWorkspace.editorContextMenu.paste'),
            icon: <ClipboardPaste className={iconClassName} />,
            actionId: 'editor.action.clipboardPasteAction',
            disabled: isReadOnly,
          },
        ],
      },
      {
        id: 'selection',
        items: [
          {
            id: 'selectAll',
            label: t('codeWorkspace.editorContextMenu.selectAll'),
            icon: <ScanText className={iconClassName} />,
            actionId: 'editor.action.selectAll',
          },
        ],
      },
    ]

    if (canComment) {
      groups.push({
        id: 'comment',
        items: [
          {
            id: 'toggleLineComment',
            label: t('codeWorkspace.editorContextMenu.toggleLineComment'),
            icon: <MessageSquarePlus className={iconClassName} />,
            actionId: 'editor.action.commentLine',
          },
          {
            id: 'toggleBlockComment',
            label: t('codeWorkspace.editorContextMenu.toggleBlockComment'),
            icon: <MessageSquareQuote className={iconClassName} />,
            actionId: 'editor.action.blockComment',
          },
        ],
      })
    }

    groups.push({
      id: 'folding',
      items: [
        {
          id: 'fold',
          label: t('codeWorkspace.editorContextMenu.fold'),
          icon: <FoldVertical className={iconClassName} />,
          actionId: 'editor.fold',
        },
        {
          id: 'unfold',
          label: t('codeWorkspace.editorContextMenu.unfold'),
          icon: <UnfoldVertical className={iconClassName} />,
          actionId: 'editor.unfold',
        },
      ],
    })

    if (canFormat) {
      groups.push({
        id: 'format',
        items: [
          {
            id: 'formatDocument',
            label: t('codeWorkspace.editorContextMenu.formatDocument'),
            icon: <AlignLeft className={iconClassName} />,
            actionId: 'editor.action.formatDocument',
          },
          ...(hasSelection
            ? [
                {
                  id: 'formatSelection',
                  label: t('codeWorkspace.editorContextMenu.formatSelection'),
                  icon: <AlignLeft className={iconClassName} />,
                  actionId: 'editor.action.formatSelection',
                },
              ]
            : []),
        ],
      })
    }

    return groups
  }, [selection, isReadOnly, canComment, canFormat, t])

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const height = el.getBoundingClientRect().height
    if (height > 0) setMenuHeight(height)
  }, [sections])

  const left = clamp(x, VIEWPORT_PADDING, Math.max(VIEWPORT_PADDING, window.innerWidth - MENU_WIDTH - VIEWPORT_PADDING))
  const top = clamp(y, VIEWPORT_PADDING, Math.max(VIEWPORT_PADDING, window.innerHeight - menuHeight - MENU_BOTTOM_MARGIN))

  const themeTriggerRect = themeTriggerRef.current?.getBoundingClientRect() ?? null
  const themePanelPos = themeTriggerRect
    ? {
        left: (() => {
          const rightLeft = themeTriggerRect.right + THEME_PANEL_GAP
          const leftLeft = themeTriggerRect.left - THEME_PANEL_WIDTH - THEME_PANEL_GAP
          const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - THEME_PANEL_WIDTH - VIEWPORT_PADDING)
          const rightFits = rightLeft + THEME_PANEL_WIDTH <= window.innerWidth - VIEWPORT_PADDING
          const leftFits = leftLeft >= VIEWPORT_PADDING
          return clamp(rightFits || !leftFits ? rightLeft : leftLeft, VIEWPORT_PADDING, maxLeft)
        })(),
        top: clamp(themeTriggerRect.top, VIEWPORT_PADDING, Math.max(VIEWPORT_PADDING, window.innerHeight - THEME_PANEL_ESTIMATED_HEIGHT - VIEWPORT_PADDING)),
      }
    : null

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
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

  useEffect(() => {
    const onScroll = () => onClose()
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [onClose])

  return (
    <>
      {createPortal(
        <div ref={menuRef} className={dropdownSurfaceClassName} style={{ ...dropdownSurfaceStyle, left, top, width: MENU_WIDTH }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
          {sections.map((section, index) => (
            <div key={section.id}>
              {index > 0 ? <div className="mx-2 my-1 h-px bg-[color:var(--color-border)]/60" /> : null}
              {section.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={item.disabled}
                  className={['flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-[12px] text-[color:var(--color-foreground)] transition-colors', item.disabled ? 'cursor-not-allowed opacity-45' : 'hover:bg-[color:var(--color-accent)]'].filter(Boolean).join(' ')}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (item.disabled) return
                    onAction(item.actionId)
                  }}
                >
                  {item.icon}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </button>
              ))}
            </div>
          ))}
          <div className="mx-2 my-1 h-px bg-[color:var(--color-border)]/60" />
          <button
            ref={themeTriggerRef}
            type="button"
            className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-[12px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => {
              cancelThemeMenuClose()
              setThemeMenuOpen(true)
            }}
            onMouseLeave={scheduleThemeMenuClose}
          >
            <Palette className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" />
            <span className="min-w-0 flex-1 truncate">{t('codeWorkspace.editorContextMenu.colorTheme')}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" />
          </button>
        </div>,
        document.body,
      )}
      {themeMenuOpen
        ? createPortal(
            <div
              className={dropdownSurfaceClassName}
              style={{ ...dropdownSurfaceStyle, left: themePanelPos?.left ?? left + MENU_WIDTH + THEME_PANEL_GAP, top: themePanelPos?.top ?? top, width: THEME_PANEL_WIDTH }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
              onMouseEnter={() => {
                cancelThemeMenuClose()
                setThemeMenuOpen(true)
              }}
              onMouseLeave={scheduleThemeMenuClose}
            >
              {themeOptions.map((option) => {
                const active = option.id === currentTheme
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={['flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-[12px] text-[color:var(--color-foreground)] transition-colors', active ? 'bg-[color:var(--color-accent)]' : 'hover:bg-[color:var(--color-accent)]'].filter(Boolean).join(' ')}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      onThemeChange(option.id)
                      onClose()
                    }}
                  >
                    <span className="text-[color:var(--color-muted-foreground)]">{option.icon}</span>
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {active ? <Check className="h-4 w-4 shrink-0 text-[color:var(--color-primary)]" /> : null}
                  </button>
                )
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
