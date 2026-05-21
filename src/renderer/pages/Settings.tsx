import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { RULES } from '../../shared/rules'
import type {
  BackendMode,
  ManagedProcessSnapshot,
  RuntimeEntry,
  TerminalProcessInventory,
  TmuxSessionInfo,
} from '../../shared/types'
import { Palette, Database, Info, ChevronLeft, Monitor, Sun, Moon, Wrench, Bot } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'

const THEME_OPTIONS = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const

type Section = 'general' | 'runtime' | 'ai' | 'rules' | 'about'

function clampSplitMaxBatches(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 4
  return Math.max(1, Math.min(12, Math.trunc(value)))
}

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
    <nav className="quiet-control w-56 shrink-0 flex flex-col gap-1 rounded-[26px] p-2">
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onSelect(item.id)}
          className={`flex items-center gap-2.5 px-4 py-3 rounded-[18px] text-sm font-medium transition-colors text-left ${
            active === item.id
              ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm'
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
    <div className="quiet-control inline-flex rounded-full p-1 gap-0.5">
      {THEME_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${
            value === opt.value
              ? 'bg-[color:var(--color-card)] text-[color:var(--color-foreground)] shadow-sm'
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
    <div className="space-y-8">
      <div>
        <p className="section-label mb-3">Appearance</p>
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">Interface</h2>
        <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2 mb-6">
          Customize how the application looks and feels.
        </p>
        <SegmentedControl value={theme} onChange={onThemeChange} />
      </div>
    </div>
  )
}

function RulesPanel() {
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

function RuntimePanel({
  runtimeLauncherScript,
  onRuntimeLauncherScriptSave,
  runtimeKeepAliveOnQuit,
  onRuntimeKeepAliveToggle,
  projects,
  runtimeEntries,
}: {
  runtimeLauncherScript: string
  onRuntimeLauncherScriptSave: (v: string) => Promise<void>
  runtimeKeepAliveOnQuit: boolean
  onRuntimeKeepAliveToggle: (enabled: boolean) => Promise<void>
  projects: { id: string; name: string; path: string }[]
  runtimeEntries: Record<string, RuntimeEntry>
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
  const [inventoryLoading, setInventoryLoading] = useState(false)
  const [inventory, setInventory] = useState<TerminalProcessInventory | null>(null)
  const [stopAllLoading, setStopAllLoading] = useState(false)
  const [stopSummary, setStopSummary] = useState<string | null>(null)

  useEffect(() => {
    setScriptPath(runtimeLauncherScript)
  }, [runtimeLauncherScript])

  const projectNameMap = new Map(projects.map((p) => [p.id, p.name]))
  const runtimeSessionProjectNameMap = new Map(
    Object.values(runtimeEntries).map((entry) => [entry.sessionName, projectNameMap.get(entry.projectId) || entry.projectId])
  )

  const classifyManagedProcess = (item: ManagedProcessSnapshot): 'tmux' | 'project' | 'idle' => {
    if (item.backend === 'tmux') return 'tmux'
    if (item.processId.includes('::toolbox')) return 'idle'
    return 'project'
  }

  const classifyTmuxSession = (
    session: TmuxSessionInfo,
    managedTmuxNames: Set<string>,
    projectSessionNames: Set<string>
  ): 'tmux' | 'project' | 'idle' => {
    if (managedTmuxNames.has(session.sessionName)) return 'tmux'
    if (projectSessionNames.has(session.sessionName)) return 'project'
    if (session.sessionName.startsWith('lx_')) return 'project'
    return 'idle'
  }

  const projectSessionNameSet = new Set(Object.values(runtimeEntries).map((entry) => entry.sessionName))

  const refreshInventory = async () => {
    setInventoryLoading(true)
    try {
      const data = await window.electronAPI.listTerminalProcesses()
      setInventory(data)
    } finally {
      setInventoryLoading(false)
    }
  }

  useEffect(() => {
    void refreshInventory()
  }, [])

  const managedTmuxNames = new Set(
    (inventory?.managedProcesses || [])
      .filter((p) => p.backend === 'tmux' && p.sessionName)
      .map((p) => p.sessionName as string)
  )

  const projectManaged = (inventory?.managedProcesses || []).filter((p) => classifyManagedProcess(p) === 'project')
  const tmuxManaged = (inventory?.managedProcesses || []).filter((p) => classifyManagedProcess(p) === 'tmux')
  const idleManaged = (inventory?.managedProcesses || []).filter((p) => classifyManagedProcess(p) === 'idle')

  const projectTmux = (inventory?.tmuxSessions || []).filter(
    (s) => classifyTmuxSession(s, managedTmuxNames, projectSessionNameSet) === 'project'
  )
  const idleTmux = (inventory?.tmuxSessions || []).filter(
    (s) => classifyTmuxSession(s, managedTmuxNames, projectSessionNameSet) === 'idle'
  )

  const closeManagedProcess = async (processId: string) => {
    await window.electronAPI.stopProcess(processId)
    await refreshInventory()
  }

  const closeTmuxSession = async (sessionName: string) => {
    await window.electronAPI.killTmuxSession(sessionName)
    await refreshInventory()
  }

  const closeAllTerminals = async () => {
    setStopAllLoading(true)
    setStopSummary(null)
    try {
      const result = await window.electronAPI.stopAllTerminalProcesses()
      setStopSummary(
        `已关闭普通终端 ${result.managedStopped} 个，tmux ${result.tmuxKilled} 个` +
        (result.tmuxSkipped > 0 ? `（${result.tmuxSkipped} 个未关闭）` : '')
      )
      await refreshInventory()
    } finally {
      setStopAllLoading(false)
    }
  }

  const backendLabel = (backend: BackendMode): string => {
    if (backend === 'tmux') return 'tmux'
    if (backend === 'wsl-pty') return 'wsl-pty'
    if (backend === 'direct-pty') return 'direct-pty'
    return 'spawn'
  }

  const formatSince = (ts: number): string => {
    if (!ts) return '-'
    const diff = Date.now() - ts
    if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s`
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
    return `${Math.floor(diff / 3_600_000)}h`
  }

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
    <div className="space-y-8">
      <div>
        <p className="section-label mb-3">Runtime</p>
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">Launcher</h2>
        <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2 mb-6">
          Configure the WSL script used to boot Claude/Codex runtime sessions.
        </p>
        <div className="flex gap-2">
          <Input
            value={scriptPath}
            onChange={(e) => setScriptPath(e.target.value)}
            className="quiet-control flex-1 h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
            placeholder="$HOME/tools/claude-code-script/start-claude-with-env.sh"
          />
          <Button
            className="h-11 rounded-full px-5 text-sm"
            onClick={() => onRuntimeLauncherScriptSave(scriptPath.trim())}
          >
            Save
          </Button>
        </div>
      </div>

      <div>
        <p className="section-label mb-3">Lifecycle</p>
        <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">Quit Behavior</h3>
        <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2 mb-4">
          Keep Runtime tmux sessions alive after application exit.
        </p>
        <label className="inline-flex items-center gap-2 text-sm text-[color:var(--color-foreground)]">
          <input
            type="checkbox"
            checked={runtimeKeepAliveOnQuit}
            onChange={(e) => void onRuntimeKeepAliveToggle(e.target.checked)}
          />
          Keep Runtime sessions on quit
        </label>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-medium text-[color:var(--color-foreground)]">Diagnostics</h3>
          <Button
            variant="outline"
            className="quiet-control h-8 rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]"
            onClick={() => void runDiagnostics()}
            disabled={loading}
          >
            {loading ? 'Checking...' : 'Run Check'}
          </Button>
        </div>
        {diag && (
          <div className="rounded-[22px] border px-5 py-4 surface-card space-y-1 text-xs" style={{ borderColor: 'var(--color-border)' }}>
            <p>WSL: {diag.hasWsl ? 'OK' : 'Missing'}</p>
            <p>tmux: {diag.hasTmux ? 'OK' : 'Missing'}</p>
            <p>Script exists: {diag.launcherScriptExists ? 'Yes' : 'No'}</p>
            <p>Script executable: {diag.launcherScriptExecutable ? 'Yes' : 'No'}</p>
            {diag.issues.length > 0 && (
              <div className="mt-2 text-[color:var(--color-destructive)] whitespace-pre-line">
                {diag.issues.map((it) => `- ${it}`).join('\n')}
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-medium text-[color:var(--color-foreground)]">Terminal Processes</h3>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="quiet-control h-8 rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]"
              onClick={() => void refreshInventory()}
              disabled={inventoryLoading || stopAllLoading}
            >
              {inventoryLoading ? 'Refreshing...' : 'Refresh'}
            </Button>
            <Button
              variant="outline"
              className="h-8 rounded-full px-3 text-xs"
              onClick={() => void closeAllTerminals()}
              disabled={stopAllLoading}
            >
              {stopAllLoading ? 'Stopping...' : 'Close All Terminals'}
            </Button>
          </div>
        </div>
        {stopSummary && (
          <p className="mb-2 text-xs text-[color:var(--color-muted-foreground)]">{stopSummary}</p>
        )}
        <div className="space-y-3">
          <div className="rounded-[22px] border px-5 py-4 surface-card" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-[color:var(--color-foreground)]">项目启动终端</p>
              <span className="text-xs text-[color:var(--color-muted-foreground)]">{projectManaged.length + projectTmux.length}</span>
            </div>
            {projectManaged.length === 0 && projectTmux.length === 0 ? (
              <p className="text-xs text-[color:var(--color-muted-foreground)]">无</p>
            ) : (
              <div className="space-y-1.5">
                {projectManaged.map((item) => (
                  <div key={`m-${item.processId}`} className="flex items-center justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate text-[color:var(--color-foreground)]">
                      {projectNameMap.get(item.projectId) || item.projectId} · {backendLabel(item.backend)} · {formatSince(item.startTime)}
                    </span>
                    <Button
                      variant="outline"
                      className="h-7 rounded-full px-2 text-[11px]"
                      onClick={() => void closeManagedProcess(item.processId)}
                    >
                      Close
                    </Button>
                  </div>
                ))}
                {projectTmux.map((item) => (
                  <div key={`t-project-${item.sessionName}`} className="flex items-center justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate text-[color:var(--color-foreground)]">
                      {runtimeSessionProjectNameMap.get(item.sessionName) || item.sessionName} · tmux · {item.status}
                    </span>
                    <Button
                      variant="outline"
                      className="h-7 rounded-full px-2 text-[11px]"
                      onClick={() => void closeTmuxSession(item.sessionName)}
                    >
                      Close
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-[22px] border px-5 py-4 surface-card" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-[color:var(--color-foreground)]">tmux 终端</p>
              <span className="text-xs text-[color:var(--color-muted-foreground)]">{tmuxManaged.length}</span>
            </div>
            {tmuxManaged.length === 0 ? (
              <p className="text-xs text-[color:var(--color-muted-foreground)]">无</p>
            ) : (
              <div className="space-y-1.5">
                {tmuxManaged.map((item) => (
                  <div key={`tmux-${item.processId}`} className="flex items-center justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate text-[color:var(--color-foreground)]">
                      {item.sessionName || item.processId} · {formatSince(item.startTime)}
                    </span>
                    <Button
                      variant="outline"
                      className="h-7 rounded-full px-2 text-[11px]"
                      onClick={() => void closeManagedProcess(item.processId)}
                    >
                      Close
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-[22px] border px-5 py-4 surface-card" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-[color:var(--color-foreground)]">可清理（无用）</p>
              <span className="text-xs text-[color:var(--color-muted-foreground)]">{idleManaged.length + idleTmux.length}</span>
            </div>
            {idleManaged.length === 0 && idleTmux.length === 0 ? (
              <p className="text-xs text-[color:var(--color-muted-foreground)]">无</p>
            ) : (
              <div className="space-y-1.5">
                {idleManaged.map((item) => (
                  <div key={`idle-m-${item.processId}`} className="flex items-center justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate text-[color:var(--color-foreground)]">
                      {item.processId} · {backendLabel(item.backend)} · {formatSince(item.startTime)}
                    </span>
                    <Button
                      variant="outline"
                      className="h-7 rounded-full px-2 text-[11px]"
                      onClick={() => void closeManagedProcess(item.processId)}
                    >
                      Close
                    </Button>
                  </div>
                ))}
                {idleTmux.map((item) => (
                  <div key={`idle-t-${item.sessionName}`} className="flex items-center justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate text-[color:var(--color-foreground)]">
                      {item.sessionName} · tmux · {item.status}
                    </span>
                    <Button
                      variant="outline"
                      className="h-7 rounded-full px-2 text-[11px]"
                      onClick={() => void closeTmuxSession(item.sessionName)}
                    >
                      Close
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
            说明：toolbox 会话与未匹配项目的 tmux 会话会归类到“可清理（无用）”。
          </p>
        </div>
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
    wslPwshPath?: string
    split?: boolean
    splitMaxBatches?: number
  }
  onSave: (v: {
    enabled?: boolean
    apiBaseUrl?: string
    apiKey?: string
    model?: string
    wslPwshPath?: string
    split?: boolean
    splitMaxBatches?: number
  }) => Promise<void>
}) {
  const [enabled, setEnabled] = useState(Boolean(aiCommit.enabled ?? true))
  const [apiBaseUrl, setApiBaseUrl] = useState(aiCommit.apiBaseUrl || 'https://api.openai.com/v1')
  const [apiKey, setApiKey] = useState(aiCommit.apiKey || '')
  const [model, setModel] = useState(aiCommit.model || 'gpt-4o-mini')
  const [wslPwshPath, setWslPwshPath] = useState(aiCommit.wslPwshPath || '/snap/bin/pwsh')
  const [split, setSplit] = useState(Boolean(aiCommit.split ?? false))
  const [splitMaxBatches, setSplitMaxBatches] = useState(String(clampSplitMaxBatches(aiCommit.splitMaxBatches)))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setEnabled(Boolean(aiCommit.enabled ?? true))
    setApiBaseUrl(aiCommit.apiBaseUrl || 'https://api.openai.com/v1')
    setApiKey(aiCommit.apiKey || '')
    setModel(aiCommit.model || 'gpt-4o-mini')
    setWslPwshPath(aiCommit.wslPwshPath || '/snap/bin/pwsh')
    setSplit(Boolean(aiCommit.split ?? false))
    setSplitMaxBatches(String(clampSplitMaxBatches(aiCommit.splitMaxBatches)))
  }, [aiCommit.enabled, aiCommit.apiBaseUrl, aiCommit.apiKey, aiCommit.model, aiCommit.wslPwshPath, aiCommit.split, aiCommit.splitMaxBatches])

  const handleSave = async () => {
    setSaving(true)
    try {
      const parsedSplitMaxBatches = Number.parseInt(splitMaxBatches.trim(), 10)
      const normalizedSplitMaxBatches = clampSplitMaxBatches(parsedSplitMaxBatches)
      await onSave({
        enabled,
        apiBaseUrl: apiBaseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim(),
        wslPwshPath: wslPwshPath.trim(),
        split,
        splitMaxBatches: normalizedSplitMaxBatches,
      })
      setSplitMaxBatches(String(normalizedSplitMaxBatches))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="section-label mb-3">AI</p>
        <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--color-foreground)]">Auto Commit</h2>
        <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2 mb-6">
          Configure AI API for auto-commit in project detail page (Windows PowerShell and WSL supported).
        </p>
      </div>

      <div className="rounded-[28px] border px-6 py-6 surface-card space-y-5" style={{ borderColor: 'var(--color-border)' }}>
        <label className="flex items-center gap-2 text-sm text-[color:var(--color-foreground)]">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enable AI commit
        </label>

        <label className="flex items-center gap-2 text-sm text-[color:var(--color-foreground)]">
          <input
            type="checkbox"
            checked={split}
            onChange={(e) => setSplit(e.target.checked)}
          />
          Enable split commit
        </label>

        <div className="space-y-1.5">
          <p className="text-xs text-[color:var(--color-muted-foreground)]">Split max batches (1-12)</p>
          <Input
            type="number"
            min={1}
            max={12}
            step={1}
            value={splitMaxBatches}
            onChange={(e) => setSplitMaxBatches(e.target.value)}
            className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
            placeholder="4"
            disabled={!split}
          />
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-[color:var(--color-muted-foreground)]">API Base URL</p>
          <Input
            value={apiBaseUrl}
            onChange={(e) => setApiBaseUrl(e.target.value)}
            className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
            placeholder="https://api.openai.com/v1"
          />
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-[color:var(--color-muted-foreground)]">API Key</p>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
            placeholder="sk-..."
          />
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-[color:var(--color-muted-foreground)]">Model</p>
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
            placeholder="gpt-4o-mini"
          />
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-[color:var(--color-muted-foreground)]">WSL pwsh path</p>
          <Input
            value={wslPwshPath}
            onChange={(e) => setWslPwshPath(e.target.value)}
            className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
            placeholder="/snap/bin/pwsh"
          />
        </div>

        <Button
          className="h-10 rounded-full px-5 text-sm disabled:opacity-60"
          disabled={saving}
          onClick={() => void handleSave()}
        >
          {saving ? 'Saving...' : 'Save AI Config'}
        </Button>
      </div>
    </div>
  )
}

function AboutPanel() {
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

// ── Main ──

export function SettingsPage() {
  const navigate = useNavigate()
  const config = useAppStore((s) => s.config)
  const projects = useAppStore((s) => s.projects)
  const runtimeEntries = useAppStore((s) => s.runtimeEntries)
  const setThemeConfig = useAppStore((s) => s.setTheme)
  const setRuntimeLauncherScript = useAppStore((s) => s.setRuntimeLauncherScript)
  const setRuntimeKeepAliveOnQuit = useAppStore((s) => s.setRuntimeKeepAliveOnQuit)
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
      <header className="app-chrome flex min-h-[84px] items-center gap-4 px-8 py-4 shrink-0">
        <button
          className="p-2 rounded-full text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)] transition-colors"
          onClick={() => navigate('/')}
        >
          <ChevronLeft className="w-5 h-5" strokeWidth={1.8} />
        </button>
        <h1 className="text-xl font-semibold text-[color:var(--color-foreground)] tracking-[-0.03em]">
          Settings
        </h1>
      </header>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-hidden px-8 pb-10 pt-10">
        <div className="flex h-full min-h-0 min-w-0">
          <Sidebar active={section} onSelect={setSection} />

          <main className="flex-1 min-h-0 min-w-0 ml-12 overflow-y-auto px-6 pt-1">
            <div className="pb-6 -mb-6">
              {section === 'general' && (
                <GeneralPanel theme={theme} onThemeChange={handleThemeChange} />
              )}
              {section === 'runtime' && (
                <RuntimePanel
                  runtimeLauncherScript={config.runtimeLauncherScript || '$HOME/tools/claude-code-script/start-claude-with-env.sh'}
                  onRuntimeLauncherScriptSave={setRuntimeLauncherScript}
                  runtimeKeepAliveOnQuit={config.runtimeKeepAliveOnQuit ?? false}
                  onRuntimeKeepAliveToggle={setRuntimeKeepAliveOnQuit}
                  projects={projects}
                  runtimeEntries={runtimeEntries}
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
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
