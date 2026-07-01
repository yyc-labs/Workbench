import { Check, ChevronRight, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useI18n } from '../../../i18n'
import { displayText, isRecord } from './agentLogs.display'

export type AgentLogJsonExpansionMode = 'default' | 'expand-all' | 'collapse-all' | 'expand-important'

type AgentLogCollapsibleJsonProps = {
  value: unknown
  defaultExpandedDepth?: number
  defaultCollapsedPaths?: string[]
  importantPaths?: string[]
  expansionMode?: AgentLogJsonExpansionMode
  expansionRevision?: number
  className?: string
  maxHeightClassName?: string
}

type JsonNodeProps = {
  value: unknown
  label?: string
  index?: number
  path: string[]
  depth: number
  defaultExpandedDepth: number
  defaultCollapsedPaths: string[]
  importantPaths: string[]
  expansionMode: AgentLogJsonExpansionMode
  expansionRevision: number
  trailingComma?: boolean
}

type JsonRecord = Record<string, unknown>

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

function isExpandable(value: unknown): value is JsonRecord | unknown[] {
  return (Array.isArray(value) || isRecord(value))
}

function primitiveToJson(value: unknown): string {
  if (typeof value === 'undefined') return 'undefined'
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value)

  try {
    const json = JSON.stringify(value)
    return typeof json === 'string' ? json : String(value)
  } catch {
    return String(value)
  }
}

function pathMatches(path: string[], patterns: string[]): boolean {
  if (patterns.length === 0) return false
  const joined = path.join('.')
  return patterns.some((pattern) => (
    joined === pattern
    || joined.endsWith(`.${pattern}`)
    || path.includes(pattern)
  ))
}

function hasImportantDescendant(value: unknown, path: string[], importantPaths: string[]): boolean {
  if (pathMatches(path, importantPaths)) return true
  if (!isExpandable(value)) return false

  const entries = Array.isArray(value)
    ? value.map((item, itemIndex) => [String(itemIndex), item] as const)
    : Object.entries(value)

  return entries.some(([entryKey, child]) => hasImportantDescendant(child, [...path, entryKey], importantPaths))
}

function shouldExpandNode({
  value,
  path,
  depth,
  defaultExpandedDepth,
  defaultCollapsedPaths,
  importantPaths,
  expansionMode,
}: Pick<JsonNodeProps, 'value' | 'path' | 'depth' | 'defaultExpandedDepth' | 'defaultCollapsedPaths' | 'importantPaths' | 'expansionMode'>): boolean {
  if (depth === 0) return true
  if (expansionMode === 'expand-all') return true
  if (expansionMode === 'collapse-all') return false

  const important = pathMatches(path, importantPaths)
  const hasImportantChild = hasImportantDescendant(value, path, importantPaths)

  if (expansionMode === 'expand-important') return important || hasImportantChild
  if (important || hasImportantChild) return true
  if (pathMatches(path, defaultCollapsedPaths)) return false
  return depth < defaultExpandedDepth
}

function JsonKey({ label, index }: { label?: string; index?: number }) {
  if (typeof label === 'string') {
    return (
      <span className="text-[color:var(--color-muted-foreground)]">
        {JSON.stringify(label)}:
      </span>
    )
  }

  if (typeof index === 'number') {
    return (
      <span className="select-none text-[color:var(--color-muted-foreground)]">
        [{index}]
      </span>
    )
  }

  return null
}

function LongStringJsonNode({
  value,
  label,
  index,
  trailingComma,
}: {
  value: string
  label?: string
  index?: number
  trailingComma?: boolean
}) {
  const { t } = useI18n()
  const text = displayText(value)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const preview = text.length > 260 ? `${text.slice(0, 260)}...` : text

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1200)
    return () => window.clearTimeout(timer)
  }, [copied])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
  }

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-baseline gap-1 break-words">
        <JsonKey label={label} index={index} />
        <span className="text-[color:var(--color-foreground)]">{JSON.stringify(expanded ? text : preview)}</span>
        {trailingComma ? <span className="text-[color:var(--color-muted-foreground)]">,</span> : null}
      </div>
      <div className="mt-1 flex flex-wrap gap-2 pl-1 text-[11px] text-[color:var(--color-muted-foreground)]">
        <span>{t('settings.agentLogs.charactersLabel', { count: text.length })}</span>
        <button
          type="button"
          className="button-interactive rounded-full px-2 py-0.5 hover:bg-[color:var(--color-card)]"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? t('settings.agentLogs.collapse') : t('settings.agentLogs.expand')}
        </button>
        <button
          type="button"
          className="button-interactive inline-flex items-center gap-1 rounded-full px-2 py-0.5 hover:bg-[color:var(--color-card)]"
          onClick={() => void handleCopy()}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? t('common.copied') : t('settings.agentLogs.copyFull')}
        </button>
      </div>
    </div>
  )
}

