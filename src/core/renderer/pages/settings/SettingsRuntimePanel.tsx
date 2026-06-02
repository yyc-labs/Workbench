import { useEffect, useState } from 'react'
import { projectDisplayName } from '../../lib/projectDisplay'
import type {
  BackendMode,
  ClaudeBashrcConfig,
  ManagedProcessSnapshot,
  RuntimeEntry,
  TerminalProcessInventory,
  TmuxSessionInfo,
} from '../../../shared/types'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { backendLabel, formatSince } from './settings.helpers'

type RuntimePanelProps = {
  runtimeLauncherScript: string
  onRuntimeLauncherScriptSave: (value: string) => Promise<void>
  runtimeKeepAliveOnQuit: boolean
  onRuntimeKeepAliveToggle: (enabled: boolean) => Promise<void>
  projects: { id: string; name: string; path: string }[]
  runtimeEntries: Record<string, RuntimeEntry>
}

function SettingsRuntimePanel({
  runtimeLauncherScript,
  onRuntimeLauncherScriptSave,
  runtimeKeepAliveOnQuit,
  onRuntimeKeepAliveToggle,
  projects,
  runtimeEntries,
}: RuntimePanelProps) {
  const [scriptPath, setScriptPath] = useState(runtimeLauncherScript)
  const [anthropicBaseUrl, setAnthropicBaseUrl] = useState('https://api.deepseek.com/anthropic')
  const [anthropicAuthToken, setAnthropicAuthToken] = useState('')
  const [anthropicModel, setAnthropicModel] = useState('deepseek-v4-pro[1m]')
  const [anthropicDefaultOpusModel, setAnthropicDefaultOpusModel] = useState('deepseek-v4-pro[1m]')
  const [anthropicDefaultSonnetModel, setAnthropicDefaultSonnetModel] = useState('deepseek-v4-pro[1m]')
  const [anthropicDefaultHaikuModel, setAnthropicDefaultHaikuModel] = useState('deepseek-v4-flash')
  const [claudeCodeSubagentModel, setClaudeCodeSubagentModel] = useState('deepseek-v4-flash')
  const [claudeCodeEffortLevel, setClaudeCodeEffortLevel] = useState('max')
  const [claudeBashrcLoaded, setClaudeBashrcLoaded] = useState(false)
  const [claudeBashrcSaving, setClaudeBashrcSaving] = useState(false)
  const [claudeBashrcSavedHint, setClaudeBashrcSavedHint] = useState<string | null>(null)
  const [claudeBashrcError, setClaudeBashrcError] = useState<string | null>(null)
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

  useEffect(() => {
    let mounted = true
    void window.electronAPI.getClaudeBashrcConfig()
      .then((result: ClaudeBashrcConfig) => {
        if (!mounted) return
        setAnthropicBaseUrl(result.anthropicBaseUrl)
        setAnthropicAuthToken(result.anthropicAuthToken)
        setAnthropicModel(result.anthropicModel)
        setAnthropicDefaultOpusModel(result.anthropicDefaultOpusModel)
        setAnthropicDefaultSonnetModel(result.anthropicDefaultSonnetModel)
        setAnthropicDefaultHaikuModel(result.anthropicDefaultHaikuModel)
        setClaudeCodeSubagentModel(result.claudeCodeSubagentModel)
        setClaudeCodeEffortLevel(result.claudeCodeEffortLevel)
        setClaudeBashrcLoaded(true)
      })
      .catch((error) => {
        if (!mounted) return
        const message = error instanceof Error ? error.message : String(error)
        setClaudeBashrcError(message || 'Failed to read ~/.bashrc.')
        setClaudeBashrcLoaded(true)
      })
    return () => {
      mounted = false
    }
  }, [])

  const projectNameMap = new Map(projects.map((p) => [p.id, projectDisplayName(p)]))
  const runtimeSessionProjectNameMap = new Map(
    Object.values(runtimeEntries).map((entry) => [entry.sessionName, projectNameMap.get(entry.projectId) || entry.projectId])
  )

  const classifyManagedProcess = (item: ManagedProcessSnapshot): 'tmux' | 'project' | 'idle' => {
    if (item.processId.includes('::toolbox')) return 'idle'
    if (item.backend === 'tmux') return 'tmux'
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

  const refreshInventory = async (silent = false) => {
    if (!silent) setInventoryLoading(true)
    try {
      const data = await window.electronAPI.listTerminalProcesses()
      setInventory(data)
    } finally {
      if (!silent) setInventoryLoading(false)
    }
  }

  useEffect(() => {
    void refreshInventory()
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshInventory(true)
    }, 5000)
    return () => {
      window.clearInterval(timer)
    }
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

  const handleSaveClaudeBashrc = async () => {
    setClaudeBashrcSaving(true)
    setClaudeBashrcSavedHint(null)
    setClaudeBashrcError(null)
    try {
      const saved = await window.electronAPI.setClaudeBashrcConfig({
        anthropicBaseUrl: anthropicBaseUrl.trim(),
        anthropicAuthToken: anthropicAuthToken.trim(),
        anthropicModel: anthropicModel.trim(),
        anthropicDefaultOpusModel: anthropicDefaultOpusModel.trim(),
        anthropicDefaultSonnetModel: anthropicDefaultSonnetModel.trim(),
        anthropicDefaultHaikuModel: anthropicDefaultHaikuModel.trim(),
        claudeCodeSubagentModel: claudeCodeSubagentModel.trim(),
        claudeCodeEffortLevel: claudeCodeEffortLevel.trim(),
      })
      setAnthropicBaseUrl(saved.anthropicBaseUrl)
      setAnthropicAuthToken(saved.anthropicAuthToken)
      setAnthropicModel(saved.anthropicModel)
      setAnthropicDefaultOpusModel(saved.anthropicDefaultOpusModel)
      setAnthropicDefaultSonnetModel(saved.anthropicDefaultSonnetModel)
      setAnthropicDefaultHaikuModel(saved.anthropicDefaultHaikuModel)
      setClaudeCodeSubagentModel(saved.claudeCodeSubagentModel)
      setClaudeCodeEffortLevel(saved.claudeCodeEffortLevel)
      setClaudeBashrcSavedHint('Claude config saved to ~/.bashrc.')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setClaudeBashrcError(message || 'Failed to save Claude config to ~/.bashrc.')
    } finally {
      setClaudeBashrcSaving(false)
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
        <p className="section-label mb-3">Claude</p>
        <h3 className="text-base font-semibold text-[color:var(--color-foreground)]">Runtime Env</h3>
        <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)] mt-2 mb-4">
          Read and write Claude environment variables directly in `~/.bashrc`. Other programs that depend on `.bashrc` will see the same values.
        </p>
        <div className="rounded-[28px] border px-6 py-6 surface-card space-y-5" style={{ borderColor: 'var(--color-border)' }}>
          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">ANTHROPIC_BASE_URL</p>
            <Input
              value={anthropicBaseUrl}
              onChange={(e) => setAnthropicBaseUrl(e.target.value)}
              className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
              placeholder="https://api.deepseek.com/anthropic"
              disabled={!claudeBashrcLoaded}
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">ANTHROPIC_AUTH_TOKEN</p>
            <Input
              type="password"
              value={anthropicAuthToken}
              onChange={(e) => setAnthropicAuthToken(e.target.value)}
              className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
              placeholder={claudeBashrcLoaded ? 'sk-...' : 'Loading ~/.bashrc...'}
              disabled={!claudeBashrcLoaded}
            />
            <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
              This value is saved as plain text in `~/.bashrc` because other programs also depend on that file.
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">ANTHROPIC_MODEL</p>
            <Input
              value={anthropicModel}
              onChange={(e) => setAnthropicModel(e.target.value)}
              className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
              placeholder="deepseek-v4-pro[1m]"
              disabled={!claudeBashrcLoaded}
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">ANTHROPIC_DEFAULT_OPUS_MODEL</p>
            <Input
              value={anthropicDefaultOpusModel}
              onChange={(e) => setAnthropicDefaultOpusModel(e.target.value)}
              className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
              placeholder="deepseek-v4-pro[1m]"
              disabled={!claudeBashrcLoaded}
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">ANTHROPIC_DEFAULT_SONNET_MODEL</p>
            <Input
              value={anthropicDefaultSonnetModel}
              onChange={(e) => setAnthropicDefaultSonnetModel(e.target.value)}
              className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
              placeholder="deepseek-v4-pro[1m]"
              disabled={!claudeBashrcLoaded}
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">ANTHROPIC_DEFAULT_HAIKU_MODEL</p>
            <Input
              value={anthropicDefaultHaikuModel}
              onChange={(e) => setAnthropicDefaultHaikuModel(e.target.value)}
              className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
              placeholder="deepseek-v4-flash"
              disabled={!claudeBashrcLoaded}
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">CLAUDE_CODE_SUBAGENT_MODEL</p>
            <Input
              value={claudeCodeSubagentModel}
              onChange={(e) => setClaudeCodeSubagentModel(e.target.value)}
              className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
              placeholder="deepseek-v4-flash"
              disabled={!claudeBashrcLoaded}
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">CLAUDE_CODE_EFFORT_LEVEL</p>
            <Input
              value={claudeCodeEffortLevel}
              onChange={(e) => setClaudeCodeEffortLevel(e.target.value)}
              className="quiet-control w-full h-11 rounded-full border-0 px-4 text-[color:var(--color-foreground)]"
              placeholder="max"
              disabled={!claudeBashrcLoaded}
            />
          </div>

          <Button
            className="h-10 rounded-full px-5 text-sm disabled:opacity-60"
            disabled={claudeBashrcSaving || !claudeBashrcLoaded}
            onClick={() => void handleSaveClaudeBashrc()}
          >
            {claudeBashrcSaving ? 'Saving...' : 'Save And Validate .bashrc'}
          </Button>
          {claudeBashrcSavedHint && (
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{claudeBashrcSavedHint}</p>
          )}
          {claudeBashrcError && (
            <p className="text-xs text-[color:var(--color-destructive)]">{claudeBashrcError}</p>
          )}
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

export { SettingsRuntimePanel }
