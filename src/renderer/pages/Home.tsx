import { useEffect, useCallback, useState, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { ProjectCard } from '../components/ProjectCard'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { ScrollArea } from '../components/ui/scroll-area'
import {
  FolderPlus,
  Search,
  Settings,
  Pin,
  Plus,
  FolderOpen,
  Command,
} from 'lucide-react'

// ── Sub-components ──────────────────────────────────────────────

function Toolbar({
  searchQuery,
  onSearchChange,
  onAddFolder,
  onSettingsClick,
  searchRef,
}: {
  searchQuery: string
  onSearchChange: (q: string) => void
  onAddFolder: () => void
  onSettingsClick: () => void
  searchRef: React.RefObject<HTMLInputElement>
}) {
  return (
    <div className="h-12 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-lg flex items-center px-4 gap-3 shrink-0">
      {/* Logo + app name */}
      <div className="flex items-center gap-2 mr-2">
        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
          <span className="text-[10px] font-bold text-white">L</span>
        </div>
        <span className="text-sm font-medium text-zinc-300">Launcher</span>
      </div>

      {/* Search */}
      <div className="flex-1 max-w-md relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
        <Input
          ref={searchRef}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search projects..."
          className="h-8 pl-8 pr-16 text-xs bg-zinc-800/50 border-zinc-700/50 text-zinc-300 placeholder:text-zinc-500 rounded-md focus-visible:ring-amber-500/30"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 text-[10px] text-zinc-600 select-none pointer-events-none">
          <Command className="w-3 h-3" />
          <span>K</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onSettingsClick}
        >
          <Settings className="w-4 h-4 text-zinc-400" />
        </Button>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={onAddFolder}>
          <Plus className="w-3.5 h-3.5" />
          Add
        </Button>
      </div>
    </div>
  )
}

