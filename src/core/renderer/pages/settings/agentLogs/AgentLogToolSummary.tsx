import { Braces } from 'lucide-react'
import { useMemo } from 'react'
import { useI18n } from '../../../i18n'
import { isRecord, stringifyUnknown } from './agentLogs.display'
import { AgentLogCollapsibleJson } from './AgentLogCollapsibleJson'

type ToolSummary = {
  name: string
  hasSchema: boolean
}

function toolName(value: unknown, index: number): string {
  if (!isRecord(value)) return `tool ${index + 1}`
  if (typeof value.name === 'string') return value.name
  if (isRecord(value.function) && typeof value.function.name === 'string') return value.function.name
  if (typeof value.id === 'string') return value.id
  return `tool ${index + 1}`
}

function hasSchema(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (typeof value.input_schema !== 'undefined') return true
  if (typeof value.parameters !== 'undefined') return true
  if (isRecord(value.function) && typeof value.function.parameters !== 'undefined') return true
  return false
}

function summarizeTools(value: unknown): ToolSummary[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => ({
      name: toolName(item, index),
      hasSchema: hasSchema(item),
    }))
  }

  if (isRecord(value)) {
    return Object.entries(value).map(([name, item]) => ({
      name,
      hasSchema: hasSchema(item),
    }))
  }

  return []
}

export function AgentLogToolSummary({ value }: { value: unknown }) {
  const { t } = useI18n()
  const tools = useMemo(() => summarizeTools(value), [value])

  if (typeof value === 'undefined') return null

  return (
    <div className="space-y-3 rounded-[18px] border bg-[color:var(--color-card)] px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--color-foreground)]">
          <Braces className="h-4 w-4" strokeWidth={1.8} />
          {t('settings.agentLogs.tools')}
        </div>
        <span className="rounded-full bg-[color:var(--color-background-sunken)]/70 px-2 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)]">
          {t('settings.agentLogs.toolCount', { count: tools.length })}
        </span>
      </div>

      {tools.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {tools.slice(0, 18).map((tool) => (
            <span
              key={tool.name}
              className="inline-flex max-w-full items-center gap-2 rounded-full bg-[color:var(--color-background-sunken)]/70 px-3 py-1 text-xs text-[color:var(--color-muted-foreground)]"
            >
              <span className="truncate">{tool.name}</span>
              <span className={tool.hasSchema ? 'text-[color:var(--color-success)]' : 'text-[color:var(--color-muted-foreground)]'}>
                {tool.hasSchema ? t('settings.agentLogs.schemaAvailable') : t('settings.agentLogs.schemaMissing')}
              </span>
            </span>
          ))}
          {tools.length > 18 ? (
            <span className="rounded-full bg-[color:var(--color-background-sunken)]/70 px-3 py-1 text-xs text-[color:var(--color-muted-foreground)]">
              +{tools.length - 18}
            </span>
          ) : null}
        </div>
      ) : (
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-[color:var(--color-muted-foreground)]">
          {stringifyUnknown(value)}
        </pre>
      )}

      <details>
        <summary className="cursor-pointer text-xs font-medium text-[color:var(--color-muted-foreground)]">
          {t('settings.agentLogs.toolSchemas')}
        </summary>
        <div className="mt-3">
          <AgentLogCollapsibleJson
            value={value}
            defaultExpandedDepth={1}
            defaultCollapsedPaths={['parameters', 'input_schema', 'schema']}
            importantPaths={['name', 'description', 'type']}
            maxHeightClassName="max-h-[420px]"
            className="bg-[color:var(--color-background-sunken)]/70"
          />
        </div>
      </details>
    </div>
  )
}
