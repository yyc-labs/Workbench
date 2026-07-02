import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { AgentLogDetail, AgentLogSummary } from '../../../shared/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/appStore'
import { AgentLogDetailPane } from './agentLogs/AgentLogDetailPane'
import { AgentLogFiltersBar } from './agentLogs/AgentLogFiltersBar'
import { agentLogKey, matchesAgentLogFilters } from './agentLogs/agentLogs.helpers'
import type { AgentLogFilters, AgentLogSelection } from './agentLogs/agentLogs.types'
import { AgentLogSummaryList } from './agentLogs/AgentLogSummaryList'

const DEFAULT_FILTERS: AgentLogFilters = {
  source: 'all',
  level: 'all',
  route: 'all',
  query: '',
}

export function SettingsAgentLogsPanel() {
  const { t } = useI18n()
  const agentLogsEnabled = useAppStore((s) => s.config.agentLogs?.enabled ?? true)
  const setAgentLogConfig = useAppStore((s) => s.setAgentLogConfig)
  const [summaries, setSummaries] = useState<AgentLogSummary[]>([])
  const [filters, setFilters] = useState<AgentLogFilters>(DEFAULT_FILTERS)
  const [selection, setSelection] = useState<AgentLogSelection | null>(null)
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list')
  const [detail, setDetail] = useState<AgentLogDetail | null>(null)
  const [markdown, setMarkdown] = useState('')
  const [loadingSummaries, setLoadingSummaries] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [loadingMarkdown, setLoadingMarkdown] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [savingCapture, setSavingCapture] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const deferredFilters = useDeferredValue(filters)

  const filteredSummaries = useMemo(
    () => summaries.filter((summary) => matchesAgentLogFilters(summary, deferredFilters)),
    [deferredFilters, summaries],
  )

  const selectedKey = selection ? agentLogKey(selection) : null

  const handleSelectLog = (item: AgentLogSummary) => {
    setSelection({ source: item.source, id: item.id })
    setMobileView('detail')
  }

  const loadSummaries = async () => {
    setLoadingSummaries(true)
    setError(null)
    try {
      const nextSummaries = await window.electronAPI.getAgentLogSummaries()
      setSummaries(nextSummaries)
      setSelection((current) => {
        if (current && nextSummaries.some((item) => item.source === current.source && item.id === current.id)) {
          return current
        }
        return nextSummaries[0] ? { source: nextSummaries[0].source, id: nextSummaries[0].id } : null
      })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('settings.agentLogs.loadError'))
    } finally {
      setLoadingSummaries(false)
    }
  }

  useEffect(() => {
    void loadSummaries()
    const timer = window.setInterval(() => {
      void loadSummaries().catch(() => undefined)
    }, 3500)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!selection) {
      setDetail(null)
      setMarkdown('')
      setMobileView('list')
      return
    }

    let canceled = false
    setLoadingDetail(true)
    setLoadingMarkdown(true)
    setError(null)
    setDetail(null)
    setMarkdown('')

    window.electronAPI.getAgentLogDetail(selection.source, selection.id)
      .then((nextDetail) => {
        if (!canceled) {
          setDetail(nextDetail)
          if (!nextDetail) {
            setError(t('settings.agentLogs.detailMissing'))
          }
        }
      })
      .catch((loadError) => {
        if (!canceled) {
          setError(loadError instanceof Error ? loadError.message : t('settings.agentLogs.loadError'))
        }
      })
      .finally(() => {
        if (!canceled) {
          setLoadingDetail(false)
        }
      })

    window.electronAPI.getAgentLogMarkdown(selection.source, selection.id)
      .then((nextMarkdown) => {
        if (!canceled) {
          setMarkdown(nextMarkdown)
        }
      })
      .catch((loadError) => {
        if (!canceled) {
          setMarkdown(loadError instanceof Error ? loadError.message : t('settings.agentLogs.markdownError'))
        }
      })
      .finally(() => {
        if (!canceled) {
          setLoadingMarkdown(false)
        }
      })

    return () => {
      canceled = true
    }
  }, [selection?.source, selection?.id, t])

  useEffect(() => {
    if (filteredSummaries.length === 0) {
      setSelection(null)
      return
    }

    if (!selection && filteredSummaries[0]) {
      setSelection({
        source: filteredSummaries[0].source,
        id: filteredSummaries[0].id,
      })
      return
    }

    if (selection && filteredSummaries.length > 0) {
      const stillVisible = filteredSummaries.some((item) => item.source === selection.source && item.id === selection.id)
      if (!stillVisible) {
        setSelection({
          source: filteredSummaries[0].source,
          id: filteredSummaries[0].id,
        })
      }
    }
  }, [filteredSummaries, selection])

  const handleLogCaptureToggle = async (enabled: boolean) => {
    setSavingCapture(true)
    setError(null)
    try {
      await setAgentLogConfig({ enabled })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('settings.agentLogs.captureSaveError'))
    } finally {
      setSavingCapture(false)
    }
  }

  const handleClearLogs = async () => {
    setClearing(true)
    setError(null)
    try {
      await window.electronAPI.clearAgentLogs()
      setDetail(null)
      setMarkdown('')
      setSelection(null)
      setMobileView('list')
      await loadSummaries()
      setClearConfirmOpen(false)
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : t('settings.agentLogs.clearError'))
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="space-y-6 lg:space-y-7">
      <div>
        <p className="section-label mb-3">{t('settings.agentLogs.kicker')}</p>
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">
          {t('settings.agentLogs.title')}
        </h2>
        <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2">
          {t('settings.agentLogs.description')}
        </p>
      </div>

      <AgentLogFiltersBar
        filters={filters}
        loading={loadingSummaries}
        total={summaries.length}
        filtered={filteredSummaries.length}
        onChange={setFilters}
        onRefresh={() => void loadSummaries()}
        onClear={() => setClearConfirmOpen(true)}
        clearing={clearing}
        clearDisabled={summaries.length === 0}
        logCaptureEnabled={agentLogsEnabled}
        logCaptureSaving={savingCapture}
        onLogCaptureToggle={(enabled) => void handleLogCaptureToggle(enabled)}
      />

      <div className="quiet-control flex rounded-full p-1 lg:hidden">
        <button
          type="button"
          onClick={() => setMobileView('list')}
          className={`button-interactive flex-1 rounded-full px-3 py-2 text-sm transition-colors ${
            mobileView === 'list'
              ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm'
              : 'text-[color:var(--color-muted-foreground)]'
          }`}
        >
          {t('settings.agentLogs.listPane')}
        </button>
        <button
          type="button"
          onClick={() => setMobileView('detail')}
          disabled={!selection}
          className={`button-interactive flex-1 rounded-full px-3 py-2 text-sm transition-colors disabled:opacity-50 ${
            mobileView === 'detail'
              ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm'
              : 'text-[color:var(--color-muted-foreground)]'
          }`}
        >
          {t('settings.agentLogs.detailPane')}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(280px,0.62fr)_minmax(0,1.38fr)] 2xl:grid-cols-[minmax(340px,0.68fr)_minmax(0,1.32fr)]">
        <div className={`${mobileView === 'list' ? 'block' : 'hidden'} lg:sticky lg:top-0 lg:block lg:self-start`}>
          <AgentLogSummaryList
            items={filteredSummaries}
            selectedKey={selectedKey}
            emptyReason={summaries.length > 0 ? 'filtered' : 'none'}
            onSelect={handleSelectLog}
          />
        </div>
        <div className={`${mobileView === 'detail' ? 'block' : 'hidden'} lg:block`}>
          <button
            type="button"
            onClick={() => setMobileView('list')}
            className="button-interactive mb-3 inline-flex rounded-full px-3 py-2 text-sm text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-card)] hover:text-[color:var(--color-foreground)] lg:hidden"
          >
            {t('settings.agentLogs.backToList')}
          </button>
          <AgentLogDetailPane
            detail={detail}
            loading={loadingDetail}
            markdown={markdown}
            markdownLoading={loadingMarkdown}
            error={error}
          />
        </div>
      </div>

      <ConfirmDialog
        open={clearConfirmOpen}
        onClose={() => setClearConfirmOpen(false)}
        onConfirm={handleClearLogs}
        ariaLabel={t('settings.agentLogs.clearConfirmLabel')}
        title={t('settings.agentLogs.clearConfirmTitle')}
        description={t('settings.agentLogs.clearConfirmDescription', { count: summaries.length })}
        confirmLabel={t('settings.agentLogs.clearConfirmAction')}
        confirmVariant="destructive"
        busy={clearing}
      />
    </div>
  )
}
