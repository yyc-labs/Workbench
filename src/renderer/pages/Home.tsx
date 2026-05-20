import { useEffect, useCallback, useState, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import type { ProjectInfo } from '../../shared/types'
import { ProjectCard } from '../components/ProjectCard'
import { WorkspaceClassifierPanel, type ClassifierFilter } from '../components/WorkspaceClassifierPanel'
import { WorkspaceManagerDialog } from '../components/ProjectMetaDialog'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { ScrollArea } from '../components/ui/scroll-area'
import { detectProjectEnvironment, projectEnvironmentLabel, type ProjectEnvironment } from '../lib/projectEnvironment'
import {
  FolderPlus,
  Search,
  Settings,
  Plus,
  Zap,
  Pin,
  FolderOpen,
  SlidersHorizontal,
} from 'lucide-react'

type EnvFilter = 'all' | 'ubuntu' | 'windows'

interface EnvGroup {
  key: EnvFilter | 'other'
  label: string
  projects: ProjectInfo[]
}

type EnvGroupKey = 'ubuntu' | 'windows' | 'other'

// ── Toolbar ──────────────────────────────────────────────────────

function Toolbar({
  searchQuery,
  onSearchChange,
  envFilter,
  onEnvFilterChange,
  envCounts,
  onAddFolder,
  onSettingsClick,
  onManageWorkspace,
  searchRef,
}: {
  searchQuery: string
  onSearchChange: (q: string) => void
  envFilter: EnvFilter
  onEnvFilterChange: (v: EnvFilter) => void
  envCounts: { all: number; ubuntu: number; windows: number }
  onAddFolder: () => void
  onSettingsClick: () => void
  onManageWorkspace: () => void
  searchRef: React.RefObject<HTMLInputElement>
}) {
  const filterButtonClass = (active: boolean): string =>
    active
      ? 'h-7 px-3 rounded-full text-xs font-medium text-[color:var(--color-foreground)] bg-[color:var(--color-card)] shadow-sm border border-[color:var(--color-border)]'
      : 'h-7 px-3 rounded-full text-xs font-medium text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)] border border-transparent'

  return (
    <header
      className="app-chrome h-auto min-h-[68px] flex items-center px-8 py-3 gap-5 shrink-0"
    >
      <div className="flex items-center gap-3 mr-5">
        <div
          className="w-8 h-8 rounded-2xl flex items-center justify-center quiet-control"
          style={{
            color: 'var(--color-primary)',
          }}
        >
          <Zap className="w-4 h-4" strokeWidth={1.8} />
        </div>
        <span className="text-[15px] font-medium text-[color:var(--color-foreground)]">Runtime</span>
      </div>

      <div className="w-full max-w-xl relative">
        <Search
          className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--color-muted-foreground)] pointer-events-none"
          strokeWidth={1.8}
        />
        <Input
          ref={searchRef}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search projects..."
          className="quiet-control h-10 pl-11 text-sm rounded-full border-0 text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
        />
      </div>

      <div className="quiet-control ml-auto flex items-center rounded-full px-1.5 py-1 gap-2.5">
        <div className="flex items-center gap-1.5">
          <button
            className={filterButtonClass(envFilter === 'all')}
            onClick={() => onEnvFilterChange('all')}
            type="button"
          >
            All
          </button>
          <button
            className={filterButtonClass(envFilter === 'ubuntu')}
            onClick={() => onEnvFilterChange('ubuntu')}
            type="button"
          >
            Ubuntu
          </button>
          <button
            className={filterButtonClass(envFilter === 'windows')}
            onClick={() => onEnvFilterChange('windows')}
            type="button"
          >
            Windows
          </button>
        </div>

        <div className="h-6 w-px" style={{ background: 'var(--color-border)' }} />

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]"
            onClick={onManageWorkspace}
            title="Manage folders and tags"
          >
            <SlidersHorizontal className="w-4 h-4" strokeWidth={1.8} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]"
            onClick={onSettingsClick}
          >
            <Settings className="w-4 h-4" strokeWidth={1.8} />
          </Button>
          <Button size="sm" className="h-9 gap-1.5 text-sm rounded-full bg-primary hover:bg-primary-hover text-white shadow-sm" onClick={onAddFolder}>
            <Plus className="w-4 h-4" strokeWidth={1.8} />
            New Project
          </Button>
        </div>
      </div>
    </header>
  )
}

