import { useEffect, useMemo, useState } from 'react'
import type { AgentLogDetail } from '../../../../shared/types'
import { useI18n } from '../../../i18n'
import { AgentLogFlowMap } from './AgentLogFlowMap'
import { AgentLogStepInspector } from './AgentLogStepInspector'
import {
  buildAgentLogFlowSteps,
  getDefaultAgentLogFlowStepId,
  type AgentLogFlowLabels,
} from './agentLogs.flow'

export function AgentLogRequestView({ detail }: { detail: AgentLogDetail }) {
  const { t } = useI18n()
  const [activeStepId, setActiveStepId] = useState('')
  const labels: AgentLogFlowLabels = useMemo(() => ({
    ingressRequest: t('settings.agentLogs.ingressRequest'),
    ingressGatewayDescription: t('settings.agentLogs.ingressGatewayDescription'),
    ingressHookDescription: t('settings.agentLogs.ingressHookDescription'),
    normalizedRequest: t('settings.agentLogs.normalizedRequest'),
    normalizedRequestDescription: t('settings.agentLogs.normalizedRequestDescription'),
    upstreamRequest: t('settings.agentLogs.upstreamRequest'),
    upstreamRequestDescription: t('settings.agentLogs.upstreamRequestDescription'),
    upstreamResponse: t('settings.agentLogs.upstreamResponse'),
    clientResponse: t('settings.agentLogs.clientResponse'),
    normalizedEnvelope: t('settings.agentLogs.normalizedEnvelope'),
    normalizedEnvelopeDescription: t('settings.agentLogs.normalizedEnvelopeDescription'),
    payload: t('settings.agentLogs.payload'),
    sideEffects: t('settings.agentLogs.sideEffects'),
    sideEffectsDescription: t('settings.agentLogs.sideEffectsDescription'),
    notCapturedYet: t('settings.agentLogs.notCapturedYet'),
    truncated: t('settings.agentLogs.truncated'),
    parseError: t('settings.agentLogs.parseError'),
    stream: t('settings.agentLogs.stream'),
    mergedStream: t('settings.agentLogs.mergedStream'),
    mergedStreamDescription: t('settings.agentLogs.mergedStreamDescription'),
    upstreamMergedText: t('settings.agentLogs.upstreamMergedText'),
    clientMergedText: t('settings.agentLogs.clientMergedText'),
    finalPayload: t('settings.agentLogs.finalPayload'),
    protocolDiagnostics: t('settings.agentLogs.protocolDiagnostics'),
    protocolDiagnosticsDescription: t('settings.agentLogs.protocolDiagnosticsDescription'),
    lossyWarnings: t('settings.agentLogs.lossyWarnings'),
    toolValidation: t('settings.agentLogs.toolValidation'),
  }), [t])
  const steps = useMemo(() => buildAgentLogFlowSteps(detail, labels), [detail, labels])

  useEffect(() => {
    setActiveStepId(getDefaultAgentLogFlowStepId(detail, steps))
  }, [detail.summary.id, detail.summary.source, detail, steps])

  const activeStep = steps.find((step) => step.id === activeStepId) ?? steps[0]

  return (
    <div className="space-y-4">
      <div className="rounded-[18px] bg-[color:var(--color-card)] px-4 py-3 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
        {t('settings.agentLogs.requestViewHint')}
      </div>

      <AgentLogFlowMap
        steps={steps}
        activeStepId={activeStep?.id ?? ''}
        onSelectStep={setActiveStepId}
      />

      {activeStep ? (
        <AgentLogStepInspector step={activeStep} />
      ) : null}
    </div>
  )
}
