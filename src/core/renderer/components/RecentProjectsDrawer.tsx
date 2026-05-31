import { useEffect, useMemo, useState } from 'react'
import { Clock3, Trash2, X } from 'lucide-react'
import { middleTruncatePath, projectDisplayName } from '../lib/projectDisplay'
import type { ProjectInfo } from '../../shared/types'

type RecentProjectsDrawerProps = {
  open: boolean
  currentProjectId?: string
  projects: ProjectInfo[]
  onClose: () => void
  onSelectProject: (projectId: string) => void
  onRemoveProject: (projectId: string) => void
}

const DRAWER_TRANSITION_MS = 220
const DRAWER_CONTENT_REVEAL_MS = 70

function formatLastOpened(timestamp?: number): string {
  if (!timestamp) return '未打开'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp))
  } catch {
    return '最近打开'
  }
}

export function RecentProjectsDrawer({
  open,
  currentProjectId,
  projects,
  onClose,
  onSelectProject,
  onRemoveProject,
}: RecentProjectsDrawerProps) {
  const [shouldRender, setShouldRender] = useState(open)
  const [visible, setVisible] = useState(open)
  const [contentVisible, setContentVisible] = useState(open)

  const recentProjects = useMemo(
    () => projects
      .filter((project) => project.id !== currentProjectId && typeof project.lastOpened === 'number')
      .sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0))
      .slice(0, 20),
    [projects, currentProjectId]
  )

  useEffect(() => {
    if (open) {
      setShouldRender(true)
      setContentVisible(false)
      const enterTimer = window.setTimeout(() => setVisible(true), 16)
      const revealTimer = window.setTimeout(() => setContentVisible(true), DRAWER_CONTENT_REVEAL_MS)
      return () => {
        window.clearTimeout(enterTimer)
        window.clearTimeout(revealTimer)
      }
    }
    setContentVisible(false)
    setVisible(false)
    const closeTimer = window.setTimeout(() => setShouldRender(false), DRAWER_TRANSITION_MS)
    return () => {
      window.clearTimeout(closeTimer)
    }
  }, [open])

  useEffect(() => {
    if (!shouldRender) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [shouldRender, onClose])

  if (!shouldRender) return null

  return (
    <>
      <button
        type="button"
        className={`fixed inset-0 z-[89] bg-[color:var(--color-background-sunken)]/42 backdrop-blur-[3px] transition-opacity duration-200 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        aria-label="Close recent project drawer backdrop"
        onClick={onClose}
      />

      <aside className={`recent-project-drawer ${visible ? 'is-open' : ''}`}>
        <div className={`flex h-full min-h-0 flex-col transition-opacity duration-150 ${contentVisible ? 'opacity-100' : 'opacity-0'}`}>
          <div className="recent-project-drawer-header">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[color:var(--color-foreground)]">最近项目</p>
              <p className="text-[11px] text-[color:var(--color-muted-foreground)]">右键下滑快速打开，点击可切换</p>
            </div>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background)]/72 text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
              onClick={onClose}
              title="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="recent-project-drawer-content">
            {recentProjects.length === 0 ? (
              <div className="recent-project-drawer-empty">
                <Clock3 className="h-4 w-4" />
                <span>暂无最近项目</span>
              </div>
            ) : (
              <div className="recent-project-drawer-list">
                {recentProjects.map((project) => (
                  <div key={project.id} className="recent-project-drawer-item">
                    <button
                      type="button"
                      className="recent-project-drawer-open"
                      onClick={() => onSelectProject(project.id)}
                      title={project.path}
                    >
                      <span className="recent-project-drawer-name">{projectDisplayName(project)}</span>
                      <span className="recent-project-drawer-meta">
                        <span>{middleTruncatePath(project.path, 24, 18)}</span>
                        <span>·</span>
                        <span>{formatLastOpened(project.lastOpened)}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="recent-project-drawer-remove"
                      title="从最近列表移除"
                      onClick={() => onRemoveProject(project.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}
