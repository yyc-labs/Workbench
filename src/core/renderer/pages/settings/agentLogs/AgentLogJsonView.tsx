import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../../../components/ui/button'
import { useI18n } from '../../../i18n'
import { toPrettyJson } from './agentLogs.helpers'
import { AgentLogCollapsibleJson } from './AgentLogCollapsibleJson'

type AgentLogJsonViewProps = {
  value: unknown
}

function parseJsonText(jsonText: string, fallback: unknown): unknown {
  try {
    return JSON.parse(jsonText) as unknown
  } catch {
    return fallback
  }
}

export function AgentLogJsonView({ value }: AgentLogJsonViewProps) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const jsonText = toPrettyJson(value)
  const displayValue = parseJsonText(jsonText, value)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1200)
    return () => window.clearTimeout(timer)
  }, [copied])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(jsonText)
    setCopied(true)
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          variant="outline"
          className="h-9 rounded-full px-3 text-xs"
          onClick={() => void handleCopy()}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t('common.copied') : t('settings.agentLogs.copyJson')}
        </Button>
      </div>
      <AgentLogCollapsibleJson key={jsonText} value={displayValue} />
    </div>
  )
}
