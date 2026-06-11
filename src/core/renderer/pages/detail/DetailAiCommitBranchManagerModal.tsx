import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { AlertTriangle, Check, ChevronDown, X } from 'lucide-react'
import { ModalShell } from '../../components/ModalShell'
import { useI18n } from '../../i18n'
import type { BranchManagerMode } from './detail.aiCommitPanel.types'

type DetailAiCommitBranchManagerModalProps = {
  branchManagerDangerText: string
  branchManagerError: string | null
  branchManagerLoading: boolean
  currentBranch: string
  currentBranchInputRef: MutableRefObject<HTMLInputElement | null>
  currentManagerDeleteTarget: string
  currentManagerInput: string
  localBranches: string[]
  mode: BranchManagerMode | null
  onChangeCurrentManagerDeleteTarget: (value: string) => void
  onChangeCurrentManagerInput: (value: string) => void
  onChangeUpstreamManagerBranchName: (value: string) => void
  onChangeUpstreamManagerDangerInput: (value: string) => void
  onChangeUpstreamManagerRemoteName: (value: string) => void
  onClose: () => void
  onCreateLocalBranch: () => void
  onCreateRemoteBranchFromUpstream: () => void
  onDeleteLocalBranch: () => void
  onSetUpstream: () => void
  upstreamBranchInputRef: MutableRefObject<HTMLInputElement | null>
  upstreamManagerBranchName: string
  upstreamManagerDangerInput: string
  upstreamManagerRemoteName: string
}

type BranchSearchSelectProps = {
  disabled?: boolean
  options: string[]
  placeholder: string
  value: string
  onChange: (value: string) => void
}

