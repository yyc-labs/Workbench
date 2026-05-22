function SettingsAboutPanel() {
  return (
    <div className="space-y-8">
      <div className="flex items-center gap-5">
        <div className="quiet-control w-14 h-14 rounded-[22px] flex items-center justify-center text-primary">
          <span className="text-lg font-semibold">L</span>
        </div>
        <div>
          <p className="section-label mb-1">About</p>
          <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">Project Launcher</h2>
          <p className="text-sm text-[color:var(--color-muted-foreground)]">v1.0.0</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {[
          ['Framework', 'Electron 42'],
          ['UI', 'React 18 + Tailwind v4'],
          ['State', 'Zustand'],
          ['Terminal', 'xterm.js'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-[22px] border px-5 py-4 surface-card" style={{ borderColor: 'var(--color-border)' }}>
            <p className="section-label mb-1">
              {label}
            </p>
            <p className="text-sm text-[color:var(--color-foreground)] font-medium">{value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export { SettingsAboutPanel }
