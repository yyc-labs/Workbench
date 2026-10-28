import { useCallback, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { shallow } from 'zustand/shallow'
import { ProjectPageShell, useProjectHeaderCollapsed } from '../../components/ProjectPageShell'
import { ProjectPaneTabs } from '../../components/ProjectPaneTabs'
import { useI18n } from '../../i18n'
import { projectDisplayName } from '../../lib/projectDisplay'
import { preloadProjectPane } from '../../lib/projectPagePreload'
import { useAppStore } from '../../stores/appStore'
import { SessionHistoryPanel } from './SessionHistoryPanel'
import { SessionProjectContextMenu } from './SessionProjectContextMenu'

export function SessionsPage() {
  const { t } = useI18n()
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [projectHeaderCollapsed, setProjectHeaderCollapsed] = useProjectHeaderCollapsed()
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const project = useAppStore((s) => {
    const found = s.projects.find((item) => item.id === projectId)
    if (!found) return undefined
    return { id: found.id, path: found.path, name: found.name, customName: found.customName, pinned: found.pinned, aiRuntimeProfileId: found.aiRuntimeProfileId, cli: found.cli }
  }, shallow)

  const navigateToPane = useCallback(
    (pane: 'code' | 'aicommit' | 'transcript' | 'sessions') => {
      if (!projectId) return
      navigate(`/project/${projectId}/${pane}`)
    },
    [navigate, projectId],
  )

  const handleSelectPane = useCallback(
    (pane: 'code' | 'aicommit' | 'transcript' | 'sessions') => {
      if (pane === 'sessions') return
      navigateToPane(pane)
    },
    [navigateToPane],
  )

  return (
    <ProjectPageShell
      title={project ? projectDisplayName(project) : t('common.workspace')}
      path={project?.path}
      titleMeta={<p className="mt-0.5 text-[11px] text-[color:var(--color-muted-foreground)]/85">{t('agentHistory.tab')}</p>}
      onBack={() => navigateToPane('code')}
      activePane="sessions"
      onPreloadPane={preloadProjectPane}
      onSelectPane={handleSelectPane}
      projectHeaderCollapsed={projectHeaderCollapsed}
      onProjectHeaderCollapsedChange={setProjectHeaderCollapsed}
      contentClassName="mx-auto flex h-full min-h-0 w-full min-w-0 max-w-[1360px] flex-col gap-3"
    >
      <div
        className="flex min-h-0 flex-1 flex-col"
        onContextMenu={(event) => {
          if (!project) return
          event.preventDefault()
          setMenuPosition({ x: event.clientX, y: event.clientY })
        }}
      >
        {projectId && project ? (
          <SessionHistoryPanel projectId={projectId} projectPath={project.path} headerCollapsed={projectHeaderCollapsed} projectName={projectDisplayName(project)} headerTabs={<ProjectPaneTabs activePane="sessions" onPreloadPane={preloadProjectPane} onSelectPane={handleSelectPane} />} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-[color:var(--color-muted-foreground)]">{t('common.workspace')}</div>
        )}
        {project && menuPosition && <SessionProjectContextMenu project={project} position={menuPosition} onClose={() => setMenuPosition(null)} />}
      </div>
    </ProjectPageShell>
  )
}
