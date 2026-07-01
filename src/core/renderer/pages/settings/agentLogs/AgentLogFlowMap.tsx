import { ArrowRight } from 'lucide-react'
import { useI18n } from '../../../i18n'
import type { AgentLogFlowStep, AgentLogFlowStepStatus } from './agentLogs.flow'

type AgentLogFlowMapProps = {
  steps: AgentLogFlowStep[]
  activeStepId: string
  onSelectStep: (stepId: string) => void
}

function statusClassName(status: AgentLogFlowStepStatus, active: boolean): string {
  if (status === 'error') {
    return active
      ? 'border-[color:var(--color-destructive)]/45 bg-[color:var(--color-destructive-background)] text-[color:var(--color-destructive)]'
      : 'border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-background)]/70 text-[color:var(--color-destructive)]'
  }
  if (status === 'warn') {
    return active
      ? 'border-[color:var(--color-warning)]/45 bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]'
      : 'border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-background)]/65 text-[color:var(--color-warning)]'
  }
  if (status === 'missing') {
    return active
      ? 'border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)] text-[color:var(--color-foreground)]'
      : 'border-[color:var(--color-border)] bg-[color:var(--color-card)]/70 text-[color:var(--color-muted-foreground)]'
  }
  return active
    ? 'border-[color:var(--color-success)]/35 bg-[color:var(--color-success-background)] text-[color:var(--color-success)]'
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

export function AgentLogFlowMap({ steps, activeStepId, onSelectStep }: AgentLogFlowMapProps) {
  const { t } = useI18n()

  return (
    <section className="rounded-[22px] border bg-[color:var(--color-background-sunken)]/35 px-4 py-4" style={{ borderColor: 'var(--color-border)' }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('settings.agentLogs.flowMap')}</h4>
          <p className="mt-1 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('settings.agentLogs.flowMapHint')}</p>
        </div>
      </div>

      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="flex min-w-max items-stretch gap-2">
          {steps.map((step, index) => {
            const active = step.id === activeStepId
            return (
              <div key={step.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSelectStep(step.id)}
                  className={`button-interactive w-[170px] rounded-[18px] border px-3 py-3 text-left transition-all hover:-translate-y-0.5 ${statusClassName(step.status, active)}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClassName(step.status)}`} />
                    <span className="truncate text-sm font-semibold">{step.title}</span>
                  </div>
                  <div className="mt-2 text-[11px] font-medium uppercase tracking-[0.12em] opacity-80">
                    {statusLabel(step.status, t)}
                  </div>
                  <div className="mt-2 min-h-8 space-y-1 text-xs leading-4 opacity-85">
                    {(step.summary.length > 0 ? step.summary.slice(0, 2) : [t('settings.agentLogs.notCapturedYet')]).map((item) => (
                      <div key={item} className="truncate">{item}</div>
                    ))}
                  </div>
                </button>
                {index < steps.length - 1 ? (
                  <ArrowRight className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" strokeWidth={1.8} />
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
