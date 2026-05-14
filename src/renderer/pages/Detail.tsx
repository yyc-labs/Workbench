import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { Terminal } from '../components/Terminal'
import { Folder, Code2, Package, ChevronLeft, Play, Square, ArrowUpRight } from 'lucide-react'

function InfoCard({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon: React.ComponentType<{ className?: string; strokeWidth?: string | number }>
}) {
  return (
    <div className="rounded-xl border border-[#e2e2df] bg-[#f6f6f4] px-4 py-3">
      <div className="flex items-center gap-1.5 text-gray-400 mb-1">
        <Icon className="w-3.5 h-3.5" strokeWidth={1.8} />
        <span className="text-[10px] uppercase tracking-wider font-medium">{label}</span>
      </div>
      <p className="text-sm text-gray-900 font-medium truncate" title={value}>
        {value}
      </p>
    </div>
  )
}

export function DetailPage() {
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
  const processBackend = projectId
    ? useAppStore((s) => s.processes[projectId]?.backend)
    : undefined
  const [customCommand, setCustomCommand] = useState(
    project?.customCommand ?? ''
  )

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

  const isRunning = processStatus === 'running'
  const isDetached = processStatus === 'detached'
  const isActive = isRunning || isDetached

  const handleSaveCommand = async () => {
    const trimmed = customCommand.trim()
    project.customCommand = trimmed || undefined
    setCustomCommand(trimmed)
    const { projects } = useAppStore.getState()
    await window.electronAPI.setConfig({
      projects: projects.map((p) => ({
        path: p.path,
        customCommand: p.customCommand,
        pinned: p.pinned,
      })),
    })
  }

  return (
    <div className="h-screen flex flex-col bg-[#f1f1ef]">
      {/* ── Header ── */}
      <header
        className="flex items-center justify-between px-6 py-5 shrink-0 border-b border-black/5"
        style={{ background: 'rgba(255,255,255,0.55)', backdropFilter: 'blur(20px)' }}
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

          {/* Status — inline text when stopped, pill badge when active */}
          {isActive ? (
            <div
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium shrink-0 ${
                isRunning
                  ? 'bg-emerald-500/10 text-emerald-600'
                  : 'bg-amber-500/10 text-amber-600'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isRunning ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
              {isRunning ? 'Running' : 'Session Available'}
            </div>
          ) : (
            <span className="text-[11px] text-gray-400 font-medium shrink-0">Stopped</span>
          )}
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
              isActive ? stopProject(projectId) : startProject(projectId, undefined, undefined, false)
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
      <div className="flex-1 flex flex-col min-h-0 px-6 pb-6 pt-6">
        {/* Command bar */}
        <div className="flex items-center gap-2 rounded-xl border border-[#e2e2df] bg-[#f6f6f4] px-3 py-2 mb-4">
          <span className="text-xs text-gray-400 select-none">$</span>
          <input
            type="text"
            value={customCommand}
            onChange={(e) => setCustomCommand(e.target.value)}
            placeholder={project.command}
            className="flex-1 bg-transparent border-none text-sm font-mono text-gray-900 outline-none placeholder:text-gray-400"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveCommand()
            }}
          />
          {customCommand && customCommand !== project.command && (
            <button
              className="text-xs text-blue-600 hover:text-blue-700 font-medium px-2 py-1 rounded-md hover:bg-blue-50 transition-colors shrink-0"
              onClick={handleSaveCommand}
            >
              Save
            </button>
          )}
        </div>

        {/* Info cards — PATH takes full width, Type + PKG MGR below */}
        <div className="space-y-3 mb-4 shrink-0">
          <InfoCard label="Path" value={project.path} icon={Folder} />
          <div className="grid grid-cols-2 gap-3">
            <InfoCard label="Type" value={project.type} icon={Code2} />
            <InfoCard label="Package Manager" value={project.packageManager || 'npm'} icon={Package} />
          </div>
        </div>

        {/* Terminal shell — graphite panel */}
        <div
          className="flex-1 min-h-0 overflow-hidden flex flex-col"
          style={{
            background: '#2f333b',
            borderRadius: '20px',
            boxShadow: `
              inset 0 1px 0 rgba(255,255,255,0.04),
              0 0 0 1px rgba(255,255,255,0.03),
              0 20px 48px rgba(0,0,0,0.18)
            `,
          }}
        >
          {/* Title bar — dark, integrated into shell */}
          <div
            className="flex items-center shrink-0 border-b border-white/5"
            style={{ gap: '6px', padding: '11px 14px' }}
          >
            <span className="rounded-full bg-white/10" style={{ width: '10px', height: '10px' }} />
            <span className="rounded-full bg-white/10" style={{ width: '10px', height: '10px' }} />
            <span className="rounded-full bg-white/10" style={{ width: '10px', height: '10px' }} />
            <span
              className="font-mono select-none uppercase tracking-widest font-medium"
              style={{
                marginLeft: '10px',
                fontSize: '10px',
                color: 'rgba(255,255,255,0.2)',
              }}
            >
              terminal
            </span>
          </div>
          {/* xterm inner area */}
          <div
            className="flex-1 min-h-0 overflow-hidden xterm-container"
            style={{
              margin: '12px',
              borderRadius: '14px',
              background: '#282c34',
              padding: '16px 18px',
            }}
          >
            <Terminal projectId={projectId} />
          </div>
        </div>
      </div>
    </div>
  )
}
