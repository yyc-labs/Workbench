import { RULES } from '../../../shared/rules'

function SettingsRulesPanel() {
  return (
    <div className="space-y-6">
      <div>
        <p className="section-label mb-3">Rules</p>
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">Detection Rules</h2>
        <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2">
          Projects are detected by matching files in the directory. Higher priority rules are checked first.
        </p>
      </div>

      <div className="space-y-3">
        {RULES.map((rule) => (
          <div
            key={rule.type}
            className="flex items-center gap-4 rounded-[22px] border px-5 py-4 surface-card"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <span className="w-8 text-[10px] font-semibold text-[color:var(--color-muted-foreground)] text-center shrink-0">
              P{rule.priority}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[color:var(--color-foreground)] capitalize">
                {rule.type}
              </p>
              <p className="text-xs text-[color:var(--color-muted-foreground)] font-mono truncate">
                {rule.matchPatterns.join(', ')}
                {rule.requiresAll ? ' (all required)' : ''}
              </p>
            </div>
            <code className="quiet-control text-[11px] text-[color:var(--color-muted-foreground)] rounded-full px-3 py-1 font-mono shrink-0">
              {rule.defaultCommand}
            </code>
          </div>
        ))}
      </div>
    </div>
  )
}

export { SettingsRulesPanel }
