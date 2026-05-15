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
  Plus,
  Zap,
  Pin,
  FolderOpen,
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
    <header
      className="h-14 flex items-center px-6 gap-4 shrink-0 border-b"
      style={{
        background: 'var(--color-card)',
        borderBottomColor: 'var(--color-border)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}
    >
      <div className="flex items-center gap-2.5 mr-4">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shadow-sm"
          style={{ background: 'linear-gradient(135deg, #635bff 0%, #554ee8 100%)' }}
        >
          <Zap className="w-4 h-4 text-white" />
        </div>
        <span className="text-sm font-semibold text-[color:var(--color-foreground)]">Runtime</span>
      </div>

      <div className="flex-1 max-w-lg relative">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--color-muted-foreground)] pointer-events-none"
          strokeWidth={1.8}
        />
        <Input
          ref={searchRef}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search projects..."
          className="h-9 pl-9 text-sm rounded-xl border bg-[color:var(--color-background-sunken)] border-[color:var(--color-border)] text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
        />
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]"
          onClick={onSettingsClick}
        >
          <Settings className="w-4 h-4" strokeWidth={1.8} />
        </Button>
        <Button size="sm" className="h-9 gap-1.5 text-sm rounded-xl bg-primary hover:bg-primary-hover text-white shadow-sm" onClick={onAddFolder}>
          <Plus className="w-4 h-4" strokeWidth={1.8} />
          New Project
        </Button>
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
        backgroundColor: 'rgba(99, 91, 255, 0.05)',
        borderColor: 'rgba(99, 91, 255, 0.2)',
      }}
    >
      <div className="text-center">
        <div
          className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center"
          style={{ background: 'rgba(99, 91, 255, 0.12)' }}
        >
          <FolderPlus className="w-8 h-8 text-primary" strokeWidth={1.5} />
        </div>
        <p className="text-lg font-medium text-primary">Drop project folders anywhere</p>
        <p className="text-sm text-[color:var(--color-muted-foreground)] mt-1">Release to add to your workspace</p>
      </div>
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────

export function HomePage() {
  const projects = useAppStore((s) => s.projects)
  const sessions = useAppStore((s) => s.sessions)
  const searchQuery = useAppStore((s) => s.searchQuery)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const addProject = useAppStore((s) => s.addProject)
  const loadConfig = useAppStore((s) => s.loadConfig)
  const updateLastOpened = useAppStore((s) => s.updateLastOpened)
  const navigate = useNavigate()

  const searchRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounter = useRef(0)

  useEffect(() => { loadConfig() }, [loadConfig])

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
    const onDragOver = (e: DragEvent) => { e.preventDefault() }
    const onDrop = async (e: DragEvent) => {
      e.preventDefault()
      dragCounter.current = 0
      setIsDragOver(false)
      const files = e.dataTransfer?.files
      if (files) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i] as File & { path?: string }
          if (file.path) await addProject(file.path)
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

  const pinnedProjects = useMemo(() => filteredProjects.filter((p) => p.pinned), [filteredProjects])
  const recentProjects = useMemo(() => filteredProjects.filter((p) => !p.pinned), [filteredProjects])
  const runningCount = useMemo(
    () => Object.values(sessions).filter((s) => s.status !== 'stopped').length,
    [sessions]
  )

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
  if (projects.length === 0) {
    return (
      <div className="h-screen flex flex-col">
        {isDragOver && <DragOverlay />}
        <header
          className="h-14 flex items-center px-6 shrink-0 border-b"
          style={{
            background: 'var(--color-card)',
            borderBottomColor: 'var(--color-border)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
          }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center shadow-sm"
              style={{ background: 'linear-gradient(135deg, #635bff 0%, #554ee8 100%)' }}
            >
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-semibold text-[color:var(--color-foreground)]">Runtime</span>
          </div>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]"
            onClick={() => navigate('/settings')}
          >
            <Settings className="w-4 h-4" strokeWidth={1.8} />
          </Button>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="flex flex-col items-center gap-6 max-w-md text-center px-6">
            <div
              className="w-20 h-20 rounded-2xl border flex items-center justify-center surface-card"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <FolderPlus className="w-10 h-10 text-[color:var(--color-muted-foreground)]" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-[color:var(--color-foreground)] mb-2">Add a project folder</h1>
              <p className="text-sm text-[color:var(--color-muted-foreground)]">Drop a folder or browse to get started</p>
            </div>
            <Button onClick={handleAddFolder} className="gap-2 rounded-xl h-10 px-5 bg-primary hover:bg-primary-hover text-white shadow-sm" size="lg">
              <Plus className="w-4 h-4" strokeWidth={1.8} />
              Add Project Folder
            </Button>
            <p className="text-xs text-[color:var(--color-muted-foreground)]">
              Node.js &middot; Python &middot; Vite &middot; Next.js &middot; Django &middot; more
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
        onAddFolder={handleAddFolder}
        onSettingsClick={() => navigate('/settings')}
        searchRef={searchRef}
      />
      <ScrollArea className="flex-1">
        <div className="max-w-5xl mx-auto w-full px-8 py-8">
          <div className="mb-8">
            <h1 className="text-lg font-semibold text-[color:var(--color-foreground)]">Projects</h1>
            <p className="text-sm text-[color:var(--color-muted-foreground)] mt-1 flex items-center gap-2">
              <span>{projects.length} project{projects.length !== 1 ? 's' : ''}</span>
              {runningCount > 0 && (
                <>
                  <span className="text-[color:var(--color-muted-foreground)]/70">&middot;</span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    {runningCount} runtime{runningCount !== 1 ? 's' : ''} active
                  </span>
                </>
              )}
            </p>
          </div>

          {pinnedProjects.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center gap-2.5 mb-4">
                <span className="w-1 h-4 rounded-full bg-amber-400" />
                <Pin className="w-3.5 h-3.5 text-amber-500" strokeWidth={2} />
                <h2 className="text-xs font-semibold text-[color:var(--color-muted-foreground)] uppercase tracking-wider">Pinned</h2>
                <span className="text-[10px] text-[color:var(--color-muted-foreground)]">{pinnedProjects.length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {pinnedProjects.map((project, index) => (
                  <ProjectCard key={project.id} project={project} index={index} onSelect={handleSelect} />
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <span className="w-1 h-4 rounded-full bg-primary" />
              <FolderOpen className="w-3.5 h-3.5 text-primary" strokeWidth={2} />
              <h2 className="text-xs font-semibold text-[color:var(--color-muted-foreground)] uppercase tracking-wider">
                {pinnedProjects.length > 0 ? 'All Projects' : 'Projects'}
              </h2>
              <span className="text-[10px] text-[color:var(--color-muted-foreground)]">{recentProjects.length}</span>
            </div>
            {recentProjects.length > 0 ? (
              <div className="flex flex-col gap-2">
                {recentProjects.map((project, index) => (
                  <ProjectCard key={project.id} project={project} index={index} onSelect={handleSelect} />
                ))}
              </div>
            ) : (
              <div className="text-center py-16 text-sm text-[color:var(--color-muted-foreground)]">
                {searchQuery ? 'No projects match your search' : 'No projects yet'}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
