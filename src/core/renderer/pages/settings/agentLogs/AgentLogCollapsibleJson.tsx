import { Check, ChevronRight, Copy } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../../i18n'
import { displayJsonString, isRecord } from './agentLogs.display'
import { toPrettyJson } from './agentLogs.helpers'

export type AgentLogJsonExpansionMode = 'default' | 'expand-all' | 'collapse-all' | 'expand-important'

type AgentLogCollapsibleJsonProps = {
  value: unknown
  defaultExpandedDepth?: number
  defaultCollapsedPaths?: string[]
  importantPaths?: string[]
  expansionMode?: AgentLogJsonExpansionMode
  expansionRevision?: number
  focusedPath?: string[]
  searchQuery?: string
  copyText?: string
  showCopyButton?: boolean
  persistenceKey?: string
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
  treeMetadata: JsonTreeMetadata
  expansionOverrides: Record<string, boolean>
  onExpansionOverrideChange: (pathKey: string, expanded: boolean | undefined) => void
  focusedPath?: string[]
  searchQuery: string
  trailingComma?: boolean
}

type JsonRecord = Record<string, unknown>
type JsonTreeMetadata = {
  importantBranchKeys: Set<string>
  searchBranchKeys: Set<string>
  searchMatchKeys: Set<string>
  focusedBranchKeys: Set<string>
}

const PATH_SEPARATOR = '\u0000'
const LARGE_NODE_ENTRY_THRESHOLD = 120
const INITIAL_ARRAY_CHILDREN = 32
const INITIAL_OBJECT_CHILDREN = 40
const CHILD_BATCH_SIZE = 120
const expansionOverrideCache = new Map<string, Record<string, boolean>>()

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

function valueToCopyText(value: unknown): string {
  try {
    return toPrettyJson(value)
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
  ))
}

function toPathKey(path: string[]): string {
  return path.join(PATH_SEPARATOR)
}

function appendPathKey(pathKey: string, segment: string): string {
  return pathKey ? `${pathKey}${PATH_SEPARATOR}${segment}` : segment
}

function pathLabel(path: string[]): string {
  if (path.length === 0) return '$'
  return path.reduce((label, segment) => {
    if (/^\d+$/.test(segment)) return `${label}[${segment}]`
    return `${label}.${segment}`
  }, '$')
}

function pathsEqual(left: string[], right: string[] | undefined): boolean {
  if (!right || left.length !== right.length) return false
  return left.every((segment, index) => segment === right[index])
}

function primitiveSearchText(value: unknown): string {
  if (typeof value === 'string') return displayJsonString(value)
  if (isExpandable(value)) return ''
  return primitiveToJson(value)
}

function nodeMatchesSearch(value: unknown, path: string[], query: string): boolean {
  if (!query) return false
  return pathLabel(path).toLowerCase().includes(query)
    || primitiveSearchText(value).toLowerCase().includes(query)
}

function addPathBranch(target: Set<string>, path: string[]): void {
  let branchKey = ''
  for (const segment of path) {
    branchKey = appendPathKey(branchKey, segment)
    target.add(branchKey)
  }
}

function buildJsonTreeMetadata(
  value: unknown,
  importantPaths: string[],
  normalizedSearchQuery: string,
  focusedPath?: string[],
): JsonTreeMetadata {
  const importantBranchKeys = new Set<string>()
  const searchBranchKeys = new Set<string>()
  const searchMatchKeys = new Set<string>()
  const focusedBranchKeys = new Set<string>()

  if (focusedPath && focusedPath.length > 0) {
    addPathBranch(focusedBranchKeys, focusedPath)
  }

  const visit = (node: unknown, path: string[], pathKey: string) => {
    if (path.length > 0 && pathMatches(path, importantPaths)) {
      addPathBranch(importantBranchKeys, path)
    }

    if (path.length > 0 && normalizedSearchQuery && nodeMatchesSearch(node, path, normalizedSearchQuery)) {
      searchMatchKeys.add(pathKey)
      addPathBranch(searchBranchKeys, path)
    }

    if (!isExpandable(node)) return

    const entries = Array.isArray(node)
      ? node.map((item, itemIndex) => [String(itemIndex), item] as const)
      : Object.entries(node)

    for (const [entryKey, child] of entries) {
      const childPath = [...path, entryKey]
      visit(child, childPath, appendPathKey(pathKey, entryKey))
    }
  }

  visit(value, [], '')

  return {
    importantBranchKeys,
    searchBranchKeys,
    searchMatchKeys,
    focusedBranchKeys,
  }
}

function initialVisibleChildrenCount(entryCount: number, isArray: boolean): number {
  if (entryCount <= LARGE_NODE_ENTRY_THRESHOLD) return entryCount
  return isArray ? INITIAL_ARRAY_CHILDREN : INITIAL_OBJECT_CHILDREN
}

