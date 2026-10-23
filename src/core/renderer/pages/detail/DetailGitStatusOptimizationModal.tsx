import { useEffect, useRef, useState } from 'react'
import { Gauge, Loader2, X } from 'lucide-react'
import type { GitStatusOptimizationState } from '../../../shared/types'
import { ModalShell } from '../../components/ModalShell'
import { Checkbox } from '../../components/ui/checkbox'
import { Input } from '../../components/ui/input'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'

type DetailGitStatusOptimizationModalProps = {
  onClose: () => void
  open: boolean
  repoRoot: string | undefined
}

// 大仓库 status 加速（阶段 6 / plan-detail §7）：opt-in 设置弹窗，
// 仅写仓库本地 Git 配置（--local），不改全局；未跟踪文件列表保持完整、排序稳定、可 stage。
export function DetailGitStatusOptimizationModal({ onClose, open, repoRoot }: DetailGitStatusOptimizationModalProps) {
  const { t } = useI18n()
  const [state, setState] = useState<GitStatusOptimizationState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [applyingKey, setApplyingKey] = useState<'untrackedCache' | 'fsmonitor' | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  // 变更文件列表上限：应用级设置（对所有仓库生效），持久化在 appConfig
  const configLimit = useAppStore((state) => state.config.gitChangedFilesLimit)
  const [limitInput, setLimitInput] = useState(String(configLimit ?? 99))

  useEffect(() => {
    if (!open) return
    setLimitInput(String(useAppStore.getState().config.gitChangedFilesLimit ?? 99))
  }, [open])

  const commitLimitValue = async (raw: string) => {
    const parsed = Number.parseInt(raw.trim(), 10)
    if (!Number.isFinite(parsed)) {
      setLimitInput(String(useAppStore.getState().config.gitChangedFilesLimit ?? 99))
      return
    }
    // 范围钳制在主进程 config 归一化中完成（10–2000）；
    // 保存后 useAiCommitFlow 的刷新依赖随之变化，面板会自动刷新，无需手动操作。
    await useAppStore.getState().setGitChangedFilesLimit(parsed)
    setLimitInput(String(useAppStore.getState().config.gitChangedFilesLimit ?? 99))
  }

  const commitLimitInput = () => commitLimitValue(limitInput)

  // 滚轮步进：仅聚焦时生效（+/-10，钳制 10–2000），保存统一走失焦
  const adjustLimitByWheel = (direction: 1 | -1) => {
    const current = Number.parseInt(limitInput, 10)
    const base = Number.isFinite(current) ? current : 99
    const next = Math.min(2000, Math.max(10, base + direction * 10))
    setLimitInput(String(next))
  }

  const limitInputRef = useRef<HTMLInputElement | null>(null)
  const wheelDeps = `${limitInput}|${open}`
  useEffect(() => {
    const node = limitInputRef.current
    if (!node || !open) return
    const handler = (event: WheelEvent) => {
      if (document.activeElement !== node) return
      event.preventDefault()
      adjustLimitByWheel(event.deltaY < 0 ? 1 : -1)
    }
    node.addEventListener('wheel', handler, { passive: false })
    return () => node.removeEventListener('wheel', handler)
    // adjustLimitByWheel 依赖最新 limitInput，随输入重挂
  }, [wheelDeps])

  useEffect(() => {
    if (!open || !repoRoot) return
    let cancelled = false
    setLoadError(null)
    setApplyError(null)
    setState(null)
    const api = window.electronAPI
    if (typeof api.getGitStatusOptimization !== 'function') {
      setLoadError(t('detail.gitStatusOptLoadFailed'))
      return
    }
    api
      .getGitStatusOptimization(repoRoot)
      .then((result) => {
        if (cancelled) return
        setState(result)
        setLoadError(result.error ?? null)
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      cancelled = true
    }
  }, [open, repoRoot, t])

  const applyToggle = async (key: 'untrackedCache' | 'fsmonitor', value: boolean) => {
    if (!repoRoot || applyingKey) return
    const api = window.electronAPI
    if (typeof api.setGitStatusOptimization !== 'function') {
      setApplyError(t('detail.gitStatusOptLoadFailed'))
      return
    }
    setApplyingKey(key)
    setApplyError(null)
    try {
      const result = await api.setGitStatusOptimization({ repoRoot, [key]: value })
      if (result.ok && result.state) {
        setState(result.state)
      } else {
        setApplyError(result.error || t('detail.gitStatusOptApplyFailed'))
      }
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : String(error))
    } finally {
      setApplyingKey(null)
    }
  }

  const renderToggleRow = (key: 'untrackedCache' | 'fsmonitor') => {
    const checked = state?.[key] === true
    const busy = applyingKey === key
    return (
      <label className="flex items-start gap-3 rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)] p-3">
        <Checkbox
          className="mt-0.5 h-4 w-4"
          checked={checked}
          disabled={!repoRoot || applyingKey !== null || Boolean(loadError)}
          onChange={(event) => {
            void applyToggle(key, event.target.checked)
          }}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-[12px] font-semibold text-[color:var(--color-foreground)]">
            {key === 'untrackedCache' ? t('detail.gitStatusOptUntrackedCache') : t('detail.gitStatusOptFsmonitor')}
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[color:var(--color-muted-foreground)]" /> : null}
          </span>
          <span className="mt-1 block text-[12px] leading-5 text-[color:var(--color-muted-foreground)]">{key === 'untrackedCache' ? t('detail.gitStatusOptUntrackedCacheHint') : t('detail.gitStatusOptFsmonitorHint')}</span>
          <code className="mt-1 block text-[11px] text-[color:var(--color-muted-foreground)]">{key === 'untrackedCache' ? 'core.untrackedCache' : 'core.fsmonitor'}</code>
        </span>
      </label>
    )
  }

  return (
    <ModalShell open={open} onClose={onClose} widthClassName="max-w-[520px]" baseZIndex={1130} ariaLabel={t('detail.gitStatusOptAria')}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="section-label mb-1">{t('detail.gitStatusOptTitle')}</p>
          <p className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('detail.gitStatusOptSubtitle')}</p>
        </div>
        <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]" onClick={onClose} title={t('detail.gitGuideClose')}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mb-3 text-[12px] leading-5 text-[color:var(--color-muted-foreground)]">{t('detail.gitStatusOptDescription')}</p>
      {loadError ? <p className="mb-3 rounded-[10px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-background)] p-3 text-[12px] leading-5 text-[color:var(--color-destructive)]">{loadError}</p> : null}
      <div className="space-y-2">
        {renderToggleRow('untrackedCache')}
        {renderToggleRow('fsmonitor')}
        <div className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)] p-3">
          <p className="text-[12px] font-semibold text-[color:var(--color-foreground)]">{t('detail.gitStatusOptLimit')}</p>
          <p className="mt-1 text-[12px] leading-5 text-[color:var(--color-muted-foreground)]">{t('detail.gitStatusOptLimitHint')}</p>
          <Input
            ref={limitInputRef}
            className="mt-2 h-8 w-full"
            textSize={12}
            inputMode="numeric"
            value={limitInput}
            disabled={!open}
            onChange={(event) => setLimitInput(event.target.value)}
            onBlur={() => {
              void commitLimitInput()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur()
              }
            }}
          />
        </div>
      </div>
      {applyError ? <p className="mt-3 rounded-[10px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-background)] p-3 text-[12px] leading-5 text-[color:var(--color-destructive)]">{applyError}</p> : null}
      <p className="mt-3 text-[11px] leading-4 text-[color:var(--color-muted-foreground)]">{t('detail.gitStatusOptFooter')}</p>
    </ModalShell>
  )
}

export function GitStatusOptimizationTrigger({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:opacity-50"
      onClick={onClick}
      disabled={disabled}
      title={t('detail.gitStatusOptTitle')}
      aria-label={t('detail.gitStatusOptAria')}
    >
      <Gauge className="h-4 w-4" />
    </button>
  )
}
