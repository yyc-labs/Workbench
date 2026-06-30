import * as React from "react"
import { createPortal } from "react-dom"
import { Check, ChevronDown, Plus } from "lucide-react"

import { cn } from "@/lib/utils"

import {
  dropdownSurfaceClassName,
  dropdownSurfaceStyle,
  resolveDropdownFallbackRect,
  useDropdownLayer,
  type DropdownAlign,
} from "./dropdown"

export type ComboboxOption = {
  value: string
  label: string
  keywords?: ReadonlyArray<string>
  disabled?: boolean
}

export type ComboboxGroup = {
  key: string
  label?: React.ReactNode
  options: ReadonlyArray<ComboboxOption>
}

interface RenderComboboxOptionState {
  selected: boolean
  highlighted: boolean
}

interface RenderCreateState {
  highlighted: boolean
}

interface RenderEmptyState {
  query: string
}

interface ComboboxRowOption {
  type: "option"
  option: ComboboxOption
}

interface ComboboxRowCreate {
  type: "create"
  value: string
}

interface ComboboxRowGroup {
  type: "group"
  group: ComboboxGroup
}

type ComboboxRow = ComboboxRowOption | ComboboxRowCreate | ComboboxRowGroup

export interface ComboboxProps {
  ariaLabel: string
  value: string
  options: ReadonlyArray<ComboboxOption>
  onChange: (value: string) => void
  groups?: ReadonlyArray<ComboboxGroup>
  pinnedOptions?: ReadonlyArray<ComboboxOption>
  placeholder?: string
  inputPlaceholder?: string
  triggerPlaceholder?: string
  disabled?: boolean
  emptyText?: string
  align?: DropdownAlign
  maxHeight?: number
  minDropdownWidth?: number
  matchTriggerWidth?: boolean
  allowCreate?: boolean
  clearSearchOnClose?: boolean
  editable?: boolean | "open"
  displayValue?: React.ReactNode
  searchValue?: string
  toggleAriaLabel?: string
  className?: string
  inputClassName?: string
  triggerClassName?: string
  contentClassName?: string
  optionClassName?: string
  createOptionClassName?: string
  groupLabelClassName?: string
  floatingContentRef?: React.Ref<HTMLDivElement>
  createIcon?: React.ReactNode
  inputLeading?: React.ReactNode
  createLabel?: (value: string, state: RenderCreateState) => React.ReactNode
  renderOption?: (option: ComboboxOption, state: RenderComboboxOptionState) => React.ReactNode
  renderDisplayValue?: (option: ComboboxOption | undefined) => React.ReactNode
  renderEmpty?: (state: RenderEmptyState) => React.ReactNode
  renderGroupLabel?: (group: ComboboxGroup) => React.ReactNode
  filterOption?: (option: ComboboxOption, query: string) => boolean
  isOptionSelected?: (option: ComboboxOption, value: string) => boolean
  onSearchValueChange?: (value: string) => void
  onOpenChange?: (open: boolean) => void
}

function assignRef<T>(ref: React.ForwardedRef<T>, value: T | null) {
  if (typeof ref === "function") {
    ref(value)
    return
  }

  if (ref) {
    ref.current = value
  }
}

function assignOptionalRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (!ref) return
  if (typeof ref === "function") {
    ref(value)
    return
  }

  ;(ref as React.MutableRefObject<T | null>).current = value
}

function nextRowIndex(rows: ReadonlyArray<ComboboxRow>, startIndex: number, direction: 1 | -1): number {
  if (rows.length === 0) return -1

  let index = startIndex
  for (let step = 0; step < rows.length; step += 1) {
    index = (index + direction + rows.length) % rows.length
    const row = rows[index]
    if (!row) continue
    if (row.type === "group") continue
    if (row.type === "create" || !row.option.disabled) return index
  }

  return -1
}

const defaultFilter = (option: ComboboxOption, query: string) => {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true

  const haystack = [
    option.label,
    option.value,
    ...(option.keywords ?? []),
  ]
    .join("\n")
    .toLowerCase()

  return haystack.includes(normalizedQuery)
}

