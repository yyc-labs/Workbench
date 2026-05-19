import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ProjectInfo, CliTool } from '../../shared/types'
import { useAppStore } from '../stores/appStore'
import { Badge } from './ui/badge'
import { Pin, Play, Square, Folder, ExternalLink, Trash2, FileText, Zap, Sparkles, Terminal, BookOpen } from 'lucide-react'
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
  const docLinks = project.docLinks ?? []
  const defaultDocLink = docLinks[0]

  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [isOpeningTerminal, setIsOpeningTerminal] = useState(false)

  const handleOpenTerminal = useCallback(async () => {
    if (isOpeningTerminal) return
    setIsOpeningTerminal(true)
    try {
      await openTerminal(project.id, session?.status)
    } finally {
      setTimeout(() => setIsOpeningTerminal(false), 400)
    }
  }, [isOpeningTerminal, openTerminal, project.id, session?.status])

  return (
    <div
      className="group relative flex items-center gap-5 rounded-[24px] px-6 py-4 cursor-pointer card-enter surface-card surface-card-hover"
      style={{
        animationDelay: `${index * 40}ms`,
        background: 'var(--color-card)',
        border: '1px solid var(--color-border)',
        backdropFilter: 'saturate(180%) blur(28px)',
        WebkitBackdropFilter: 'saturate(180%) blur(28px)',
        boxShadow: 'var(--shadow-card)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-border-hover)'
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.boxShadow = 'var(--shadow-card-hover)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = 'var(--shadow-card)'
      }}
      onClick={() => onSelect(project.id)}
      onContextMenu={(e) => { e.preventDefault(); setMenuPos({ x: e.clientX, y: e.clientY }) }}
    >
      {/* Icon */}
      <div
        className="quiet-control w-11 h-11 rounded-[18px] flex items-center justify-center shrink-0"
        style={{
          color: 'var(--color-primary)',
        }}
      >
        <Folder className="h-[18px] w-[18px]" strokeWidth={1.7} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2.5">
          <h3 className="text-[15px] font-medium text-[color:var(--color-foreground)] truncate">{project.name}</h3>
          {/* Runtime status */}
          {isRuntimeActive ? (
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-medium shrink-0 ${
                isRuntimeAttached ? 'text-[color:var(--color-success)]' : 'text-[color:var(--color-warning)]'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isRuntimeAttached ? 'bg-[color:var(--color-success)]' : 'bg-[color:var(--color-warning)]'
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
        <div className="flex items-center gap-2 mt-2">
          <p className="text-xs text-[color:var(--color-muted-foreground)] truncate max-w-[340px]" title={project.path}>{project.path}</p>
          <Badge variant="secondary" className="h-5 px-2 capitalize shrink-0 bg-[color:var(--color-secondary)]/45 text-[color:var(--color-muted-foreground)] border-transparent">
            {project.type}
          </Badge>
          {project.packageManager && (
            <Badge variant="secondary" className="h-5 px-2 shrink-0 bg-[color:var(--color-secondary)]/45 text-[color:var(--color-muted-foreground)] border-transparent">
              {project.packageManager}
            </Badge>
          )}
          <Badge
            variant="secondary"
            className="h-5 px-1.5 shrink-0 border"
            style={
              currentCli === 'codex'
                ? {
                    background: 'color-mix(in srgb, var(--color-primary) 13%, transparent)',
                    color: 'var(--color-primary)',
                    borderColor: 'color-mix(in srgb, var(--color-primary) 28%, transparent)',
                  }
                : {
                    background: 'color-mix(in srgb, var(--color-warning) 15%, transparent)',
                    color: 'var(--color-warning)',
                    borderColor: 'color-mix(in srgb, var(--color-warning) 30%, transparent)',
                  }
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
          <p className="text-[10px] text-[color:var(--color-muted-foreground)] mt-1.5 flex items-center gap-1">
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
          isOpeningTerminal={isOpeningTerminal}
          currentCli={currentCli}
          onStartRuntime={() => startRuntime(project.id)}
          onStopRuntime={() => stopRuntime(project.id)}
          onOpenTerminal={handleOpenTerminal}
          onSwitchCli={handleSwitchCli}
          onStartProject={() => startProject(project.id)}
          onStopProject={() => stopProject(project.id)}
          onOpenFolder={() => window.electronAPI.openFolder(project.path)}
          onOpenVsCode={() => window.electronAPI.openInVsCode(project.path)}
        />
      )}

      {/* Actions — compact grouped */}
      <div className="flex items-center gap-1.5 shrink-0">
        {isDevRunning && devUrls.length > 0 && (
          <UrlPopover urls={devUrls}>
            <button
              className="quiet-control flex items-center gap-1 text-xs text-primary rounded-full px-3 py-1.5 transition-colors max-w-[200px] border-0 hover:bg-[color:var(--color-accent)]"
              onClick={(e) => { e.stopPropagation(); window.electronAPI.openExternal(devUrls[0]) }}
              title={devUrls[0]}
            >
              <ExternalLink className="h-3 w-3 shrink-0" />
              <span className="truncate">{devUrls[0]}</span>
            </button>
          </UrlPopover>
        )}
        {defaultDocLink && (
          <UrlPopover items={docLinks.map((link) => ({ url: link.url, label: link.title }))}>
            <button
              className="quiet-control flex items-center gap-1 text-xs text-[color:var(--color-muted-foreground)] rounded-full px-3 py-1.5 transition-colors max-w-[170px] border-0 hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
              onClick={(e) => { e.stopPropagation(); window.electronAPI.openExternal(defaultDocLink.url) }}
              title={defaultDocLink.url}
            >
              <BookOpen className="h-3 w-3 shrink-0" />
              <span className="truncate">{defaultDocLink.title}</span>
            </button>
          </UrlPopover>
        )}
        {isDevRunning ? (
          <button
            className="h-8 px-3 text-xs rounded-full border text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-background)] flex items-center gap-1 font-medium transition-colors shrink-0"
            style={{ borderColor: 'color-mix(in srgb, var(--color-destructive) 34%, transparent)' }}
            onClick={(e) => { e.stopPropagation(); stopProject(project.id) }}
          >
            <Square className="h-3 w-3" />
            <span className="hidden sm:inline">Stop</span>
          </button>
        ) : (
          <button
            className="h-8 px-3.5 text-xs rounded-full bg-primary text-white hover:bg-primary-hover flex items-center gap-1 font-medium transition-colors shrink-0 shadow-sm"
            onClick={(e) => { e.stopPropagation(); startProject(project.id) }}
          >
            <Play className="h-3 w-3" />
            <span className="hidden sm:inline">Run</span>
          </button>
        )}
        <button
          className="h-8 w-8 rounded-full flex items-center justify-center text-[color:var(--color-muted-foreground)] hover:text-primary hover:bg-[color:var(--color-accent)] transition-colors"
          title="View details"
          onClick={(e) => { e.stopPropagation(); navigate(`/project/${project.id}`) }}
        >
          <FileText className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
          <button
            className="p-1.5 rounded-full text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-warning)] hover:bg-[color:var(--color-warning-background)] transition-colors"
            title={project.pinned ? 'Unpin' : 'Pin'}
            onClick={(e) => { e.stopPropagation(); togglePin(project.id) }}
          >
            <Pin className={`h-3.5 w-3.5 ${project.pinned ? 'fill-[color:var(--color-warning)] text-[color:var(--color-warning)]' : ''}`} />
          </button>
          <button
            className="p-1.5 rounded-full text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-background)] transition-colors"
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
