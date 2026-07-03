import { Braces, Search } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { useI18n } from '../../../i18n'
import { displayJsonString, isRecord, stringifyUnknown } from './agentLogs.display'
import { AgentLogCollapsibleJson, type AgentLogJsonExpansionMode } from './AgentLogCollapsibleJson'

type AgentLogJsonViewProps = {
  value: unknown
  focusedPath?: string[]
  onFocusPathChange?: (path: string[] | undefined) => void
  persistenceKey?: string
  showFieldIndex?: boolean
}

type JsonPathEntry = {
  path: string[]
  label: string
  kind: string
  preview: string
  important: boolean
}

const IMPORTANT_PATHS = ['error', 'statusCode', 'model', 'messages', 'route', 'providerEvent', 'canonicalEvent']
const DEFAULT_COLLAPSED_PATHS = ['headers', 'messages', 'tools', 'content', 'choices', 'rawText', 'previewEvents']
const MAX_INDEX_ENTRIES = 280
const MAX_ARRAY_INDEX_ITEMS = 30
const MAX_INDEX_DEPTH = 7

type AgentLogJsonFieldIndexPanelProps = {
  value: unknown
  focusedPath?: string[]
  onFocusPathChange?: (path: string[]) => void
  maxHeightClassName?: string
}

function pathLabel(path: string[]): string {
  if (path.length === 0) return '$'
  return path.reduce((label, segment) => {
    if (/^\d+$/.test(segment)) return `${label}[${segment}]`
    return `${label}.${segment}`
  }, '$')
}

function kindOf(value: unknown): string {
  if (Array.isArray(value)) return `array[${value.length}]`
  if (value === null) return 'null'
  if (isRecord(value)) return `object{${Object.keys(value).length}}`
  return typeof value
}

function oneLine(value: string): string {
  return displayJsonString(value).replace(/\s+/g, ' ').trim()
}

