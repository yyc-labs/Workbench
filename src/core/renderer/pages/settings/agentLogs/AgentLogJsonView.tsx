import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../../../components/ui/button'
import { useI18n } from '../../../i18n'

type AgentLogJsonViewProps = {
  value: unknown
}

function toPrettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export function AgentLogJsonView({ value }: AgentLogJsonViewProps) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const jsonText = toPrettyJson(value)

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
      <pre className="max-h-[620px] overflow-auto rounded-[18px] bg-[color:var(--color-background-sunken)]/70 px-4 py-4 font-mono text-xs leading-5 text-[color:var(--color-foreground)] whitespace-pre-wrap break-all">
        {jsonText}
      </pre>
    </div>
  )
}
