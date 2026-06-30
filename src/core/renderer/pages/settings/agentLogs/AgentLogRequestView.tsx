import { ArrowRight, Braces, MessageSquareText } from 'lucide-react'
import type {
  AgentLogDetail,
  StructuredHttpRequestSnapshot,
  StructuredHttpResponseSnapshot,
  StructuredJsonSnapshot,
} from '../../../../shared/types'
import { useI18n } from '../../../i18n'

type JsonRecord = Record<string, unknown>

type RequestSection = {
  title: string
  description?: string
  request?: StructuredHttpRequestSnapshot
  response?: StructuredHttpResponseSnapshot
  body?: StructuredJsonSnapshot
  value?: unknown
}

type RequestViewLabels = {
  ingressRequest: string
  ingressGatewayDescription: string
  ingressHookDescription: string
  normalizedRequest: string
  normalizedRequestDescription: string
  upstreamRequest: string
  upstreamRequestDescription: string
  upstreamResponse: string
  clientResponse: string
  normalizedEnvelope: string
  normalizedEnvelopeDescription: string
  payload: string
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function displayText(value: string): string {
  return value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return displayText(value)
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function snapshotValue(snapshot: StructuredJsonSnapshot | undefined): unknown {
  if (!snapshot) return undefined
  return typeof snapshot.parsed !== 'undefined' ? snapshot.parsed : snapshot.rawText
}

function getBodyValue(section: RequestSection): unknown {
  return section.value
    ?? snapshotValue(section.body)
    ?? snapshotValue(section.request?.body)
    ?? snapshotValue(section.response?.body)
}

function roleLabel(message: JsonRecord, index: number): string {
  const role = typeof message.role === 'string'
    ? message.role
    : typeof message.type === 'string'
      ? message.type
      : `item ${index + 1}`
  const name = typeof message.name === 'string' ? ` / ${message.name}` : ''
  return `${role}${name}`
}

function extractTextBlocks(value: unknown): string[] {
  if (typeof value === 'string') return [displayText(value)]
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === 'string') return [displayText(item)]
      if (!isRecord(item)) return [stringifyUnknown(item)]
      const label = typeof item.type === 'string' ? `[${item.type}]` : ''
      const text = typeof item.text === 'string'
        ? item.text
        : typeof item.content === 'string'
          ? item.content
          : typeof item.input === 'string'
            ? item.input
            : undefined
      if (text) return [`${label ? `${label}\n` : ''}${displayText(text)}`]
      return [stringifyUnknown(item)]
    })
  }
  if (isRecord(value)) {
    const text = typeof value.text === 'string'
      ? value.text
      : typeof value.content === 'string'
        ? value.content
        : typeof value.input === 'string'
          ? value.input
          : undefined
    if (text) return [displayText(text)]
  }
  return typeof value === 'undefined' ? [] : [stringifyUnknown(value)]
}

function getTopLevelEntries(value: unknown): Array<[string, unknown]> {
  if (!isRecord(value)) return []
  const skipped = new Set(['messages', 'input', 'instructions', 'system', 'tools'])
  return Object.entries(value).filter(([key]) => !skipped.has(key))
}

function getMessageRows(value: unknown): Array<{ label: string; text: string }> {
  if (!isRecord(value)) return []
  if (Array.isArray(value.messages)) {
    return value.messages.map((message, index) => {
      if (!isRecord(message)) {
        return {
          label: `item ${index + 1}`,
          text: stringifyUnknown(message),
        }
      }
      return {
        label: roleLabel(message, index),
        text: extractTextBlocks(message.content).join('\n\n'),
      }
    })
  }
  if (typeof value.input !== 'undefined') {
    if (typeof value.input === 'string') {
      return [{ label: 'input', text: displayText(value.input) }]
    }
    if (Array.isArray(value.input)) {
      return value.input.map((item, index) => {
        if (!isRecord(item)) {
          return {
            label: `input ${index + 1}`,
            text: stringifyUnknown(item),
          }
        }
        return {
          label: roleLabel(item, index),
          text: extractTextBlocks(item.content ?? item.text ?? item.input).join('\n\n'),
        }
      })
    }
    return [{ label: 'input', text: stringifyUnknown(value.input) }]
  }
  return []
}

