import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { RULES } from '../../shared/rules'
import { Palette, Database, Info, ChevronLeft, Monitor, Sun, Moon, Wrench, Bot } from 'lucide-react'

const THEME_OPTIONS = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const

type Section = 'general' | 'runtime' | 'ai' | 'rules' | 'about'

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
    { id: 'runtime', label: 'Runtime', icon: Wrench },
    { id: 'ai', label: 'AI Commit', icon: Bot },
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

function RuntimePanel({
  runtimeLauncherScript,
  onRuntimeLauncherScriptSave,
}: {
  runtimeLauncherScript: string
  onRuntimeLauncherScriptSave: (v: string) => Promise<void>
}) {
  const [scriptPath, setScriptPath] = useState(runtimeLauncherScript)
  const [diag, setDiag] = useState<{
    issues: string[]
    hasWsl: boolean
    hasTmux: boolean
    launcherScriptExists: boolean
    launcherScriptExecutable: boolean
  } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setScriptPath(runtimeLauncherScript)
  }, [runtimeLauncherScript])

  const runDiagnostics = async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.getRuntimeDiagnostics()
      setDiag({
        issues: result.issues,
        hasWsl: result.hasWsl,
        hasTmux: result.hasTmux,
        launcherScriptExists: result.launcherScriptExists,
        launcherScriptExecutable: result.launcherScriptExecutable,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-[color:var(--color-foreground)]">Runtime Launcher</h2>
        <p className="text-xs text-[color:var(--color-muted-foreground)] mt-1 mb-4">
          Configure the WSL script used to boot Claude/Codex runtime sessions.
        </p>
        <div className="flex gap-2">
          <input
            value={scriptPath}
            onChange={(e) => setScriptPath(e.target.value)}
            className="flex-1 h-9 rounded-lg border px-3 text-sm bg-[color:var(--color-background-sunken)] border-[color:var(--color-border)] text-[color:var(--color-foreground)]"
            placeholder="$HOME/tools/claude-code-script/start-claude-with-env.sh"
          />
          <button
            className="h-9 px-3 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-hover"
            onClick={() => onRuntimeLauncherScriptSave(scriptPath.trim())}
          >
            Save
          </button>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-[color:var(--color-foreground)]">Diagnostics</h3>
          <button
            className="h-8 px-3 rounded-lg border text-xs border-[color:var(--color-border)] text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]"
            onClick={() => void runDiagnostics()}
            disabled={loading}
          >
            {loading ? 'Checking...' : 'Run Check'}
          </button>
        </div>
        {diag && (
          <div className="rounded-xl border px-4 py-3 surface-card space-y-1 text-xs" style={{ borderColor: 'var(--color-border)' }}>
            <p>WSL: {diag.hasWsl ? 'OK' : 'Missing'}</p>
            <p>tmux: {diag.hasTmux ? 'OK' : 'Missing'}</p>
            <p>Script exists: {diag.launcherScriptExists ? 'Yes' : 'No'}</p>
            <p>Script executable: {diag.launcherScriptExecutable ? 'Yes' : 'No'}</p>
            {diag.issues.length > 0 && (
              <div className="mt-2 text-red-500 whitespace-pre-line">
                {diag.issues.map((it) => `- ${it}`).join('\n')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function AiCommitPanel({
  aiCommit,
  onSave,
}: {
  aiCommit: {
    enabled?: boolean
    apiBaseUrl?: string
    apiKey?: string
    model?: string
  }
  onSave: (v: { enabled?: boolean; apiBaseUrl?: string; apiKey?: string; model?: string }) => Promise<void>
}) {
  const [enabled, setEnabled] = useState(Boolean(aiCommit.enabled ?? true))
  const [apiBaseUrl, setApiBaseUrl] = useState(aiCommit.apiBaseUrl || 'https://api.openai.com/v1')
  const [apiKey, setApiKey] = useState(aiCommit.apiKey || '')
  const [model, setModel] = useState(aiCommit.model || 'gpt-4o-mini')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setEnabled(Boolean(aiCommit.enabled ?? true))
    setApiBaseUrl(aiCommit.apiBaseUrl || 'https://api.openai.com/v1')
    setApiKey(aiCommit.apiKey || '')
    setModel(aiCommit.model || 'gpt-4o-mini')
  }, [aiCommit.enabled, aiCommit.apiBaseUrl, aiCommit.apiKey, aiCommit.model])

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave({
        enabled,
        apiBaseUrl: apiBaseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim(),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-[color:var(--color-foreground)]">AI Auto Commit</h2>
        <p className="text-xs text-[color:var(--color-muted-foreground)] mt-1 mb-4">
          Configure AI API for Windows PowerShell auto-commit in project detail page.
        </p>
      </div>

      <div className="rounded-xl border px-4 py-4 surface-card space-y-4" style={{ borderColor: 'var(--color-border)' }}>
        <label className="flex items-center gap-2 text-sm text-[color:var(--color-foreground)]">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enable AI commit
        </label>

        <div className="space-y-1.5">
          <p className="text-xs text-[color:var(--color-muted-foreground)]">API Base URL</p>
          <input
            value={apiBaseUrl}
            onChange={(e) => setApiBaseUrl(e.target.value)}
            className="w-full h-9 rounded-lg border px-3 text-sm bg-[color:var(--color-background-sunken)] border-[color:var(--color-border)] text-[color:var(--color-foreground)]"
            placeholder="https://api.openai.com/v1"
          />
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-[color:var(--color-muted-foreground)]">API Key</p>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full h-9 rounded-lg border px-3 text-sm bg-[color:var(--color-background-sunken)] border-[color:var(--color-border)] text-[color:var(--color-foreground)]"
            placeholder="sk-..."
          />
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-[color:var(--color-muted-foreground)]">Model</p>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full h-9 rounded-lg border px-3 text-sm bg-[color:var(--color-background-sunken)] border-[color:var(--color-border)] text-[color:var(--color-foreground)]"
            placeholder="gpt-4o-mini"
          />
        </div>

        <button
          className="h-9 px-3 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-hover disabled:opacity-60"
          disabled={saving}
          onClick={() => void handleSave()}
        >
          {saving ? 'Saving...' : 'Save AI Config'}
        </button>
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
  const setThemeConfig = useAppStore((s) => s.setTheme)
  const setRuntimeLauncherScript = useAppStore((s) => s.setRuntimeLauncherScript)
  const setAiCommitConfig = useAppStore((s) => s.setAiCommitConfig)
  const [theme, setTheme] = useState(config.theme)
  const [section, setSection] = useState<Section>('general')

  useEffect(() => {
    setTheme(config.theme)
  }, [config.theme])

  const handleThemeChange = async (newTheme: 'system' | 'light' | 'dark') => {
    setTheme(newTheme)
    await setThemeConfig(newTheme)
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
          {section === 'runtime' && (
            <RuntimePanel
              runtimeLauncherScript={config.runtimeLauncherScript || '$HOME/tools/claude-code-script/start-claude-with-env.sh'}
              onRuntimeLauncherScriptSave={setRuntimeLauncherScript}
            />
          )}
          {section === 'ai' && (
            <AiCommitPanel
              aiCommit={config.aiCommit || {}}
              onSave={setAiCommitConfig}
            />
          )}
          {section === 'rules' && <RulesPanel />}
          {section === 'about' && <AboutPanel />}
        </main>
      </div>
    </div>
  )
}
