import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { Terminal } from '../components/Terminal'
import { Folder, Code2, Package, ChevronLeft, Play, Square, ArrowUpRight } from 'lucide-react'
import { UrlPopover } from '../components/UrlPopover'
import { detectProjectEnvironment, projectEnvironmentLabel } from '../lib/projectEnvironment'

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
    <div className="rounded-xl border px-4 py-3 surface-card" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex items-center gap-1.5 text-[color:var(--color-muted-foreground)] mb-1">
        <Icon className="w-3.5 h-3.5" strokeWidth={1.8} />
        <span className="text-[10px] uppercase tracking-wider font-medium">{label}</span>
      </div>
      <p className="text-sm text-[color:var(--color-foreground)] font-medium truncate" title={value}>
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
  const processUrls = projectId
    ? useAppStore((s) => s.processUrls[projectId] || [])
    : [] as string[]
  const startProject = useAppStore((s) => s.startProject)
  const stopProject = useAppStore((s) => s.stopProject)
  const reattachProject = useAppStore((s) => s.reattachProject)
  const processBackend = projectId
    ? useAppStore((s) => s.processes[projectId]?.backend)
    : undefined
  const [customCommand, setCustomCommand] = useState(
    project?.customCommand ?? ''
  )
  const environmentLabel = project ? projectEnvironmentLabel(detectProjectEnvironment(project.path)) : 'Unknown'

  if (!project || !projectId) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4">
        <h2 className="text-lg font-semibold text-[color:var(--color-foreground)]">Project not found</h2>
        <button
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary transition-colors"
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
        lastOpened: p.lastOpened,
        cli: p.cli,
        docLinks: p.docLinks ?? [],
      })),
    })
  }

  return (
    <div className="h-screen flex flex-col">
      {/* ── Header ── */}
      <header
        className="flex items-center justify-between px-6 py-5 shrink-0 border-b"
        style={{
          background: 'var(--color-card)',
          borderBottomColor: 'var(--color-border)',
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
        }}
      >
        <div className="flex items-center gap-4 min-w-0">
          <button
            className="p-1.5 rounded-lg text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)] transition-colors"
            onClick={() => navigate('/')}
          >
            <ChevronLeft className="w-5 h-5" strokeWidth={1.8} />
          </button>

          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-[color:var(--color-foreground)] tracking-tight truncate">
              {project.name}
            </h1>
            <p className="text-xs text-[color:var(--color-muted-foreground)] truncate">{project.path}</p>
            <p className="text-[11px] text-[color:var(--color-muted-foreground)]/85 mt-0.5">
              Environment: {environmentLabel}
            </p>
          </div>

          {/* Status — inline text when stopped, pill badge when active */}
          {isActive ? (
            <div
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium shrink-0 ${isRunning
                ? 'bg-emerald-500/12 text-emerald-500'
                : 'bg-amber-500/12 text-amber-500'
                }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
              />
              {isRunning ? 'Running' : 'Session Available'}
            </div>
          ) : (
            <span className="text-[11px] text-[color:var(--color-muted-foreground)] font-medium shrink-0">Stopped</span>
          )}
        </div>

        {/* Action buttons + URL */}
        <div className="flex items-center gap-3 shrink-0">
          {isRunning && processUrls.length > 0 && (
            <UrlPopover urls={processUrls}>
              <button
                className="inline-flex items-center gap-1.5 text-xs text-primary rounded-lg px-3 py-1.5 transition-colors border border-[color:var(--color-border)] bg-[color:var(--color-secondary)]/50 hover:bg-[color:var(--color-secondary)]"
                onClick={() => window.electronAPI.openExternal(processUrls[0])}
              >
                <ArrowUpRight className="w-3 h-3" />
                <span className="truncate max-w-[180px]">{processUrls[0]}</span>
              </button>
            </UrlPopover>
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
            className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition-all ${isActive
              ? 'border text-red-500 hover:bg-red-500/10'
              : 'bg-primary text-white hover:bg-primary-hover shadow-sm'
              }`}
            style={isActive ? { borderColor: 'rgba(248, 113, 113, 0.35)' } : undefined}
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
      <div className="flex-1 flex flex-col min-h-0 px-6 pb-6 pt-6">
        {/* Command bar */}
        <div className="flex items-center gap-2 rounded-xl border px-3 py-2 mb-4 surface-card" style={{ borderColor: 'var(--color-border)' }}>
          <span className="text-xs text-[color:var(--color-muted-foreground)] select-none">$</span>
          <input
            type="text"
            value={customCommand}
            onChange={(e) => setCustomCommand(e.target.value)}
            placeholder={project.command}
            className="flex-1 bg-transparent border-none text-sm font-mono text-[color:var(--color-foreground)] outline-none placeholder:text-[color:var(--color-muted-foreground)]"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveCommand()
            }}
          />
          {customCommand && customCommand !== project.command && (
            <button
              className="text-xs text-primary hover:text-primary font-medium px-2 py-1 rounded-md hover:bg-primary/10 transition-colors shrink-0"
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
            <span className="rounded-full" style={{ width: '10px', height: '10px', background: '#ff5f57', opacity: 0.7 }} />
            <span className="rounded-full" style={{ width: '10px', height: '10px', background: '#febc2e', opacity: 0.7 }} />
            <span className="rounded-full" style={{ width: '10px', height: '10px', background: '#28c840', opacity: 0.7 }} />
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
