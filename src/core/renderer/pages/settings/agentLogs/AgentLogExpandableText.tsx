import { Check, Copy } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../../components/ui/button'
import { useI18n } from '../../../i18n'
import { displayText, getStringLength } from './agentLogs.display'

type AgentLogExpandableTextProps = {
  text: string
  collapsedLines?: number
  previewChars?: number
  truncated?: boolean
  className?: string
}

function previewText(text: string, collapsedLines: number, previewChars: number): string {
  const lines = text.split('\n')
  const linePreview = lines.length > collapsedLines
    ? lines.slice(0, collapsedLines).join('\n')
    : text

  return linePreview.length > previewChars
    ? linePreview.slice(0, previewChars)
    : linePreview
}

export function AgentLogExpandableText({
  text,
  collapsedLines = 12,
  previewChars = 4000,
  truncated = false,
  className,
}: AgentLogExpandableTextProps) {
  const { t } = useI18n()
  const normalizedText = useMemo(() => displayText(text), [text])
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const { chars, lines } = useMemo(() => getStringLength(normalizedText), [normalizedText])
  const isLong = lines > collapsedLines || chars > previewChars || truncated
  const visibleText = expanded || !isLong ? normalizedText : previewText(normalizedText, collapsedLines, previewChars)

  useEffect(() => {
    setExpanded(false)
  }, [normalizedText])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1200)
    return () => window.clearTimeout(timer)
  }, [copied])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(normalizedText)
    setCopied(true)
  }

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--color-muted-foreground)]">
        <span>{t('settings.agentLogs.charactersLabel', { count: chars })}</span>
        <span>{t('settings.agentLogs.linesLabel', { count: lines })}</span>
        {truncated ? (
          <span className="rounded-full bg-[color:var(--color-destructive-background)] px-2 py-0.5 text-[color:var(--color-destructive)]">
            {t('settings.agentLogs.truncated')}
          </span>
        ) : null}
        {isLong && !expanded ? (
          <span>{t('settings.agentLogs.previewOnly')}</span>
        ) : null}
      </div>

      <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-6 text-[color:var(--color-foreground)]">
        {visibleText || t('settings.agentLogs.noContent')}
        {isLong && !expanded ? '\n...' : ''}
      </pre>

      <div className="mt-3 flex flex-wrap gap-2">
        {isLong ? (
          <Button
            type="button"
            variant="outline"
            className="h-8 rounded-full px-3 text-xs"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? t('settings.agentLogs.collapse') : t('settings.agentLogs.expand')}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className="h-8 rounded-full px-3 text-xs"
          onClick={() => void handleCopy()}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t('common.copied') : t('settings.agentLogs.copyFull')}
        </Button>
      </div>
    </div>
  )
}
