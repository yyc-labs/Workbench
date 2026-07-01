import { AlertTriangle, Braces, FileText, Rows3 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useI18n } from '../../../i18n'
import { AgentLogCollapsibleJson } from './AgentLogCollapsibleJson'
import { AgentLogExpandableText } from './AgentLogExpandableText'
import { AgentLogMessageList } from './AgentLogMessageList'
import { AgentLogToolSummary } from './AgentLogToolSummary'
import {
  displayText,
  extractTextBlocks,
  formatBytes,
  isRecord,
  stringifyUnknown,
  toDisplayString,
} from './agentLogs.display'
import type { AgentLogFlowStep } from './agentLogs.flow'
import { getStepBodyValue } from './agentLogs.flow'

type Field = {
  label: string
  value: ReactNode
}

function isEmptyValue(value: ReactNode): boolean {
  return value === undefined || value === null || value === ''
}

function SectionBlock({
  title,
  icon,
  children,
  defaultOpen = true,
}: {
  title: string
  icon: ReactNode
  children: ReactNode
  defaultOpen?: boolean
}) {
  return (
    <details
      open={defaultOpen}
      className="rounded-[18px] border bg-[color:var(--color-card)] px-4 py-3"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <summary className="cursor-pointer list-none">
        <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--color-foreground)]">
          {icon}
          {title}
        </div>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  )
}

function OverviewField({ label, value }: Field) {
  if (isEmptyValue(value)) return null

  return (
    <div className="rounded-[14px] bg-[color:var(--color-background-sunken)]/55 px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">
        {label}
      </div>
      <div className="mt-1 break-words text-sm font-medium text-[color:var(--color-foreground)]">
        {value}
      </div>
    </div>
  )
}

function CompactField({ label, value }: { label: string; value: unknown }) {
  if (typeof value === 'undefined' || value === null || value === '') return null
  const displayValue = typeof value === 'boolean' ? String(value) : stringifyUnknown(value)

  return (
    <div className="rounded-[14px] bg-[color:var(--color-background-sunken)]/55 px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">
        {label}
      </div>
      <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-[color:var(--color-foreground)]">
        {displayValue}
      </pre>
    </div>
  )
}

function TextBlock({
  label,
  text,
  truncated,
}: {
  label: string
  text: string
  truncated?: boolean
}) {
  return (
    <div className="rounded-[18px] border bg-[color:var(--color-card)] px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
      <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-[color:var(--color-background-sunken)]/70 px-3 py-1 text-xs font-medium text-[color:var(--color-muted-foreground)]">
        <FileText className="h-3.5 w-3.5" strokeWidth={1.8} />
        {label}
      </div>
      <AgentLogExpandableText text={text} truncated={truncated} />
    </div>
  )
}

function topLevelEntries(value: unknown): Array<[string, unknown]> {
  if (!isRecord(value)) return []
  const skipped = new Set(['messages', 'input', 'instructions', 'system', 'tools'])
  return Object.entries(value).filter(([key]) => !skipped.has(key))
}

function snapshotFields(step: AgentLogFlowStep, labels: ReturnType<typeof useI18n>['t']): Field[] {
  const snapshot = step.body ?? step.request?.body ?? step.response?.body
  return [
    { label: labels('settings.agentLogs.contentType'), value: snapshot?.contentType },
    { label: labels('settings.agentLogs.bodySize'), value: formatBytes(snapshot?.sizeBytes) },
    { label: labels('settings.agentLogs.truncation'), value: snapshot?.truncated ? labels('settings.agentLogs.truncated') : undefined },
    { label: labels('settings.agentLogs.parseError'), value: snapshot?.parseError },
  ]
}

function overviewFields(step: AgentLogFlowStep, labels: ReturnType<typeof useI18n>['t']): Field[] {
  return [
    { label: labels('settings.agentLogs.method'), value: step.request?.method },
    { label: labels('settings.agentLogs.path'), value: step.request?.path },
    { label: labels('settings.agentLogs.url'), value: step.request?.url },
    { label: labels('settings.agentLogs.query'), value: step.request?.query ? stringifyUnknown(step.request.query) : undefined },
    { label: labels('settings.agentLogs.status'), value: step.response?.statusCode },
    ...snapshotFields(step, labels),
  ]
}

function HeadersBlock({ step }: { step: AgentLogFlowStep }) {
  const { t } = useI18n()
  const headers = step.request?.headers ?? step.response?.headers
  if (!headers) return null

  return (
    <SectionBlock
      title={t('settings.agentLogs.headers')}
      icon={<Rows3 className="h-4 w-4" strokeWidth={1.8} />}
      defaultOpen={false}
    >
      <AgentLogCollapsibleJson
        value={headers}
        defaultExpandedDepth={1}
        maxHeightClassName="max-h-[320px]"
        className="bg-[color:var(--color-background-sunken)]/70"
      />
    </SectionBlock>
  )
}

