import { ChevronDown, Link2, RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'
import type {
  AiGatewayClientCli,
  AiGatewayStatus,
} from '../../../../shared/types'
import { Button } from '../../../components/ui/button'
import { useI18n } from '../../../i18n'

export function BindingCard({
  cli,
  status,
  busy,
  onApply,
  onRestore,
}: {
  cli: AiGatewayClientCli
  status: AiGatewayStatus | null
  busy: boolean
  onApply: (cli: AiGatewayClientCli) => void
  onRestore: (cli: AiGatewayClientCli) => void
}) {
  const { t } = useI18n()
  const binding = status?.clientBindings[cli]
  const title = cli === 'claude'
    ? t('settings.aiGateway.bindingClaude')
    : t('settings.aiGateway.bindingCodex')

  return (
    <div className="rounded-[22px] border px-5 py-5" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-[color:var(--color-foreground)]">{title}</h4>
          <p className="mt-1 text-xs leading-5 text-[color:var(--color-muted-foreground)]">
            {cli === 'claude'
              ? t('settings.aiGateway.bindingClaudeHint')
              : t('settings.aiGateway.bindingCodexHint')}
          </p>
        </div>
        <span className="rounded-full bg-[color:var(--color-card)] px-3 py-1 text-xs text-[color:var(--color-muted-foreground)]">
          {binding?.enabled ? t('settings.aiGateway.bound') : t('settings.aiGateway.notBound')}
        </span>
      </div>

      <div className="mt-4 space-y-1.5">
        <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.bindingBaseUrl')}</p>
        <div className="quiet-control rounded-[16px] px-4 py-3 font-mono text-xs text-[color:var(--color-foreground)] break-all">
          {binding?.baseUrl || t('settings.aiGateway.notAvailable')}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          className="h-10 rounded-full px-4 text-sm"
          onClick={() => onApply(cli)}
          disabled={busy}
        >
          <Link2 className="h-4 w-4" />
          {t('settings.aiGateway.applyBinding')}
        </Button>
        <Button
          variant="outline"
          className="h-10 rounded-full px-4 text-sm"
          onClick={() => onRestore(cli)}
          disabled={busy || !binding?.backup}
        >
          <RotateCcw className="h-4 w-4" />
          {t('settings.aiGateway.restoreBinding')}
        </Button>
      </div>
    </div>
  )
}

export function ExpandableCard({
  title,
  description,
  open,
  onToggle,
  children,
}: {
  title: string
  description: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className="rounded-[28px] border px-6 py-5 surface-card" style={{ borderColor: 'var(--color-border)' }}>
      <button
        type="button"
        className="flex w-full items-start justify-between gap-4 text-left"
        onClick={onToggle}
        aria-expanded={open}
      >
        <div>
          <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-[color:var(--color-muted-foreground)]">{description}</p>
        </div>
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-card)] text-[color:var(--color-muted-foreground)]">
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth={1.8} />
        </span>
      </button>
      {open ? <div className="mt-5">{children}</div> : null}
    </div>
  )
}

export function GatewayQuickStartCard() {
  const { t } = useI18n()
  const steps = [
    {
      title: t('settings.aiGateway.quickStartProviderTitle'),
      description: t('settings.aiGateway.quickStartProviderDescription'),
    },
    {
      title: t('settings.aiGateway.quickStartStartTitle'),
      description: t('settings.aiGateway.quickStartStartDescription'),
    },
    {
      title: t('settings.aiGateway.quickStartRouteTitle'),
      description: t('settings.aiGateway.quickStartRouteDescription'),
    },
    {
      title: t('settings.aiGateway.quickStartLeaveAloneTitle'),
      description: t('settings.aiGateway.quickStartLeaveAloneDescription'),
    },
  ]

  return (
    <div className="rounded-[28px] border px-6 py-6 surface-card space-y-5" style={{ borderColor: 'var(--color-border)' }}>
      <div>
        <p className="section-label mb-3">{t('settings.aiGateway.kicker')}</p>
        <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">{t('settings.aiGateway.quickStartTitle')}</h3>
        <p className="mt-1 text-sm leading-6 text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.quickStartDescription')}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, index) => (
          <div key={step.title} className="rounded-[20px] bg-[color:var(--color-card)] px-4 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-muted-foreground)]">
              {index + 1}
            </div>
            <h4 className="mt-2 text-sm font-semibold text-[color:var(--color-foreground)]">{step.title}</h4>
            <p className="mt-2 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{step.description}</p>
          </div>
        ))}
      </div>

      <div className="rounded-[18px] bg-[color:var(--color-background-sunken)]/55 px-4 py-3 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
        {t('settings.aiGateway.quickStartFootnote')}
      </div>
    </div>
  )
}

