import { Braces, FileText, MessageSquareText } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { AgentLogDetail } from '../../../../shared/types'
import { useI18n } from '../../../i18n'
import { detailToJson } from './agentLogs.helpers'
import type { AgentLogDetailTab } from './agentLogs.types'
import { AgentLogDetailHeader } from './AgentLogDetailHeader'
import { AgentLogJsonView } from './AgentLogJsonView'
import { AgentLogMarkdownView } from './AgentLogMarkdownView'
import { AgentLogRequestView } from './AgentLogRequestView'

type AgentLogDetailPaneProps = {
  detail: AgentLogDetail | null
  loading: boolean
  markdown: string
  markdownLoading: boolean
  error: string | null
}

function DetailTabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`button-interactive inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs transition-colors sm:text-sm ${
        active
          ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm'
          : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function SummaryField({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  const displayValue = value === undefined || value === null || value === ''
    ? 'n/a'
    : value

  return (
    <div className="rounded-[16px] bg-[color:var(--color-card)] px-4 py-3">
      <div className="text-xs text-[color:var(--color-muted-foreground)]">{label}</div>
      <div className="mt-1 min-h-5 break-words text-sm font-medium text-[color:var(--color-foreground)]">
        {displayValue}
      </div>
    </div>
  )
}

function SummaryView({ detail }: { detail: AgentLogDetail }) {
  const { t, formatDateTime } = useI18n()
  const summary = detail.summary
  const sourceLabel = detail.source === 'ai-gateway'
    ? t('settings.agentLogs.sourceGateway')
    : t('settings.agentLogs.sourceHooks')
  const mainMeta = detail.source === 'ai-gateway'
    ? [
      { label: t('settings.agentLogs.route'), value: detail.meta.route },
      { label: t('settings.agentLogs.provider'), value: detail.meta.providerName || detail.meta.providerId },
      { label: t('settings.agentLogs.profile'), value: detail.meta.profileId },
      { label: t('settings.agentLogs.model'), value: detail.meta.model },
      { label: t('settings.agentLogs.authSource'), value: detail.meta.authSource },
      { label: t('settings.agentLogs.authToken'), value: detail.meta.authToken ? <span className="font-mono text-xs">{detail.meta.authToken}</span> : undefined },
    ]
    : [
      { label: t('settings.agentLogs.provider'), value: detail.meta.provider },
      { label: t('settings.agentLogs.providerEvent'), value: detail.meta.providerEvent },
      { label: t('settings.agentLogs.canonicalEvent'), value: detail.meta.canonicalEvent },
      { label: t('settings.agentLogs.cwd'), value: summary.cwd },
      { label: t('settings.agentLogs.tool'), value: summary.toolName },
    ]

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <SummaryField label={t('settings.agentLogs.source')} value={sourceLabel} />
        <SummaryField label={t('settings.agentLogs.level')} value={summary.level} />
        <SummaryField
          label={t('settings.agentLogs.timestamp')}
          value={formatDateTime(summary.timestamp, {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        />
        <SummaryField label={t('settings.agentLogs.status')} value={summary.statusCode} />
        <SummaryField label={t('settings.agentLogs.duration')} value={typeof summary.durationMs === 'number' ? `${summary.durationMs}ms` : undefined} />
        <SummaryField label={t('settings.agentLogs.truncation')} value={summary.truncated ? t('settings.agentLogs.truncated') : t('settings.agentLogs.notTruncated')} />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {mainMeta.map((item) => (
          <SummaryField key={item.label} label={item.label} value={item.value} />
        ))}
        {detail.source === 'ai-gateway' && (
          <>
            <SummaryField label={t('settings.agentLogs.requestedStream')} value={detail.stream?.requested ? t('common.on') : t('common.off')} />
            <SummaryField label={t('settings.agentLogs.actualStream')} value={detail.stream?.enabled ? t('common.on') : t('common.off')} />
            <SummaryField label={t('settings.agentLogs.eventCount')} value={detail.stream?.upstreamEventCount} />
          </>
        )}
      </div>

      {detail.error ? (
        <div className="rounded-[18px] bg-[color:var(--color-destructive-background)] px-4 py-3 text-sm text-[color:var(--color-destructive)]">
          {detail.error.code ? `${detail.error.code}: ` : ''}{detail.error.message}
        </div>
      ) : null}
    </div>
  )
}

export function AgentLogDetailPane({
  detail,
  loading,
  markdown,
  markdownLoading,
  error,
}: AgentLogDetailPaneProps) {
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState<AgentLogDetailTab>('summary')
  const jsonValue = useMemo(() => detailToJson(detail), [detail])
  const tabs = (
    <div className="quiet-control inline-flex max-w-full flex-wrap gap-1 rounded-full p-1">
      <DetailTabButton
        active={activeTab === 'summary'}
        icon={<FileText className="h-4 w-4" strokeWidth={1.8} />}
        label={t('settings.agentLogs.summaryTab')}
        onClick={() => setActiveTab('summary')}
      />
      <DetailTabButton
        active={activeTab === 'request'}
        icon={<MessageSquareText className="h-4 w-4" strokeWidth={1.8} />}
        label={t('settings.agentLogs.requestTab')}
        onClick={() => setActiveTab('request')}
      />
      <DetailTabButton
        active={activeTab === 'json'}
        icon={<Braces className="h-4 w-4" strokeWidth={1.8} />}
        label={t('settings.agentLogs.jsonTab')}
        onClick={() => setActiveTab('json')}
      />
      <DetailTabButton
        active={activeTab === 'markdown'}
        icon={<FileText className="h-4 w-4" strokeWidth={1.8} />}
        label={t('settings.agentLogs.markdownTab')}
        onClick={() => setActiveTab('markdown')}
      />
    </div>
  )

  useEffect(() => {
    setActiveTab('summary')
  }, [detail?.summary.id, detail?.summary.source])

  return (
    <div className="quiet-control min-h-[520px] rounded-[24px] p-4">
      {!detail && loading ? (
        <div className="flex min-h-[420px] items-center justify-center text-sm text-[color:var(--color-muted-foreground)]">
          {t('common.loading')}
        </div>
      ) : !detail ? (
        <div className="flex min-h-[420px] items-center justify-center text-sm text-[color:var(--color-muted-foreground)]">
          {error || t('settings.agentLogs.selectLogHint')}
        </div>
      ) : (
        <div className="space-y-5">
          <AgentLogDetailHeader detail={detail} tabs={tabs} />

          {error ? (
            <div className="rounded-[16px] bg-[color:var(--color-destructive-background)] px-4 py-3 text-sm text-[color:var(--color-destructive)]">
              {error}
            </div>
          ) : null}

          {activeTab === 'summary' && <SummaryView detail={detail} />}
          {activeTab === 'request' && <AgentLogRequestView detail={detail} />}
          {activeTab === 'json' && <AgentLogJsonView value={jsonValue} />}
          {activeTab === 'markdown' && (
            <AgentLogMarkdownView markdown={markdown} loading={markdownLoading} />
          )}
        </div>
      )}
    </div>
  )
}
