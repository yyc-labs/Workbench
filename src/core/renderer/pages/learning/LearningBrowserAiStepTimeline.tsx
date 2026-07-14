import { AlertCircle, Check, ChevronDown, ChevronRight, Circle, Loader2, X } from 'lucide-react'
import { useState } from 'react'
import type { BrowserAiTaskStep } from '../../../shared/types'
import { useI18n } from '../../i18n'

type LearningBrowserAiStepTimelineProps = {
  steps: BrowserAiTaskStep[]
}

const STEP_IDS = [
  'prepare-task',
  'connect-edge',
  'open-conversation',
  'check-login',
  'find-composer',
  'fill-prompt',
  'submit-prompt',
  'wait-response',
  'read-answer',
  'completed',
] as const

export function LearningBrowserAiStepTimeline({ steps }: LearningBrowserAiStepTimelineProps) {
  const { t } = useI18n()
  const [isCollapsed, setIsCollapsed] = useState(true)
  const stepMap = new Map(steps.map((step) => [step.id, step]))
  const visibleSteps = STEP_IDS.map((id) => stepMap.get(id)).filter((step): step is BrowserAiTaskStep => Boolean(step))
  const terminalSteps = steps.filter((step) => step.id === 'failed' || step.id === 'cancelled')
  const allSteps = [...visibleSteps, ...terminalSteps]
  if (allSteps.length === 0) return null

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        className="flex min-h-9 w-full items-center justify-between gap-2 rounded-[10px] px-2.5 py-1.5 text-left text-sm font-medium text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
        onClick={() => setIsCollapsed((collapsed) => !collapsed)}
        aria-expanded={!isCollapsed}
        aria-controls="learning-browser-ai-step-timeline"
        title={t(isCollapsed ? 'learning.browserAi.expandSteps' : 'learning.browserAi.collapseSteps')}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {isCollapsed ? <ChevronRight className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" /> : <ChevronDown className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)]" />}
          <span className="truncate">{t('learning.browserAi.stepsTitle')}</span>
        </span>
      </button>
      <div
        id="learning-browser-ai-step-timeline"
        className="grid gap-1"
        hidden={isCollapsed}
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }}
      >
        {allSteps.map((step) => {
          const isActive = step.status === 'active'
          const isFailed = step.status === 'failed'
          const isCancelled = step.status === 'cancelled'
          return (
            <div key={step.id} className="flex min-w-0 items-center gap-2.5 rounded-[10px] px-2 py-1" style={{ background: isActive ? 'color-mix(in srgb, var(--color-primary) 8%, transparent)' : 'transparent' }}>
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {isFailed ? <AlertCircle className="h-4 w-4 text-[color:var(--color-destructive)]" />
                  : isCancelled ? <X className="h-4 w-4 text-[color:var(--color-muted-foreground)]" />
                    : step.status === 'completed' ? <Check className="h-4 w-4 text-[color:var(--color-primary)]" />
                      : isActive ? <Loader2 className="h-4 w-4 animate-spin text-[color:var(--color-primary)]" />
                        : <Circle className="h-3 w-3 text-[color:var(--color-muted-foreground)]" />}
              </span>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="shrink-0 text-xs font-medium text-[color:var(--color-foreground)]">{t(`learning.browserAi.steps.${step.id}` as never)}</span>
                {step.id === 'wait-response' && step.elapsedMs ? (
                  <span className="min-w-0 truncate text-[11px] text-[color:var(--color-muted-foreground)]">
                    {t('learning.browserAi.waitingCheck', { value: String(Math.floor(step.elapsedMs / 1000)) })}
                  </span>
                ) : isFailed || isCancelled ? (
                  <span className="min-w-0 truncate text-[11px] text-[color:var(--color-muted-foreground)]">{step.detail || step.message}</span>
                ) : null}
              </div>
              {step.elapsedMs && step.id === 'wait-response' ? <span className="shrink-0 text-[10px] text-[color:var(--color-muted-foreground)]">{Math.floor(step.elapsedMs / 1000)}s</span> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
