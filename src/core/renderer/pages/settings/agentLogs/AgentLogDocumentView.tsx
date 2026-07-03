import { Braces, FileText } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { AgentLogDetail } from '../../../../shared/types'
import { Button } from '../../../components/ui/button'
import { useI18n } from '../../../i18n'
import {
  formatJsonPath,
  getStepBodyJsonPathPrefix,
  joinJsonPath,
} from './agentLogs.anchors'
import { type AgentLogDocumentSection } from './agentLogs.document'
import {
  displayText,
  extractTextBlocks,
  formatBytes,
  isRecord,
  snapshotValue,
  toDisplayString,
} from './agentLogs.display'
import { estimateJsonSizeBytes } from './agentLogs.helpers'
import { AgentLogExpandableText } from './AgentLogExpandableText'
import { AgentLogCollapsibleJson } from './AgentLogCollapsibleJson'
import { AgentLogMessageList } from './AgentLogMessageList'
import { AgentLogToolSummary } from './AgentLogToolSummary'
import type { AgentLogSectionJsonById } from './useAgentLogViewerModel'

type AgentLogDocumentViewProps = {
  detail: AgentLogDetail
  sections: AgentLogDocumentSection[]
  sectionJsonById: AgentLogSectionJsonById
  activeSectionId: string
  onSelectSection: (sectionId: string) => void
  onFocusPath: (path: string[], sectionId?: string) => void
  domIdPrefix?: string
  focusedPath?: string[]
}

type DocumentField = {
  label: string
  value: React.ReactNode
  focusPath?: string[]
}

const LARGE_JSON_PREVIEW_BYTES = 64 * 1024

function statusTone(status: AgentLogDocumentSection['status']): string {
  if (status === 'error') return 'bg-[color:var(--color-destructive-background)] text-[color:var(--color-destructive)]'
  if (status === 'warn') return 'bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]'
  if (status === 'missing') return 'bg-[color:var(--color-background-sunken)] text-[color:var(--color-muted-foreground)]'
  return 'bg-[color:var(--color-success-background)] text-[color:var(--color-success)]'
}

function statusLabel(status: AgentLogDocumentSection['status'], t: ReturnType<typeof useI18n>['t']): string {
  if (status === 'error') return t('settings.agentLogs.stepStatusError')
  if (status === 'warn') return t('settings.agentLogs.stepStatusWarn')
  if (status === 'missing') return t('settings.agentLogs.stepStatusMissing')
  return t('settings.agentLogs.stepStatusOk')
}

function kindSummary(value: unknown): string {
  if (Array.isArray(value)) return `array[${value.length}]`
  if (value === null) return 'null'
  if (isRecord(value)) return `object{${Object.keys(value).length}}`
  return typeof value
}

function FocusButton({
  onClick,
}: {
  onClick: () => void
}) {
  const { t } = useI18n()
  return (
    <Button
      type="button"
      variant="outline"
      className="h-7 rounded-full px-2.5 text-[11px]"
      onClick={onClick}
    >
      {t('settings.agentLogs.revealInJson')}
    </Button>
  )
}

function FieldRow({
  label,
  value,
  focusPath,
  onFocusPath,
}: {
  label: string
  value: React.ReactNode
  focusPath?: string[]
  onFocusPath?: (path: string[]) => void
}) {
  if (value === undefined || value === null || value === '') return null

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-[14px] bg-[color:var(--color-background-sunken)]/55 px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">{label}</div>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 text-sm font-medium text-[color:var(--color-foreground)] [overflow-wrap:anywhere]">
          {value}
        </div>
        {focusPath && onFocusPath ? <FocusButton onClick={() => onFocusPath(focusPath)} /> : null}
      </div>
    </div>
  )
}

