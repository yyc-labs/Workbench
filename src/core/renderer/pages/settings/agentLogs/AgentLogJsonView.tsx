import { useState } from 'react'
import { Button } from '../../../components/ui/button'
import { useI18n } from '../../../i18n'
import { toPrettyJson } from './agentLogs.helpers'
import { AgentLogCollapsibleJson, type AgentLogJsonExpansionMode } from './AgentLogCollapsibleJson'

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
  const [expansionMode, setExpansionMode] = useState<AgentLogJsonExpansionMode>('default')
  const [expansionRevision, setExpansionRevision] = useState(0)
  const jsonText = toPrettyJson(value)
  const displayValue = parseJsonText(jsonText, value)

  const applyExpansionMode = (mode: AgentLogJsonExpansionMode) => {
    setExpansionMode(mode)
    setExpansionRevision((current) => current + 1)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-end gap-2">
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
      <AgentLogCollapsibleJson
        key={jsonText}
        value={displayValue}
        copyText={jsonText}
        defaultCollapsedPaths={['headers', 'tools', 'rawText', 'previewEvents']}
        importantPaths={['error', 'statusCode', 'model', 'messages', 'route', 'providerEvent', 'canonicalEvent']}
        expansionMode={expansionMode}
        expansionRevision={expansionRevision}
      />
    </div>
  )
}
