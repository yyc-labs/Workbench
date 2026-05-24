import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { middleTruncatePath, projectDisplayName } from '../../lib/projectDisplay'
import { CodeWorkspacePanel } from './CodeWorkspacePanel'

export function CodePage() {
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId: string }>()
  const project = useAppStore((s) => s.projects.find((item) => item.id === projectId))
  const themeMode = useAppStore((s) => s.config.theme)

  if (!project || !projectId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <h2 className="text-lg font-semibold text-[color:var(--color-foreground)]">Project not found</h2>
        <button
          className="inline-flex items-center gap-1.5 text-sm text-primary transition-colors hover:text-primary"
          onClick={() => navigate('/')}
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
          Back to Home
        </button>
      </div>
    )
  }

  return (
    <div className="code-page-shell">
      <header className="app-chrome flex min-h-[84px] shrink-0 items-center justify-between px-8 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            className="rounded-full p-2 text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
            onClick={() => navigate(`/project/${projectId}`)}
            title="Back to Project"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={1.8} />
          </button>

          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-[-0.02em] text-[color:var(--color-foreground)]">
              {projectDisplayName(project)}
            </h1>
            <p className="mt-0.5 truncate text-xs text-[color:var(--color-muted-foreground)]" title={project.path}>
              {middleTruncatePath(project.path)}
            </p>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 px-6 pb-4 pt-4">
        <CodeWorkspacePanel projectPath={project.path} themeMode={themeMode} />
      </div>
    </div>
  )
}
