import { Bot, Check, Copy, RadioTower } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { AgentLogDetail } from '../../../../shared/types'
import { Button } from '../../../components/ui/button'
import { useI18n } from '../../../i18n'

type AgentLogDetailHeaderProps = {
  detail: AgentLogDetail
  tabs: ReactNode
}

function badgeClassName(tone: 'neutral' | 'success' | 'warn' | 'error'): string {
  if (tone === 'error') return 'bg-[color:var(--color-destructive-background)] text-[color:var(--color-destructive)]'
  if (tone === 'warn') return 'bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]'
  if (tone === 'success') return 'bg-[color:var(--color-success-background)] text-[color:var(--color-success)]'
  return 'bg-[color:var(--color-card)] text-[color:var(--color-muted-foreground)]'
}

function DetailBadge({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'warn' | 'error'; children: ReactNode }) {
  return (
    <span className={`inline-flex max-w-full items-center rounded-full px-3 py-1 text-xs font-medium ${badgeClassName(tone)}`}>
      <span className="truncate">{children}</span>
    </span>
  )
}

export function AgentLogDetailHeader({ detail, tabs }: AgentLogDetailHeaderProps) {
  const { t, formatDateTime } = useI18n()
  const [copied, setCopied] = useState(false)
  const sourceLabel = detail.source === 'ai-gateway'
    ? t('settings.agentLogs.sourceGateway')
    : t('settings.agentLogs.sourceHooks')
  const sourceIcon = detail.source === 'ai-gateway'
    ? <Bot className="h-3.5 w-3.5" strokeWidth={1.8} />
    : <RadioTower className="h-3.5 w-3.5" strokeWidth={1.8} />
  const requestId = detail.meta.requestId || detail.summary.id
  const statusTone = detail.error || detail.summary.level === 'error'
    ? 'error'
    : detail.summary.level === 'warn' || detail.summary.truncated
      ? 'warn'
      : 'success'

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1200)
    return () => window.clearTimeout(timer)
  }, [copied])

  const handleCopyRequestId = async () => {
    await navigator.clipboard.writeText(requestId)
    setCopied(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-[color:var(--color-muted-foreground)]">
            {sourceIcon}
            {sourceLabel}
          </div>
          <h3 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[color:var(--color-foreground)]">
            {detail.summary.title}
          </h3>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
            <span className="max-w-[min(100%,420px)] truncate rounded-full bg-[color:var(--color-card)] px-3 py-1 font-mono text-[11px] text-[color:var(--color-muted-foreground)]">
              {t('settings.agentLogs.requestId')}: {requestId}
            </span>
            <Button
              type="button"
              variant="outline"
              className="h-7 rounded-full px-2.5 text-[11px]"
              onClick={() => void handleCopyRequestId()}
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? t('common.copied') : t('settings.agentLogs.copyRequestId')}
            </Button>
          </div>
        </div>
        {tabs}
      </div>

      <div className="flex flex-wrap gap-2">
        <DetailBadge tone={statusTone}>{detail.summary.level}</DetailBadge>
        {typeof detail.summary.statusCode === 'number' ? (
          <DetailBadge tone={detail.summary.statusCode >= 400 ? 'error' : 'neutral'}>
            {t('settings.agentLogs.status')}: {detail.summary.statusCode}
          </DetailBadge>
        ) : null}
        {typeof detail.summary.durationMs === 'number' ? (
          <DetailBadge>{t('settings.agentLogs.duration')}: {detail.summary.durationMs}ms</DetailBadge>
        ) : null}
        {detail.source === 'ai-gateway' && (detail.meta.providerName || detail.meta.providerId) ? (
          <DetailBadge>{detail.meta.providerName || detail.meta.providerId}</DetailBadge>
        ) : null}
        {detail.source === 'ai-gateway' && detail.meta.model ? (
          <DetailBadge>{detail.meta.model}</DetailBadge>
        ) : null}
        {detail.source === 'agent-hooks' ? (
          <DetailBadge>{detail.meta.canonicalEvent || detail.meta.providerEvent}</DetailBadge>
        ) : null}
        {detail.source === 'ai-gateway' && detail.stream?.enabled ? (
          <DetailBadge tone="warn">{t('settings.agentLogs.stream')}</DetailBadge>
        ) : null}
        {detail.summary.truncated ? (
          <DetailBadge tone="warn">{t('settings.agentLogs.truncated')}</DetailBadge>
        ) : null}
        {detail.error ? (
          <DetailBadge tone="error">
            {detail.error.code ? `${detail.error.code}: ` : ''}{detail.error.message}
          </DetailBadge>
        ) : null}
        <DetailBadge>
          {formatDateTime(detail.summary.timestamp, {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </DetailBadge>
      </div>
    </div>
  )
}
