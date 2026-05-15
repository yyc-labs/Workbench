import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ProjectInfo, CliTool } from '../../shared/types'
import { useAppStore } from '../stores/appStore'
import { Badge } from './ui/badge'
import { Pin, Play, Square, Folder, ExternalLink, Trash2, FileText, Zap, Sparkles, Terminal } from 'lucide-react'
import { UrlPopover } from './UrlPopover'
import { CardContextMenu } from './CardContextMenu'

interface ProjectCardProps {
  project: ProjectInfo
  onSelect: (id: string) => void
  index?: number
}

export function ProjectCard({ project, onSelect, index = 0 }: ProjectCardProps) {
  const navigate = useNavigate()

  const devStatus = useAppStore((s) => s.processes[project.id]?.status ?? 'stopped')
  const devUrls = useAppStore((s) => s.processUrls[project.id] || [])
  const startProject = useAppStore((s) => s.startProject)
  const stopProject = useAppStore((s) => s.stopProject)
  const startRuntime = useAppStore((s) => s.startRuntime)
  const stopRuntime = useAppStore((s) => s.stopRuntime)
  const openTerminal = useAppStore((s) => s.openTerminal)
  const setProjectCli = useAppStore((s) => s.setProjectCli)

  const currentCli: CliTool = project.cli || 'claude'

  const session = useAppStore((s) => s.sessions[project.id])
  const isRuntimeAttached = session?.status === 'attached'
  const isRuntimeDetached = session?.status === 'detached'
  const isRuntimeActive = isRuntimeAttached || isRuntimeDetached

  const handleSwitchCli = useCallback(() => {
    setProjectCli(project.id, currentCli === 'codex' ? 'claude' : 'codex')
  }, [project.id, currentCli, setProjectCli])

  const togglePin = useAppStore((s) => s.togglePin)
  const removeProject = useAppStore((s) => s.removeProject)
  const isDevRunning = devStatus === 'running'

  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)

  return (
    <div
      className="group relative flex items-center gap-4 rounded-xl px-5 py-2.5 cursor-pointer card-enter surface-card surface-card-hover"
      style={{
        animationDelay: `${index * 40}ms`,
        background: 'var(--color-card)',
        border: '1px solid var(--color-border)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-border-hover)'
        e.currentTarget.style.transform = 'translateY(-1px)'
        e.currentTarget.style.boxShadow = '0 10px 30px rgba(0,0,0,0.08)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)'
      }}
      onClick={() => onSelect(project.id)}
      onContextMenu={(e) => { e.preventDefault(); setMenuPos({ x: e.clientX, y: e.clientY }) }}
    >
      {/* Icon */}
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: 'rgba(99, 91, 255, 0.12)', color: 'var(--color-primary)' }}
      >
        <Folder className="h-4 w-4" strokeWidth={1.8} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[color:var(--color-foreground)] truncate">{project.name}</h3>
          {/* Runtime status */}
          {isRuntimeActive ? (
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-medium shrink-0 ${
                isRuntimeAttached ? 'text-emerald-600' : 'text-amber-600'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isRuntimeAttached ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
              {isRuntimeAttached ? 'Active' : 'Background'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] text-[color:var(--color-muted-foreground)] font-medium shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--color-muted-foreground)]/55" />
              Offline
            </span>
          )}
          {isDevRunning && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              Dev
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <p className="text-xs text-[color:var(--color-muted-foreground)] truncate max-w-[280px]" title={project.path}>{project.path}</p>
          <Badge variant="secondary" className="h-5 px-1.5 capitalize shrink-0 bg-[color:var(--color-secondary)]/45 text-[color:var(--color-muted-foreground)] border-[color:var(--color-border)]">
            {project.type}
          </Badge>
          {project.packageManager && (
            <Badge variant="secondary" className="h-5 px-1.5 shrink-0 bg-[color:var(--color-secondary)]/45 text-[color:var(--color-muted-foreground)] border-[color:var(--color-border)]">
              {project.packageManager}
            </Badge>
          )}
          <Badge
            variant="secondary"
            className="h-5 px-1.5 shrink-0 border"
            style={
              currentCli === 'codex'
                ? { background: 'rgba(99, 91, 255, 0.14)', color: '#5f59dc', borderColor: 'rgba(99, 91, 255, 0.24)' }
                : { background: 'rgba(249, 115, 22, 0.12)', color: '#c97137', borderColor: 'rgba(249, 115, 22, 0.24)' }
            }
            title={`AI CLI: ${currentCli}`}
          >
            {currentCli === 'codex' ? (
              <Terminal className="h-2.5 w-2.5 mr-0.5" />
            ) : (
              <Sparkles className="h-2.5 w-2.5 mr-0.5" />
            )}
            {currentCli}
          </Badge>
        </div>
        {isRuntimeActive && session && (
          <p className="text-[10px] text-[color:var(--color-muted-foreground)] mt-0.5 flex items-center gap-1">
            <Zap className="w-2.5 h-2.5" />
            {session.sessionName}
            {isRuntimeAttached && <span className="text-primary/70">· Connected</span>}
          </p>
        )}
      </div>

      {menuPos && (
        <CardContextMenu
          x={menuPos.x}
          y={menuPos.y}
          onClose={() => setMenuPos(null)}
          isRuntimeActive={isRuntimeActive}
          isDevRunning={isDevRunning}
          currentCli={currentCli}
          onStartRuntime={() => startRuntime(project.id)}
          onStopRuntime={() => stopRuntime(project.id)}
          onOpenTerminal={() => openTerminal(project.id)}
          onSwitchCli={handleSwitchCli}
          onStartProject={() => startProject(project.id, undefined, undefined, false)}
          onStopProject={() => stopProject(project.id)}
          onOpenFolder={() => window.electronAPI.openFolder(project.path)}
          onOpenVsCode={() => window.electronAPI.openInVsCode(project.path)}
        />
      )}

      {/* Actions — compact grouped */}
      <div className="flex items-center gap-1 shrink-0">
        {isDevRunning && devUrls.length > 0 && (
          <UrlPopover urls={devUrls}>
            <button
              className="flex items-center gap-1 text-xs text-primary rounded-lg px-2.5 py-1.5 transition-colors max-w-[200px] border border-[color:var(--color-border)] bg-[color:var(--color-secondary)]/50 hover:bg-[color:var(--color-secondary)]"
              onClick={(e) => { e.stopPropagation(); window.electronAPI.openExternal(devUrls[0]) }}
              title={devUrls[0]}
            >
              <ExternalLink className="h-3 w-3 shrink-0" />
              <span className="truncate">{devUrls[0]}</span>
            </button>
          </UrlPopover>
        )}
        {isDevRunning ? (
          <button
            className="h-8 px-3 text-xs rounded-lg border text-red-500 hover:bg-red-500/10 flex items-center gap-1 font-medium transition-colors shrink-0"
            style={{ borderColor: 'rgba(248, 113, 113, 0.35)' }}
            onClick={(e) => { e.stopPropagation(); stopProject(project.id) }}
          >
            <Square className="h-3 w-3" />
            <span className="hidden sm:inline">Stop</span>
          </button>
        ) : (
          <button
            className="h-8 px-3 text-xs rounded-lg bg-primary text-white hover:bg-primary-hover flex items-center gap-1 font-medium transition-colors shrink-0 shadow-sm"
            onClick={(e) => { e.stopPropagation(); startProject(project.id, undefined, undefined, false) }}
          >
            <Play className="h-3 w-3" />
            <span className="hidden sm:inline">Run</span>
          </button>
        )}
        <button
          className="h-8 w-8 rounded-lg flex items-center justify-center text-[color:var(--color-muted-foreground)] hover:text-primary hover:bg-[color:var(--color-secondary)]/70 transition-colors"
          title="View details"
          onClick={(e) => { e.stopPropagation(); navigate(`/project/${project.id}`) }}
        >
          <FileText className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
          <button
            className="p-1 rounded-md text-[color:var(--color-muted-foreground)] hover:text-amber-500 hover:bg-amber-500/10 transition-colors"
            title={project.pinned ? 'Unpin' : 'Pin'}
            onClick={(e) => { e.stopPropagation(); togglePin(project.id) }}
          >
            <Pin className={`h-3.5 w-3.5 ${project.pinned ? 'fill-amber-500 text-amber-500' : ''}`} />
          </button>
          <button
            className="p-1 rounded-md text-[color:var(--color-muted-foreground)] hover:text-red-500 hover:bg-red-500/10 transition-colors"
            title="Remove"
            onClick={(e) => { e.stopPropagation(); removeProject(project.id) }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
