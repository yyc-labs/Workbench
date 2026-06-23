import { useDeferredValue, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type MutableRefObject } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Copy, Ellipsis, ExternalLink, KeyRound, Link2, RefreshCw, UserRound } from 'lucide-react'
import { useI18n } from '../i18n'
import { copyTextToClipboard } from '../pages/code/code.clipboard'

interface UrlPopoverProps {
  urls?: string[]
  items?: UrlPopoverItem[]
  tagOptions?: ReadonlyArray<{ value: string; label: string }>
  children: React.ReactNode
}

export type UrlPopoverItem = {
  url: string
  label: string
  tag?: string
  tagLabel?: string
  onOpen?: () => void | Promise<void>
  kind?: 'url' | 'ssh'
  description?: string
  copyValue?: string
  copyLabel?: string
  copyValueResolver?: () => Promise<string>
  credentialActions?: ReadonlyArray<UrlPopoverCredentialAction>
}
type UrlPopoverEntry = UrlPopoverItem
type PreparedUrlPopoverEntry = UrlPopoverEntry & {
  key: string
  normalizedLabel: string
  normalizedUrl: string
  normalizedDescription: string
  normalizedTag: string
  normalizedTagLabel: string
  searchText: string
}

type UrlPopoverCategoryOption = {
  value: string
  label: string
}

export type UrlPopoverCredentialAction = {
  key: string
  label: string
  onCopy: () => Promise<boolean>
  icon?: 'account' | 'password'
}

type UrlPopoverItemActionsMenuProps = {
  entryKey: string
  actions: ReadonlyArray<UrlPopoverCredentialAction>
  copiedActionKey: string | null
  onCopyAction: (entryKey: string, action: UrlPopoverCredentialAction) => void
  floatingMenuRef: MutableRefObject<HTMLDivElement | null>
  onOpenChange?: (open: boolean) => void
}

