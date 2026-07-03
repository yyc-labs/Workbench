import { MessageSquareText } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '../../../components/ui/button'
import { useI18n } from '../../../i18n'
import { joinJsonPath } from './agentLogs.anchors'
import { AgentLogExpandableText } from './AgentLogExpandableText'
import { extractTextBlocks, isRecord, stringifyUnknown } from './agentLogs.display'

type AgentLogMessageRow = {
  label: string
  role: string
  name?: string
  contentType: string
  text: string
  path?: string[]
}

function roleLabel(message: Record<string, unknown>, index: number): string {
  const role = typeof message.role === 'string'
    ? message.role
    : typeof message.type === 'string'
      ? message.type
      : `item ${index + 1}`
  const name = typeof message.name === 'string' ? ` / ${message.name}` : ''
  return `${role}${name}`
}

function contentType(value: unknown): string {
  if (typeof value === 'string') return 'text'
  if (Array.isArray(value)) return `array[${value.length}]`
  if (isRecord(value) && typeof value.type === 'string') return value.type
  if (isRecord(value)) return 'object'
  return typeof value
}

function messageText(message: Record<string, unknown>): string {
  return extractTextBlocks(message.content ?? message.text ?? message.input ?? message.result).join('\n\n')
}

function rowsFromMessages(value: unknown): AgentLogMessageRow[] {
  if (!isRecord(value)) return []

  if (Array.isArray(value.messages)) {
    return value.messages.map((message, index) => {
      if (!isRecord(message)) {
        return {
          label: `item ${index + 1}`,
          role: 'item',
          contentType: contentType(message),
          text: stringifyUnknown(message),
        }
      }

      const role = typeof message.role === 'string'
        ? message.role
        : typeof message.type === 'string'
          ? message.type
          : 'item'

      return {
        label: roleLabel(message, index),
        role,
        name: typeof message.name === 'string' ? message.name : undefined,
        contentType: contentType(message.content ?? message.text ?? message.input ?? message.result),
        text: messageText(message),
        path: ['messages', String(index)],
      }
    })
  }

  if (typeof value.input !== 'undefined') {
    if (typeof value.input === 'string') {
      return [{
        label: 'input',
        role: 'input',
        contentType: 'text',
        text: value.input,
        path: ['input'],
      }]
    }

    if (Array.isArray(value.input)) {
      return value.input.map((item, index) => {
        if (!isRecord(item)) {
          return {
            label: `input ${index + 1}`,
            role: 'input',
            contentType: contentType(item),
            text: stringifyUnknown(item),
          }
        }

        const role = typeof item.role === 'string'
          ? item.role
          : typeof item.type === 'string'
            ? item.type
            : 'input'

        return {
          label: roleLabel(item, index),
          role,
          name: typeof item.name === 'string' ? item.name : undefined,
          contentType: contentType(item.content ?? item.text ?? item.input),
          text: extractTextBlocks(item.content ?? item.text ?? item.input).join('\n\n'),
          path: ['input', String(index)],
        }
      })
    }

    return [{
      label: 'input',
      role: 'input',
      contentType: contentType(value.input),
      text: stringifyUnknown(value.input),
      path: ['input'],
    }]
  }

  return []
}

function roleTone(role: string): string {
  switch (role) {
    case 'system':
    case 'developer':
      return 'bg-[color:var(--color-background-sunken)] text-[color:var(--color-foreground)]'
    case 'tool':
    case 'tool_result':
      return 'bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]'
    case 'assistant':
      return 'bg-[color:var(--color-success-background)] text-[color:var(--color-success)]'
    case 'user':
      return 'bg-[color:var(--color-card)] text-[color:var(--color-primary)]'
    default:
      return 'bg-[color:var(--color-card)] text-[color:var(--color-muted-foreground)]'
  }
}

export function AgentLogMessageList({
  value,
  pathPrefix,
  onFocusPath,
}: {
  value: unknown
  pathPrefix?: string[]
  onFocusPath?: (path: string[]) => void
}) {
  const { t } = useI18n()
  const [showAll, setShowAll] = useState(false)
  const rows = useMemo(() => rowsFromMessages(value), [value])

  if (rows.length === 0) return null

  const visibleRows = showAll ? rows : rows.slice(0, 2)
  const hiddenCount = rows.length - visibleRows.length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--color-foreground)]">
          <MessageSquareText className="h-4 w-4" strokeWidth={1.8} />
          {t('settings.agentLogs.messages')}
          <span className="rounded-full bg-[color:var(--color-card)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--color-muted-foreground)]">
            {rows.length}
          </span>
        </div>
        {hiddenCount > 0 || showAll ? (
          <Button
            type="button"
            variant="outline"
            className="h-8 rounded-full px-3 text-xs"
            onClick={() => setShowAll((current) => !current)}
          >
            {showAll ? t('settings.agentLogs.showLessMessages') : t('settings.agentLogs.showAllMessages')}
          </Button>
        ) : null}
      </div>

      {hiddenCount > 0 ? (
        <div className="rounded-[14px] bg-[color:var(--color-background-sunken)]/60 px-3 py-2 text-xs text-[color:var(--color-muted-foreground)]">
          {t('settings.agentLogs.messagesHidden', { count: hiddenCount })}
        </div>
      ) : null}

      {visibleRows.map((row, index) => (
        <div
          key={`${row.label}-${index}`}
          className="rounded-[18px] border bg-[color:var(--color-card)] px-4 py-3"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${roleTone(row.role)}`}>
                {row.role}
              </span>
              <span className="text-xs font-medium text-[color:var(--color-foreground)]">{row.label}</span>
              <span className="text-[11px] text-[color:var(--color-muted-foreground)]">{row.contentType}</span>
              {row.name ? (
                <span className="text-[11px] text-[color:var(--color-muted-foreground)]">{row.name}</span>
              ) : null}
            </div>
            {onFocusPath && row.path ? (
              <Button
                type="button"
                variant="outline"
                className="h-7 rounded-full px-2.5 text-[11px]"
                onClick={() => onFocusPath(joinJsonPath(pathPrefix ?? [], row.path ?? []) ?? [])}
              >
                {t('settings.agentLogs.revealInJson')}
              </Button>
            ) : null}
          </div>
          <AgentLogExpandableText text={row.text} collapsedLines={row.role === 'tool' ? 6 : 10} />
        </div>
      ))}
    </div>
  )
}