function BodySummary({ step }: { step: AgentLogFlowStep }) {
  const { t } = useI18n()
  const value = getStepBodyValue(step)
  const snapshot = step.body ?? step.request?.body ?? step.response?.body
  const record = isRecord(value) ? value : null
  const entries = topLevelEntries(value)

  if (typeof value === 'undefined') {
    return (
      <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-6 text-center text-sm text-[color:var(--color-muted-foreground)]">
        {t('settings.agentLogs.noStructuredBody')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {record && entries.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {entries.map(([key, child]) => (
            <CompactField key={key} label={key} value={child} />
          ))}
        </div>
      ) : null}

      {record?.system ? (
        <TextBlock
          label={t('settings.agentLogs.systemPrompt')}
          text={extractTextBlocks(record.system).join('\n\n')}
          truncated={snapshot?.truncated}
        />
      ) : null}

      {record?.instructions ? (
        <TextBlock
          label={t('settings.agentLogs.instructions')}
          text={extractTextBlocks(record.instructions).join('\n\n')}
          truncated={snapshot?.truncated}
        />
      ) : null}

      <AgentLogMessageList value={value} />

      {record?.tools ? (
        <AgentLogToolSummary value={record.tools} />
      ) : null}

      {!record ? (
        <TextBlock
          label={t('settings.agentLogs.bodySummary')}
          text={toDisplayString(value)}
          truncated={snapshot?.truncated}
        />
      ) : null}
    </div>
  )
}

function RawJsonBlock({ step }: { step: AgentLogFlowStep }) {
  const { t } = useI18n()
  const value = getStepBodyValue(step)
  if (typeof value === 'undefined') return null

  return (
    <SectionBlock
      title={t('settings.agentLogs.rawJson')}
      icon={<Braces className="h-4 w-4" strokeWidth={1.8} />}
      defaultOpen={false}
    >
      <AgentLogCollapsibleJson
        value={value}
        defaultExpandedDepth={1}
        defaultCollapsedPaths={['headers', 'tools', 'rawText', 'previewEvents']}
        importantPaths={['error', 'statusCode', 'model', 'messages']}
        maxHeightClassName="max-h-[460px]"
        className="bg-[color:var(--color-background-sunken)]/70"
      />
    </SectionBlock>
  )
}

export function AgentLogStepInspector({ step }: { step: AgentLogFlowStep }) {
  const { t } = useI18n()
  const fields = overviewFields(step, t)
  const hasCapturedData = Boolean(step.request || step.response || step.body || typeof step.value !== 'undefined')

  return (
    <section className="space-y-3 rounded-[22px] border px-5 py-5 surface-card" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.16em] text-[color:var(--color-muted-foreground)]">
            {t('settings.agentLogs.focusedStep')}
          </div>
          <h4 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-[color:var(--color-foreground)]">{step.title}</h4>
          {step.description ? (
            <p className="mt-1 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{step.description}</p>
          ) : null}
        </div>
        <span className="rounded-full bg-[color:var(--color-card)] px-3 py-1 text-xs text-[color:var(--color-muted-foreground)]">
          {step.summary.length > 0 ? step.summary.slice(0, 2).join(' · ') : t('settings.agentLogs.notCapturedYet')}
        </span>
      </div>

      {!hasCapturedData ? (
        <div className="flex items-center gap-2 rounded-[16px] bg-[color:var(--color-background-sunken)]/55 px-4 py-3 text-sm text-[color:var(--color-muted-foreground)]">
          <AlertTriangle className="h-4 w-4" strokeWidth={1.8} />
          {t('settings.agentLogs.notCapturedYet')}
        </div>
      ) : null}

      <SectionBlock
        title={t('settings.agentLogs.overview')}
        icon={<FileText className="h-4 w-4" strokeWidth={1.8} />}
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {fields.map((field) => (
            <OverviewField key={field.label} label={field.label} value={field.value} />
          ))}
        </div>
      </SectionBlock>

      <HeadersBlock step={step} />

      <SectionBlock
        title={t('settings.agentLogs.bodySummary')}
        icon={<FileText className="h-4 w-4" strokeWidth={1.8} />}
      >
        <BodySummary step={step} />
      </SectionBlock>

      <RawJsonBlock step={step} />

      {step.body?.rawText && typeof step.body.parsed === 'undefined' ? (
        <SectionBlock
          title={t('settings.agentLogs.rawText')}
          icon={<FileText className="h-4 w-4" strokeWidth={1.8} />}
          defaultOpen={false}
        >
          <AgentLogExpandableText text={displayText(step.body.rawText)} truncated={step.body.truncated} />
        </SectionBlock>
      ) : null}
    </section>
  )
}
