import { memo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ProjectInfo, CliTool, ProjectFolder, ProjectTag } from '../../shared/types'
import { useAppStore } from '../stores/appStore'
import { Play, Square, Folder, FileText, Sparkles, Terminal, MoreHorizontal, BookOpen } from 'lucide-react'
import { UrlPopover } from './UrlPopover'
import { CardContextMenu } from './CardContextMenu'
import { ProjectMetaDialog } from './ProjectMetaDialog'

interface ProjectCardProps {
  project: ProjectInfo
  folders?: ProjectFolder[]
  tags?: ProjectTag[]
  onSelect: (id: string) => void
  index?: number
}

function ProjectCardInner({ project, folders = [], tags = [], onSelect, index = 0 }: ProjectCardProps) {
  const navigate = useNavigate()

  const devStatus = useAppStore((s) => s.processes[project.id]?.status ?? 'stopped')
  const devUrls = useAppStore((s) => s.processUrls[project.id] || [])
  const startProject = useAppStore((s) => s.startProject)
  const stopProject = useAppStore((s) => s.stopProject)
  const startRuntime = useAppStore((s) => s.startRuntime)
  const stopRuntime = useAppStore((s) => s.stopRuntime)
  const openTerminal = useAppStore((s) => s.openTerminal)
  const setProjectCli = useAppStore((s) => s.setProjectCli)
  const assignProjectFolder = useAppStore((s) => s.assignProjectFolder)
  const setProjectTags = useAppStore((s) => s.setProjectTags)

  const currentCli: CliTool = project.cli || 'claude'

  const session = useAppStore((s) => s.sessions[project.id])
  const isRuntimeAttached = session?.status === 'attached'
  const isRuntimeDetached = session?.status === 'detached'
  const isRuntimeActive = isRuntimeAttached || isRuntimeDetached
  const runtimeLabel = isRuntimeAttached ? 'Active' : isRuntimeDetached ? 'Background' : 'Offline'
  const accentColor = isRuntimeAttached
    ? 'var(--color-success)'
    : isRuntimeDetached
      ? 'var(--color-warning)'
      : 'var(--color-primary)'
  const runtimeColorClass = isRuntimeAttached
    ? 'text-[color:var(--color-success)]'
    : isRuntimeDetached
      ? 'text-[color:var(--color-warning)]'
      : 'text-[color:var(--color-muted-foreground)]'
  const runtimeDotClass = isRuntimeAttached
    ? 'bg-[color:var(--color-success)]'
    : isRuntimeDetached
      ? 'bg-[color:var(--color-warning)]'
      : 'bg-[color:var(--color-muted-foreground)]/45'

  const handleSwitchCli = useCallback(() => {
    setProjectCli(project.id, currentCli === 'codex' ? 'claude' : 'codex')
  }, [project.id, currentCli, setProjectCli])

  const togglePin = useAppStore((s) => s.togglePin)
  const removeProject = useAppStore((s) => s.removeProject)
  const isDevRunning = devStatus === 'running'
  const docLinks = project.docLinks ?? []
  const defaultDocLink = docLinks[0]
  const linkMenuItems = [
    ...(isDevRunning ? devUrls.map((url) => ({ url, label: `Dev: ${url}` })) : []),
    ...docLinks.map((link) => ({ url: link.url, label: `Docs: ${link.title}` })),
  ]
  const firstLinkMenuItem = linkMenuItems[0]
  const hoverDocLabel = defaultDocLink
    ? `Docs: ${defaultDocLink.title}`
    : docLinks.length > 0
      ? `${docLinks.length} docs`
      : null

  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [isOpeningTerminal, setIsOpeningTerminal] = useState(false)
  const [metaDialogOpen, setMetaDialogOpen] = useState(false)

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
      className="group relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 overflow-hidden rounded-[18px] px-4 py-3 cursor-pointer card-enter surface-card surface-card-hover"
      style={{
        animationDelay: `${index * 40}ms`,
        background: 'var(--color-card)',
        border: '1px solid var(--color-border)',
        backdropFilter: 'saturate(150%) blur(18px)',
        WebkitBackdropFilter: 'saturate(150%) blur(18px)',
        boxShadow: 'var(--shadow-card)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'color-mix(in srgb, var(--color-card) 88%, var(--color-primary) 5%)'
        e.currentTarget.style.borderColor = 'var(--color-border-hover)'
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.boxShadow = 'var(--shadow-card-hover)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--color-card)'
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = 'var(--shadow-card)'
      }}
      onClick={() => onSelect(project.id)}
      onContextMenu={(e) => { e.preventDefault(); setMenuPos({ x: e.clientX, y: e.clientY }) }}
    >
      <div
        className="pointer-events-none absolute inset-y-3 left-0 w-1 rounded-r-full opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: accentColor }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: 'linear-gradient(90deg, color-mix(in srgb, var(--color-primary) 7%, transparent), transparent 44%)',
        }}
      />
      <div
        className="quiet-control relative z-10 w-10 h-10 rounded-[14px] flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-[1.04]"
        style={{
          color: 'var(--color-primary)',
        }}
      >
        <Folder className="h-[18px] w-[18px]" strokeWidth={1.7} />
      </div>

      <div className="relative z-10 flex-1 min-w-0">
        <div className="flex min-w-0 items-center gap-2.5">
          <h3 className="text-[15px] font-medium text-[color:var(--color-foreground)] truncate">{project.name}</h3>
          {project.pinned && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--color-warning)]" title="Pinned" />
          )}
          <span className={`inline-flex items-center gap-1 text-[10px] font-medium shrink-0 ${runtimeColorClass}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${runtimeDotClass}`} />
            {runtimeLabel}
          </span>
          {isDevRunning && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              Dev
            </span>
          )}
        </div>
        {project.tagIds && project.tagIds.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {project.tagIds.slice(0, 3).map((tagId) => {
              const tag = tags.find((item) => item.id === tagId)
              if (!tag) return null
              return (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[10px] text-[color:var(--color-muted-foreground)]"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: tag.color || 'var(--color-primary)' }}
                  />
                  {tag.name}
                </span>
              )
            })}
            {project.tagIds.length > 3 && (
              <span className="text-[10px] text-[color:var(--color-muted-foreground)]">
                +{project.tagIds.length - 3}
              </span>
            )}
          </div>
        )}
        <div className="mt-1.5 flex min-w-0 items-center gap-2 text-xs text-[color:var(--color-muted-foreground)]">
          <p className="truncate" title={project.path}>{project.path}</p>
          <span className="shrink-0 text-[color:var(--color-muted-foreground)]/45">/</span>
          <span className="shrink-0 capitalize">{project.type}</span>
          {project.packageManager && (
            <>
              <span className="shrink-0 text-[color:var(--color-muted-foreground)]/45">/</span>
              <span className="shrink-0">{project.packageManager}</span>
            </>
          )}
          {isRuntimeActive && session && (
            <>
              <span className="hidden shrink-0 text-[color:var(--color-muted-foreground)]/45 opacity-0 transition-opacity duration-300 group-hover:opacity-100 md:inline">/</span>
              <span className="hidden max-w-0 shrink items-center gap-1 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-300 group-hover:max-w-[220px] group-hover:opacity-100 md:inline-flex">
                <Terminal className="h-3 w-3 shrink-0" />
                <span className="truncate">{session.sessionName}</span>
              </span>
            </>
          )}
          {hoverDocLabel && (
            <>
              <span className="hidden shrink-0 text-[color:var(--color-muted-foreground)]/45 opacity-0 transition-opacity duration-300 group-hover:opacity-100 lg:inline">/</span>
              <span className="hidden max-w-0 shrink items-center gap-1 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-300 group-hover:max-w-[180px] group-hover:opacity-100 lg:inline-flex">
                <BookOpen className="h-3 w-3 shrink-0" />
                <span className="truncate">{hoverDocLabel}</span>
              </span>
            </>
          )}
        </div>
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
          isPinned={project.pinned}
          onStartRuntime={() => startRuntime(project.id)}
          onStopRuntime={() => stopRuntime(project.id)}
          onOpenTerminal={handleOpenTerminal}
          onSwitchCli={handleSwitchCli}
          onStartProject={() => startProject(project.id)}
          onStopProject={() => stopProject(project.id)}
          onOpenFolder={() => window.electronAPI.openFolder(project.path)}
          onOpenVsCode={() => window.electronAPI.openInVsCode(project.path)}
          onTogglePin={() => togglePin(project.id)}
          onRemoveProject={() => removeProject(project.id)}
          onEditMetadata={() => setMetaDialogOpen(true)}
        />
      )}

      {metaDialogOpen && (
        <ProjectMetaDialog
          project={project}
          folders={folders}
          tags={tags}
          onClose={() => setMetaDialogOpen(false)}
          onAssignFolder={assignProjectFolder}
          onSetProjectTags={setProjectTags}
        />
      )}

      <div className="relative z-10 flex items-center gap-1.5 shrink-0">
        <button
          className="quiet-control hidden h-8 items-center gap-1 rounded-full border-0 px-2.5 text-[11px] font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] md:inline-flex"
          onClick={(e) => { e.stopPropagation(); handleSwitchCli() }}
          title={`AI CLI: ${currentCli}`}
        >
          {currentCli === 'codex' ? (
            <Terminal className="h-3 w-3" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          {currentCli}
        </button>
        {firstLinkMenuItem && (
          <UrlPopover items={linkMenuItems}>
            <button
              className="quiet-control inline-flex h-8 w-8 items-center justify-center rounded-full border-0 text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] cursor-pointer"
              onClick={(e) => { e.stopPropagation(); window.electronAPI.openExternal(firstLinkMenuItem.url) }}
              title="Project links"
            >
              <BookOpen className="h-3.5 w-3.5 shrink-0" />
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
        <button
          className="h-8 w-8 rounded-full flex items-center justify-center text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)] transition-colors"
          title="More actions"
          onClick={(e) => { e.stopPropagation(); setMenuPos({ x: e.clientX, y: e.clientY }) }}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

export const ProjectCard = memo(ProjectCardInner)
