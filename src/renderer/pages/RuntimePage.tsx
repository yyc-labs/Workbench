import { useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { runtimeManager } from '../runtime/RuntimeManager'
import { ChevronLeft, Play, Square, ExternalLink, RefreshCw, Terminal, Zap } from 'lucide-react'

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
    if (!projectId || !session) return
    try {
      await openTerminal(projectId)
    } catch (err) {
      console.error('[RuntimePage] open terminal failed:', err)
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
          {/* Runtime Status Card */}
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
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="text-center">
                <div
                  className={`w-2.5 h-2.5 rounded-full mx-auto mb-1.5 ${
                    isAttached ? 'bg-emerald-500' : !isStopped ? 'bg-amber-500' : 'bg-gray-600'
                  }`}
                />
                <p className="text-xs text-gray-400">{sessionLabel}</p>
              </div>
              <div className="text-center">
                <div
                  className={`w-2.5 h-2.5 rounded-full mx-auto mb-1.5 ${
                    isAttached ? 'bg-blue-500' : 'bg-gray-600'
                  }`}
                />
                <p className="text-xs text-gray-400">
                  {isAttached ? 'Connected' : 'Disconnected'}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-700 font-mono mb-1.5">
                  {session?.createdAt
                    ? new Date(session.createdAt).toLocaleTimeString()
                    : '—'}
                </p>
                <p className="text-[10px] text-gray-400">Created</p>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3">
              {isStopped ? (
                <button
                  disabled={isLoading}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 shadow-sm"
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
                  <button
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
                    onClick={handleOpenTerminal}
                  >
                    <Terminal className="w-4 h-4" />
                    Open Terminal
                  </button>
                  <button
                    disabled={isLoading}
                    className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all text-gray-500 hover:text-gray-400 hover:bg-[#eae9e6] border border-[#e2e2df] disabled:opacity-50"
                    onClick={handleRestart}
                  >
                    {actionLoading === 'restart' ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                    Restart
                  </button>
                  <button
                    disabled={isLoading}
                    className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all text-red-500 hover:text-red-600 hover:bg-red-50 border border-red-200 disabled:opacity-50"
                    onClick={handleStopRuntime}
                  >
                    {actionLoading === 'stop' ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                    Stop
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Recent Activity (placeholder) */}
          <div
            className="rounded-2xl border border-[#e2e2df] p-6"
            style={{ background: '#f6f6f4' }}
          >
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Recent Activity
            </h3>
            <div className="space-y-2 text-sm font-mono">
              {isStopped ? (
                <p className="text-gray-400">— Press "Start Runtime" to launch Claude</p>
              ) : isAttached ? (
                <p className="text-gray-500">— Claude runtime active, terminal connected</p>
              ) : (
                <p className="text-gray-500">— Session running in background</p>
              )}
            </div>
          </div>

          {/* Runtime Info */}
          <div
            className="rounded-2xl border border-[#e2e2df] p-6"
            style={{ background: '#f6f6f4' }}
          >
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Runtime Info
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-[11px] text-gray-400 mb-0.5">Session</p>
                <p className="text-gray-900 font-mono text-xs">{session?.sessionName ?? '—'}</p>
              </div>
              <div>
                <p className="text-[11px] text-gray-400 mb-0.5">Type</p>
                <p className="text-gray-900">{project.type}</p>
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
  )
}
