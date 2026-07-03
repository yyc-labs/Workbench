import { useEffect, useState } from 'react'
import { useI18n } from '../../../i18n'
import { AgentLogFlowMap } from './AgentLogFlowMap'
import { AgentLogStepInspector } from './AgentLogStepInspector'
import type { AgentLogDocumentSection } from './agentLogs.document'

export function AgentLogRequestView({
  detailKey,
  defaultStepId,
  steps,
  onFocusJsonPath,
}: {
  detailKey: string | null
  defaultStepId: string
  steps: AgentLogDocumentSection[]
  onFocusJsonPath?: (path: string[]) => void
}) {
  const { t } = useI18n()
  const [activeStepId, setActiveStepId] = useState('')

  useEffect(() => {
    setActiveStepId(defaultStepId)
  }, [defaultStepId, detailKey])

  const activeStep = steps.find((step) => step.id === activeStepId) ?? steps[0]

  return (
    <div className="space-y-4">
      <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
        {t('settings.agentLogs.requestViewHint')}
      </div>

      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 540px), 1fr))' }}
      >
        <div className="self-start">
          <AgentLogFlowMap
            steps={steps}
            activeStepId={activeStep?.id ?? ''}
            onSelectStep={setActiveStepId}
          />
        </div>

        {activeStep ? (
          <AgentLogStepInspector
            step={activeStep}
            jsonRootPath={activeStep.jsonRootPath}
            onFocusJsonPath={onFocusJsonPath}
          />
        ) : null}
      </div>
    </div>
  )
}