function PrimitiveJsonNode({
  value,
  label,
  index,
  trailingComma,
}: Pick<JsonNodeProps, 'value' | 'label' | 'index' | 'trailingComma'>) {
  if (typeof value === 'string') {
    const text = displayText(value)
    if (text.length > 260 || text.split('\n').length > 4) {
      return (
        <LongStringJsonNode
          value={value}
          label={label}
          index={index}
          trailingComma={trailingComma}
        />
      )
    }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-1 break-words">
      <JsonKey label={label} index={index} />
      <span className="text-[color:var(--color-foreground)]">{primitiveToJson(value)}</span>
      {trailingComma ? <span className="text-[color:var(--color-muted-foreground)]">,</span> : null}
    </div>
  )
}

function EmptyJsonNode({
  value,
  label,
  index,
  trailingComma,
}: Pick<JsonNodeProps, 'value' | 'label' | 'index' | 'trailingComma'>) {
  const pair = Array.isArray(value) ? '[]' : '{}'

  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-1 break-words">
      <JsonKey label={label} index={index} />
      <span className="text-[color:var(--color-foreground)]">{pair}</span>
      {trailingComma ? <span className="text-[color:var(--color-muted-foreground)]">,</span> : null}
    </div>
  )
}

function collapsedSummary(value: JsonRecord | unknown[]): string {
  if (Array.isArray(value)) return `[${value.length}]`
  return `{${Object.keys(value).length}}`
}

function CollapsibleJsonNode(props: JsonNodeProps) {
  const {
    value,
    label,
    index,
    path,
    depth,
    defaultExpandedDepth,
    defaultCollapsedPaths,
    importantPaths,
    expansionMode,
    expansionRevision,
    trailingComma,
  } = props
  const [expanded, setExpanded] = useState(() => shouldExpandNode(props))

  useEffect(() => {
    setExpanded(shouldExpandNode(props))
  }, [
    expansionRevision,
    expansionMode,
    value,
    path.join('.'),
    depth,
    defaultExpandedDepth,
    defaultCollapsedPaths.join('|'),
    importantPaths.join('|'),
  ])

  if (!isExpandable(value)) {
    return (
      <PrimitiveJsonNode
        value={value}
        label={label}
        index={index}
        trailingComma={trailingComma}
      />
    )
  }

  const entries = Array.isArray(value)
    ? value.map((item, itemIndex) => [String(itemIndex), item] as const)
    : Object.entries(value)
  const opening = Array.isArray(value) ? '[' : '{'
  const closing = Array.isArray(value) ? ']' : '}'

  if (entries.length === 0) {
    return (
      <EmptyJsonNode
        value={value}
        label={label}
        index={index}
        trailingComma={trailingComma}
      />
    )
  }

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="button-interactive flex min-w-0 items-baseline gap-1 rounded-[10px] px-1 py-0.5 text-left transition-colors hover:bg-[color:var(--color-card)]"
      >
        <ChevronRight
          className={cx(
            'mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)] transition-transform',
            expanded && 'rotate-90',
          )}
          strokeWidth={1.8}
        />
        <JsonKey label={label} index={index} />
        <span className="text-[color:var(--color-foreground)]">
          {expanded ? opening : `${opening} ... ${closing}`}
        </span>
        {!expanded ? (
          <span className="rounded-full bg-[color:var(--color-card)] px-1.5 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">
            {collapsedSummary(value)}
          </span>
        ) : null}
        {!expanded && trailingComma ? (
          <span className="text-[color:var(--color-muted-foreground)]">,</span>
        ) : null}
      </button>

      {expanded ? (
        <>
          <div className="ml-4 space-y-1 border-l pl-3" style={{ borderColor: 'var(--color-border)' }}>
            {entries.map(([entryKey, child], entryIndex) => (
              <CollapsibleJsonNode
                key={entryKey}
                value={child}
                label={Array.isArray(value) ? undefined : entryKey}
                index={Array.isArray(value) ? Number(entryKey) : undefined}
                path={[...path, entryKey]}
                depth={depth + 1}
                defaultExpandedDepth={defaultExpandedDepth}
                defaultCollapsedPaths={defaultCollapsedPaths}
                importantPaths={importantPaths}
                expansionMode={expansionMode}
                expansionRevision={expansionRevision}
                trailingComma={entryIndex < entries.length - 1}
              />
            ))}
          </div>
          <div className="ml-1 text-[color:var(--color-foreground)]">
            {closing}
            {trailingComma ? <span className="text-[color:var(--color-muted-foreground)]">,</span> : null}
          </div>
        </>
      ) : null}
    </div>
  )
}

export function AgentLogCollapsibleJson({
  value,
  defaultExpandedDepth = 2,
  defaultCollapsedPaths = [],
  importantPaths = [],
  expansionMode = 'default',
  expansionRevision = 0,
  className,
  maxHeightClassName = 'max-h-[620px]',
}: AgentLogCollapsibleJsonProps) {
  return (
    <div
      className={cx(
        maxHeightClassName,
        'overflow-auto rounded-[18px] bg-[color:var(--color-background-sunken)]/70 px-4 py-4 font-mono text-xs leading-5 text-[color:var(--color-foreground)]',
        className,
      )}
    >
      <CollapsibleJsonNode
        value={value}
        path={[]}
        depth={0}
        defaultExpandedDepth={defaultExpandedDepth}
        defaultCollapsedPaths={defaultCollapsedPaths}
        importantPaths={importantPaths}
        expansionMode={expansionMode}
        expansionRevision={expansionRevision}
      />
    </div>
  )
}
