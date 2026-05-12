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

// ── Toolbar ──────────────────────────────────────────────────────

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
    <header className="h-16 bg-white border-b border-gray-200 flex items-center px-6 gap-4 shrink-0">
      {/* Logo + app name */}
      <div className="flex items-center gap-2.5 mr-4">
        <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
          <span className="text-[11px] font-bold text-white">L</span>
        </div>
        <span className="text-sm font-semibold text-gray-900">Launcher</span>
      </div>

      {/* Search */}
      <div className="flex-1 max-w-lg relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" strokeWidth={1.8} />
        <Input
          ref={searchRef}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search projects..."
          className="h-9 pl-9 pr-16 text-sm bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400 rounded-xl focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-0"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[10px] text-gray-400 select-none pointer-events-none bg-gray-100 px-1.5 py-0.5 rounded">
          <Command className="w-3 h-3" strokeWidth={1.8} />
          <span>K</span>
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onSettingsClick}
        >
          <Settings className="w-4 h-4 text-gray-500" strokeWidth={1.8} />
        </Button>
        <Button size="sm" className="h-9 gap-1.5 text-sm rounded-xl" onClick={onAddFolder}>
          <Plus className="w-4 h-4" strokeWidth={1.8} />
          New Project
        </Button>
      </div>
    </header>
  )
}

// ── Section ──────────────────────────────────────────────────────

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
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          {title}
        </h2>
      </div>
      {children}
    </div>
  )
}

// ── Project Grid ─────────────────────────────────────────────────

function ProjectGrid({
  projects,
  onSelect,
}: {
  projects: ReturnType<typeof useAppStore.getState>['projects']
  onSelect: (id: string) => void
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
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

// ── Drag Overlay ─────────────────────────────────────────────────

function DragOverlay() {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center drag-overlay-border border-4 border-dashed rounded-none"
      style={{
        backgroundColor: 'rgba(37, 99, 235, 0.03)',
        borderColor: 'rgba(37, 99, 235, 0.25)',
      }}
    >
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-blue-50 flex items-center justify-center">
          <FolderPlus className="w-8 h-8 text-blue-600" strokeWidth={1.5} />
        </div>
        <p className="text-lg font-medium text-blue-600">
          Drop project folders anywhere
        </p>
        <p className="text-sm text-gray-500 mt-1">
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
  const appendOutput = useAppStore((s) => s.appendOutput)
  const updateLastOpened = useAppStore((s) => s.updateLastOpened)
  const navigate = useNavigate()

  const searchRef = useRef<HTMLInputElement>(null)

  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounter = useRef(0)

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

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

  // ── Listen for process output globally (needed for card URL detection) ──
  useEffect(() => {
    const cleanup = window.electronAPI.onProcessOutput(({ projectId, data }) => {
      const normalized = data.replace(/\r?\n/g, '\r\n')
      appendOutput(projectId, normalized)
    })
    return cleanup
  }, [appendOutput])

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
      <div className="h-screen flex flex-col bg-[#f6f8fb]">
        {isDragOver && <DragOverlay />}

        {/* Minimal toolbar */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center px-6 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <span className="text-[11px] font-bold text-white">L</span>
            </div>
            <span className="text-sm font-semibold text-gray-900">Launcher</span>
          </div>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => navigate('/settings')}
          >
            <Settings className="w-4 h-4 text-gray-500" strokeWidth={1.8} />
          </Button>
        </header>

        {/* Empty content */}
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="flex flex-col items-center gap-6 max-w-md text-center px-6">
            <div className="w-20 h-20 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-center">
              <FolderPlus className="w-10 h-10 text-gray-300" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900 mb-2">
                Drop your project folder here
              </h1>
              <p className="text-sm text-gray-500">
                or browse to add a project
              </p>
            </div>
            <Button onClick={handleAddFolder} className="gap-2 rounded-xl h-10 px-5" size="lg">
              <Plus className="w-4 h-4" strokeWidth={1.8} />
              Add Project Folder
            </Button>
            <p className="text-xs text-gray-400">
              Supports: Node.js &middot; Python &middot; Vite &middot; Next.js
              &middot; Django &middot; more
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── Populated state ──
  return (
    <div className="h-screen flex flex-col bg-[#f6f8fb]">
      {isDragOver && <DragOverlay />}

      <Toolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onAddFolder={handleAddFolder}
        onSettingsClick={() => navigate('/settings')}
        searchRef={searchRef}
      />

      <ScrollArea className="flex-1">
        <div className="max-w-5xl mx-auto w-full px-8 py-8">
          {/* Welcome */}
          <div className="mb-8">
            <h1 className="text-lg font-semibold text-gray-900">
              Welcome back
            </h1>
            <p className="text-sm text-gray-500 mt-1 flex items-center gap-2">
              <span>
                {projects.length} project{projects.length !== 1 ? 's' : ''}
              </span>
              {runningCount > 0 && (
                <>
                  <span className="text-gray-200">&middot;</span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    {runningCount} running
                  </span>
                </>
              )}
            </p>
          </div>

          {/* Favorites section */}
          {pinnedProjects.length > 0 && (
            <Section
              title="Favorites"
              icon={<Pin className="w-3.5 h-3.5 text-amber-500" strokeWidth={1.8} />}
            >
              <ProjectGrid
                projects={pinnedProjects}
                onSelect={handleSelect}
              />
            </Section>
          )}

          {/* All Projects section */}
          <Section
            title={
              pinnedProjects.length > 0 ? 'All Projects' : 'Recent Projects'
            }
            icon={<FolderOpen className="w-3.5 h-3.5 text-gray-500" strokeWidth={1.8} />}
          >
            {recentProjects.length > 0 ? (
              <ProjectGrid
                projects={recentProjects}
                onSelect={handleSelect}
              />
            ) : (
              <div className="text-center py-16 text-sm text-gray-400">
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