function SummarySection({
  detail,
  onFocusPath,
}: {
  detail: AgentLogDetail
  onFocusPath: (path: string[]) => void
}) {
  const { t, formatDateTime } = useI18n()
  const fields: DocumentField[] = detail.source === 'ai-gateway'
    ? [
      { label: t('settings.agentLogs.source'), value: t('settings.agentLogs.sourceGateway'), focusPath: ['summary', 'source'] },
      { label: t('settings.agentLogs.timestamp'), value: formatDateTime(detail.summary.timestamp, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }), focusPath: ['summary', 'timestamp'] },
      { label: t('settings.agentLogs.status'), value: detail.summary.statusCode, focusPath: ['clientResponse', 'statusCode'] },
      { label: t('settings.agentLogs.duration'), value: typeof detail.summary.durationMs === 'number' ? `${detail.summary.durationMs}ms` : undefined, focusPath: ['meta', 'durationMs'] },
      { label: t('settings.agentLogs.requestId'), value: detail.meta.requestId, focusPath: ['meta', 'requestId'] },
      { label: t('settings.agentLogs.route'), value: detail.meta.route, focusPath: ['meta', 'route'] },
      { label: t('settings.agentLogs.provider'), value: detail.meta.providerName || detail.meta.providerId, focusPath: detail.meta.providerName ? ['meta', 'providerName'] : ['meta', 'providerId'] },
      { label: t('settings.agentLogs.model'), value: detail.meta.model, focusPath: ['meta', 'model'] },
    ]
    : [
      { label: t('settings.agentLogs.source'), value: t('settings.agentLogs.sourceHooks'), focusPath: ['summary', 'source'] },
      { label: t('settings.agentLogs.timestamp'), value: formatDateTime(detail.summary.timestamp, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }), focusPath: ['summary', 'timestamp'] },
      { label: t('settings.agentLogs.duration'), value: typeof detail.summary.durationMs === 'number' ? `${detail.summary.durationMs}ms` : undefined, focusPath: ['meta', 'durationMs'] },
      { label: t('settings.agentLogs.requestId'), value: detail.meta.requestId, focusPath: ['meta', 'requestId'] },
      { label: t('settings.agentLogs.provider'), value: detail.meta.provider, focusPath: ['meta', 'provider'] },
      { label: t('settings.agentLogs.providerEvent'), value: detail.meta.providerEvent, focusPath: ['meta', 'providerEvent'] },
      { label: t('settings.agentLogs.canonicalEvent'), value: detail.meta.canonicalEvent, focusPath: ['meta', 'canonicalEvent'] },
      { label: t('settings.agentLogs.cwd'), value: detail.summary.cwd, focusPath: ['summary', 'cwd'] },
    ]

  return (
    <article className="rounded-[22px] border bg-[color:var(--color-card)] px-4 py-4" style={{ borderColor: 'var(--color-border)' }}>
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[color:var(--color-foreground)]">
        <FileText className="h-4 w-4" strokeWidth={1.8} />
        {t('settings.agentLogs.summaryTab')}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {fields.map((field) => (
          <FieldRow
            key={field.label}
            label={field.label}
            value={field.value}
            focusPath={field.focusPath}
            onFocusPath={onFocusPath}
          />
        ))}
      </div>
      {detail.error ? (
        <div className="mt-4 rounded-[16px] bg-[color:var(--color-destructive-background)] px-4 py-3 text-sm text-[color:var(--color-destructive)]">
          {detail.error.code ? `${detail.error.code}: ` : ''}{detail.error.message}
        </div>
      ) : null}
    </article>
  )
}

