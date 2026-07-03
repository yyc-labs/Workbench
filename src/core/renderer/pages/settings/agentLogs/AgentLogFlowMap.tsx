import { useI18n } from '../../../i18n'
import type { AgentLogFlowStep, AgentLogFlowStepStatus } from './agentLogs.flow'

type AgentLogFlowMapProps = {
  steps: AgentLogFlowStep[]
  activeStepId: string
  onSelectStep: (stepId: string) => void
  maxHeightClassName?: string
}

function statusClassName(status: AgentLogFlowStepStatus, active: boolean): string {
  if (status === 'error') {
    return active
      ? 'border-[color:var(--color-destructive)]/45 bg-[color:var(--color-destructive-background)] text-[color:var(--color-destructive)] shadow-sm'
      : 'border-[color:var(--color-destructive)]/25 bg-[color:var(--color-destructive-background)]/45 text-[color:var(--color-destructive)]'
  }
  if (status === 'warn') {
    return active
      ? 'border-[color:var(--color-warning)]/45 bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)] shadow-sm'
      : 'border-[color:var(--color-warning)]/25 bg-[color:var(--color-warning-background)]/45 text-[color:var(--color-warning)]'
  }
  if (status === 'missing') {
    return active
      ? 'border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)] text-[color:var(--color-foreground)] shadow-sm'
      : 'border-[color:var(--color-border)] bg-[color:var(--color-card)]/65 text-[color:var(--color-muted-foreground)]'
  }
  return active
    ? 'border-[color:var(--color-success)]/35 bg-[color:var(--color-success-background)] text-[color:var(--color-success)] shadow-sm'
    : 'border-[color:var(--color-border)] bg-[color:var(--color-card)] text-[color:var(--color-foreground)]'
}

function statusDotClassName(status: AgentLogFlowStepStatus): string {
  if (status === 'error') return 'bg-[color:var(--color-destructive)]'
  if (status === 'warn') return 'bg-[color:var(--color-warning)]'
  if (status === 'missing') return 'bg-[color:var(--color-muted-foreground)]'
  return 'bg-[color:var(--color-success)]'
}

function statusLabel(status: AgentLogFlowStepStatus, t: ReturnType<typeof useI18n>['t']): string {
  if (status === 'error') return t('settings.agentLogs.stepStatusError')
  if (status === 'warn') return t('settings.agentLogs.stepStatusWarn')
  if (status === 'missing') return t('settings.agentLogs.stepStatusMissing')
  return t('settings.agentLogs.stepStatusOk')
}

export function AgentLogFlowMap({
  steps,
  activeStepId,
  onSelectStep,
  maxHeightClassName = 'max-h-[380px]',
}: AgentLogFlowMapProps) {
  const { t } = useI18n()

  return (
    <section className="rounded-[22px] border bg-[color:var(--color-background-sunken)]/35 px-3 py-3" style={{ borderColor: 'var(--color-border)' }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('settings.agentLogs.flowMap')}</h4>
          <p className="mt-1 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('settings.agentLogs.flowMapHint')}</p>
        </div>
      </div>

      <div className={`${maxHeightClassName} space-y-2 overflow-auto pr-1`}>
        {steps.map((step, index) => {
          const active = step.id === activeStepId
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => onSelectStep(step.id)}
              className={`button-interactive group relative w-full rounded-[18px] border px-3 py-3 text-left transition-colors ${statusClassName(step.status, active)}`}
            >
              {index < steps.length - 1 ? (
                <span className="absolute bottom-[-10px] left-[21px] h-3 w-px bg-[color:var(--color-border)]" />
              ) : null}
              <div className="flex min-w-0 gap-3">
                <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ring-4 ring-[color:var(--color-background-sunken)] ${statusDotClassName(step.status)}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{step.title}</span>
                    <span className="shrink-0 rounded-full bg-[color:var(--color-card)]/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] opacity-80">
                      {statusLabel(step.status, t)}
                    </span>
                  </span>
                  <span className="mt-2 flex min-w-0 flex-wrap gap-1.5 text-[11px] leading-4 opacity-85">
                    {(step.summary.length > 0 ? step.summary.slice(0, 3) : [t('settings.agentLogs.notCapturedYet')]).map((item) => (
                      <span
                        key={item}
                        className="max-w-full truncate rounded-full bg-[color:var(--color-card)]/55 px-2 py-0.5"
                        title={item}
                      >
                        {item}
                      </span>
                    ))}
                  </span>
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