function BranchSearchSelect({
  disabled = false,
  options,
  placeholder,
  value,
  onChange,
}: BranchSearchSelectProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return options
    return options.filter((option) => option.toLowerCase().includes(normalizedQuery))
  }, [options, query])

  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })

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
      window.cancelAnimationFrame(frame)
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  return (
    <div ref={containerRef} className="relative">
      {open ? (
        <div className="quiet-control flex h-8 w-full items-center gap-2 rounded-[10px] border-[color:var(--color-ring)]/65 px-2 ring-2 ring-[color:var(--color-ring)]/22">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={value || placeholder}
            className="min-w-0 flex-1 bg-transparent font-mono text-[11.5px] text-[color:var(--color-foreground)] outline-none placeholder:font-sans placeholder:text-[color:var(--color-muted-foreground)]"
            spellCheck={false}
          />
          <button
            type="button"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
            onClick={() => setOpen(false)}
            title={t('detail.branchPanelCloseList')}
          >
            <ChevronDown className="h-3.5 w-3.5 rotate-180 transition-transform" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="quiet-control flex h-8 w-full items-center justify-between rounded-[10px] px-2 font-mono text-[11.5px] text-[color:var(--color-foreground)] transition-colors hover:border-[color:var(--color-border-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <span className={value ? 'truncate' : 'truncate font-sans text-[color:var(--color-muted-foreground)]'}>
            {value || placeholder}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
        </button>
      )}

      {open && (
        <div
          className="surface-card absolute left-0 right-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-[14px]"
          role="listbox"
          aria-label={placeholder}
        >
          <div className="max-h-[220px] overflow-auto p-1">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => {
                const selected = value === option
                return (
                  <button
                    key={option}
                    type="button"
                    className={`flex w-full items-center justify-between rounded-[10px] px-2.5 py-1.5 text-left text-[11.5px] transition-colors ${
                      selected
                        ? 'bg-[color:var(--color-primary)]/12 text-[color:var(--color-foreground)]'
                        : 'text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]'
                    }`}
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(option)
                      setOpen(false)
                    }}
                  >
                    <span className="truncate font-mono">{option}</span>
                    {selected && <Check className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-primary)]" />}
                  </button>
                )
              })
            ) : (
              <p className="px-2 py-2 text-[11px] text-[color:var(--color-muted-foreground)]">{t('detail.branchPanelNoMatch')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function DetailAiCommitBranchManagerModal({
  branchManagerDangerText,
  branchManagerError,
  branchManagerLoading,
  currentBranch,
  currentBranchInputRef,
  currentManagerDeleteTarget,
  currentManagerInput,
  localBranches,
  mode,
  onChangeCurrentManagerDeleteTarget,
  onChangeCurrentManagerInput,
  onChangeUpstreamManagerBranchName,
  onChangeUpstreamManagerDangerInput,
  onChangeUpstreamManagerRemoteName,
  onClose,
  onCreateLocalBranch,
  onCreateRemoteBranchFromUpstream,
  onDeleteLocalBranch,
  onSetUpstream,
  upstreamBranchInputRef,
  upstreamManagerBranchName,
  upstreamManagerDangerInput,
  upstreamManagerRemoteName,
}: DetailAiCommitBranchManagerModalProps) {
  const { t } = useI18n()
  const deletableLocalBranches = useMemo(
    () => localBranches.filter((name) => name !== currentBranch),
    [currentBranch, localBranches]
  )

  return (
    <ModalShell
      open={Boolean(mode)}
      onClose={onClose}
      widthClassName="max-w-[460px]"
      baseZIndex={1120}
      ariaLabel={mode === 'current' ? t('detail.branchManagerCurrentTitle') : t('detail.branchManagerUpstreamTitle')}
    >
      {mode === 'current' ? (
        <>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="section-label mb-1">{t('detail.branchManagerCurrentTitle')}</p>
              <p className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('detail.branchManagerCurrentDescription')}</p>
            </div>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
              onClick={onClose}
              title={t('detail.branchManagerClose')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-2">
            <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/62 px-3 py-2">
              <p className="mb-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">{t('detail.branchManagerNewLocalBranch')}</p>
              <input
                ref={(node) => {
                  currentBranchInputRef.current = node
                }}
                type="text"
                value={currentManagerInput}
                onChange={(event) => onChangeCurrentManagerInput(event.target.value)}
                placeholder="feature/new-branch"
                className="h-8 w-full bg-transparent font-mono text-[12px] text-[color:var(--color-foreground)] outline-none placeholder:text-[color:var(--color-muted-foreground)]"
                spellCheck={false}
              />
              <button
                type="button"
                className="mt-2 inline-flex h-8 items-center justify-center rounded-full bg-primary px-3 text-[11px] font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!currentManagerInput.trim() || branchManagerLoading}
                onClick={onCreateLocalBranch}
              >
                {branchManagerLoading ? t('detail.branchManagerCreating') : t('detail.branchManagerCreate')}
              </button>
            </div>

            <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/62 px-3 py-2">
              <p className="mb-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">{t('detail.branchManagerDeleteLocalBranch')}</p>
              <BranchSearchSelect
                value={currentManagerDeleteTarget}
                options={deletableLocalBranches}
                placeholder={t('detail.branchManagerSearchBranchesPlaceholder')}
                disabled={branchManagerLoading || deletableLocalBranches.length <= 0}
                onChange={onChangeCurrentManagerDeleteTarget}
              />
              <button
                type="button"
                className="mt-2 inline-flex h-8 items-center justify-center rounded-full bg-[color:var(--color-destructive)] px-3 text-[11px] font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!currentManagerDeleteTarget || branchManagerLoading}
                onClick={onDeleteLocalBranch}
              >
                {branchManagerLoading ? t('detail.branchManagerCreating') : t('detail.branchManagerDelete')}
              </button>
            </div>
          </div>
          {branchManagerError && (
            <p className="mt-2 rounded-[12px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-background)] px-3 py-2 text-[11px] text-[color:var(--color-destructive)]">
              {branchManagerError}
            </p>
          )}
        </>
      ) : (
        <>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="section-label mb-1">{t('detail.branchManagerUpstreamTitle')}</p>
              <p className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('detail.branchManagerUpstreamDescription')}</p>
            </div>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
              onClick={onClose}
              title={t('detail.branchManagerClose')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="rounded-[14px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-background)] px-3 py-2">
            <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-[color:var(--color-destructive)]">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t('detail.branchManagerHighRisk')}
            </p>
          </div>
          <div className="mt-2 space-y-2">
            <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/62 px-3 py-2">
              <p className="mb-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">{t('detail.branchManagerRemote')}</p>
              <input
                type="text"
                value={upstreamManagerRemoteName}
                onChange={(event) => onChangeUpstreamManagerRemoteName(event.target.value)}
                placeholder="origin"
                className="h-8 w-full bg-transparent font-mono text-[12px] text-[color:var(--color-foreground)] outline-none placeholder:text-[color:var(--color-muted-foreground)]"
                spellCheck={false}
              />
            </div>
            <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/62 px-3 py-2">
              <p className="mb-1 text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">{t('detail.branchManagerBranch')}</p>
              <input
                ref={(node) => {
                  upstreamBranchInputRef.current = node
                }}
                type="text"
                value={upstreamManagerBranchName}
                onChange={(event) => onChangeUpstreamManagerBranchName(event.target.value)}
                placeholder="feature/new-branch"
                className="h-8 w-full bg-transparent font-mono text-[12px] text-[color:var(--color-foreground)] outline-none placeholder:text-[color:var(--color-muted-foreground)]"
                spellCheck={false}
              />
            </div>
            <div className="rounded-[14px] border border-[color:var(--color-destructive)]/28 bg-[color:var(--color-destructive-background)]/55 px-3 py-2">
              <p className="text-[10.5px] text-[color:var(--color-destructive)]/92">
                {t('detail.branchManagerDangerPrompt')}
                <span className="ml-1 font-mono">{branchManagerDangerText}</span>
              </p>
              <input
                type="text"
                value={upstreamManagerDangerInput}
                onChange={(event) => onChangeUpstreamManagerDangerInput(event.target.value)}
                placeholder={branchManagerDangerText}
                className="mt-2 h-8 w-full rounded-[10px] border border-[color:var(--color-destructive)]/28 bg-[color:var(--color-background)] px-2 font-mono text-[11.5px] text-[color:var(--color-foreground)] outline-none ring-[color:var(--color-ring)] focus:ring-2"
                spellCheck={false}
              />
            </div>
          </div>
          {branchManagerError && (
            <p className="mt-2 rounded-[12px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-background)] px-3 py-2 text-[11px] text-[color:var(--color-destructive)]">
              {branchManagerError}
            </p>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-xs font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              disabled={
                branchManagerLoading
                || !upstreamManagerBranchName.trim()
                || upstreamManagerDangerInput.trim() !== branchManagerDangerText
              }
              onClick={onCreateRemoteBranchFromUpstream}
            >
              {branchManagerLoading ? t('detail.branchManagerCreating') : t('detail.branchManagerCreateRemoteBranch')}
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-full bg-[color:var(--color-destructive)] px-4 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={
                branchManagerLoading
                || !upstreamManagerBranchName.trim()
                || upstreamManagerDangerInput.trim() !== branchManagerDangerText
              }
              onClick={onSetUpstream}
            >
              {branchManagerLoading ? t('detail.branchManagerCreating') : t('detail.branchManagerBindUpstream')}
            </button>
          </div>
        </>
      )}
    </ModalShell>
  )
}
