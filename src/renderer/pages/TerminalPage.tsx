import { useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { Terminal } from '../components/Terminal'
import { ChevronLeft, Play, Square, ArrowUpRight, Terminal as TerminalIcon } from 'lucide-react'

export function TerminalPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()

  const project = useAppStore((s) =>
    s.projects.find((p) => p.id === projectId)
  )

  // ── Process keys ──
  // Claude runs in WSL (tmux / wsl-pty), dev server runs on Windows host.
  // Separate keys so their terminals and lifecycle are fully isolated.
  const claudeProcessId = `${projectId}__claude`

  // Dev server status (shared key with Detail page → state sync)
  const devStatus = useAppStore((s) => s.processes[projectId!]?.status ?? 'stopped')
  const isDevRunning = devStatus === 'running'

  // Claude status
  const claudeStatus = useAppStore((s) => s.processes[claudeProcessId]?.status ?? 'stopped')
  const claudeUrl = useAppStore((s) => s.processUrls[claudeProcessId] || '')

  const startProject = useAppStore((s) => s.startProject)
  const stopProject = useAppStore((s) => s.stopProject)
  const reattachProject = useAppStore((s) => s.reattachProject)

  // ── Auto-start Claude on page entry ──
  // Env vars (PATH, API keys, proxy, WSL path fixes) are injected by the
  // runner's env-capture system — no need to source nvm/.profile here.
  const claudeCommand = 'hash -r && clear && (claude --continue || (clear && claude))'
  const hasAutoStarted = useRef(false)

  useEffect(() => {
    if (hasAutoStarted.current) return
    if (!projectId) return
    const currentStatus = useAppStore.getState().processes[claudeProcessId]?.status
    if (currentStatus !== 'running' && currentStatus !== 'detached') {
      hasAutoStarted.current = true
      startProject(projectId, claudeCommand, claudeProcessId, true)
    } else {
      hasAutoStarted.current = true
    }
  }, [projectId, startProject, claudeCommand, claudeProcessId])

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

  const isClaudeRunning = claudeStatus === 'running'
  const isClaudeDetached = claudeStatus === 'detached'
  const isClaudeActive = isClaudeRunning || isClaudeDetached

  return (
    <div className="h-screen flex flex-col bg-[#f1f1ef]">
      {/* ── Header ── */}
      <header
        className="flex items-center justify-between px-6 py-5 shrink-0 border-b border-black/5"
        style={{ background: 'rgba(255,255,255,0.88)' }}
      >
        <div className="flex items-center gap-4 min-w-0">
          <button
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-[#eae9e6] transition-colors"
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

          {/* Claude status badge */}
          <div
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium shrink-0 ${
              isClaudeRunning
                ? 'bg-emerald-500/10 text-emerald-600'
                : isClaudeDetached
                  ? 'bg-amber-500/10 text-amber-600'
                  : 'bg-[#eae9e6] text-gray-500'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isClaudeRunning
                  ? 'bg-emerald-500'
                  : isClaudeDetached
                    ? 'bg-amber-500'
                    : 'bg-gray-400'
              }`}
            />
            {isClaudeRunning ? 'Claude Running' : isClaudeDetached ? 'Session Available' : 'Claude Stopped'}
          </div>
        </div>

        {/* Action buttons + URL */}
        <div className="flex items-center gap-3 shrink-0">
          {isClaudeRunning && claudeUrl && (
            <button
              className="inline-flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg px-3 py-1.5 transition-colors"
              onClick={() => window.electronAPI.openExternal(claudeUrl)}
            >
              <ArrowUpRight className="w-3 h-3" />
              <span className="truncate max-w-[180px]">{claudeUrl}</span>
            </button>
          )}
          {/* Reattach button (detached tmux session) */}
          {isClaudeDetached && (
            <button
              className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition-all bg-amber-500 text-white hover:bg-amber-600 shadow-sm"
              onClick={() => reattachProject(projectId, claudeProcessId)}
            >
              <Play className="w-3.5 h-3.5" />
              Reattach
            </button>
          )}
          {/* Run — dev server (Windows host, output visible in Detail page terminal) */}
          <button
            className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition-all ${
              isDevRunning
                ? 'border border-red-200 text-red-500 hover:bg-red-50'
                : 'text-gray-500 hover:text-gray-700 hover:bg-[#eae9e6] border border-[#e2e2df]'
            }`}
            onClick={() =>
              isDevRunning ? stopProject(projectId) : startProject(projectId, undefined, undefined, false)
            }
          >
            {isDevRunning ? (
              <>
                <Square className="w-3.5 h-3.5" />
                Stop
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                Run
              </>
            )}
          </button>
          {/* Claude — WSL terminal */}
          <button
            className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition-all ${
              isClaudeActive
                ? 'border border-red-200 text-red-500 hover:bg-red-50'
                : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
            }`}
            onClick={() =>
              isClaudeActive ? stopProject(claudeProcessId) : startProject(projectId, claudeCommand, claudeProcessId, true)
            }
          >
            {isClaudeActive ? (
              <>
                <Square className="w-3.5 h-3.5" />
                Stop
              </>
            ) : (
              <>
                <TerminalIcon className="w-3.5 h-3.5" />
                Claude
              </>
            )}
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 flex flex-col min-h-0 px-6 pb-6">
        {/* Terminal shell — Claude output (WSL) */}
        <div
          className="flex-1 min-h-0 overflow-hidden flex flex-col border border-white/5"
          style={{ background: '#2b2f36' ,borderRadius: '20px' }}
        >
          {/* Title bar — dark, integrated into shell */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5 shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-white/20" />
            <span className="w-2.5 h-2.5 rounded-full bg-white/20" />
            <span className="w-2.5 h-2.5 rounded-full bg-white/20" />
            <span className="ml-3 text-[11px] text-white/25 font-mono select-none">
              claude — wsl
            </span>
          </div>
          {/* xterm area */}
          <div className="flex-1 min-h-0 m-3 overflow-hidden bg-[#2b2f36]">
            <Terminal projectId={claudeProcessId} />
          </div>
        </div>
      </div>
    </div>
  )
}
