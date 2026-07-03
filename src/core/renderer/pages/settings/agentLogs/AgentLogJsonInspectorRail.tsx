import { Braces } from 'lucide-react'
import { useI18n } from '../../../i18n'
import { formatJsonPath } from './agentLogs.anchors'
import type { AgentLogDocumentSection } from './agentLogs.document'
import { AgentLogJsonView } from './AgentLogJsonView'

type AgentLogJsonInspectorRailProps = {
  persistenceKey?: string
  jsonValue: unknown
  sections: AgentLogDocumentSection[]
  activeSectionId: string
  focusedPath?: string[]
  onFocusPathChange: (path: string[] | undefined) => void
  showFieldIndex?: boolean
}

export function AgentLogJsonInspectorRail({
  persistenceKey,
  jsonValue,
  sections,
  activeSectionId,
  focusedPath,
  onFocusPathChange,
  showFieldIndex = true,
}: AgentLogJsonInspectorRailProps) {
  const { t } = useI18n()
  const activeSection = sections.find((section) => section.id === activeSectionId)

  return (
    <section className="space-y-3 rounded-[22px] border bg-[color:var(--color-card)] px-4 py-4" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--color-foreground)]">
        <Braces className="h-4 w-4" strokeWidth={1.8} />
        {t('settings.agentLogs.jsonInspector')}
      </div>

      <div className="space-y-2 rounded-[18px] bg-[color:var(--color-background-sunken)]/55 px-3 py-3 text-xs text-[color:var(--color-muted-foreground)]">
        <div>
          {t('settings.agentLogs.activeSection')}: {activeSection?.title ?? t('settings.agentLogs.notCapturedYet')}
        </div>
        <div className="font-mono">
          {t('settings.agentLogs.focusedPath')}: {formatJsonPath(focusedPath)}
        </div>
      </div>

      <AgentLogJsonView
        value={jsonValue}
        focusedPath={focusedPath}
        onFocusPathChange={onFocusPathChange}
        persistenceKey={persistenceKey}
        showFieldIndex={showFieldIndex}
      />
    </section>
  )
}