// ── Drag Overlay ─────────────────────────────────────────────────

function DragOverlay() {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center drag-overlay-border border-4 border-dashed rounded-none"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
        borderColor: 'color-mix(in srgb, var(--color-primary) 28%, transparent)',
      }}
    >
      <div className="text-center">
        <div
          className="quiet-control w-20 h-20 mx-auto mb-6 rounded-[28px] flex items-center justify-center"
          style={{ color: 'var(--color-primary)' }}
        >
          <FolderPlus className="w-9 h-9" strokeWidth={1.5} />
        </div>
        <p className="text-xl font-medium text-[color:var(--color-foreground)]">Drop project folders anywhere</p>
        <p className="text-sm text-[color:var(--color-muted-foreground)] mt-2">Release to add to your workspace</p>
      </div>
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────

export function HomePage() {
  const projects = useAppStore((s) => s.projects)
  const folders = useAppStore((s) => s.folders)
  const tags = useAppStore((s) => s.tags)
  const isAppReady = useAppStore((s) => s.isAppReady)
  const config = useAppStore((s) => s.config)
  const sessions = useAppStore((s) => s.sessions)
  const processes = useAppStore((s) => s.processes)
  const searchQuery = useAppStore((s) => s.searchQuery)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const addProject = useAppStore((s) => s.addProject)
  const updateLastOpened = useAppStore((s) => s.updateLastOpened)
  const createFolder = useAppStore((s) => s.createFolder)
  const renameFolder = useAppStore((s) => s.renameFolder)
  const removeFolder = useAppStore((s) => s.removeFolder)
  const reorderFolders = useAppStore((s) => s.reorderFolders)
  const createTag = useAppStore((s) => s.createTag)
  const renameTag = useAppStore((s) => s.renameTag)
  const removeTag = useAppStore((s) => s.removeTag)
  const reorderTags = useAppStore((s) => s.reorderTags)
  const setStartupDefaultFilter = useAppStore((s) => s.setStartupDefaultFilter)
  const navigate = useNavigate()

  const searchRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [envFilter, setEnvFilter] = useState<EnvFilter>('all')
  const [classifierFilter, setClassifierFilter] = useState<ClassifierFilter>({ type: 'all' })
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false)
  const defaultFilterAppliedRef = useRef(false)
  const isDragOverRef = useRef(false)
  const dragHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastDragOverAtRef = useRef(0)

  const setDragOverlay = useCallback((next: boolean) => {
    if (isDragOverRef.current === next) return
    isDragOverRef.current = next
    setIsDragOver(next)
  }, [])

  const stopDragTracking = useCallback(() => {
    if (dragHeartbeatRef.current) {
      clearInterval(dragHeartbeatRef.current)
      dragHeartbeatRef.current = null
    }
    setDragOverlay(false)
  }, [setDragOverlay])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!isAppReady || defaultFilterAppliedRef.current) return
    defaultFilterAppliedRef.current = true

    const defaultFilter = config.startupDefaultFilter
    if (!defaultFilter) return

    if (defaultFilter.type === 'folder') {
      const exists = folders.some((folder) => folder.id === defaultFilter.folderId)
      if (!exists) {
        void setStartupDefaultFilter(undefined)
        return
      }
      setClassifierFilter(defaultFilter)
      return
    }

    if (defaultFilter.type === 'tag') {
      const exists = tags.some((tag) => tag.id === defaultFilter.tagId)
      if (!exists) {
        void setStartupDefaultFilter(undefined)
        return
      }
      setClassifierFilter(defaultFilter)
      return
    }

    setClassifierFilter(defaultFilter)
  }, [config.startupDefaultFilter, folders, isAppReady, setStartupDefaultFilter, tags])

  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      let hasFiles = isDragOverRef.current
      if (!hasFiles) {
        const types = e.dataTransfer?.types
        hasFiles = Boolean(
          types &&
          (types.includes('Files') || (types as unknown as { contains?: (v: string) => boolean }).contains?.('Files'))
        )
      }
      if (!hasFiles) return

      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      setDragOverlay(true)
      lastDragOverAtRef.current = performance.now()

      if (!dragHeartbeatRef.current) {
        dragHeartbeatRef.current = setInterval(() => {
          if (performance.now() - lastDragOverAtRef.current > 180) {
            stopDragTracking()
          }
        }, 120)
      }
    }

    const onDrop = async (e: DragEvent) => {
      e.preventDefault()
      stopDragTracking()
      const files = e.dataTransfer?.files
      if (!files || files.length === 0) return

      const api = window.electronAPI as unknown as {
        getPathForFile?: (file: File) => string
      }
      const getPathForFile = typeof api.getPathForFile === 'function' ? api.getPathForFile : undefined

      const pathSet = new Set<string>()
      for (let i = 0; i < files.length; i++) {
        const file = files[i] as File & { path?: string }
        const fromWebUtils = getPathForFile ? getPathForFile(file) : ''
        const resolvedPath = fromWebUtils || file.path || ''
        if (resolvedPath) {
          pathSet.add(resolvedPath)
        }
      }

      for (const p of pathSet) {
        try {
          await addProject(p)
        } catch (err) {
          console.error('[HomePage] drop addProject failed:', p, err)
        }
      }
    }

    const onWindowBlur = () => {
      stopDragTracking()
    }

    document.addEventListener('dragover', onDragOver)
    document.addEventListener('drop', onDrop)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('drop', onDrop)
      window.removeEventListener('blur', onWindowBlur)
      stopDragTracking()
    }
  }, [addProject, setDragOverlay, stopDragTracking])

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects
    const q = searchQuery.toLowerCase().trim()
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.path.toLowerCase().includes(q) ||
        p.type.toLowerCase().includes(q)
    )
  }, [projects, searchQuery])

  const envByPath = useMemo(() => {
    const map = new Map<string, ProjectEnvironment>()
    for (const p of filteredProjects) {
      map.set(p.path, detectProjectEnvironment(p.path))
    }
    return map
  }, [filteredProjects])

  const envCounts = useMemo(() => {
    let ubuntu = 0
    let windows = 0
    for (const p of filteredProjects) {
      const env = envByPath.get(p.path)
      if (env === 'ubuntu') ubuntu++
      else if (env === 'windows') windows++
    }
    return {
      all: filteredProjects.length,
      ubuntu,
      windows,
    }
  }, [filteredProjects, envByPath])

  const envFilteredProjects = useMemo(() => {
    if (envFilter === 'all') return filteredProjects
    return filteredProjects.filter((p) => envByPath.get(p.path) === envFilter)
  }, [filteredProjects, envFilter, envByPath])

  const filteredByClassifier = useMemo(() => {
    switch (classifierFilter.type) {
      case 'all':
        return envFilteredProjects
      case 'pinned':
        return envFilteredProjects.filter((p) => Boolean(p.pinned))
      case 'running':
        return envFilteredProjects.filter((p) => processes[p.id]?.status === 'running')
      case 'uncategorized':
        return envFilteredProjects.filter((p) => !p.folderId)
      case 'folder':
        return envFilteredProjects.filter((p) => p.folderId === classifierFilter.folderId)
      case 'tag':
        return envFilteredProjects.filter((p) => (p.tagIds ?? []).includes(classifierFilter.tagId))
      default:
        return envFilteredProjects
    }
  }, [classifierFilter, envFilteredProjects, processes])

  const pinnedProjects = useMemo(() => filteredByClassifier.filter((p) => p.pinned), [filteredByClassifier])
  const recentProjects = useMemo(() => filteredByClassifier.filter((p) => !p.pinned), [filteredByClassifier])

  const groupedRecentProjects = useMemo(() => {
    const groupOrder: EnvGroupKey[] = ['ubuntu', 'windows', 'other']
    const groups: Record<EnvGroupKey, EnvGroup> = {
      ubuntu: { key: 'ubuntu', label: projectEnvironmentLabel('ubuntu'), projects: [] },
      windows: { key: 'windows', label: projectEnvironmentLabel('windows'), projects: [] },
      other: { key: 'other', label: 'Other', projects: [] },
    }

    for (const p of recentProjects) {
      const env = envByPath.get(p.path) ?? 'unknown'
      if (env === 'ubuntu' || env === 'windows') {
        groups[env].projects.push(p)
      } else {
        groups.other.projects.push(p)
      }
    }

    return groupOrder
      .map((k) => groups[k])
      .filter((g) => g.projects.length > 0)
  }, [recentProjects, envByPath])

  const runningCount = useMemo(
    () => Object.values(sessions).filter((s) => s.status !== 'stopped').length,
    [sessions]
  )

  const classifierCounts = useMemo(() => {
    const byFolder: Record<string, number> = {}
    const byTag: Record<string, number> = {}

    for (const p of envFilteredProjects) {
      if (p.folderId) {
        byFolder[p.folderId] = (byFolder[p.folderId] ?? 0) + 1
      }
      for (const tagId of p.tagIds ?? []) {
        byTag[tagId] = (byTag[tagId] ?? 0) + 1
      }
    }

    return {
      all: envFilteredProjects.length,
      pinned: envFilteredProjects.filter((p) => Boolean(p.pinned)).length,
      running: envFilteredProjects.filter((p) => processes[p.id]?.status === 'running').length,
      uncategorized: envFilteredProjects.filter((p) => !p.folderId).length,
      byFolder,
      byTag,
    }
  }, [envFilteredProjects, processes])

  const handleAddFolder = useCallback(async () => {
    const dirPath = await window.electronAPI.selectDirectory()
    if (dirPath) await addProject(dirPath)
  }, [addProject])

  const handleSelect = useCallback(
    (id: string) => {
      updateLastOpened(id)
      navigate(`/runtime/${id}`)
    },
    [updateLastOpened, navigate]
  )

  // ── Empty state ──
  if (!isAppReady) {
    return <div className="h-screen" />
  }

  if (projects.length === 0) {
    return (
      <div className="h-screen flex flex-col">
        {isDragOver && <DragOverlay />}
        <header
          className="app-chrome min-h-[76px] flex items-center px-8 shrink-0"
        >
          <div className="flex items-center gap-3">
            <div
              className="quiet-control w-8 h-8 rounded-2xl flex items-center justify-center"
              style={{
                color: 'var(--color-primary)',
              }}
            >
              <Zap className="w-4 h-4" strokeWidth={1.8} />
            </div>
            <span className="text-[15px] font-medium text-[color:var(--color-foreground)]">Runtime</span>
          </div>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]"
            onClick={() => navigate('/settings')}
          >
            <Settings className="w-4 h-4" strokeWidth={1.8} />
          </Button>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="flex flex-col items-center gap-8 max-w-md text-center px-8">
            <div
              className="w-24 h-24 rounded-[32px] border flex items-center justify-center surface-card"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <FolderPlus className="w-11 h-11 text-[color:var(--color-muted-foreground)]" strokeWidth={1.35} />
            </div>
            <div>
              <h1 className="text-[28px] font-semibold tracking-[-0.03em] text-[color:var(--color-foreground)] mb-3">Add a project folder</h1>
              <p className="text-sm leading-6 text-[color:var(--color-muted-foreground)]">Drop a folder or browse to get started. The launcher will keep the workspace quiet and close at hand.</p>
            </div>
            <Button onClick={handleAddFolder} className="gap-2 rounded-full h-11 px-6 bg-primary hover:bg-primary-hover text-white shadow-sm" size="lg">
              <Plus className="w-4 h-4" strokeWidth={1.8} />
              Add Project Folder
            </Button>
            <p className="text-xs leading-5 text-[color:var(--color-muted-foreground)]">
              Node.js &middot; Python &middot; Android &middot; Vite &middot; Next.js &middot; Django &middot; more
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── Populated state ──
  return (
    <div className="h-screen flex flex-col">
      {isDragOver && <DragOverlay />}
      <Toolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        envFilter={envFilter}
        onEnvFilterChange={setEnvFilter}
        envCounts={envCounts}
        onAddFolder={handleAddFolder}
        onSettingsClick={() => navigate('/settings')}
        onManageWorkspace={() => setWorkspaceDialogOpen(true)}
        searchRef={searchRef}
      />
      <ScrollArea className="flex-1">
        <div className="content-breathe">
          <div className="mb-8 flex items-end justify-between gap-6">
            <div>
              <p className="section-label mb-2">Workspace</p>
              <h1 className="text-[28px] font-semibold tracking-[-0.035em] text-[color:var(--color-foreground)]">Projects</h1>
            </div>
            <p className="mb-1 flex items-center gap-2 text-[13px] text-[color:var(--color-muted-foreground)]">
              <span>{envFilteredProjects.length} project{envFilteredProjects.length !== 1 ? 's' : ''}</span>
              {runningCount > 0 && (
                <>
                  <span className="text-[color:var(--color-muted-foreground)]/70">&middot;</span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--color-success)]" />
                    {runningCount} runtime{runningCount !== 1 ? 's' : ''} active
                  </span>
                </>
              )}
            </p>
          </div>

          <div className="flex flex-col gap-5 md:flex-row md:items-start">
            <WorkspaceClassifierPanel
              folders={folders}
              tags={tags}
              activeFilter={classifierFilter}
              counts={classifierCounts}
              onChangeFilter={setClassifierFilter}
              onReorderFolders={reorderFolders}
              onReorderTags={reorderTags}
              startupDefaultFilter={config.startupDefaultFilter}
              onSetStartupDefaultFilter={setStartupDefaultFilter}
            />

            <div className="min-w-0 flex-1">
              {pinnedProjects.length > 0 && (
                <div className="mb-9">
                  <div className="flex items-center gap-2.5 mb-3">
                    <Pin className="w-3.5 h-3.5 text-[color:var(--color-warning)]" strokeWidth={1.8} />
                    <h2 className="section-label">Pinned</h2>
                    <span className="text-[10px] text-[color:var(--color-muted-foreground)]">{pinnedProjects.length}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {pinnedProjects.map((project, index) => (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        folders={folders}
                        tags={tags}
                        index={index}
                        onSelect={handleSelect}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center gap-2.5 mb-3">
                  <FolderOpen className="w-3.5 h-3.5 text-[color:var(--color-muted-foreground)]" strokeWidth={1.8} />
                  <h2 className="section-label">
                    {pinnedProjects.length > 0 ? 'Projects' : 'Project Groups'}
                  </h2>
                  <span className="text-[10px] text-[color:var(--color-muted-foreground)]">{recentProjects.length}</span>
                </div>
                {groupedRecentProjects.length > 0 ? (
                  <div className="space-y-7">
                    {groupedRecentProjects.map((group) => (
                      <section key={group.key}>
                        <div className="flex items-center gap-2 mb-3">
                          <h3 className="text-[12px] font-medium text-[color:var(--color-muted-foreground)]">
                            {group.label}
                          </h3>
                          <span className="text-[10px] text-[color:var(--color-muted-foreground)]">
                            {group.projects.length}
                          </span>
                        </div>
                        <div className="flex flex-col gap-2">
                          {group.projects.map((project, index) => (
                            <ProjectCard
                              key={project.id}
                              project={project}
                              folders={folders}
                              tags={tags}
                              index={index}
                              onSelect={handleSelect}
                            />
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-16 text-sm text-[color:var(--color-muted-foreground)]">
                    {searchQuery || envFilter !== 'all'
                      ? 'No projects match your search/filter'
                      : 'No projects yet'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>

      {workspaceDialogOpen && (
        <WorkspaceManagerDialog
          folders={folders}
          tags={tags}
          onClose={() => setWorkspaceDialogOpen(false)}
          onCreateFolder={createFolder}
          onRenameFolder={renameFolder}
          onRemoveFolder={removeFolder}
          onCreateTag={createTag}
          onRenameTag={renameTag}
          onRemoveTag={removeTag}
        />
      )}
    </div>
  )
}
