import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '../../../components/ui/button'
import { useI18n } from '../../../i18n'
import type { ProcessPortInfo } from '../../../../shared/types'
import { FALLBACK_GROUP, groupProcessesByType } from './processGrouping'
import { useProcessPortInventory } from './useProcessPortInventory'

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to the textarea-based fallback below.
    }
  }
  if (typeof document === 'undefined') return false

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '-9999px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  } finally {
    document.body.removeChild(textarea)
  }
  return copied
}

function CopyChip({ copied, onCopy, ariaLabel, children }: { copied: boolean; onCopy: () => void; ariaLabel: string; children: ReactNode }) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={ariaLabel}
      title={copied ? t('common.copied') : t('common.copy')}
      className="button-interactive inline-flex items-center gap-1 rounded-full bg-[color:var(--color-card)] px-2.5 py-1 font-mono text-[11px] text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]"
    >
      {copied ? <Check className="h-3 w-3 text-[color:var(--color-success)]" strokeWidth={2.2} /> : <Copy className="h-3 w-3 text-[color:var(--color-muted-foreground)]" strokeWidth={2} />}
      <span className="truncate">{children}</span>
    </button>
  )
}

function ProcessRow({ process, copiedKey, onCopy }: { process: ProcessPortInfo; copiedKey: string | null; onCopy: (key: string, value: string) => void }) {
  const pidKey = `pid-${process.pid}`
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[color:var(--color-foreground)]">{process.name}</p>
        {process.command ? <p className="mt-0.5 truncate font-mono text-[11px] text-[color:var(--color-muted-foreground)]">{process.command}</p> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        <CopyChip copied={copiedKey === pidKey} onCopy={() => onCopy(pidKey, String(process.pid))} ariaLabel={`PID ${process.pid}`}>
          PID {process.pid}
        </CopyChip>
        {process.ports.map((port) => {
          const portKey = `port-${process.pid}-${port}`
          return (
            <CopyChip key={portKey} copied={copiedKey === portKey} onCopy={() => onCopy(portKey, String(port))} ariaLabel={String(port)}>
              {port}
            </CopyChip>
          )
        })}
      </div>
    </div>
  )
}

export function SettingsProcessesPanel() {
  const { t } = useI18n()
  const { inventory, loading, refresh } = useProcessPortInventory()
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  useEffect(() => {
    if (!copiedKey) return
    const timer = window.setTimeout(() => setCopiedKey(null), 1200)
    return () => {
      window.clearTimeout(timer)
    }
  }, [copiedKey])

  const handleCopy = async (key: string, value: string) => {
    const ok = await copyTextToClipboard(value)
    if (ok) setCopiedKey(key)
  }

  // 只展示配置了分组的已知进程类型（如 Node.js），未命中的进程暂不展示。
  const visibleGroups = inventory ? groupProcessesByType(inventory.processes).filter(({ group }) => group.key !== FALLBACK_GROUP.key) : []

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-label mb-3">{t('settingsProcesses.kicker')}</p>
          <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">{t('settingsProcesses.title')}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[color:var(--color-muted-foreground)]">{t('settingsProcesses.description')}</p>
        </div>
        <Button variant="outline" className="quiet-control h-8 rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]" onClick={() => void refresh()} loading={loading}>
          {loading ? t('settingsProcesses.refreshing') : t('settingsProcesses.refresh')}
        </Button>
      </div>

      <div className="mt-6 h-[420px]">
        {loading || !inventory ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsProcesses.refreshing')}</p>
          </div>
        ) : inventory.error ? (
          <div className="flex h-full items-center justify-center px-4">
            <p className="text-xs leading-5 text-red-700 dark:text-red-200">{t('settingsProcesses.error', { message: inventory.error })}</p>
          </div>
        ) : visibleGroups.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settingsProcesses.empty')}</p>
          </div>
        ) : (
          <div className="h-full space-y-3 overflow-y-auto pb-2">
            {visibleGroups.map(({ group, items }) => (
              <div key={group.key} className="rounded-[22px] border px-5 py-4 surface-card" style={{ borderColor: 'var(--color-border)' }}>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-medium text-[color:var(--color-foreground)]">{t(group.labelKey)}</p>
                  <span className="text-xs text-[color:var(--color-muted-foreground)]">{items.length}</span>
                </div>
                <div className="space-y-3">
                  {items.map((process) => (
                    <ProcessRow key={`${process.pid}-${process.host}`} process={process} copiedKey={copiedKey} onCopy={handleCopy} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