function previewValue(value: unknown): string {
  if (typeof value === 'string') {
    const text = oneLine(value)
    return text.length > 96 ? `${text.slice(0, 96)}...` : text
  }
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`
  if (isRecord(value)) return Object.keys(value).slice(0, 5).join(', ') || '{}'
  const text = oneLine(stringifyUnknown(value))
  return text.length > 96 ? `${text.slice(0, 96)}...` : text
}

function pathIsImportant(path: string[]): boolean {
  const joined = path.join('.')
  return IMPORTANT_PATHS.some((part) => (
    joined === part
    || joined.endsWith(`.${part}`)
  ))
}

function buildPathIndex(value: unknown): JsonPathEntry[] {
  const entries: JsonPathEntry[] = []

  const visit = (node: unknown, path: string[], depth: number) => {
    if (entries.length >= MAX_INDEX_ENTRIES || depth > MAX_INDEX_DEPTH) return

    if (path.length > 0) {
      entries.push({
        path,
        label: pathLabel(path),
        kind: kindOf(node),
        preview: previewValue(node),
        important: pathIsImportant(path),
      })
    }

    if (Array.isArray(node)) {
      node.slice(0, MAX_ARRAY_INDEX_ITEMS).forEach((child, index) => visit(child, [...path, String(index)], depth + 1))
      return
    }

    if (isRecord(node)) {
      Object.entries(node).forEach(([key, child]) => visit(child, [...path, key], depth + 1))
    }
  }

  visit(value, [], 0)
  return entries
}

function JsonFieldIndexPanel({
  entries,
  focusedPath,
  normalizedSearchQuery,
  onFocusPathChange,
  maxHeightClassName = 'max-h-[540px]',
}: {
  entries: JsonPathEntry[]
  focusedPath?: string[]
  normalizedSearchQuery: string
  onFocusPathChange?: (path: string[]) => void
  maxHeightClassName?: string
}) {
  const { t } = useI18n()

  return (
    <section className="rounded-[20px] border bg-[color:var(--color-card)] px-3 py-3" style={{ borderColor: 'var(--color-border)' }}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--color-foreground)]">
          <Braces className="h-4 w-4" strokeWidth={1.8} />
          {t('settings.agentLogs.jsonFieldIndex')}
        </div>
        <span className="rounded-full bg-[color:var(--color-background-sunken)]/70 px-2 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)]">
          {entries.length}
        </span>
      </div>
      <p className="mb-3 text-xs leading-5 text-[color:var(--color-muted-foreground)]">
        {normalizedSearchQuery
          ? t('settings.agentLogs.jsonFieldIndexSearchHint')
          : t('settings.agentLogs.jsonFieldIndexHint')}
      </p>
      <div className={`${maxHeightClassName} space-y-1 overflow-auto pr-1`}>
        {entries.length === 0 ? (
          <div className="rounded-[14px] bg-[color:var(--color-background-sunken)]/60 px-3 py-4 text-center text-xs text-[color:var(--color-muted-foreground)]">
            {t('settings.agentLogs.jsonNoFieldMatches')}
          </div>
        ) : entries.map((entry) => {
          const active = focusedPath?.join('\u0000') === entry.path.join('\u0000')
          return (
            <button
              key={entry.label}
              type="button"
              onClick={() => onFocusPathChange?.(entry.path)}
              className={`button-interactive w-full rounded-[14px] px-3 py-2 text-left transition-colors ${
                active
                  ? 'bg-[color:var(--color-primary)]/10 text-[color:var(--color-foreground)]'
                  : 'hover:bg-[color:var(--color-background-sunken)]/65'
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${entry.important ? 'bg-[color:var(--color-primary)]' : 'bg-[color:var(--color-muted-foreground)]/55'}`} />
                <span className="truncate font-mono text-[11px] text-[color:var(--color-foreground)]">{entry.label}</span>
              </div>
              <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-[color:var(--color-muted-foreground)]">
                <span className="shrink-0 rounded-full bg-[color:var(--color-background-sunken)]/70 px-2 py-0.5">{entry.kind}</span>
                <span className="truncate">{entry.preview}</span>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}

export function AgentLogJsonFieldIndexPanel({
  value,
  focusedPath,
  onFocusPathChange,
  maxHeightClassName = 'max-h-[540px]',
}: AgentLogJsonFieldIndexPanelProps) {
  const { t } = useI18n()
  const [searchQuery, setSearchQuery] = useState('')
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const pathIndex = useMemo(() => buildPathIndex(value), [value])
  const normalizedSearchQuery = deferredSearchQuery.trim().toLowerCase()
  const visiblePathIndex = useMemo(() => {
    if (!normalizedSearchQuery) return pathIndex.filter((entry) => entry.important).slice(0, 32)
    return pathIndex
      .filter((entry) => (
        entry.label.toLowerCase().includes(normalizedSearchQuery)
        || entry.kind.toLowerCase().includes(normalizedSearchQuery)
        || entry.preview.toLowerCase().includes(normalizedSearchQuery)
      ))
      .slice(0, 80)
  }, [normalizedSearchQuery, pathIndex])

  return (
    <div className="space-y-3">
      <div className="rounded-[20px] bg-[color:var(--color-background-sunken)]/45 p-3">
        <label className="relative block min-w-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--color-muted-foreground)]" strokeWidth={1.8} />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="h-9 pl-9 font-mono text-xs"
            placeholder={t('settings.agentLogs.jsonSearchPlaceholder')}
          />
        </label>
      </div>
      <JsonFieldIndexPanel
        entries={visiblePathIndex}
        focusedPath={focusedPath}
        normalizedSearchQuery={normalizedSearchQuery}
        onFocusPathChange={onFocusPathChange}
        maxHeightClassName={maxHeightClassName}
      />
    </div>
  )
}

export function AgentLogJsonView({
  value,
  focusedPath: externalFocusedPath,
  onFocusPathChange,
  persistenceKey,
  showFieldIndex = true,
}: AgentLogJsonViewProps) {
  const { t } = useI18n()
  const [expansionMode, setExpansionMode] = useState<AgentLogJsonExpansionMode>('default')
  const [expansionRevision, setExpansionRevision] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [internalFocusedPath, setInternalFocusedPath] = useState<string[] | undefined>(undefined)
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const displayValue = value
  const pathIndex = useMemo(
    () => (showFieldIndex ? buildPathIndex(displayValue) : []),
    [displayValue, showFieldIndex],
  )
  const focusedPath = externalFocusedPath ?? internalFocusedPath
  const normalizedSearchQuery = deferredSearchQuery.trim().toLowerCase()
  const visiblePathIndex = useMemo(() => {
    if (!showFieldIndex) return []
    if (!normalizedSearchQuery) return pathIndex.filter((entry) => entry.important).slice(0, 32)
    return pathIndex
      .filter((entry) => (
        entry.label.toLowerCase().includes(normalizedSearchQuery)
        || entry.kind.toLowerCase().includes(normalizedSearchQuery)
        || entry.preview.toLowerCase().includes(normalizedSearchQuery)
      ))
      .slice(0, 80)
  }, [normalizedSearchQuery, pathIndex, showFieldIndex])

  const applyExpansionMode = (mode: AgentLogJsonExpansionMode) => {
    setExpansionMode(mode)
    setExpansionRevision((current) => current + 1)
  }

  const focusPath = (path: string[]) => {
    if (!externalFocusedPath) {
      setInternalFocusedPath(path)
    }
    onFocusPathChange?.(path)
    setExpansionMode('default')
    setExpansionRevision((current) => current + 1)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-[20px] bg-[color:var(--color-background-sunken)]/45 p-3 lg:flex-row lg:items-center lg:justify-between">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--color-muted-foreground)]" strokeWidth={1.8} />
          <Input
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value)
              if (!externalFocusedPath) {
                setInternalFocusedPath(undefined)
              }
              onFocusPathChange?.(undefined)
            }}
            className="h-9 pl-9 font-mono text-xs"
            placeholder={t('settings.agentLogs.jsonSearchPlaceholder')}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="h-9 rounded-full px-3 text-xs"
            onClick={() => applyExpansionMode('expand-important')}
          >
            {t('settings.agentLogs.expandImportant')}
          </Button>
          <Button
            variant="outline"
            className="h-9 rounded-full px-3 text-xs"
            onClick={() => applyExpansionMode('expand-all')}
          >
            {t('settings.agentLogs.expandAll')}
          </Button>
          <Button
            variant="outline"
            className="h-9 rounded-full px-3 text-xs"
            onClick={() => applyExpansionMode('collapse-all')}
          >
            {t('settings.agentLogs.collapseAll')}
          </Button>
        </div>
      </div>

      <div
        className={showFieldIndex ? 'grid gap-3' : undefined}
        style={showFieldIndex ? { gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 560px), 1fr))' } : undefined}
      >
        {showFieldIndex ? (
          <JsonFieldIndexPanel
            entries={visiblePathIndex}
            focusedPath={focusedPath}
            normalizedSearchQuery={normalizedSearchQuery}
            onFocusPathChange={focusPath}
          />
        ) : null}

        <AgentLogCollapsibleJson
          value={displayValue}
          defaultCollapsedPaths={DEFAULT_COLLAPSED_PATHS}
          importantPaths={IMPORTANT_PATHS}
          expansionMode={expansionMode}
          expansionRevision={expansionRevision}
          focusedPath={focusedPath}
          searchQuery={deferredSearchQuery}
          persistenceKey={persistenceKey}
        />
      </div>
    </div>
  )
}
