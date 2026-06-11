import { useCallback, useEffect, useRef } from 'react'
import { useState, type ReactNode, type Ref } from 'react'
import { X } from 'lucide-react'
import { useI18n } from '../../i18n'

interface DebouncedSearchInputProps {
  placeholder: string
  inputClassName?: string
  debounceMs: number
  onQueryChange: (value: string) => void
  leadingIcon: ReactNode
  trailingAction?: ReactNode
  inputRef?: Ref<HTMLInputElement>
  syncValue?: string
  syncNonce?: number
}

export function DebouncedSearchInput({
  placeholder,
  inputClassName,
  debounceMs,
  onQueryChange,
  leadingIcon,
  trailingAction,
  inputRef,
  syncValue,
  syncNonce,
}: DebouncedSearchInputProps) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(syncValue ?? '')
  const lastEmittedRef = useRef('')
  const lastSyncSignatureRef = useRef<string>('')

  const emitQuery = useCallback((nextValue: string) => {
    if (lastEmittedRef.current === nextValue) return
    lastEmittedRef.current = nextValue
    onQueryChange(nextValue)
  }, [onQueryChange])

  useEffect(() => {
    const normalized = draft.trim()
    if (normalized.length === 0) {
      emitQuery('')
      return
    }

    const timer = window.setTimeout(() => {
      emitQuery(draft)
    }, debounceMs)

    return () => {
      window.clearTimeout(timer)
    }
  }, [debounceMs, draft, emitQuery])

  useEffect(() => {
    if (typeof syncValue !== 'string') return
    const signature = `${syncNonce ?? 0}:${syncValue}`
    if (signature === lastSyncSignatureRef.current) return
    lastSyncSignatureRef.current = signature
    setDraft(syncValue)
    emitQuery(syncValue)
  }, [emitQuery, syncNonce, syncValue])

  const hasValue = draft.trim().length > 0

  return (
    <>
      {leadingIcon}
      <div className="relative min-w-0 flex-1">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          className={inputClassName ?? 'code-search-input'}
          spellCheck={false}
        />
        <button
          type="button"
          className={`absolute right-2 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-opacity ${
            hasValue
              ? 'hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
              : 'pointer-events-none opacity-0'
          }`}
          onClick={() => {
            setDraft('')
            emitQuery('')
          }}
          title={t('common.clearSearch')}
          aria-label={t('common.clearSearch')}
          tabIndex={hasValue ? 0 : -1}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {trailingAction}
    </>
  )
}