function requiredVisibleChildrenCount(
  entries: ReadonlyArray<readonly [string, unknown]>,
  pathKey: string,
  treeMetadata: JsonTreeMetadata,
  baseCount: number,
): number {
  let requiredCount = baseCount

  for (let index = 0; index < entries.length; index += 1) {
    const childKey = appendPathKey(pathKey, entries[index][0])
    if (
      treeMetadata.focusedBranchKeys.has(childKey)
      || treeMetadata.searchBranchKeys.has(childKey)
      || treeMetadata.importantBranchKeys.has(childKey)
    ) {
      requiredCount = Math.max(requiredCount, index + 1)
    }
  }

  return Math.min(entries.length, requiredCount)
}

function shouldExpandNode({
  path,
  pathKey,
  depth,
  defaultExpandedDepth,
  defaultCollapsedPaths,
  expansionMode,
  treeMetadata,
  searchQuery,
}: Pick<JsonNodeProps, 'path' | 'depth' | 'defaultExpandedDepth' | 'defaultCollapsedPaths' | 'expansionMode' | 'treeMetadata' | 'searchQuery'> & {
  pathKey: string
}): boolean {
  if (depth === 0) return true
  if (treeMetadata.focusedBranchKeys.has(pathKey)) return true
  if (searchQuery && treeMetadata.searchBranchKeys.has(pathKey)) return true
  if (expansionMode === 'expand-all') return true
  if (expansionMode === 'collapse-all') return false
  const importantBranch = treeMetadata.importantBranchKeys.has(pathKey)
  if (expansionMode === 'expand-important') return importantBranch
  if (pathMatches(path, defaultCollapsedPaths)) return false
  if (importantBranch) return true
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
  const text = displayJsonString(value)
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
    const text = displayJsonString(value)
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
  const { t } = useI18n()
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
    treeMetadata,
    expansionOverrides,
    onExpansionOverrideChange,
    focusedPath,
    searchQuery,
    trailingComma,
  } = props
  const pathKey = toPathKey(path)
  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  const focused = pathsEqual(path, focusedPath)
  const matched = treeMetadata.searchMatchKeys.has(pathKey)
  const expandable = isExpandable(value)
  const entries = expandable
    ? Array.isArray(value)
      ? value.map((item, itemIndex) => [String(itemIndex), item] as const)
      : Object.entries(value)
    : []
  const defaultVisibleChildren = useMemo(
    () => requiredVisibleChildrenCount(
      entries,
      pathKey,
      treeMetadata,
      initialVisibleChildrenCount(entries.length, Array.isArray(value)),
    ),
    [entries, pathKey, treeMetadata, value],
  )
  const [visibleChildrenCount, setVisibleChildrenCount] = useState(defaultVisibleChildren)
  const opening = Array.isArray(value) ? '[' : '{'
  const closing = Array.isArray(value) ? ']' : '}'
  const defaultExpanded = shouldExpandNode({ ...props, pathKey })
  const allowManualOverride = expansionMode === 'default'
    && !(searchQuery && treeMetadata.searchBranchKeys.has(pathKey))
    && !treeMetadata.focusedBranchKeys.has(pathKey)
  const manualOverride = allowManualOverride ? expansionOverrides[pathKey] : undefined
  const expanded = typeof manualOverride === 'boolean' ? manualOverride : defaultExpanded
  const nodeHighlightClassName = focused
    ? 'bg-[color:var(--color-primary)]/10 ring-1 ring-[color:var(--color-primary)]/25'
      : matched
        ? 'bg-[color:var(--color-warning-background)]/65 ring-1 ring-[color:var(--color-warning)]/20'
        : undefined

  useEffect(() => {
    setVisibleChildrenCount(defaultVisibleChildren)
  }, [defaultVisibleChildren, expansionRevision])

  if (!expandable) {
    return (
      <div
        className={cx('rounded-[10px] px-1 py-0.5', nodeHighlightClassName)}
        data-agent-log-json-focused={focused ? 'true' : undefined}
      >
        <PrimitiveJsonNode
          value={value}
          label={label}
          index={index}
          trailingComma={trailingComma}
        />
      </div>
    )
  }

  const toggleExpanded = () => {
    const nextExpanded = !expanded
    onExpansionOverrideChange(pathKey, nextExpanded === defaultExpanded ? undefined : nextExpanded)
  }

  if (entries.length === 0) {
    return (
      <div
        className={cx('rounded-[10px] px-1 py-0.5', nodeHighlightClassName)}
        data-agent-log-json-focused={focused ? 'true' : undefined}
      >
        <EmptyJsonNode
          value={value}
          label={label}
          index={index}
          trailingComma={trailingComma}
        />
      </div>
    )
  }

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={toggleExpanded}
        data-agent-log-json-focused={focused ? 'true' : undefined}
        className={cx(
          'button-interactive flex min-w-0 items-baseline gap-1 rounded-[10px] px-1 py-0.5 text-left transition-colors hover:bg-[color:var(--color-card)]',
          nodeHighlightClassName,
        )}
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
            {entries.slice(0, visibleChildrenCount).map(([entryKey, child], entryIndex) => (
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
                treeMetadata={treeMetadata}
                expansionOverrides={expansionOverrides}
                onExpansionOverrideChange={onExpansionOverrideChange}
                focusedPath={focusedPath}
                searchQuery={searchQuery}
                trailingComma={entryIndex < Math.min(entries.length, visibleChildrenCount) - 1}
              />
            ))}
          </div>
          {visibleChildrenCount < entries.length ? (
            <div className="ml-4 mt-2 flex flex-wrap gap-2 pl-3">
              <button
                type="button"
                className="button-interactive rounded-full bg-[color:var(--color-card)] px-2.5 py-1 text-[11px] text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]"
                onClick={() => setVisibleChildrenCount((current) => Math.min(entries.length, current + CHILD_BATCH_SIZE))}
              >
                {t('settings.agentLogs.showMoreJsonItems', { count: Math.min(CHILD_BATCH_SIZE, entries.length - visibleChildrenCount) })}
              </button>
              {entries.length - visibleChildrenCount > CHILD_BATCH_SIZE ? (
                <button
                  type="button"
                  className="button-interactive rounded-full bg-[color:var(--color-card)] px-2.5 py-1 text-[11px] text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]"
                  onClick={() => setVisibleChildrenCount(entries.length)}
                >
                  {t('settings.agentLogs.showAllJsonItems', { count: entries.length })}
                </button>
              ) : null}
            </div>
          ) : null}
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
  focusedPath,
  searchQuery = '',
  copyText,
  showCopyButton = true,
  persistenceKey,
  className,
  maxHeightClassName = 'max-h-[620px]',
}: AgentLogCollapsibleJsonProps) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [expansionOverrides, setExpansionOverrides] = useState<Record<string, boolean>>(
    () => (persistenceKey ? expansionOverrideCache.get(persistenceKey) ?? {} : {}),
  )
  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  const focusedPathKey = focusedPath?.join(PATH_SEPARATOR) ?? ''
  const importantPathsKey = importantPaths.join('|')
  const treeMetadata = useMemo(
    () => buildJsonTreeMetadata(value, importantPaths, normalizedSearchQuery, focusedPath),
    [focusedPathKey, importantPathsKey, normalizedSearchQuery, value],
  )

  useEffect(() => {
    setExpansionOverrides(persistenceKey ? expansionOverrideCache.get(persistenceKey) ?? {} : {})
  }, [persistenceKey])

  useEffect(() => {
    if (!persistenceKey) return
    expansionOverrideCache.set(persistenceKey, expansionOverrides)
  }, [expansionOverrides, persistenceKey])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1200)
    return () => window.clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    if (!focusedPath || focusedPath.length === 0) return

    let frameId = 0
    let cancelled = false

    const scrollFocusedNode = (remainingAttempts: number) => {
      if (cancelled) return

      const target = containerRef.current?.querySelector<HTMLElement>('[data-agent-log-json-focused="true"]')
      if (target) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' })
        return
      }

      if (remainingAttempts <= 0) return
      frameId = window.requestAnimationFrame(() => scrollFocusedNode(remainingAttempts - 1))
    }

    frameId = window.requestAnimationFrame(() => scrollFocusedNode(8))

    return () => {
      cancelled = true
      if (frameId) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [focusedPath, expansionRevision])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(copyText ?? valueToCopyText(value))
    setCopied(true)
  }

  const handleExpansionOverrideChange = (pathKey: string, expanded: boolean | undefined) => {
    setExpansionOverrides((current) => {
      if (typeof expanded === 'undefined') {
        if (!(pathKey in current)) return current
        const next = { ...current }
        delete next[pathKey]
        return next
      }
      if (current[pathKey] === expanded) return current
      return { ...current, [pathKey]: expanded }
    })
  }

  return (
    <div
      ref={containerRef}
      className={cx(
        maxHeightClassName,
        'overflow-auto rounded-[18px] bg-[color:var(--color-background-sunken)]/70 px-4 py-4 font-mono text-xs leading-5 text-[color:var(--color-foreground)]',
        className,
      )}
    >
      {showCopyButton ? (
        <div className="sticky top-0 z-10 mb-2 flex justify-end">
          <button
            type="button"
            className="button-interactive inline-flex items-center gap-1 rounded-full border bg-[color:var(--color-card)]/95 px-2.5 py-1 font-sans text-[11px] font-medium text-[color:var(--color-muted-foreground)] shadow-sm backdrop-blur transition-colors hover:text-[color:var(--color-foreground)]"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => void handleCopy()}
            aria-label={copied ? t('common.copied') : t('settings.agentLogs.copyJson')}
            title={copied ? t('common.copied') : t('settings.agentLogs.copyJson')}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? t('common.copied') : t('settings.agentLogs.copyJson')}
          </button>
        </div>
      ) : null}
      <CollapsibleJsonNode
        value={value}
        path={[]}
        depth={0}
        defaultExpandedDepth={defaultExpandedDepth}
        defaultCollapsedPaths={defaultCollapsedPaths}
        importantPaths={importantPaths}
        expansionMode={expansionMode}
        expansionRevision={expansionRevision}
        treeMetadata={treeMetadata}
        expansionOverrides={expansionOverrides}
        onExpansionOverrideChange={handleExpansionOverrideChange}
        focusedPath={focusedPath}
        searchQuery={normalizedSearchQuery}
      />
    </div>
  )
}