function CompactField({ label, value }: { label: string; value: unknown }) {
  if (typeof value === 'undefined' || value === null || value === '') return null
  const displayValue = typeof value === 'boolean' ? String(value) : stringifyUnknown(value)
  return (
    <div className="rounded-[14px] bg-[color:var(--color-card)] px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">
        {label}
      </div>
      <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-[color:var(--color-foreground)]">
        {displayValue}
      </pre>
    </div>
  )
}

function MessageBlock({
  label,
  text,
}: {
  label: string
  text: string
}) {
  return (
    <div className="rounded-[18px] border bg-[color:var(--color-card)] px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
      <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-[color:var(--color-background-sunken)]/70 px-3 py-1 text-xs font-medium text-[color:var(--color-muted-foreground)]">
        <MessageSquareText className="h-3.5 w-3.5" strokeWidth={1.8} />
        {label}
      </div>
      <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-6 text-[color:var(--color-foreground)]">
        {text || 'n/a'}
      </pre>
    </div>
  )
}

function ExpandedJsonValue({
  value,
  depth = 0,
}: {
  value: unknown
  depth?: number
}) {
  if (typeof value === 'string') {
    return (
      <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-[color:var(--color-foreground)]">
        {displayText(value)}
      </pre>
    )
  }

  if (typeof value !== 'object' || value === null) {
    return <span className="font-mono text-xs text-[color:var(--color-foreground)]">{String(value)}</span>
  }

  if (Array.isArray(value)) {
    return (
      <div className="space-y-2">
        {value.map((item, index) => (
          <div key={index} className="rounded-[14px] bg-[color:var(--color-background-sunken)]/45 px-3 py-2">
            <div className="mb-1 font-mono text-[11px] text-[color:var(--color-muted-foreground)]">[{index}]</div>
            <ExpandedJsonValue value={item} depth={depth + 1} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {Object.entries(value as JsonRecord).map(([key, child]) => (
        <div key={key} className="rounded-[14px] bg-[color:var(--color-background-sunken)]/45 px-3 py-2">
          <div className="mb-1 font-mono text-[11px] text-[color:var(--color-muted-foreground)]">
            {key}
          </div>
          <ExpandedJsonValue value={child} depth={depth + 1} />
        </div>
      ))}
    </div>
  )
}

function BodyInspector({ value }: { value: unknown }) {
  const { t } = useI18n()
  if (typeof value === 'undefined') {
    return (
      <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-6 text-center text-sm text-[color:var(--color-muted-foreground)]">
        {t('settings.agentLogs.noStructuredBody')}
      </div>
    )
  }

  const record = isRecord(value) ? value : null
  const topLevelEntries = getTopLevelEntries(value)
  const messages = getMessageRows(value)

  return (
    <div className="space-y-4">
      {record ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {topLevelEntries.map(([key, child]) => (
            <CompactField key={key} label={key} value={child} />
          ))}
        </div>
      ) : null}

      {record?.system ? (
        <MessageBlock label={t('settings.agentLogs.systemPrompt')} text={extractTextBlocks(record.system).join('\n\n')} />
      ) : null}

      {record?.instructions ? (
        <MessageBlock label={t('settings.agentLogs.instructions')} text={extractTextBlocks(record.instructions).join('\n\n')} />
      ) : null}

      {messages.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--color-foreground)]">
            <MessageSquareText className="h-4 w-4" strokeWidth={1.8} />
            {t('settings.agentLogs.messages')}
          </div>
          {messages.map((message, index) => (
            <MessageBlock key={`${message.label}-${index}`} label={message.label} text={message.text} />
          ))}
        </div>
      ) : null}

      {record?.tools ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--color-foreground)]">
            <Braces className="h-4 w-4" strokeWidth={1.8} />
            {t('settings.agentLogs.tools')}
          </div>
          <ExpandedJsonValue value={record.tools} />
        </div>
      ) : null}

      <details className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium text-[color:var(--color-foreground)]">
          {t('settings.agentLogs.expandedBody')}
        </summary>
        <div className="mt-3">
          <ExpandedJsonValue value={value} />
        </div>
      </details>
    </div>
  )
}

