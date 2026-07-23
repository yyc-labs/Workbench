import * as React from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'

import { dropdownSurfaceClassName, dropdownSurfaceStyle, resolveDropdownFallbackRect, useDropdownLayer, type DropdownAlign } from './dropdown'

export type SelectOption = {
  value: string
  label: React.ReactNode
  disabled?: boolean
  actions?: Array<{
    label: string
    ariaLabel: string
    onClick: () => void | Promise<void>
  }>
}

interface RenderSelectOptionState {
  selected: boolean
  highlighted: boolean
}

export interface SelectProps {
  ariaLabel: string
  value: string
  options: ReadonlyArray<SelectOption>
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  emptyText?: string
  align?: DropdownAlign
  maxHeight?: number
  minDropdownWidth?: number
  matchTriggerWidth?: boolean
  className?: string
  triggerClassName?: string
  contentClassName?: string
  optionClassName?: string
  floatingContentRef?: React.Ref<HTMLDivElement>
  renderValue?: (option: SelectOption | undefined) => React.ReactNode
  renderOption?: (option: SelectOption, state: RenderSelectOptionState) => React.ReactNode
  isOptionSelected?: (option: SelectOption, value: string) => boolean
  onOpenChange?: (open: boolean) => void
}

function assignRef<T>(ref: React.ForwardedRef<T>, value: T | null) {
  if (typeof ref === 'function') {
    ref(value)
    return
  }

  if (ref) {
    ref.current = value
  }
}

function assignOptionalRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (!ref) return
  if (typeof ref === 'function') {
    ref(value)
    return
  }

  ;(ref as React.MutableRefObject<T | null>).current = value
}

function nextEnabledIndex(options: ReadonlyArray<SelectOption>, startIndex: number, direction: 1 | -1): number {
  if (options.length === 0) return -1

  let index = startIndex
  for (let step = 0; step < options.length; step += 1) {
    index = (index + direction + options.length) % options.length
    if (!options[index]?.disabled) return index
  }

  return -1
}

