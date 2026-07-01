import { ChevronRight } from 'lucide-react'
import { useState } from 'react'

type AgentLogCollapsibleJsonProps = {
  value: unknown
  defaultExpandedDepth?: number
  className?: string
  maxHeightClassName?: string
}

type JsonNodeProps = {
  value: unknown
  label?: string
  index?: number
  depth: number
  defaultExpandedDepth: number
  trailingComma?: boolean
}

type JsonRecord = Record<string, unknown>

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
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

function PrimitiveJsonNode({
  value,
  label,
  index,
  trailingComma,
}: Pick<JsonNodeProps, 'value' | 'label' | 'index' | 'trailingComma'>) {
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

function CollapsibleJsonNode({
  value,
  label,
  index,
  depth,
  defaultExpandedDepth,
  trailingComma,
}: JsonNodeProps) {
  const [expanded, setExpanded] = useState(() => depth < defaultExpandedDepth)

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
          <span className="text-[color:var(--color-muted-foreground)]">{entries.length}</span>
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
                depth={depth + 1}
                defaultExpandedDepth={defaultExpandedDepth}
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
        depth={0}
        defaultExpandedDepth={defaultExpandedDepth}
      />
    </div>
  )
}
