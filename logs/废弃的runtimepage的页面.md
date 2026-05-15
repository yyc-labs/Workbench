import { useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { runtimeManager } from '../runtime/RuntimeManager'
import { ChevronLeft, Play, Square, ExternalLink, RefreshCw, Terminal, Zap, Clock, FolderOpen } from 'lucide-react'

/** Map tmux status → user-facing label */
function statusLabel(status: string): string {
  switch (status) {
    case 'attached': return 'Active'
    case 'detached': return 'Background'
    case 'stopped': return 'Offline'
    default: return status
  }
}

export function RuntimePage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()

  const project = useAppStore((s) =>
    s.projects.find((p) => p.id === projectId)
  )
  const session = useAppStore((s) => (projectId ? s.sessions[projectId] : undefined))
  const devStatus = useAppStore((s) => s.processes[projectId!]?.status ?? 'stopped')
  const devUrl = useAppStore((s) => s.processUrls[projectId!] || '')
  const isDevRunning = devStatus === 'running'

  const startRuntime = useAppStore((s) => s.startRuntime)
  const stopRuntime = useAppStore((s) => s.stopRuntime)
  const openTerminal = useAppStore((s) => s.openTerminal)
  const refreshSessions = useAppStore((s) => s.refreshSessions)
  const startProject = useAppStore((s) => s.startProject)
  const stopProject = useAppStore((s) => s.stopProject)

  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const handleStartRuntime = useCallback(async () => {
    if (!projectId || !project) return
    setActionLoading('start')
    try {
      // Store action: starts runtime (main process computes session name via MD5),
      // reloads runtime entries, does initial session refresh
      await startRuntime(projectId)

      // Poll until the tmux session appears (background script is async in WSL)
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500))
        await refreshSessions()
        const s = useAppStore.getState().sessions[projectId]
        if (s && s.status !== 'stopped') break
      }
    } catch (err) {
      console.error('[RuntimePage] start runtime failed:', err)
    } finally {
      setActionLoading(null)
    }
  }, [projectId, project, startRuntime, refreshSessions])

  const handleStopRuntime = useCallback(async () => {
    if (!projectId) return
    setActionLoading('stop')
    try {
      await stopRuntime(projectId)
    } catch (err) {
      console.error('[RuntimePage] stop runtime failed:', err)
    } finally {
      setActionLoading(null)
    }
  }, [projectId, stopRuntime])

  const handleOpenTerminal = useCallback(async () => {
    console.log('[RuntimePage] handleOpenTerminal called', { projectId, hasSession: !!session, sessionName: session?.sessionName, sessionStatus: session?.status })
    if (!projectId || !session) {
      console.log('[RuntimePage] handleOpenTerminal BAIL — projectId or session missing')
      return
    }
    setActionLoading('openTerminal')
    try {
      console.log('[RuntimePage] calling store.openTerminal...')
      const result = await openTerminal(projectId, session?.status)
      console.log('[RuntimePage] store.openTerminal returned', result)
    } catch (err) {
      console.error('[RuntimePage] open terminal failed:', err)
    } finally {
      setTimeout(() => setActionLoading(null), 300)
    }
  }, [projectId, session, openTerminal])

  const handleRestart = useCallback(async () => {
    if (!projectId || !project || !session) return
    setActionLoading('restart')
    try {
      const sessionName = session.sessionName

      // Kill
      await runtimeManager.stopRuntime(sessionName)

      // Wait for tmux to actually remove the session (poll, not blind sleep)
      await runtimeManager.waitForSessionGone(sessionName, 10000)

      // Re-create (store action computes session name + reloads entries + refreshes)
      await startRuntime(projectId)

      // Poll until the tmux session reappears
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500))
        await refreshSessions()
        const s = useAppStore.getState().sessions[projectId]
        if (s && s.status !== 'stopped') break
      }
    } catch (err) {
      console.error('[RuntimePage] restart failed:', err)
    } finally {
      setActionLoading(null)
    }
  }, [projectId, project, session, startRuntime, refreshSessions])

  const isLoading = actionLoading !== null
  const isStopped = session?.status === 'stopped'
  const isAttached = session?.status === 'attached'
  const sessionLabel = statusLabel(session?.status ?? 'stopped')

  if (!project || !projectId) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-[#f1f1ef]">
        <h2 className="text-lg font-semibold text-gray-900">Project not found</h2>
        <button
          className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 transition-colors"
          onClick={() => navigate('/')}
        >
          <ChevronLeft className="w-4 h-4" strokeWidth={1.8} />
          Back to Home
        </button>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-[#f1f1ef]">
      {/* ── Header ── */}
      <header
        className="flex items-center justify-between px-6 py-4 shrink-0 border-b border-black/5"
        style={{ background: '#f6f6f4' }}
      >
        <div className="flex items-center gap-4 min-w-0">
          <button
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-400 hover:bg-[#eae9e6] transition-colors"
            onClick={() => navigate('/')}
          >
            <ChevronLeft className="w-5 h-5" strokeWidth={1.8} />
          </button>

          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-gray-900 tracking-tight truncate">
              {project.name}
            </h1>
            <p className="text-xs text-gray-500 truncate">{project.path}</p>
          </div>

          {/* Runtime status badge */}
          <div
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium shrink-0 ${
              isAttached
                ? 'bg-emerald-500/10 text-emerald-600'
                : !isStopped
                  ? 'bg-amber-500/10 text-amber-600'
                  : 'bg-[#eae9e6] text-gray-500'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isAttached
                  ? 'bg-emerald-500'
                  : !isStopped
                    ? 'bg-amber-500'
                    : 'bg-gray-600'
              }`}
            />
            {sessionLabel}
          </div>
        </div>

        {/* Dev server actions */}
        <div className="flex items-center gap-2 shrink-0">
          {isDevRunning && devUrl && (
            <button
              className="inline-flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg px-3 py-1.5 transition-colors max-w-[200px]"
              onClick={() => window.electronAPI.openExternal(devUrl)}
            >
              <ExternalLink className="w-3 h-3" />
              <span className="truncate">{devUrl}</span>
            </button>
          )}
          <button
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              isDevRunning
                ? 'border border-red-200 text-red-500 hover:bg-red-50'
                : 'text-gray-500 hover:text-gray-400 hover:bg-[#eae9e6] border border-[#e2e2df]'
            }`}
            onClick={() =>
              isDevRunning ? stopProject(projectId) : startProject(projectId, undefined, undefined, false)
            }
          >
            {isDevRunning ? (
              <><Square className="w-3 h-3" /> Stop Dev</>
            ) : (
              <><Play className="w-3 h-3" /> Run Dev</>
            )}
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 flex flex-col min-h-0 px-6 py-6 overflow-auto">
        <div className="max-w-2xl mx-auto w-full space-y-6">
          {/* ── Runtime Card ── */}
          <div
            className="rounded-2xl border border-[#e2e2df] p-6"
            style={{ background: '#f6f6f4' }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
                Claude Runtime
              </h2>
              <span className="text-[11px] text-gray-400 font-mono">
                {session?.sessionName ?? '—'}
              </span>
            </div>

            {/* Status indicators */}
            <div className="flex items-center gap-5 mb-5">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    isAttached ? 'bg-emerald-500' : !isStopped ? 'bg-amber-500' : 'bg-gray-400'
                  }`}
                />
                <span className="text-xs font-medium text-gray-700">{sessionLabel}</span>
              </div>
              <span className="w-px h-4 bg-[#e2e2df]" />
              <span className="text-[11px] text-gray-400">
                Created{' '}
                <span className="text-gray-500 font-mono">
                  {session?.createdAt
                    ? new Date(session.createdAt).toLocaleTimeString()
                    : '—'}
                </span>
              </span>
            </div>

            {/* ── Actions ── */}
            {isStopped ? (
              <button
                disabled={isLoading}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 shadow-sm"
                onClick={handleStartRuntime}
              >
                {actionLoading === 'start' ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4" />
                )}
                Start Runtime
              </button>
            ) : (
              <>
                {/* Primary CTA */}
                <button
                  disabled={isLoading}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all bg-blue-600 text-white hover:bg-blue-700 shadow-sm disabled:opacity-50"
                  onClick={handleOpenTerminal}
                >
                  {actionLoading === 'openTerminal' ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Terminal className="w-4 h-4" />
                  )}
                  Open Terminal
                </button>

                {/* Auxiliary actions */}
                <div className="flex items-center gap-2 mt-2">
                  <button
                    disabled={isLoading}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all text-gray-500 hover:text-gray-400 hover:bg-[#eae9e6] border border-[#e2e2df] disabled:opacity-50"
                    onClick={() => window.electronAPI.openFolder(project.path)}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    Open Folder
                  </button>
                  <button
                    disabled={isLoading}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all text-gray-500 hover:text-gray-400 hover:bg-[#eae9e6] border border-[#e2e2df] disabled:opacity-50"
                    onClick={() => window.electronAPI.openInVsCode(project.path)}
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                      <path d="M17.5 3.5L6.5 8.5L2 12L6.5 15.5L17.5 20.5L17.5 17L9.5 12L17.5 7Z" fill="#007ACC" />
                    </svg>
                    VS Code
                  </button>
                  <button
                    disabled={isLoading}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all text-gray-500 hover:text-gray-400 hover:bg-[#eae9e6] border border-[#e2e2df] disabled:opacity-50"
                    onClick={handleRestart}
                  >
                    {actionLoading === 'restart' ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    Restart
                  </button>
                </div>

                {/* Destructive action — separated */}
                <div className="mt-3 pt-3 border-t border-[#e2e2df]">
                  <button
                    disabled={isLoading}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 disabled:opacity-50"
                    onClick={handleStopRuntime}
                  >
                    {actionLoading === 'stop' ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                    Stop Runtime
                  </button>
                </div>
              </>
            )}
          </div>

          {/* ── Details Card ── */}
          <div
            className="rounded-2xl border border-[#e2e2df] p-6"
            style={{ background: '#f6f6f4' }}
          >
            {/* Activity */}
            <div className="flex items-center gap-2.5 mb-4">
              <Clock className="w-3.5 h-3.5 text-gray-300" strokeWidth={1.5} />
              <span className="text-xs text-gray-500">
                {isStopped
                  ? 'Press "Start Runtime" to launch Claude'
                  : isAttached
                    ? 'Claude runtime active, terminal connected'
                    : 'Session running in background'}
              </span>
            </div>

            <div className="border-t border-[#e2e2df] pt-4">
              <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Runtime Info
              </h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <p className="text-[11px] text-gray-400 mb-0.5">Session</p>
                  <p className="text-gray-900 font-mono text-xs">{session?.sessionName ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[11px] text-gray-400 mb-0.5">Type</p>
                  <p className="text-gray-900 text-xs">{project.type}</p>
                </div>
                <div>
                  <p className="text-[11px] text-gray-400 mb-0.5">Runtime</p>
                  <p className="text-gray-900 font-mono text-xs">Claude Code</p>
                </div>
                <div>
                  <p className="text-[11px] text-gray-400 mb-0.5">Backend</p>
                  <p className="text-gray-900 font-mono text-xs">tmux</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