export function GatewayGuideContent() {
  const { t } = useI18n()

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">{t('settings.aiGateway.guideTitle')}</h3>
        <p className="mt-1 text-sm leading-6 text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.guideDescription')}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {[
          {
            title: t('settings.aiGateway.guideClaudeTitle'),
            body: t('settings.aiGateway.guideClaudeDescription'),
            flow: t('settings.aiGateway.guideClaudeFlow'),
          },
          {
            title: t('settings.aiGateway.guideCodexTitle'),
            body: t('settings.aiGateway.guideCodexDescription'),
            flow: t('settings.aiGateway.guideCodexFlow'),
          },
          {
            title: t('settings.aiGateway.guideProviderTitle'),
            body: t('settings.aiGateway.guideProviderDescription'),
            flow: t('settings.aiGateway.guideProviderFlow'),
          },
        ].map((item) => (
          <div key={item.title} className="rounded-[20px] bg-[color:var(--color-card)] px-4 py-4">
            <h4 className="text-sm font-semibold text-[color:var(--color-foreground)]">{item.title}</h4>
            <p className="mt-2 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{item.body}</p>
            <div className="mt-3 rounded-[14px] bg-[color:var(--color-background-sunken)]/65 px-3 py-2 font-mono text-[11px] leading-5 text-[color:var(--color-muted-foreground)]">
              {item.flow}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-[20px] border px-4 py-4" style={{ borderColor: 'var(--color-border)' }}>
          <h4 className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('settings.aiGateway.guideProfileTitle')}</h4>
          <p className="mt-2 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.guideProfileDescription')}</p>
        </div>
        <div className="rounded-[20px] border px-4 py-4" style={{ borderColor: 'var(--color-border)' }}>
          <h4 className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('settings.aiGateway.guideGlobalTitle')}</h4>
          <p className="mt-2 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{t('settings.aiGateway.guideGlobalDescription')}</p>
        </div>
      </div>
    </div>
  )
}

export function GatewayAdvancedMeaningCard() {
  const { t } = useI18n()
  const items = [
    {
      title: t('settings.aiGateway.advancedMeaningHostPortTitle'),
      description: t('settings.aiGateway.advancedMeaningHostPortDescription'),
    },
    {
      title: t('settings.aiGateway.advancedMeaningProviderIdTitle'),
      description: t('settings.aiGateway.advancedMeaningProviderIdDescription'),
    },
    {
      title: t('settings.aiGateway.advancedMeaningTimeoutTitle'),
      description: t('settings.aiGateway.advancedMeaningTimeoutDescription'),
    },
    {
      title: t('settings.aiGateway.advancedMeaningModelMapTitle'),
      description: t('settings.aiGateway.advancedMeaningModelMapDescription'),
    },
    {
      title: t('settings.aiGateway.advancedMeaningCapabilitiesTitle'),
      description: t('settings.aiGateway.advancedMeaningCapabilitiesDescription'),
    },
    {
      title: t('settings.aiGateway.advancedMeaningEnabledTitle'),
      description: t('settings.aiGateway.advancedMeaningEnabledDescription'),
    },
    {
      title: t('settings.aiGateway.advancedMeaningBindingsTitle'),
      description: t('settings.aiGateway.advancedMeaningBindingsDescription'),
    },
  ]

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <div key={item.title} className="rounded-[20px] bg-[color:var(--color-card)] px-4 py-4">
          <h4 className="text-sm font-semibold text-[color:var(--color-foreground)]">{item.title}</h4>
          <p className="mt-2 text-xs leading-5 text-[color:var(--color-muted-foreground)]">{item.description}</p>
        </div>
      ))}
    </div>
  )
}
