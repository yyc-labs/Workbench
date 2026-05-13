import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { Terminal } from '../components/Terminal'
import { ChevronLeft, Play, Square, ArrowUpRight } from 'lucide-react'

export function TerminalPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()

  const project = useAppStore((s) =>
    s.projects.find((p) => p.id === projectId)
  )
  const processStatus = projectId
    ? useAppStore((s) => s.processes[projectId]?.status ?? 'stopped')
    : 'stopped'
  const processUrl = projectId
    ? useAppStore((s) => s.processUrls[projectId] || '')
    : ''

  const startProject = useAppStore((s) => s.startProject)
  const stopProject = useAppStore((s) => s.stopProject)
  const reattachProject = useAppStore((s) => s.reattachProject)

  // Auto-start / auto-reattach on mount
  useEffect(() => {
    if (!projectId) return
    if (processStatus === 'running') return

    if (processStatus === 'detached') {
      reattachProject(projectId)
    } else if (processStatus === 'stopped' || processStatus === 'error') {
      startProject(projectId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!project || !projectId) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-[#f6f8fb]">
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

  const isRunning = processStatus === 'running'
  const isDetached = processStatus === 'detached'
  const isActive = isRunning || isDetached

  return (
    <div className="h-screen flex flex-col bg-[#f6f8fb]">
      {/* ── Header ── */}
      <header className="flex items-center justify-between px-6 py-5 shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          <button
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
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

          {/* Status badge */}
          <div
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium shrink-0 ${
              isRunning
                ? 'bg-emerald-500/10 text-emerald-600'
                : isDetached
                  ? 'bg-amber-500/10 text-amber-600'
                  : 'bg-gray-100 text-gray-500'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isRunning
                  ? 'bg-emerald-500'
                  : isDetached
                    ? 'bg-amber-500'
                    : 'bg-gray-400'
              }`}
            />
            {isRunning ? 'Running' : isDetached ? 'Session Available' : 'Stopped'}
          </div>
        </div>

        {/* Action buttons + URL */}
        <div className="flex items-center gap-3 shrink-0">
          {isRunning && processUrl && (
            <button
              className="inline-flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg px-3 py-1.5 transition-colors"
              onClick={() => window.electronAPI.openExternal(processUrl)}
            >
              <ArrowUpRight className="w-3 h-3" />
              <span className="truncate max-w-[180px]">{processUrl}</span>
            </button>
          )}
          {/* Reattach button (detached tmux session) */}
          {isDetached && (
            <button
              className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition-all bg-amber-500 text-white hover:bg-amber-600 shadow-sm"
              onClick={() => reattachProject(projectId)}
            >
              <Play className="w-3.5 h-3.5" />
              Reattach
            </button>
          )}
          <button
            className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition-all ${
              isActive
                ? 'border border-red-200 text-red-500 hover:bg-red-50'
                : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
            }`}
            onClick={() =>
              isActive ? stopProject(projectId) : startProject(projectId)
            }
          >
            {isActive ? (
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
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 flex flex-col min-h-0 px-6 pb-6">
        {/* Terminal panel */}
        <div className="flex-1 min-h-0 rounded-2xl border border-gray-200 bg-white shadow-lg overflow-hidden flex flex-col">
          {/* macOS-style title bar */}
          <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-100 shrink-0">
            <span className="w-3 h-3 rounded-full bg-red-400" />
            <span className="w-3 h-3 rounded-full bg-amber-400" />
            <span className="w-3 h-3 rounded-full bg-green-400" />
            <span className="ml-3 text-[11px] text-gray-400 font-mono select-none">
              terminal
            </span>
          </div>
          <div className="flex-1 min-h-0 p-3 bg-[#f6f8fc]">
            <Terminal projectId={projectId} />
          </div>
        </div>
      </div>
    </div>
  )
}