const Combobox = React.forwardRef<HTMLInputElement, ComboboxProps>(function Combobox({
  ariaLabel,
  value,
  options,
  onChange,
  groups,
  pinnedOptions = [],
  placeholder = "Type to search",
  inputPlaceholder,
  triggerPlaceholder,
  disabled = false,
  emptyText = "No matches found",
  align = "start",
  maxHeight = 240,
  minDropdownWidth = 0,
  matchTriggerWidth = true,
  allowCreate = false,
  clearSearchOnClose = false,
  editable = true,
  displayValue,
  searchValue,
  toggleAriaLabel,
  className,
  inputClassName,
  triggerClassName,
  contentClassName,
  optionClassName,
  createOptionClassName,
  groupLabelClassName,
  floatingContentRef,
  createIcon,
  inputLeading,
  createLabel,
  renderOption,
  renderDisplayValue,
  renderEmpty,
  renderGroupLabel,
  filterOption = defaultFilter,
  isOptionSelected = (option, currentValue) => option.value === currentValue,
  onSearchValueChange,
  onOpenChange,
}, forwardedRef) {
  const [open, setOpen] = React.useState(false)
  const [highlightedIndex, setHighlightedIndex] = React.useState(-1)
  const [internalSearchValue, setInternalSearchValue] = React.useState("")
  const triggerRef = React.useRef<HTMLDivElement | null>(null)
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const isSearchControlled = searchValue !== undefined
  const resolvedSearchValue = isSearchControlled
    ? searchValue
    : editable === "open"
      ? internalSearchValue
      : value
  const deferredQuery = React.useDeferredValue(resolvedSearchValue)
  const listboxId = React.useId()
  const trimmedValue = resolvedSearchValue.trim()
  const displayLabel = displayValue ?? value
  const inputValue = editable === true || open ? resolvedSearchValue : ""

  const updateSearchValue = React.useCallback((nextValue: string) => {
    if (isSearchControlled) {
      onSearchValueChange?.(nextValue)
      return
    }

    if (editable === "open") {
      setInternalSearchValue(nextValue)
      onSearchValueChange?.(nextValue)
      return
    }

    if (onSearchValueChange) {
      onSearchValueChange(nextValue)
      return
    }

    onChange(nextValue)
  }, [editable, isSearchControlled, onChange, onSearchValueChange])

  const allOptions = React.useMemo(
    () => [
      ...pinnedOptions,
      ...options,
      ...(groups ?? []).flatMap((group) => group.options),
    ],
    [groups, options, pinnedOptions]
  )

  const matchedOption = React.useMemo(
    () => allOptions.find((option) => isOptionSelected(option, value)),
    [allOptions, isOptionSelected, value]
  )
  const displayContent = renderDisplayValue
    ? renderDisplayValue(matchedOption)
    : (displayLabel || triggerPlaceholder || placeholder)
  const showOpenDisplayOverlay = editable === "open" && open && resolvedSearchValue.length === 0
  const hasInputLeading = Boolean(inputLeading)
  const effectiveInputPlaceholder = showOpenDisplayOverlay
    ? ""
    : (inputPlaceholder ?? placeholder)

  const filteredOptions = React.useMemo(
    () => options.filter((option) => filterOption(option, deferredQuery)),
    [deferredQuery, filterOption, options]
  )

  const filteredGroups = React.useMemo(
    () => (groups ?? [])
      .map((group) => ({
        ...group,
        options: group.options.filter((option) => filterOption(option, deferredQuery)),
      }))
      .filter((group) => group.options.length > 0),
    [deferredQuery, filterOption, groups]
  )

  const rows = React.useMemo<ComboboxRow[]>(() => {
    const nextRows: ComboboxRow[] = pinnedOptions.map((option) => ({ type: "option", option }))

    if (allowCreate && trimmedValue && !matchedOption) {
      nextRows.push({ type: "create", value: trimmedValue })
    }

    if (filteredGroups.length > 0) {
      filteredGroups.forEach((group) => {
        if (group.label) {
          nextRows.push({ type: "group", group })
        }
        group.options.forEach((option) => {
          nextRows.push({ type: "option", option })
        })
      })
      return nextRows
    }

    filteredOptions.forEach((option) => {
      nextRows.push({ type: "option", option })
    })

    return nextRows
  }, [allowCreate, filteredGroups, filteredOptions, matchedOption, pinnedOptions, trimmedValue])

  const closeCombobox = React.useCallback((focusInput = false) => {
    setOpen(false)
    if (clearSearchOnClose && resolvedSearchValue) {
      updateSearchValue("")
    }
    if (focusInput) {
      window.requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
  }, [clearSearchOnClose, resolvedSearchValue, updateSearchValue])

  const { layout } = useDropdownLayer({
    open,
    onClose: () => closeCombobox(false),
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
    if (disabled) closeCombobox(false)
  }, [closeCombobox, disabled])

  React.useEffect(() => {
    if (!open) return

    const selectedIndex = rows.findIndex((row) => row.type === "option" && isOptionSelected(row.option, value))
    const nextIndex = selectedIndex >= 0
      ? selectedIndex
      : rows.findIndex((row) => (
        row.type === "create"
        || (row.type === "option" && !row.option.disabled)
      ))

    setHighlightedIndex(nextIndex)
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [isOptionSelected, open, rows, value])

  const handleSelectOption = React.useCallback((option: ComboboxOption) => {
    onChange(option.value)
    if (clearSearchOnClose) {
      updateSearchValue("")
    }
    setOpen(false)
    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      const nextLength = clearSearchOnClose ? 0 : option.value.length
      inputRef.current?.setSelectionRange(nextLength, nextLength)
    })
  }, [clearSearchOnClose, onChange, updateSearchValue])

  const handleCreate = React.useCallback((nextValue: string) => {
    onChange(nextValue)
    if (clearSearchOnClose) {
      updateSearchValue("")
    }
    setOpen(false)
    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      const nextLength = clearSearchOnClose ? 0 : nextValue.length
      inputRef.current?.setSelectionRange(nextLength, nextLength)
    })
  }, [clearSearchOnClose, onChange, updateSearchValue])

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      setHighlightedIndex((current) => nextRowIndex(rows, current < 0 ? -1 : current, 1))
      return
    }

    if (event.key === "ArrowUp") {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      setHighlightedIndex((current) => nextRowIndex(rows, current < 0 ? rows.length : current, -1))
      return
    }

    if (event.key === "Enter" && open) {
      const row = rows[highlightedIndex]
      if (!row) return

      event.preventDefault()
      if (row.type === "create") {
        handleCreate(row.value)
        return
      }

      if (row.type === "option" && !row.option.disabled) handleSelectOption(row.option)
      return
    }

    if (event.key === "Escape" && open) {
      event.preventDefault()
      closeCombobox(true)
    }
  }

  const fallbackRect = resolveDropdownFallbackRect(triggerRef)
  const scrollAreaMaxHeight = Math.max(0, (layout?.maxHeight ?? maxHeight) - 12)

  return (
    <div ref={triggerRef} className={cn("relative", className)}>
      {editable === "open" && !open ? (
        <button
          type="button"
          className={cn(
            "quiet-control flex h-10 w-full items-center rounded-full border-0 px-4 pr-11 text-left text-sm text-[color:var(--color-foreground)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            triggerClassName
          )}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          disabled={disabled}
          onClick={() => {
            setOpen(true)
            window.requestAnimationFrame(() => {
              inputRef.current?.focus()
            })
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              setOpen(true)
            }
          }}
        >
          <span className={cn(
            "min-w-0 truncate",
            !displayLabel && "text-[color:var(--color-muted-foreground)]"
          )}>
            {displayContent}
          </span>
        </button>
      ) : (
        <div className="relative">
          <input
            ref={(node) => {
              inputRef.current = node
              assignRef(forwardedRef, node)
            }}
            type="text"
            aria-label={ariaLabel}
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? listboxId : undefined}
            aria-autocomplete="list"
            value={inputValue}
            onChange={(event) => {
              updateSearchValue(event.target.value)
              if (!open) setOpen(true)
            }}
            onFocus={() => {
              if (!disabled) setOpen(true)
            }}
            onKeyDown={handleInputKeyDown}
            placeholder={effectiveInputPlaceholder}
            className={cn(
              "quiet-control flex h-10 w-full rounded-full border-0 px-4 py-2 pr-11 text-sm ring-offset-transparent placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50",
              hasInputLeading && "pl-10",
              inputClassName
            )}
            disabled={disabled}
          />
          {hasInputLeading ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 flex w-10 items-center justify-center text-[color:var(--color-muted-foreground)]"
            >
              {inputLeading}
            </div>
          ) : null}
          {showOpenDisplayOverlay ? (
            <div
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute inset-y-0 left-0 right-11 flex items-center overflow-hidden",
                hasInputLeading && "pl-10",
                inputClassName
              )}
            >
              <span className="min-w-0 truncate">
                {displayContent}
              </span>
            </div>
          ) : null}
        </div>
      )}
      <button
        type="button"
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-full text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={toggleAriaLabel ?? ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        onClick={() => {
          if (open) {
            closeCombobox(editable !== "open")
            return
          }

          setOpen(true)
          if (!open) {
            window.requestAnimationFrame(() => {
              inputRef.current?.focus()
            })
          }
        }}
      >
        <ChevronDown
          className={cn(
            "h-4 w-4 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>

      {open ? createPortal(
        <div
          ref={(node) => {
            contentRef.current = node
            assignOptionalRef(floatingContentRef, node)
          }}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className={cn(dropdownSurfaceClassName, contentClassName)}
          style={{
            ...dropdownSurfaceStyle,
            top: layout?.top ?? fallbackRect.top,
            left: layout?.left ?? fallbackRect.left,
            width: layout?.width ?? fallbackRect.width,
            maxHeight: layout?.maxHeight ?? maxHeight,
            visibility: layout ? "visible" : "hidden",
          }}
        >
          <div className="overflow-auto" style={{ maxHeight: scrollAreaMaxHeight }}>
            {rows.length > 0 ? rows.map((row, index) => {
              const highlighted = index === highlightedIndex

              if (row.type === "group") {
                return (
                  <div
                    key={`group:${row.group.key}`}
                    className={cn(
                      "px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]",
                      groupLabelClassName
                    )}
                  >
                    {renderGroupLabel ? renderGroupLabel(row.group) : row.group.label}
                  </div>
                )
              }

              if (row.type === "create") {
                return (
                  <button
                    key={`create:${row.value}`}
                    type="button"
                    role="option"
                    aria-selected={false}
                    className={cn(
                      "flex w-full items-center justify-between rounded-[13px] px-3 py-2 text-left text-sm text-[color:var(--color-foreground)] outline-none transition-colors",
                      highlighted ? "bg-[color:var(--color-accent)]" : "hover:bg-[color:var(--color-accent)]",
                      createOptionClassName
                    )}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => handleCreate(row.value)}
                  >
                    {createLabel ? createLabel(row.value, { highlighted }) : (
                      <span className="flex min-w-0 items-center gap-2">
                        {createIcon ?? <Plus className="h-4 w-4 shrink-0 text-[color:var(--color-primary)]" />}
                        <span className="truncate">Create "{row.value}"</span>
                      </span>
                    )}
                  </button>
                )
              }

              const selected = isOptionSelected(row.option, value)
              return (
                <button
                  key={row.option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={row.option.disabled}
                  className={cn(
                    "flex w-full items-center justify-between rounded-[13px] px-3 py-2 text-left text-sm text-[color:var(--color-foreground)] outline-none transition-colors",
                    selected
                      ? "bg-[color:var(--color-primary)]/12"
                      : highlighted
                        ? "bg-[color:var(--color-accent)]"
                        : "hover:bg-[color:var(--color-accent)]",
                    row.option.disabled && "cursor-not-allowed opacity-50",
                    optionClassName
                  )}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => {
                    if (!row.option.disabled) handleSelectOption(row.option)
                  }}
                >
                  {renderOption ? renderOption(row.option, { selected, highlighted }) : (
                    <>
                      <span className="min-w-0 truncate">{row.option.label}</span>
                      {selected ? <Check className="h-4 w-4 shrink-0 text-[color:var(--color-primary)]" /> : null}
                    </>
                  )}
                </button>
              )
            }) : (
              renderEmpty
                ? renderEmpty({ query: resolvedSearchValue })
                : <p className="px-3 py-2 text-sm text-[color:var(--color-muted-foreground)]">{emptyText}</p>
            )}
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  )
})

export { Combobox }