function RequestSectionCard({ section }: { section: RequestSection }) {
  const { t } = useI18n()
  const bodyValue = getBodyValue(section)
  const transport = section.request
    ? `${section.request.method} ${section.request.url || section.request.path}`
    : section.response
      ? `${section.response.statusCode}`
      : ''

  return (
    <section className="rounded-[22px] border px-5 py-5 surface-card" style={{ borderColor: 'var(--color-border)' }}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-base font-semibold text-[color:var(--color-foreground)]">{section.title}</h4>
          {section.description ? (
            <p className="mt-1 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{section.description}</p>
          ) : null}
        </div>
        {transport ? (
          <code className="max-w-full break-all rounded-full bg-[color:var(--color-card)] px-3 py-1 text-xs text-[color:var(--color-muted-foreground)]">
            {transport}
          </code>
        ) : null}
      </div>

      {(section.request?.headers || section.response?.headers) ? (
        <details className="mb-4 rounded-[16px] bg-[color:var(--color-card)] px-4 py-3">
          <summary className="cursor-pointer text-xs font-medium text-[color:var(--color-muted-foreground)]">
            {t('settings.agentLogs.headers')}
          </summary>
          <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-5 text-[color:var(--color-foreground)]">
            {JSON.stringify(section.request?.headers ?? section.response?.headers, null, 2)}
          </pre>
        </details>
      ) : null}

      <BodyInspector value={bodyValue} />
    </section>
  )
}

function gatewaySections(
  detail: Extract<AgentLogDetail, { source: 'ai-gateway' }>,
  labels: RequestViewLabels,
): RequestSection[] {
  const sections: RequestSection[] = [
    {
      title: labels.ingressRequest,
      description: labels.ingressGatewayDescription,
      request: detail.ingressRequest,
    },
    {
      title: labels.normalizedRequest,
      description: labels.normalizedRequestDescription,
      body: detail.normalizedRequest,
    },
    {
      title: labels.upstreamRequest,
      description: labels.upstreamRequestDescription,
      request: detail.upstreamRequest,
    },
    {
      title: labels.upstreamResponse,
      response: detail.upstreamResponse,
    },
    {
      title: labels.clientResponse,
      response: detail.clientResponse,
    },
  ]
  return sections.filter((section) => section.request || section.response || section.body || typeof section.value !== 'undefined')
}

function hookSections(
  detail: Extract<AgentLogDetail, { source: 'agent-hooks' }>,
  labels: RequestViewLabels,
): RequestSection[] {
  const sections: RequestSection[] = [
    {
      title: labels.ingressRequest,
      description: labels.ingressHookDescription,
      request: detail.ingressRequest,
    },
    {
      title: labels.normalizedEnvelope,
      description: labels.normalizedEnvelopeDescription,
      value: detail.normalizedEnvelope,
    },
    {
      title: labels.payload,
      body: detail.payload,
    },
  ]
  return sections.filter((section) => section.request || section.response || section.body || typeof section.value !== 'undefined')
}

export function AgentLogRequestView({ detail }: { detail: AgentLogDetail }) {
  const { t } = useI18n()
  const labels: RequestViewLabels = {
    ingressRequest: t('settings.agentLogs.ingressRequest'),
    ingressGatewayDescription: t('settings.agentLogs.ingressGatewayDescription'),
    ingressHookDescription: t('settings.agentLogs.ingressHookDescription'),
    normalizedRequest: t('settings.agentLogs.normalizedRequest'),
    normalizedRequestDescription: t('settings.agentLogs.normalizedRequestDescription'),
    upstreamRequest: t('settings.agentLogs.upstreamRequest'),
    upstreamRequestDescription: t('settings.agentLogs.upstreamRequestDescription'),
    upstreamResponse: t('settings.agentLogs.upstreamResponse'),
    clientResponse: t('settings.agentLogs.clientResponse'),
    normalizedEnvelope: t('settings.agentLogs.normalizedEnvelope'),
    normalizedEnvelopeDescription: t('settings.agentLogs.normalizedEnvelopeDescription'),
    payload: t('settings.agentLogs.payload'),
  }
  const sections = detail.source === 'ai-gateway'
    ? gatewaySections(detail, labels)
    : hookSections(detail, labels)

  return (
    <div className="space-y-4">
      <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
        {t('settings.agentLogs.requestViewHint')}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--color-muted-foreground)]">
        {sections.map((section, index) => (
          <div key={section.title} className="inline-flex items-center gap-2">
            <span className="rounded-full bg-[color:var(--color-card)] px-3 py-1">{section.title}</span>
            {index < sections.length - 1 ? <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.8} /> : null}
          </div>
        ))}
      </div>

      {sections.map((section) => (
        <RequestSectionCard key={section.title} section={section} />
      ))}
    </div>
  )
}