function OverviewFields({
  section,
  onFocusPath,
}: {
  section: AgentLogDocumentSection
  onFocusPath: (path: string[]) => void
}) {
  const { t } = useI18n()
  const bodySnapshot = section.body ?? section.request?.body ?? section.response?.body
  const fields: DocumentField[] = [
    { label: t('settings.agentLogs.method'), value: section.request?.method, focusPath: section.request ? [...section.jsonRootPath, 'method'] : undefined },
    { label: t('settings.agentLogs.path'), value: section.request?.path, focusPath: section.request ? [...section.jsonRootPath, 'path'] : undefined },
    { label: t('settings.agentLogs.url'), value: section.request?.url, focusPath: section.request?.url ? [...section.jsonRootPath, 'url'] : undefined },
    { label: t('settings.agentLogs.status'), value: section.response?.statusCode, focusPath: section.response ? [...section.jsonRootPath, 'statusCode'] : undefined },
    { label: t('settings.agentLogs.contentType'), value: bodySnapshot?.contentType, focusPath: bodySnapshot?.contentType ? joinJsonPath(section.jsonRootPath, section.body ? ['contentType'] : ['body', 'contentType']) : undefined },
    { label: t('settings.agentLogs.bodySize'), value: formatBytes(bodySnapshot?.sizeBytes), focusPath: typeof bodySnapshot?.sizeBytes === 'number' ? joinJsonPath(section.jsonRootPath, section.body ? ['sizeBytes'] : ['body', 'sizeBytes']) : undefined },
    { label: t('settings.agentLogs.truncation'), value: bodySnapshot?.truncated ? t('settings.agentLogs.truncated') : undefined, focusPath: bodySnapshot?.truncated ? joinJsonPath(section.jsonRootPath, section.body ? ['truncated'] : ['body', 'truncated']) : undefined },
    { label: t('settings.agentLogs.parseError'), value: bodySnapshot?.parseError, focusPath: bodySnapshot?.parseError ? joinJsonPath(section.jsonRootPath, section.body ? ['parseError'] : ['body', 'parseError']) : undefined },
  ]

  const visibleFields = fields.filter((field) => field.value !== undefined && field.value !== null && field.value !== '')
  if (visibleFields.length === 0) return null

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {visibleFields.map((field) => (
        <FieldRow
          key={field.label}
          label={field.label}
          value={field.value}
          focusPath={field.focusPath}
          onFocusPath={onFocusPath}
        />
      ))}
    </div>
  )
}

function NarrativeTextBlock({
  label,
  text,
  truncated,
  focusPath,
  onFocusPath,
}: {
  label: string
  text: string
  truncated?: boolean
  focusPath?: string[]
  onFocusPath: (path: string[]) => void
}) {
  return (
    <div className="rounded-[18px] border bg-[color:var(--color-card)] px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 rounded-full bg-[color:var(--color-background-sunken)]/70 px-3 py-1 text-xs font-medium text-[color:var(--color-muted-foreground)]">
          <FileText className="h-3.5 w-3.5" strokeWidth={1.8} />
          {label}
        </div>
        {focusPath ? <FocusButton onClick={() => onFocusPath(focusPath)} /> : null}
      </div>
      <AgentLogExpandableText text={text} truncated={truncated} />
    </div>
  )
}