const Select = React.forwardRef<HTMLButtonElement, SelectProps>(function Select(
  {
    ariaLabel,
    value,
    options,
    onChange,
    placeholder = 'Select an option',
    disabled = false,
    emptyText = 'No options available',
    align = 'start',
    maxHeight = 240,
    minDropdownWidth = 0,
    matchTriggerWidth = true,
    className,
    triggerClassName,
    contentClassName,
    optionClassName,
    floatingContentRef,
    renderValue,
    renderOption,
    isOptionSelected = (option, currentValue) => option.value === currentValue,
    onOpenChange,
  },
  forwardedRef,
) {
  const [open, setOpen] = React.useState(false)
  const [highlightedIndex, setHighlightedIndex] = React.useState(-1)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const listboxId = React.useId()
  const selectedIndex = options.findIndex((option) => isOptionSelected(option, value))
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined

  const { layout } = useDropdownLayer({
    open,
    onClose: () => setOpen(false),
    triggerRef,
    contentRef,
    preferredMaxHeight: maxHeight,
    minWidth: minDropdownWidth,
    align,
    matchTriggerWidth,
  })

  React.useEffect(() => {
    onOpenChange?.(open)
  }, [onOpenChange, open])

  React.useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  React.useEffect(() => {
    if (!open) return

    const nextIndex = selectedIndex >= 0 ? selectedIndex : options.findIndex((option) => !option.disabled)

    setHighlightedIndex(nextIndex)
    const frame = window.requestAnimationFrame(() => {
      contentRef.current?.focus()
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [open, options, selectedIndex])

  const handleSelect = React.useCallback(
    (nextValue: string) => {
      onChange(nextValue)
      setOpen(false)
      window.requestAnimationFrame(() => {
        triggerRef.current?.focus()
      })
    },
    [onChange],
  )

  const handleOptionAction = React.useCallback((action: NonNullable<SelectOption['actions']>[number]) => {
    if (!action) return
    void action.onClick()
    setOpen(false)
    window.requestAnimationFrame(() => {
      triggerRef.current?.focus()
    })
  }, [])

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedIndex((current) => nextEnabledIndex(options, current < 0 ? -1 : current, 1))
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex((current) => nextEnabledIndex(options, current < 0 ? options.length : current, -1))
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      setHighlightedIndex(options.findIndex((option) => !option.disabled))
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      for (let index = options.length - 1; index >= 0; index -= 1) {
        if (!options[index]?.disabled) {
          setHighlightedIndex(index)
          break
        }
      }
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const option = options[highlightedIndex]
      if (option && !option.disabled) handleSelect(option.value)
      return
    }

    if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  const fallbackRect = resolveDropdownFallbackRect(triggerRef)
  const scrollAreaMaxHeight = Math.max(0, (layout?.maxHeight ?? maxHeight) - 12)

  return (
    <div className={cn('relative', className)}>
      <button
        ref={(node) => {
          triggerRef.current = node
          assignRef(forwardedRef, node)
        }}
        type="button"
        className={cn(
          'quiet-control flex h-10 w-full items-center justify-between rounded-full border-0 px-4 text-left text-sm text-[color:var(--color-foreground)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          open && 'bg-[color:var(--color-popover)] shadow-[0_10px_24px_rgba(15,23,42,0.08)]',
          triggerClassName,
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          if (options.length === 0) return
          setOpen((current) => !current)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (!open) {
              setOpen(true)
              return
            }
          }

          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setOpen((current) => !current)
          }
        }}
      >
        <span className={cn('min-w-0 truncate', !selectedOption && 'text-[color:var(--color-muted-foreground)]')}>{renderValue ? renderValue(selectedOption) : (selectedOption?.label ?? placeholder)}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)] transition-transform duration-200', open && 'rotate-180')} />
      </button>

      {open
        ? createPortal(
            <div
              ref={(node) => {
                contentRef.current = node
                assignOptionalRef(floatingContentRef, node)
              }}
              id={listboxId}
              role="listbox"
              aria-label={ariaLabel}
              tabIndex={-1}
              onKeyDown={handleMenuKeyDown}
              className={cn(dropdownSurfaceClassName, contentClassName)}
              style={{
                ...dropdownSurfaceStyle,
                top: layout?.top ?? fallbackRect.top,
                left: layout?.left ?? fallbackRect.left,
                width: layout?.width ?? fallbackRect.width,
                maxHeight: layout?.maxHeight ?? maxHeight,
                visibility: layout ? 'visible' : 'hidden',
              }}
            >
              <div className="overflow-auto" style={{ maxHeight: scrollAreaMaxHeight }}>
                {options.length > 0 ? (
                  options.map((option, index) => {
                    const selected = isOptionSelected(option, value)
                    const highlighted = index === highlightedIndex

                    const optionContent = renderOption ? (
                      renderOption(option, { selected, highlighted })
                    ) : (
                      <>
                        <span className="min-w-0 truncate">{option.label}</span>
                        {selected ? <Check className="h-4 w-4 shrink-0 text-[color:var(--color-primary)]" /> : null}
                      </>
                    )
                    const optionClass = cn(
                      'flex w-full items-center justify-between rounded-[13px] px-3 py-2 text-left text-sm text-[color:var(--color-foreground)] outline-none transition-colors',
                      selected ? 'bg-[color:var(--color-primary)]/12' : highlighted ? 'bg-[color:var(--color-accent)]' : 'hover:bg-[color:var(--color-accent)]',
                      option.disabled && 'cursor-not-allowed opacity-50',
                      optionClassName,
                    )

                    if (option.actions && option.actions.length > 0) {
                      return (
                        <div key={option.value} role="option" aria-selected={selected} className={optionClass} onMouseEnter={() => setHighlightedIndex(index)}>
                          <button type="button" className="flex min-w-0 flex-1 items-center text-left outline-none" disabled={option.disabled} onClick={() => handleSelect(option.value)}>
                            {optionContent}
                          </button>
                          <span className="ml-2 flex shrink-0 items-center gap-1">
                            {option.actions.map((action) => (
                              <button
                                key={action.ariaLabel}
                                type="button"
                                className="rounded-full px-2 py-1 text-[10px] font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-card)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                                aria-label={action.ariaLabel}
                                title={action.ariaLabel}
                                disabled={option.disabled}
                                onClick={() => handleOptionAction(action)}
                              >
                                {action.label}
                              </button>
                            ))}
                          </span>
                        </div>
                      )
                    }

                    return (
                      <button key={option.value} type="button" role="option" aria-selected={selected} disabled={option.disabled} className={optionClass} onMouseEnter={() => setHighlightedIndex(index)} onClick={() => handleSelect(option.value)}>
                        {optionContent}
                      </button>
                    )
                  })
                ) : (
                  <p className="px-3 py-2 text-sm text-[color:var(--color-muted-foreground)]">{emptyText}</p>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
})

export { Select }
