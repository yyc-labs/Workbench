import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectDocLinkTag, ProjectDocTagOption } from '../../../shared/types'
import {
  PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS,
  normalizeProjectDocLinkTag,
  projectDocLinkTagLabel,
} from '../../lib/projectDocLinks'

type DetailDocumentationTagSelectProps = {
  value: ProjectDocLinkTag
  onChange: (tag: ProjectDocLinkTag) => void
  options: ReadonlyArray<ProjectDocTagOption>
  compact?: boolean
}

function DetailDocumentationTagSelect({
  value,
  onChange,
  options,
  compact = false,
}: DetailDocumentationTagSelectProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const safeOptions = useMemo(
    () => (options.length > 0 ? options : PROJECT_DOC_LINK_DEFAULT_TAG_OPTIONS),
    [options]
  )
  const normalizedValue = useMemo(
    () => normalizeProjectDocLinkTag(value, safeOptions),
    [safeOptions, value]
  )
  const currentLabel = useMemo(
    () => projectDocLinkTagLabel(normalizedValue, safeOptions),
    [normalizedValue, safeOptions]
  )

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (!containerRef.current?.contains(target)) setOpen(false)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className={`quiet-control flex w-full items-center justify-between border-0 text-left text-[color:var(--color-foreground)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
          compact
            ? 'h-9 rounded-full px-3 text-xs hover:border-[color:var(--color-border-hover)]'
            : 'h-10 rounded-full px-4 text-sm hover:border-[color:var(--color-border-hover)]'
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span>{currentLabel}</span>
        <ChevronDown
          className={`h-4 w-4 text-[color:var(--color-muted-foreground)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          className="surface-card absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-[14px]"
          role="listbox"
          aria-label="资料类型"
        >
          <div className="max-h-[220px] overflow-auto p-1">
            {safeOptions.map((option) => {
              const selected = normalizedValue === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`flex w-full items-center justify-between rounded-[10px] px-2.5 py-1.5 text-left outline-none transition-colors focus-visible:outline-none ${
                    compact ? 'text-xs' : 'text-sm'
                  } ${
                    selected
                      ? 'bg-[color:var(--color-accent)] text-[color:var(--color-foreground)]'
                      : 'text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]'
                  }`}
                  onClick={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                >
                  <span>{option.label}</span>
                  {selected && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export { DetailDocumentationTagSelect }
