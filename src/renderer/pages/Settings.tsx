import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { RULES } from '../../shared/rules'
import { Palette, Database, Info, ChevronLeft, Monitor, Sun, Moon } from 'lucide-react'

const THEME_OPTIONS = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const

type Section = 'general' | 'rules' | 'about'

// ── Sidebar ──

function Sidebar({
  active,
  onSelect,
}: {
  active: Section
  onSelect: (s: Section) => void
}) {
  const items: { id: Section; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: string | number }> }[] = [
    { id: 'general', label: 'General', icon: Palette },
    { id: 'rules', label: 'Rules', icon: Database },
    { id: 'about', label: 'About', icon: Info },
  ]

  return (
    <nav className="w-48 shrink-0 flex flex-col gap-1">
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onSelect(item.id)}
          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
            active === item.id
              ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm border border-[color:var(--color-border)]'
              : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]/60'
          }`}
        >
          <item.icon className="w-4 h-4" strokeWidth={1.8} />
          {item.label}
        </button>
      ))}
    </nav>
  )
}

// ── Segmented Control ──

function SegmentedControl({
  value,
  onChange,
}: {
  value: string
  onChange: (v: 'system' | 'light' | 'dark') => void
}) {
  return (
    <div className="inline-flex rounded-xl bg-[color:var(--color-background-sunken)] p-1 gap-0.5 border border-[color:var(--color-border)]">
      {THEME_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
            value === opt.value
              ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm border border-[color:var(--color-border)]'
              : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
          }`}
        >
          <opt.icon className="w-3.5 h-3.5" strokeWidth={1.8} />
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ── Panels ──

function GeneralPanel({ theme, onThemeChange }: { theme: string; onThemeChange: (v: 'system' | 'light' | 'dark') => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-[color:var(--color-foreground)]">Appearance</h2>
        <p className="text-xs text-[color:var(--color-muted-foreground)] mt-1 mb-4">
          Customize how the application looks and feels.
        </p>
        <SegmentedControl value={theme} onChange={onThemeChange} />
      </div>
    </div>
  )
}

function RulesPanel() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-[color:var(--color-foreground)]">Detection Rules</h2>
        <p className="text-xs text-[color:var(--color-muted-foreground)] mt-1">
          Projects are detected by matching files in the directory. Higher priority rules are checked first.
        </p>
      </div>

      <div className="space-y-2">
        {RULES.map((rule) => (
          <div
            key={rule.type}
            className="flex items-center gap-4 rounded-xl border px-4 py-3 surface-card"
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
            <code className="text-[11px] text-[color:var(--color-muted-foreground)] bg-[color:var(--color-background-sunken)] rounded-md px-2 py-0.5 font-mono shrink-0 border border-[color:var(--color-border)]">
              {rule.defaultCommand}
            </code>
          </div>
        ))}
      </div>
    </div>
  )
}

function AboutPanel() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center shadow-sm">
          <span className="text-lg font-bold text-white">L</span>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-[color:var(--color-foreground)]">Project Launcher</h2>
          <p className="text-xs text-[color:var(--color-muted-foreground)]">v1.0.0</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[
          ['Framework', 'Electron 42'],
          ['UI', 'React 18 + Tailwind v4'],
          ['State', 'Zustand'],
          ['Terminal', 'xterm.js'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border px-4 py-3 surface-card" style={{ borderColor: 'var(--color-border)' }}>
            <p className="text-[10px] text-[color:var(--color-muted-foreground)] uppercase tracking-wider font-medium mb-0.5">
              {label}
            </p>
            <p className="text-sm text-[color:var(--color-foreground)] font-medium">{value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main ──

export function SettingsPage() {
  const navigate = useNavigate()
  const config = useAppStore((s) => s.config)
  const [theme, setTheme] = useState(config.theme)
  const [section, setSection] = useState<Section>('general')

  useEffect(() => {
    setTheme(config.theme)
  }, [config.theme])

  const handleThemeChange = async (newTheme: 'system' | 'light' | 'dark') => {
    setTheme(newTheme)
    await window.electronAPI.setConfig({ theme: newTheme })
    document.documentElement.setAttribute(
      'data-theme',
      newTheme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : newTheme
    )
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header
        className="flex items-center gap-4 px-6 py-4 shrink-0"
        style={{
          background: 'var(--color-card)',
          borderBottom: '1px solid var(--color-border)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}
      >
        <button
          className="p-1.5 rounded-lg text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)] transition-colors"
          onClick={() => navigate('/')}
        >
          <ChevronLeft className="w-5 h-5" strokeWidth={1.8} />
        </button>
        <h1 className="text-lg font-semibold text-[color:var(--color-foreground)] tracking-tight">
          Settings
        </h1>
      </header>

      {/* Body */}
      <div className="flex-1 flex min-h-0 px-6 pb-8 pt-6">
        <Sidebar active={section} onSelect={setSection} />

        <main className="flex-1 min-w-0 ml-8">
          {section === 'general' && (
            <GeneralPanel theme={theme} onThemeChange={handleThemeChange} />
          )}
          {section === 'rules' && <RulesPanel />}
          {section === 'about' && <AboutPanel />}
        </main>
      </div>
    </div>
  )
}