function JsonDocumentBlock({
  section,
  detail,
  jsonValue,
  active,
  onFocusPath,
}: {
  section: AgentLogDocumentSection
  detail: AgentLogDetail
  jsonValue: unknown
  active: boolean
  onFocusPath: (path: string[]) => void
}) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const estimatedSize = useMemo(
    () => (
      section.body?.sizeBytes
      ?? section.request?.body?.sizeBytes
      ?? section.response?.body?.sizeBytes
      ?? estimateJsonSizeBytes(jsonValue)
    ),
    [
      jsonValue,
      section.body?.sizeBytes,
      section.request?.body?.sizeBytes,
      section.response?.body?.sizeBytes,
    ],
  )

  useEffect(() => {
    setExpanded(false)
  }, [section.id, detail.summary.id])

  if (typeof jsonValue === 'undefined') {
    return (
      <div className="rounded-[18px] bg-[color:var(--color-background-sunken)]/55 px-4 py-4 text-sm text-[color:var(--color-muted-foreground)]">
        {t('settings.agentLogs.noStructuredJsonForSection')}
      </div>
    )
  }

  const showSummaryOnly = !expanded
  const resolvedSize = formatBytes(estimatedSize)

  return (
    <div className="rounded-[18px] border bg-[color:var(--color-card)] px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--color-foreground)]">
          <Braces className="h-4 w-4" strokeWidth={1.8} />
          {t('settings.agentLogs.sectionJson')}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {section.jsonRootPath.length > 0 ? (
            <FocusButton onClick={() => onFocusPath(section.jsonRootPath)} />
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="h-7 rounded-full px-2.5 text-[11px]"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? t('settings.agentLogs.collapseJson') : t('settings.agentLogs.expandJson')}
          </Button>
        </div>
      </div>

      {showSummaryOnly ? (
        <div className="rounded-[16px] bg-[color:var(--color-background-sunken)]/60 px-4 py-3 text-sm text-[color:var(--color-muted-foreground)]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[color:var(--color-card)] px-2.5 py-1 text-[11px]">{kindSummary(jsonValue)}</span>
            {resolvedSize ? (
              <span className="rounded-full bg-[color:var(--color-card)] px-2.5 py-1 text-[11px]">{resolvedSize}</span>
            ) : null}
            {!active ? (
              <span className="rounded-full bg-[color:var(--color-card)] px-2.5 py-1 text-[11px]">
                {t('settings.agentLogs.jsonPreviewHidden')}
              </span>
            ) : null}
            {estimatedSize && estimatedSize >= LARGE_JSON_PREVIEW_BYTES ? (
              <span className="rounded-full bg-[color:var(--color-warning-background)] px-2.5 py-1 text-[11px] text-[color:var(--color-warning)]">
                {t('settings.agentLogs.largeJsonCollapsed')}
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <AgentLogCollapsibleJson
          value={jsonValue}
          defaultExpandedDepth={1}
          defaultCollapsedPaths={['headers', 'messages', 'tools', 'content', 'choices', 'rawText', 'previewEvents']}
          importantPaths={['error', 'statusCode', 'model', 'messages', 'route', 'providerEvent', 'canonicalEvent']}
          maxHeightClassName="max-h-[520px]"
          className="bg-[color:var(--color-background-sunken)]/70"
          persistenceKey={`${detail.source}:${detail.summary.id}:document:${section.id}`}
        />
      )}
    </div>
  )
}

function MergedStreamNarrative({
  detail,
  section,
  onFocusPath,
}: {
  detail: AgentLogDetail
  section: AgentLogDocumentSection
  onFocusPath: (path: string[]) => void
}) {
  if (!section.mergedStream) return null

  const textValue = snapshotValue(section.mergedStream.text)
  const payloadValue = snapshotValue(section.mergedStream.payload)
  const textFocusPath = section.id === 'provider-response'
    ? ['stream', 'merged', 'upstreamText']
    : section.id === 'client-response'
      ? ['stream', 'merged', 'clientText']
      : undefined
  const payloadFocusPath = section.id === 'provider-response'
    ? ['stream', 'merged', 'upstreamPayload']
    : section.id === 'client-response'
      ? ['stream', 'merged', 'clientPayload']
      : undefined

  if (section.mergedStream.notCaptured || (typeof textValue === 'undefined' && typeof payloadValue === 'undefined')) {
    return (
      <div className="rounded-[18px] bg-[color:var(--color-background-sunken)]/55 px-4 py-4 text-sm text-[color:var(--color-muted-foreground)]">
        {section.mergedStream.description}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)]">{section.mergedStream.description}</p>
      {typeof textValue !== 'undefined' ? (
        <NarrativeTextBlock
          label={section.mergedStream.textLabel}
          text={toDisplayString(textValue)}
          truncated={section.mergedStream.text?.truncated}
          focusPath={textFocusPath}
          onFocusPath={onFocusPath}
        />
      ) : null}
      {typeof payloadValue !== 'undefined' ? (
        <div className="rounded-[18px] border bg-[color:var(--color-card)] px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-[color:var(--color-background-sunken)]/70 px-3 py-1 text-xs font-medium text-[color:var(--color-muted-foreground)]">
              <Braces className="h-3.5 w-3.5" strokeWidth={1.8} />
              {section.mergedStream.payloadLabel}
            </div>
            {payloadFocusPath ? <FocusButton onClick={() => onFocusPath(payloadFocusPath)} /> : null}
          </div>
          <AgentLogCollapsibleJson
            value={payloadValue}
            defaultExpandedDepth={1}
            defaultCollapsedPaths={['messages', 'content', 'choices', 'rawText']}
            importantPaths={['output_text', 'content', 'stop_reason', 'usage', 'choices']}
            maxHeightClassName="max-h-[360px]"
            className="bg-[color:var(--color-background-sunken)]/70"
            persistenceKey={`${detail.source}:${detail.summary.id}:merged-stream:${section.id}`}
          />
        </div>
      ) : null}
    </div>
  )
}

function SectionNarrative({
  section,
  detail,
  jsonValue,
  active,
  onSelectSection,
  onFocusPath,
  domIdPrefix,
}: {
  section: AgentLogDocumentSection
  detail: AgentLogDetail
  jsonValue: unknown
  active: boolean
  onSelectSection: (sectionId: string) => void
  onFocusPath: (path: string[], sectionId?: string) => void
  domIdPrefix: string
}) {
  const { t } = useI18n()

  return (
    <article
      id={`${domIdPrefix}-${section.id}`}
      className={`rounded-[22px] border px-4 py-4 transition-colors ${
        active ? 'bg-[color:var(--color-card)] shadow-sm' : 'bg-[color:var(--color-card)]/82'
      }`}
      style={{ borderColor: active ? 'var(--color-primary)' : 'var(--color-border)' }}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            className="button-interactive text-left"
            onClick={() => onSelectSection(section.id)}
          >
            <h3 className="text-lg font-semibold tracking-[-0.02em] text-[color:var(--color-foreground)]">{section.title}</h3>
          </button>
          {section.description ? (
            <p className="mt-1 text-sm leading-6 text-[color:var(--color-muted-foreground)]">{section.description}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <span className={`rounded-full px-3 py-1 text-[11px] font-medium ${statusTone(section.status)}`}>
            {statusLabel(section.status, t)}
          </span>
          {section.summary.slice(0, 4).map((item) => (
            <span
              key={item}
              className="rounded-full bg-[color:var(--color-background-sunken)]/70 px-3 py-1 text-[11px] text-[color:var(--color-muted-foreground)]"
            >
              {item}
            </span>
          ))}
          {section.defaultFocusPath ? (
            <FocusButton onClick={() => onFocusPath(section.defaultFocusPath!, section.id)} />
          ) : null}
        </div>
      </div>

      {active ? (
        <ActiveSectionNarrative
          detail={detail}
          section={section}
          jsonValue={jsonValue}
          onFocusPath={onFocusPath}
        />
      ) : null}
    </article>
  )
}

function ActiveSectionNarrative({
  detail,
  section,
  jsonValue,
  onFocusPath,
}: {
  detail: AgentLogDetail
  section: AgentLogDocumentSection
  jsonValue: unknown
  onFocusPath: (path: string[], sectionId?: string) => void
}) {
  const { t } = useI18n()
  const bodyValue = section.request?.body || section.response?.body || section.body
  const bodyRecord = isRecord(snapshotValue(bodyValue)) ? snapshotValue(bodyValue) as Record<string, unknown> : null
  const bodyPathPrefix = getStepBodyJsonPathPrefix(section, section.jsonRootPath)

  return (
    <div className="space-y-4">
      <OverviewFields section={section} onFocusPath={(path) => onFocusPath(path, section.id)} />

      <MergedStreamNarrative detail={detail} section={section} onFocusPath={(path) => onFocusPath(path, section.id)} />

      {bodyRecord?.system ? (
        <NarrativeTextBlock
          label={t('settings.agentLogs.systemPrompt')}
          text={extractTextBlocks(bodyRecord.system).join('\n\n')}
          truncated={bodyValue?.truncated}
          focusPath={joinJsonPath(bodyPathPrefix, ['system'])}
          onFocusPath={(path) => onFocusPath(path, section.id)}
        />
      ) : null}

      {bodyRecord?.instructions ? (
        <NarrativeTextBlock
          label={t('settings.agentLogs.instructions')}
          text={extractTextBlocks(bodyRecord.instructions).join('\n\n')}
          truncated={bodyValue?.truncated}
          focusPath={joinJsonPath(bodyPathPrefix, ['instructions'])}
          onFocusPath={(path) => onFocusPath(path, section.id)}
        />
      ) : null}

      {bodyRecord ? (
        <AgentLogMessageList
          value={bodyRecord}
          pathPrefix={bodyPathPrefix}
          onFocusPath={(path) => onFocusPath(path, section.id)}
        />
      ) : null}

      {bodyRecord?.tools ? (
        <AgentLogToolSummary
          value={bodyRecord.tools}
          pathPrefix={bodyPathPrefix}
          onFocusPath={(path) => onFocusPath(path, section.id)}
        />
      ) : null}

      {!bodyRecord && typeof snapshotValue(bodyValue) !== 'undefined' ? (
        <NarrativeTextBlock
          label={t('settings.agentLogs.bodySummary')}
          text={toDisplayString(snapshotValue(bodyValue))}
          truncated={bodyValue?.truncated}
          focusPath={bodyPathPrefix}
          onFocusPath={(path) => onFocusPath(path, section.id)}
        />
      ) : null}

      {section.body?.rawText && typeof section.body.parsed === 'undefined' ? (
        <NarrativeTextBlock
          label={t('settings.agentLogs.rawText')}
          text={displayText(section.body.rawText)}
          truncated={section.body.truncated}
          focusPath={joinJsonPath(section.jsonRootPath, ['rawText'])}
          onFocusPath={(path) => onFocusPath(path, section.id)}
        />
      ) : null}

      <JsonDocumentBlock
        section={section}
        detail={detail}
        jsonValue={jsonValue}
        active
        onFocusPath={(path) => onFocusPath(path, section.id)}
      />
    </div>
  )
}

export function AgentLogDocumentView({
  detail,
  sections,
  sectionJsonById,
  activeSectionId,
  onSelectSection,
  onFocusPath,
  domIdPrefix = 'agent-log-document',
  focusedPath,
}: AgentLogDocumentViewProps) {
  const { t } = useI18n()

  useEffect(() => {
    const target = document.getElementById(`${domIdPrefix}-${activeSectionId}`)
    target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeSectionId, domIdPrefix])

  return (
    <div className="space-y-4">
      <div className="rounded-[22px] bg-[color:var(--color-background-sunken)]/45 px-4 py-3 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
        {t('settings.agentLogs.documentViewHint')}
      </div>

      <SummarySection detail={detail} onFocusPath={onFocusPath} />

      {sections.map((section) => (
        <SectionNarrative
          key={section.id}
          section={section}
          detail={detail}
          jsonValue={sectionJsonById[section.id]}
          active={section.id === activeSectionId}
          onSelectSection={onSelectSection}
          onFocusPath={onFocusPath}
          domIdPrefix={domIdPrefix}
        />
      ))}

      <div className="rounded-[18px] border bg-[color:var(--color-card)] px-4 py-3 text-xs text-[color:var(--color-muted-foreground)]" style={{ borderColor: 'var(--color-border)' }}>
        {t('settings.agentLogs.focusedPath')}: {formatJsonPath(focusedPath)}
      </div>
    </div>
  )
}
