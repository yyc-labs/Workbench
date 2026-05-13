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
              ? 'bg-[#f6f6f4] text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700 hover:bg-[#f6f6f4]/60'
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
    <div className="inline-flex rounded-xl bg-[#eae9e6] p-1 gap-0.5">
      {THEME_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
            value === opt.value
              ? 'bg-[#f6f6f4] text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
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
        <h2 className="text-sm font-semibold text-gray-900">Appearance</h2>
        <p className="text-xs text-gray-500 mt-1 mb-4">
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
        <h2 className="text-sm font-semibold text-gray-900">Detection Rules</h2>
        <p className="text-xs text-gray-500 mt-1">
          Projects are detected by matching files in the directory. Higher priority rules are checked first.
        </p>
      </div>

      <div className="space-y-2">
        {RULES.map((rule) => (
          <div
            key={rule.type}
            className="flex items-center gap-4 rounded-xl border border-[#e2e2df] bg-[#f6f6f4] px-4 py-3"
          >
            <span className="w-8 text-[10px] font-semibold text-gray-400 text-center shrink-0">
              P{rule.priority}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 capitalize">
                {rule.type}
              </p>
              <p className="text-xs text-gray-500 font-mono truncate">
                {rule.matchPatterns.join(', ')}
                {rule.requiresAll ? ' (all required)' : ''}
              </p>
            </div>
            <code className="text-[11px] text-gray-400 bg-[#eae9e6] rounded-md px-2 py-0.5 font-mono shrink-0">
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
        <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center shadow-sm">
          <span className="text-lg font-bold text-white">L</span>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Project Launcher</h2>
          <p className="text-xs text-gray-500">v1.0.0</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[
          ['Framework', 'Electron 42'],
          ['UI', 'React 18 + Tailwind v4'],
          ['State', 'Zustand'],
          ['Terminal', 'xterm.js'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-[#e2e2df] bg-[#f6f6f4] px-4 py-3">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-0.5">
              {label}
            </p>
            <p className="text-sm text-gray-900 font-medium">{value}</p>
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
    <div className="h-screen flex flex-col bg-[#f1f1ef]">
      {/* Header */}
      <header
        className="flex items-center gap-4 px-6 py-4 shrink-0"
        style={{ background: 'rgba(255,255,255,0.55)', backdropFilter: 'blur(20px)' }}
      >
        <button
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-[#eae9e6] transition-colors"
          onClick={() => navigate('/')}
        >
          <ChevronLeft className="w-5 h-5" strokeWidth={1.8} />
        </button>
        <h1 className="text-lg font-semibold text-gray-900 tracking-tight">
          Settings
        </h1>
      </header>

      {/* Body */}
      <div className="flex-1 flex min-h-0 px-6 pb-8">
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