function Section({
  title,
  icon,
  children,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h2 className="text-sm font-medium text-zinc-400">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function ProjectGrid({
  projects,
  onSelect,
}: {
  projects: ReturnType<typeof useAppStore.getState>['projects']
  onSelect: (id: string) => void
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
      {projects.map((project, index) => (
        <ProjectCard
          key={project.id}
          project={project}
          index={index}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

function DragOverlay() {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center drag-overlay-border border-4 border-dashed rounded-none"
      style={{
        backgroundColor: 'rgba(245, 158, 11, 0.03)',
        borderColor: 'rgba(245, 158, 11, 0.3)',
      }}
    >
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-500/10 flex items-center justify-center">
          <FolderPlus className="w-8 h-8 text-amber-400" />
        </div>
        <p className="text-lg font-medium text-amber-300">
          Drop project folders anywhere
        </p>
        <p className="text-sm text-amber-600 mt-1">
          Release to add to your workspace
        </p>
      </div>
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────

export function HomePage() {
  const projects = useAppStore((s) => s.projects)
  const processes = useAppStore((s) => s.processes)
  const searchQuery = useAppStore((s) => s.searchQuery)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const addProject = useAppStore((s) => s.addProject)
  const loadConfig = useAppStore((s) => s.loadConfig)
  const updateLastOpened = useAppStore((s) => s.updateLastOpened)
  const navigate = useNavigate()

  const searchRef = useRef<HTMLInputElement>(null)

  // Drag overlay state (counter pattern to handle child elements)
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounter = useRef(0)

  // ── Load saved config on mount ──
  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // ── Keyboard: Cmd+K / Ctrl+K focuses search ──
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

  // ── Document-level drag events ──
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault()
      dragCounter.current++
      setIsDragOver(true)
    }
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault()
      dragCounter.current--
      if (dragCounter.current === 0) setIsDragOver(false)
    }
    const onDragOver = (e: DragEvent) => {
      e.preventDefault()
    }
    const onDrop = async (e: DragEvent) => {
      e.preventDefault()
      dragCounter.current = 0
      setIsDragOver(false)
      const files = e.dataTransfer?.files
      if (files) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i] as File & { path?: string }
          if (file.path) {
            await addProject(file.path)
          }
        }
      }
    }
    const onDragEnd = () => {
      dragCounter.current = 0
      setIsDragOver(false)
    }

    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    document.addEventListener('dragend', onDragEnd)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
      document.removeEventListener('dragend', onDragEnd)
    }
  }, [addProject])

  // ── Derived data ──
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

  const pinnedProjects = useMemo(
    () => filteredProjects.filter((p) => p.pinned),
    [filteredProjects]
  )
  const recentProjects = useMemo(
    () => filteredProjects.filter((p) => !p.pinned),
    [filteredProjects]
  )
  const runningCount = useMemo(
    () =>
      Object.values(processes).filter((p) => p.status === 'running').length,
    [processes]
  )

  // ── Handlers ──
  const handleAddFolder = useCallback(async () => {
    const dirPath = await window.electronAPI.selectDirectory()
    if (dirPath) {
      await addProject(dirPath)
    }
  }, [addProject])

  const handleSelect = useCallback(
    (id: string) => {
      updateLastOpened(id)
      navigate(`/project/${id}`)
    },
    [updateLastOpened, navigate]
  )

  // ── Empty state ──
  if (projects.length === 0) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-zinc-950">
        {isDragOver && <DragOverlay />}

        <div className="flex flex-col items-center gap-6 max-w-md text-center px-6">
          <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
            <FolderPlus className="w-8 h-8 text-zinc-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-zinc-100 mb-2">
              Drop your project folder here
            </h1>
            <p className="text-sm text-zinc-500">
              or browse to add a project
            </p>
          </div>
          <Button onClick={handleAddFolder} className="gap-2">
            <Plus className="w-4 h-4" />
            Add Project Folder
          </Button>
          <p className="text-xs text-zinc-700">
            Supports: Node.js &middot; Python &middot; Vite &middot; Next.js
            &middot; Django &middot; more
          </p>
        </div>
      </div>
    )
  }

  // ── Populated state ──
  return (
    <div className="h-screen flex flex-col bg-zinc-950">
      {isDragOver && <DragOverlay />}

      <Toolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onAddFolder={handleAddFolder}
        onSettingsClick={() => navigate('/settings')}
        searchRef={searchRef}
      />

      <ScrollArea className="flex-1">
        <div className="max-w-6xl mx-auto w-full px-6 py-6">
          {/* Welcome */}
          <div className="mb-8">
            <h1 className="text-2xl font-semibold text-zinc-100">
              Welcome back
            </h1>
            <p className="text-sm text-zinc-500 mt-1">
              {projects.length} project{projects.length !== 1 ? 's' : ''}
              {runningCount > 0 && (
                <>
                  {' '}
                  &middot;{' '}
                  <span className="text-green-400">{runningCount} running</span>
                </>
              )}
            </p>
          </div>

          {/* Favorites section */}
          {pinnedProjects.length > 0 && (
            <Section
              title="Favorites"
              icon={<Pin className="w-4 h-4 text-amber-400" />}
            >
              <ProjectGrid
                projects={pinnedProjects}
                onSelect={handleSelect}
              />
            </Section>
          )}

          {/* Recent / All Projects section */}
          <Section
            title={
              pinnedProjects.length > 0 ? 'All Projects' : 'Recent Projects'
            }
            icon={<FolderOpen className="w-4 h-4 text-zinc-400" />}
          >
            {recentProjects.length > 0 ? (
              <ProjectGrid
                projects={recentProjects}
                onSelect={handleSelect}
              />
            ) : (
              <div className="text-center py-12 text-zinc-600 text-sm">
                {searchQuery
                  ? 'No projects match your search'
                  : 'No projects yet'}
              </div>
            )}
          </Section>
        </div>
      </ScrollArea>
    </div>
  )
}