function UrlPopoverItemActionsMenu({
  entryKey,
  actions,
  copiedActionKey,
  onCopyAction,
  floatingMenuRef,
  onOpenChange,
}: UrlPopoverItemActionsMenuProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const previousOpenRef = useRef(open)
  const [menuLayout, setMenuLayout] = useState({ top: 0, left: 0, width: 0, maxHeight: 220 })

  const isWithinMenuArea = (target: EventTarget | null) => (
    target instanceof Node
    && Boolean(
      containerRef.current?.contains(target)
      || floatingMenuRef.current?.contains(target)
    )
  )

  const updateMenuLayout = () => {
    if (!triggerRef.current) return

    const rect = triggerRef.current.getBoundingClientRect()
    const viewportPadding = 12
    const triggerGap = 6
    const menuWidth = 156
    const idealMaxHeight = 220
    const preferredTop = rect.bottom + triggerGap
    const availableBelow = window.innerHeight - preferredTop - viewportPadding
    const availableAbove = rect.top - triggerGap - viewportPadding
    const shouldOpenUpward = availableBelow < 120 && availableAbove > availableBelow
    const maxHeight = Math.max(88, Math.min(
      idealMaxHeight,
      shouldOpenUpward ? availableAbove : availableBelow,
    ))
    const top = shouldOpenUpward
      ? Math.max(viewportPadding, rect.top - triggerGap - maxHeight)
      : rect.bottom + triggerGap
    const left = Math.max(
      viewportPadding,
      Math.min(rect.right - menuWidth, window.innerWidth - viewportPadding - menuWidth),
    )

    setMenuLayout({ top, left, width: menuWidth, maxHeight })
  }

  useEffect(() => {
    if (!open) return

    updateMenuLayout()

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target
      if (!isWithinMenuArea(target)) setOpen(false)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    const handleResize = () => {
      updateMenuLayout()
    }

    const handleScroll = () => {
      setOpen(false)
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    window.addEventListener('resize', handleResize)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [open])

  useEffect(() => {
    if (previousOpenRef.current === open) return
    previousOpenRef.current = open
    onOpenChange?.(open)
    if (!open) {
      floatingMenuRef.current = null
    }
  }, [floatingMenuRef, onOpenChange, open])

  useEffect(() => {
    return () => {
      onOpenChange?.(false)
      floatingMenuRef.current = null
    }
  }, [floatingMenuRef, onOpenChange])

  if (actions.length === 0) return null

  const resolveIcon = (icon: UrlPopoverCredentialAction['icon']) => {
    if (icon === 'password') return <KeyRound className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
    return <UserRound className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
  }

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        className={`inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
          open
            ? 'bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]'
            : 'text-[color:var(--color-muted-foreground)] opacity-0 hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] group-hover/item:opacity-100 focus-visible:opacity-100'
        }`}
        title={t('common.moreActions')}
        aria-label={t('common.moreActions')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation()
          if (!open) updateMenuLayout()
          setOpen((prev) => !prev)
        }}
      >
        <Ellipsis className="h-3.5 w-3.5" />
      </button>

      {open && createPortal(
        <div
          ref={(node) => {
            floatingMenuRef.current = node
          }}
          className="surface-card fixed z-[10011] overflow-hidden rounded-[14px]"
          style={{
            top: menuLayout.top,
            left: menuLayout.left,
            width: menuLayout.width,
          }}
          role="menu"
          aria-label={t('common.moreActions')}
          onClick={(event) => {
            event.stopPropagation()
          }}
          onContextMenu={(event) => {
            event.preventDefault()
          }}
        >
          <div className="overflow-auto p-1" style={{ maxHeight: menuLayout.maxHeight }}>
            {actions.map((action) => {
              const actionKey = `${entryKey}:${action.key}`
              const isCopied = copiedActionKey === actionKey
              return (
                <button
                  key={action.key}
                  type="button"
                  className={`flex w-full items-center justify-between rounded-[10px] px-2.5 py-1.5 text-left text-xs outline-none transition-colors focus-visible:outline-none ${
                    isCopied
                      ? 'bg-[color:var(--color-success-background)] text-[color:var(--color-success)]'
                      : 'text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]'
                  }`}
                  role="menuitem"
                  onClick={() => {
                    onCopyAction(entryKey, action)
                  }}
                >
                  <span className="flex min-w-0 items-center gap-1.5 truncate">
                    {resolveIcon(action.icon)}
                    <span className="truncate">{isCopied ? t('common.copied') : action.label}</span>
                  </span>
                  {isCopied ? <Check className="h-3.5 w-3.5 shrink-0" /> : <Copy className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />}
                </button>
              )
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

type UrlPopoverCategorySelectProps = {
  value: string
  options: ReadonlyArray<UrlPopoverCategoryOption>
  onChange: (value: string) => void
  floatingMenuRef: MutableRefObject<HTMLDivElement | null>
  onOpenChange?: (open: boolean) => void
}

function UrlPopoverCategorySelect({
  value,
  options,
  onChange,
  floatingMenuRef,
  onOpenChange,
}: UrlPopoverCategorySelectProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previousOpenRef = useRef(open)
  const [menuLayout, setMenuLayout] = useState({ top: 0, left: 0, width: 0, maxHeight: 220 })
  const selectedOption = options.find((option) => option.value === value) ?? options[0]

  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  const isWithinSelectArea = (target: EventTarget | null) => (
    target instanceof Node
    && Boolean(
      containerRef.current?.contains(target)
      || floatingMenuRef.current?.contains(target)
    )
  )

  const scheduleClose = () => {
    clearCloseTimer()
    closeTimerRef.current = setTimeout(() => {
      const activeEl = document.activeElement
      if (isWithinSelectArea(activeEl)) return
      setOpen(false)
    }, 120)
  }

  const updateMenuLayout = () => {
    if (!triggerRef.current) return

    const rect = triggerRef.current.getBoundingClientRect()
    const viewportPadding = 12
    const triggerGap = 6
    const idealMaxHeight = 240
    const width = rect.width
    const preferredTop = rect.bottom + triggerGap
    const availableBelow = window.innerHeight - preferredTop - viewportPadding
    const availableAbove = rect.top - triggerGap - viewportPadding
    const shouldOpenUpward = availableBelow < 120 && availableAbove > availableBelow
    const maxHeight = Math.max(96, Math.min(
      idealMaxHeight,
      shouldOpenUpward ? availableAbove : availableBelow,
    ))
    const top = shouldOpenUpward
      ? Math.max(viewportPadding, rect.top - triggerGap - maxHeight)
      : rect.bottom + triggerGap
    const left = Math.max(
      viewportPadding,
      Math.min(rect.left, window.innerWidth - viewportPadding - width),
    )

    setMenuLayout({ top, left, width, maxHeight })
  }

  useEffect(() => {
    if (!open) return

    updateMenuLayout()

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target
      if (!isWithinSelectArea(target)) setOpen(false)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    const handleReposition = () => {
      updateMenuLayout()
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    window.addEventListener('resize', handleReposition)
    window.addEventListener('scroll', handleReposition, true)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
      window.removeEventListener('resize', handleReposition)
      window.removeEventListener('scroll', handleReposition, true)
    }
  }, [open])

  useEffect(() => {
    if (previousOpenRef.current === open) return
    previousOpenRef.current = open
    onOpenChange?.(open)
    if (!open) {
      floatingMenuRef.current = null
      clearCloseTimer()
    }
  }, [floatingMenuRef, onOpenChange, open])

  useEffect(() => {
    return () => {
      floatingMenuRef.current = null
      clearCloseTimer()
    }
  }, [floatingMenuRef])

  return (
    <div ref={containerRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        className="quiet-control flex h-8 w-full items-center justify-between rounded-full border-0 px-3 text-left text-xs text-[color:var(--color-foreground)] outline-none transition-colors hover:border-[color:var(--color-border-hover)] focus-visible:ring-2 focus-visible:ring-ring"
        aria-haspopup="listbox"
        aria-expanded={open}
        onMouseEnter={() => {
          clearCloseTimer()
          if (!open) updateMenuLayout()
          setOpen(true)
        }}
        onMouseLeave={(event) => {
          if (isWithinSelectArea(event.relatedTarget)) return
          scheduleClose()
        }}
        onFocus={() => {
          clearCloseTimer()
        }}
        onBlur={(event) => {
          if (isWithinSelectArea(event.relatedTarget)) return
          scheduleClose()
        }}
        onClick={() => {
          if (!open) updateMenuLayout()
          setOpen((prev) => !prev)
        }}
      >
        <span className="truncate">{selectedOption?.label}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        createPortal(
          <div
            ref={(node) => {
              floatingMenuRef.current = node
            }}
            className="surface-card fixed z-[10010] overflow-hidden rounded-[14px]"
            style={{
              top: menuLayout.top,
              left: menuLayout.left,
              width: menuLayout.width,
            }}
            role="listbox"
            aria-label={selectedOption?.label}
            onMouseEnter={() => {
              clearCloseTimer()
            }}
            onMouseLeave={(event) => {
              if (isWithinSelectArea(event.relatedTarget)) return
              scheduleClose()
            }}
            onFocusCapture={() => {
              clearCloseTimer()
            }}
            onBlurCapture={() => {
              window.setTimeout(() => {
                const activeEl = document.activeElement
                if (isWithinSelectArea(activeEl)) return
                scheduleClose()
              }, 0)
            }}
          >
            <div className="overflow-auto p-1" style={{ maxHeight: menuLayout.maxHeight }}>
              {options.map((option) => {
                const selected = option.value === value
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`flex w-full items-center justify-between rounded-[10px] px-2.5 py-1.5 text-left text-xs outline-none transition-colors focus-visible:outline-none ${
                      selected
                        ? 'bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]'
                        : 'text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]'
                    }`}
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(option.value)
                      setOpen(false)
                    }}
                  >
                    <span className="truncate">{option.label}</span>
                    {selected && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
          ,
          document.body
        )
      )}
    </div>
  )
}

function isFuzzySubsequence(query: string, candidate: string): boolean {
  if (!query) return true
  let queryIndex = 0
  for (let i = 0; i < candidate.length && queryIndex < query.length; i += 1) {
    if (candidate[i] === query[queryIndex]) {
      queryIndex += 1
    }
  }
  return queryIndex === query.length
}

export async function openUrlPopoverItem(entry: UrlPopoverItem): Promise<void> {
  if (entry.onOpen) {
    await entry.onOpen()
    return
  }
  await window.electronAPI.openExternal(entry.url)
}

export function UrlPopover({ urls, items, tagOptions, children }: UrlPopoverProps) {
  const { t } = useI18n()
  const [show, setShow] = useState(false)
  const [layout, setLayout] = useState({ top: 0, left: 0, maxHeight: 320, width: 300 })
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [copiedCredentialKey, setCopiedCredentialKey] = useState<string | null>(null)
  const [openingEntryKey, setOpeningEntryKey] = useState<string | null>(null)
  const [credentialMenuOpen, setCredentialMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const triggerRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const categoryMenuRef = useRef<HTMLDivElement | null>(null)
  const itemActionsMenuRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copiedCredentialTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverStateRef = useRef({ trigger: false, popover: false })
  const focusWithinRef = useRef(false)
  const entries = useMemo<UrlPopoverEntry[]>(
    () => (
      items && items.length > 0
        ? items
        : (urls ?? []).map((url) => ({ url, label: url }))
    ),
    [items, urls]
  )
  const preparedEntries = useMemo<PreparedUrlPopoverEntry[]>(
    () => entries.map((entry) => {
      const normalizedLabel = entry.label.toLowerCase()
      const normalizedUrl = entry.url.toLowerCase()
      const normalizedDescription = (entry.description ?? '').toLowerCase()
      const normalizedTag = (entry.tag ?? '').toLowerCase()
      const normalizedTagLabel = (entry.tagLabel ?? '').toLowerCase()
      return {
        ...entry,
        key: `${entry.label}:${entry.url}`,
        normalizedLabel,
        normalizedUrl,
        normalizedDescription,
        normalizedTag,
        normalizedTagLabel,
        searchText: `${normalizedLabel} ${normalizedUrl} ${normalizedDescription} ${normalizedTag} ${normalizedTagLabel}`,
      }
    }),
    [entries]
  )
  const hasPopover = preparedEntries.length > 1
  const showCategorySelect = Boolean(tagOptions && tagOptions.length > 0)
  const hasSshEntries = preparedEntries.some((e) => e.kind === 'ssh')
  const hasTagEntries = preparedEntries.some((e) => e.tag)
  const hasUncategorized = hasTagEntries && preparedEntries.some((e) => !e.tag)
  const categoryOptions = useMemo<UrlPopoverCategoryOption[]>(() => {
    if (!showCategorySelect) return []

    const options: UrlPopoverCategoryOption[] = [
      { value: 'all', label: t('common.allCategories') },
    ]

    if (hasSshEntries) {
      options.push({ value: 'ssh', label: t('common.sshConnections') })
    }

    if (hasUncategorized) {
      options.push({ value: 'uncategorized', label: t('common.uncategorized') })
    }

    for (const option of tagOptions ?? []) {
      options.push({
        value: option.value,
        label: option.label,
      })
    }

    return options
  }, [hasSshEntries, hasUncategorized, showCategorySelect, t, tagOptions])
  const categoryFilteredEntries = useMemo(() => {
    if (selectedCategory === 'all') return preparedEntries
    if (selectedCategory === 'ssh') return preparedEntries.filter((e) => e.kind === 'ssh')
    if (selectedCategory === 'uncategorized') return preparedEntries.filter((e) => !e.tag)
    return preparedEntries.filter((e) => e.tag === selectedCategory)
  }, [selectedCategory, preparedEntries])
  const normalizedQuery = query.trim().toLowerCase()
  const deferredQuery = useDeferredValue(normalizedQuery)
  const filteredEntries = useMemo(() => {
    if (!deferredQuery) return categoryFilteredEntries

    return categoryFilteredEntries.filter((entry) => {
      if (entry.searchText.includes(deferredQuery)) return true
      return (
        isFuzzySubsequence(deferredQuery, entry.normalizedLabel)
        || isFuzzySubsequence(deferredQuery, entry.normalizedUrl)
        || isFuzzySubsequence(deferredQuery, entry.normalizedDescription)
        || isFuzzySubsequence(deferredQuery, entry.normalizedTag)
        || isFuzzySubsequence(deferredQuery, entry.normalizedTagLabel)
      )
    })
  }, [deferredQuery, categoryFilteredEntries])

  const handleChangeCategory = (value: string) => {
    setSelectedCategory(value)
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus()
    })
  }

  const handleCategorySelectOpenChange = (open: boolean) => {
    if (open) {
      clearHideTimer()
      return
    }
    scheduleHide({ forceClose: true })
  }

  const updatePos = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      const viewportPadding = 12
      const triggerGap = 6
      const minVisibleHeight = 160
      const maxPopoverHeight = 440
      const idealPopoverWidth = 300
      const availableWidth = window.innerWidth - viewportPadding * 2
      const width = availableWidth > 220
        ? Math.min(idealPopoverWidth, availableWidth)
        : availableWidth

      const preferredTop = rect.bottom + triggerGap
      const highestTopForMinHeight = window.innerHeight - viewportPadding - minVisibleHeight
      const top = Math.max(viewportPadding, Math.min(preferredTop, highestTopForMinHeight))
      const availableHeight = window.innerHeight - top - viewportPadding
      const maxHeight = Math.max(96, Math.min(maxPopoverHeight, availableHeight))
      const left = Math.max(
        viewportPadding,
        Math.min(rect.left, window.innerWidth - viewportPadding - width),
      )

      setLayout({ top, left, maxHeight, width })
    }
  }

  const clearHideTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const closePopover = ({ blur = false }: { blur?: boolean } = {}) => {
    clearHideTimer()
    if (blur) {
      const activeEl = document.activeElement
      if (activeEl instanceof HTMLElement && popoverRef.current?.contains(activeEl)) {
        activeEl.blur()
      }
    }
    focusWithinRef.current = false
    hoverStateRef.current = { trigger: false, popover: false }
    setShow(false)
  }

  const isWithinInteractiveArea = (target: EventTarget | null) => (
    target instanceof Node
    && Boolean(
      triggerRef.current?.contains(target)
      || popoverRef.current?.contains(target)
      || categoryMenuRef.current?.contains(target)
      || itemActionsMenuRef.current?.contains(target)
    )
  )

  const hasSearchText = () => query.trim().length > 0
  const hasSelectedCategory = () => selectedCategory !== 'all'

  const scheduleHide = ({ forceClose }: { forceClose?: boolean } = {}) => {
    clearHideTimer()
    timerRef.current = setTimeout(() => {
      if (forceClose && (hasSearchText() || hasSelectedCategory())) return
      if (!forceClose && focusWithinRef.current) return
      if (credentialMenuOpen) return
      const activeEl = document.activeElement
      if (activeEl instanceof HTMLElement && (
        categoryMenuRef.current?.contains(activeEl)
        || itemActionsMenuRef.current?.contains(activeEl)
      )) return
      if (hoverStateRef.current.trigger || hoverStateRef.current.popover) return
      closePopover({ blur: Boolean(forceClose) })
    }, 150)
  }

  const handleTriggerEnter = () => {
    hoverStateRef.current.trigger = true
    clearHideTimer()
    updatePos()
    setShow(true)
  }

  const handleTriggerLeave = (event: ReactMouseEvent<HTMLDivElement>) => {
    hoverStateRef.current.trigger = false
    if (isWithinInteractiveArea(event.relatedTarget)) return
    scheduleHide({ forceClose: true })
  }

  const handlePopoverEnter = () => {
    hoverStateRef.current.popover = true
    clearHideTimer()
  }

  const handlePopoverLeave = (event: ReactMouseEvent<HTMLDivElement>) => {
    hoverStateRef.current.popover = false
    if (isWithinInteractiveArea(event.relatedTarget)) return
    scheduleHide({ forceClose: true })
  }

  const handleCopy = async (entry: PreparedUrlPopoverEntry) => {
    try {
      const value = entry.copyValueResolver
        ? await entry.copyValueResolver()
        : (entry.copyValue ?? entry.url)
      if (!value) return
      const copied = await copyTextToClipboard(value)
      if (!copied) return
      const key = entry.key
      setCopiedKey(key)
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current)
        copiedTimerRef.current = null
      }
      copiedTimerRef.current = setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current))
      }, 1200)
    } catch {
      return
    }
  }

  const handleCopyCredentialAction = async (entryKey: string, action: UrlPopoverCredentialAction) => {
    try {
      const copied = await action.onCopy()
      if (!copied) return
      const key = `${entryKey}:${action.key}`
      setCopiedCredentialKey(key)
      if (copiedCredentialTimerRef.current) {
        clearTimeout(copiedCredentialTimerRef.current)
        copiedCredentialTimerRef.current = null
      }
      copiedCredentialTimerRef.current = setTimeout(() => {
        setCopiedCredentialKey((current) => (current === key ? null : current))
      }, 1200)
    } catch {
      return
    }
  }

  const handleOpenEntry = async (entry: PreparedUrlPopoverEntry) => {
    if (openingEntryKey === entry.key) return

    const trackOpening = entry.kind === 'ssh'
    if (trackOpening) setOpeningEntryKey(entry.key)

    try {
      await openUrlPopoverItem(entry)
    } finally {
      if (trackOpening) {
        setOpeningEntryKey((current) => (current === entry.key ? null : current))
      }
    }
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
      if (copiedCredentialTimerRef.current) clearTimeout(copiedCredentialTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!show) {
      setQuery('')
      setCopiedKey(null)
      setCopiedCredentialKey(null)
      setOpeningEntryKey(null)
      setCredentialMenuOpen(false)
      setSelectedCategory('all')
      return
    }
    const rafId = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus()
    })
    return () => {
      window.cancelAnimationFrame(rafId)
    }
  }, [show])

  useEffect(() => {
    if (!show) return

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (isWithinInteractiveArea(event.target)) return
      closePopover({ blur: true })
    }

    window.addEventListener('mousedown', handlePointerDown)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
    }
  }, [show])

  if (!hasPopover) return <>{children}</>

  const popover = show && (
    <div
      ref={popoverRef}
      className="fixed z-[9999] flex flex-col rounded-[20px] px-1.5 py-2"
      style={{
        top: layout.top,
        left: layout.left,
        maxHeight: layout.maxHeight,
        width: layout.width,
        background: 'var(--color-popover)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-popover)',
        backdropFilter: 'saturate(145%) blur(14px)',
        WebkitBackdropFilter: 'saturate(145%) blur(14px)',
      }}
      onMouseEnter={handlePopoverEnter}
      onMouseLeave={handlePopoverLeave}
      onFocusCapture={() => {
        focusWithinRef.current = true
        clearHideTimer()
      }}
      onBlurCapture={() => {
        window.setTimeout(() => {
          const activeEl = document.activeElement
          const stillWithinPopover = activeEl instanceof Node && popoverRef.current?.contains(activeEl)
          focusWithinRef.current = Boolean(stillWithinPopover)
          if (!focusWithinRef.current) {
            scheduleHide()
          }
        }, 0)
      }}
      onContextMenu={() => closePopover({ blur: true })}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="relative z-[1] shrink-0 px-1.5 pb-2">
        <div className={showCategorySelect ? 'grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-center gap-1.5' : undefined}>
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              focusWithinRef.current = true
              clearHideTimer()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                setQuery('')
              }
            }}
            placeholder={t('common.searchLinks')}
            className={`quiet-control h-8 rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)]${showCategorySelect ? ' min-w-0 w-full' : ' w-full'}`}
          />
          {showCategorySelect && (
            <UrlPopoverCategorySelect
              value={selectedCategory}
              options={categoryOptions}
              onChange={handleChangeCategory}
              floatingMenuRef={categoryMenuRef}
              onOpenChange={handleCategorySelectOpenChange}
            />
          )}
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-1.5"
        style={{ overscrollBehavior: 'contain' }}
      >
        {filteredEntries.length === 0 ? (
          <div className="px-3 py-3 text-xs text-[color:var(--color-muted-foreground)]">
            {t('common.noMatches')}
          </div>
        ) : (
          filteredEntries.map((entry) => {
            const isCopied = copiedKey === entry.key
            const isOpening = openingEntryKey === entry.key
            return (
              <div
                key={entry.key}
                className={`group/item flex items-center gap-1.5 rounded-[14px] px-2.5 py-2 hover:bg-[color:var(--color-accent)]/70 ${
                  isOpening ? 'cursor-progress' : 'cursor-pointer'
                }`}
                role="button"
                tabIndex={0}
                aria-busy={isOpening || undefined}
                aria-disabled={isOpening || undefined}
                onClick={() => { void handleOpenEntry(entry) }}
                onKeyDown={(e) => {
                  if (isOpening) return
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    void handleOpenEntry(entry)
                  }
                }}
                aria-label={entry.label}
              >
                <div className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left text-xs text-[color:var(--color-foreground)]/88 transition-colors hover:text-[color:var(--color-foreground)]">
                  {entry.kind === 'ssh'
                    ? <Link2 className="h-3 w-3 shrink-0 text-[color:var(--color-muted-foreground)]" />
                    : <ExternalLink className="h-3 w-3 shrink-0 text-[color:var(--color-muted-foreground)]" />}
                  <div className="min-w-0 flex-1">
                    <span className="block truncate">{entry.label}</span>
                    {entry.description && (
                      <span className="block truncate text-[11px] text-[color:var(--color-muted-foreground)]">
                        {entry.description}
                      </span>
                    )}
                  </div>
                </div>
                {entry.credentialActions && entry.credentialActions.length > 0 && (
                  <UrlPopoverItemActionsMenu
                    entryKey={entry.key}
                    actions={entry.credentialActions}
                    copiedActionKey={copiedCredentialKey}
                    onCopyAction={(entryKey, action) => {
                      void handleCopyCredentialAction(entryKey, action)
                    }}
                    floatingMenuRef={itemActionsMenuRef}
                    onOpenChange={setCredentialMenuOpen}
                  />
                )}
                {isOpening ? (
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[color:var(--color-accent)] px-2 py-0.5 text-[11px] text-[color:var(--color-foreground)]"
                    aria-live="polite"
                  >
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    {t('common.opening')}
                  </span>
                ) : (
                  <button
                    type="button"
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition-all duration-300 cursor-pointer active:scale-95 ${
                      isCopied
                        ? 'scale-105 bg-[color:var(--color-success-background)] text-[color:var(--color-success)] opacity-100'
                        : 'opacity-0 text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] group-hover/item:opacity-100'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleCopy(entry)
                    }}
                  >
                    {isCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {isCopied ? t('common.copied') : (entry.copyLabel ?? t('common.copy'))}
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )

  return (
    <div
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={handleTriggerEnter}
      onMouseLeave={handleTriggerLeave}
      onContextMenuCapture={() => closePopover({ blur: true })}
    >
      {children}
      {createPortal(popover, document.body)}
    </div>
  )
}
