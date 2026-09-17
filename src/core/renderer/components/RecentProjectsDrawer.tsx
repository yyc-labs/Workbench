import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { FolderOpen, Search, Trash2, X } from 'lucide-react'
import { middleTruncatePath, projectDisplayName } from '../lib/projectDisplay'
import type { AiCommitStatus, CliTool, ProjectInfo } from '../../shared/types'
import { useAppStore } from '../stores/appStore'
import { CardContextMenu, type CardContextMenuInfo } from './CardContextMenu'
import { ProjectMetaDialog } from './ProjectMetaDialog'
import { RunTasksDialog } from './run-tasks/RunTasksDialog'
import { Input } from './ui/input'
import { isTmuxRuntimeEntry } from '../lib/runtimePresentation'
import { useI18n } from '../i18n'
import { useProjectDocLinks } from '../pages/detail/useProjectDocLinks'
import { defaultAiRuntimeProfiles, getAiRuntimeProfileCli, getAiRuntimeProfileLabel, resolveAiRuntimeProfile, resolveProjectAiRuntimeProfileId } from '../../shared/aiRuntimeProfiles'

type RecentProjectDrawerCardProps = {
  project: RecentProjectListItem
  isContextActive: boolean
  isKeyboardActive: boolean
  /** 虚拟滚动定位:由抽屉按可见窗口计算并传入(top 绝对定位),非虚拟渲染时不传。 */
  style?: CSSProperties
  onHoverProject: (projectId: string) => void
  onSelectProject: (projectId: string) => void
  onRemoveProject: (projectId: string) => void
  onOpenContextMenu: (projectId: string, x: number, y: number) => void
}

type RecentProjectsDrawerProps = {
  open: boolean
  currentProjectId?: string
  onClose: () => void
  onSelectProject: (projectId: string) => void
  onRemoveProject: (projectId: string) => void
  onEditProjectMetadata: (projectId: string) => void
}

type RecentProjectListItem = Pick<ProjectInfo, 'id' | 'path' | 'name' | 'customName' | 'lastOpened'>

type ContextMenuState = {
  projectId: string
  x: number
  y: number
}

type RecentProjectsContextMenuProps = {
  contextMenu: ContextMenuState
  project: ProjectInfo
  onClose: () => void
  onRequestCloseDrawer: () => void
  onEditMetadata: (projectId: string) => void
  /** 右键"启动/停止项目"按钮时打开运行命令配置弹窗;由抽屉层持有弹窗状态,避免菜单关闭卸载组件导致弹窗消失。 */
  onOpenRunConfig: () => void
}

export type RecentProjectsMetaDialogHostProps = {
  projectId: string
  onClose: () => void
}

const DRAWER_TRANSITION_MS = 220
const DRAWER_CONTENT_REVEAL_MS = 70
const EMPTY_RECENT_PROJECTS: RecentProjectListItem[] = []
/** 列表项间距,与 styles/parts/code-drawers.css 中 .recent-project-drawer-list 的 gap 保持一致。 */
const LIST_GAP_PX = 6
/** 虚拟滚动上下各多渲染的条数,保证键盘/滚动切换时高亮项始终已渲染。 */
const VIRTUAL_OVERSCAN = 6

function getProjectById(projects: ProjectInfo[], projectId?: string | null): ProjectInfo | undefined {
  if (!projectId) return undefined
  return projects.find((project) => project.id === projectId)
}

/** 模糊匹配:先做字段子串匹配,再做子序列匹配(名称/路径按顺序包含查询字符)。 */
function fuzzyMatchProject(project: RecentProjectListItem, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true
  const fields = [project.customName ?? '', project.name ?? '', project.path]
  if (fields.some((field) => field.toLowerCase().includes(normalizedQuery))) return true
  const targets = [projectDisplayName(project), project.path]
  return targets.some((target) => {
    const normalizedTarget = target.toLowerCase()
    let cursor = 0
    for (const char of normalizedTarget) {
      if (char === normalizedQuery[cursor]) cursor += 1
      if (cursor === normalizedQuery.length) return true
    }
    return false
  })
}

const RecentProjectDrawerCard = memo(function RecentProjectDrawerCard({ project, isContextActive, isKeyboardActive, style, onHoverProject, onSelectProject, onRemoveProject, onOpenContextMenu }: RecentProjectDrawerCardProps) {
  const { t, formatDateTime } = useI18n()

  return (
    <div
      id={`recent-project-option-${project.id}`}
      role="option"
      aria-selected={isKeyboardActive}
      style={style}
      className={`recent-project-drawer-item ${isContextActive ? 'is-context-active' : ''} ${isKeyboardActive ? 'is-keyboard-active' : ''}`}
      onMouseEnter={() => onHoverProject(project.id)}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onOpenContextMenu(project.id, event.clientX, event.clientY)
      }}
    >
      <button type="button" className="recent-project-drawer-open" onClick={() => onSelectProject(project.id)} title={project.path}>
        <span className="recent-project-drawer-name">{projectDisplayName(project)}</span>
        <span className="recent-project-drawer-meta">
          <span>{middleTruncatePath(project.path, 24, 18)}</span>
          <span>·</span>
          <span>{project.lastOpened ? formatDateTime(project.lastOpened) : t('common.notOpened')}</span>
        </span>
      </button>
      <button type="button" className="recent-project-drawer-remove" title={t('common.removeFromRecent')} onClick={() => onRemoveProject(project.id)}>
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
})

const EMPTY_URLS: string[] = []

const RecentProjectsContextMenu = memo(function RecentProjectsContextMenu({ contextMenu, project, onClose, onRequestCloseDrawer, onEditMetadata, onOpenRunConfig }: RecentProjectsContextMenuProps) {
  const stopProject = useAppStore((s) => s.stopProject)
  const startAllRunTasks = useAppStore((s) => s.startAllRunTasks)
  const stopAllRunTasks = useAppStore((s) => s.stopAllRunTasks)
  const startRuntime = useAppStore((s) => s.startRuntime)
  const stopRuntime = useAppStore((s) => s.stopRuntime)
  const openTerminal = useAppStore((s) => s.openTerminal)
  const setProjectCli = useAppStore((s) => s.setProjectCli)
  const setProjectAiRuntimeProfile = useAppStore((s) => s.setProjectAiRuntimeProfile)
  const togglePin = useAppStore((s) => s.togglePin)
  const devStatus = useAppStore((s) => s.processes[project.id]?.status ?? 'stopped')
  const devUrls = useAppStore((s) => s.processUrls[project.id] ?? EMPTY_URLS)
  const runTaskStates = useAppStore((s) => s.runTaskStates[project.id])
  const session = useAppStore((s) => s.sessions[project.id])
  const runtimeEntry = useAppStore((s) => s.runtimeEntries[project.id])
  const aiEnvironmentMode = useAppStore((s) => s.config.aiEnvironment?.mode)
  const aiRuntimeProfilesConfig = useAppStore((s) => s.config.aiRuntimeProfiles ?? [])
  const activeAiRuntimeProfileId = useAppStore((s) => s.config.activeAiRuntimeProfileId)
  const [isOpeningTerminal, setIsOpeningTerminal] = useState(false)
  const [isStartingRuntime, setIsStartingRuntime] = useState(false)
  const [isStoppingRuntime, setIsStoppingRuntime] = useState(false)

  const aiRuntimeProfiles = aiRuntimeProfilesConfig.length > 0 ? aiRuntimeProfilesConfig : defaultAiRuntimeProfiles()
  const defaultRuntimeProfile = resolveAiRuntimeProfile(aiRuntimeProfiles, activeAiRuntimeProfileId)
  const defaultRuntimeProfileLabel = getAiRuntimeProfileLabel(defaultRuntimeProfile)
  const defaultRuntimeProfileCli: CliTool = getAiRuntimeProfileCli(defaultRuntimeProfile)
  const hasProjectAiRuntimeOverride = Boolean(project.aiRuntimeProfileId?.trim() || project.cli)
  const currentRuntimeProfileId = resolveProjectAiRuntimeProfileId(project, activeAiRuntimeProfileId)
  const currentRuntimeProfile = resolveAiRuntimeProfile(aiRuntimeProfiles, currentRuntimeProfileId, project.cli)
  const currentRuntimeProfileLabel = getAiRuntimeProfileLabel(currentRuntimeProfile, project.cli)
  const currentCli: CliTool = getAiRuntimeProfileCli(currentRuntimeProfile, project.cli)
  const isDevRunning = devStatus === 'running'
  const isDevStopping = devStatus === 'stopping'
  const hasActiveRunTasks = Boolean(runTaskStates && Object.values(runTaskStates).some((item) => item.state === 'starting' || item.state === 'waiting' || item.state === 'ready' || item.state === 'running' || item.state === 'stopping'))
  const isAnyRunTaskStopping = Boolean(runTaskStates && Object.values(runTaskStates).some((item) => item.state === 'stopping'))
  // The context menu reflects the unified run-task pipeline, not the legacy
  // bare-process state alone.
  const isMenuDevRunning = isDevRunning || hasActiveRunTasks
  const isMenuDevStopping = isDevStopping || isAnyRunTaskStopping
  const isRuntimeAttached = session?.status === 'attached'
  const isRuntimeDetached = session?.status === 'detached'
  const isRuntimeActive = isRuntimeAttached || isRuntimeDetached
  const usesTmuxRuntime = isTmuxRuntimeEntry(runtimeEntry, aiEnvironmentMode)
  const aiCommitStatus: AiCommitStatus = 'idle'
  const { docMenuItems, docLinkTagOptions, defaultDocLink, handleOpenDocMenuItem } = useProjectDocLinks({ project })
  const isDevReady = isDevRunning && devUrls.length > 0
  const info: CardContextMenuInfo = {
    items: [
      ...(isDevReady
        ? devUrls.map((url) => ({
            url,
            label: `Dev: ${url}`,
            onOpen: () => handleActionAndCloseDrawer(() => window.electronAPI.openExternal(url)),
          }))
        : []),
      ...docMenuItems.map((item) => ({
        ...item,
        onOpen: () => handleActionAndCloseDrawer(() => handleOpenDocMenuItem(item.linkId ?? '')),
      })),
    ],
    tagOptions: docLinkTagOptions,
    onOpenDefault: defaultDocLink ? () => handleActionAndCloseDrawer(() => handleOpenDocMenuItem(defaultDocLink.id)) : undefined,
  }

  const handleSelectAiRuntimeProfile = useCallback(
    (profileId: string) => {
      void setProjectAiRuntimeProfile(project.id, profileId)
    },
    [project.id, setProjectAiRuntimeProfile],
  )

  const handleUseAiRuntimeProfileOnce = useCallback(
    async (profileId: string) => {
      await startRuntime(project.id, profileId || defaultRuntimeProfile.id)
    },
    [defaultRuntimeProfile.id, project.id, startRuntime],
  )

  const handleSwitchAndUseAiRuntimeProfile = useCallback(
    async (profileId: string) => {
      await setProjectAiRuntimeProfile(project.id, profileId)
      await startRuntime(project.id, profileId || defaultRuntimeProfile.id)
    },
    [defaultRuntimeProfile.id, project.id, setProjectAiRuntimeProfile, startRuntime],
  )

  const handleSwitchCli = useCallback(() => {
    const currentIndex = aiRuntimeProfiles.findIndex((profile) => profile.id === currentRuntimeProfile.id)
    const nextProfile = aiRuntimeProfiles[(currentIndex + 1 + aiRuntimeProfiles.length) % aiRuntimeProfiles.length]
    if (nextProfile) {
      void setProjectAiRuntimeProfile(project.id, nextProfile.id)
      return
    }
    void setProjectCli(project.id, currentCli === 'codex' ? 'claude' : 'codex')
  }, [aiRuntimeProfiles, currentCli, currentRuntimeProfile.id, project.id, setProjectAiRuntimeProfile, setProjectCli])

  const handleOpenTerminal = useCallback(async () => {
    if (isOpeningTerminal) return
    setIsOpeningTerminal(true)
    try {
      await openTerminal(project.id, session?.status)
    } finally {
      window.setTimeout(() => setIsOpeningTerminal(false), 400)
    }
  }, [isOpeningTerminal, openTerminal, project.id, session?.status])

  const handleStartRuntime = useCallback(async () => {
    if (isStartingRuntime) return
    setIsStartingRuntime(true)
    try {
      await startRuntime(project.id)
    } finally {
      setIsStartingRuntime(false)
    }
  }, [isStartingRuntime, project.id, startRuntime])

  const handleStopRuntime = useCallback(async () => {
    if (isStoppingRuntime) return
    setIsStoppingRuntime(true)
    try {
      await stopRuntime(project.id)
    } finally {
      setIsStoppingRuntime(false)
    }
  }, [isStoppingRuntime, project.id, stopRuntime])

  const handleActionAndCloseDrawer = useCallback(
    async (action: () => void | Promise<unknown>) => {
      await action()
      onRequestCloseDrawer()
    },
    [onRequestCloseDrawer],
  )

  // Unified start/stop: everything goes through the run-task pipeline.
  const handleStartProjectTasks = useCallback(() => {
    void startAllRunTasks(project.id, project.path)
  }, [project.id, project.path, startAllRunTasks])

  const handleStopProjectTasks = useCallback(() => {
    void (async () => {
      await stopAllRunTasks(project.id)
      await stopProject(project.id)
    })()
  }, [project.id, stopAllRunTasks, stopProject])

  return (
    <CardContextMenu
      x={contextMenu.x}
      y={contextMenu.y}
      zIndex={20002}
      onClose={onClose}
      isRuntimeActive={isRuntimeActive}
      usesTmuxRuntime={usesTmuxRuntime}
      isDevRunning={isMenuDevRunning}
      isDevStopping={isMenuDevStopping}
      isOpeningTerminal={isOpeningTerminal}
      isStartingRuntime={isStartingRuntime}
      isStoppingRuntime={isStoppingRuntime}
      currentCli={currentCli}
      defaultRuntimeProfileLabel={defaultRuntimeProfileLabel}
      defaultRuntimeProfileCli={defaultRuntimeProfileCli}
      isUsingDefaultAiRuntimeProfile={!hasProjectAiRuntimeOverride}
      currentRuntimeProfileLabel={currentRuntimeProfileLabel}
      currentRuntimeProfileId={currentRuntimeProfile.id}
      aiRuntimeProfiles={aiRuntimeProfiles}
      isPinned={project.pinned}
      onStartRuntime={() => handleActionAndCloseDrawer(handleStartRuntime)}
      onStopRuntime={() => handleActionAndCloseDrawer(handleStopRuntime)}
      onOpenTerminal={() => handleActionAndCloseDrawer(handleOpenTerminal)}
      onSwitchCli={() => handleActionAndCloseDrawer(handleSwitchCli)}
      onSelectAiRuntimeProfile={(profileId) => handleActionAndCloseDrawer(() => handleSelectAiRuntimeProfile(profileId))}
      onUseAiRuntimeProfile={(profileId) => handleActionAndCloseDrawer(() => handleUseAiRuntimeProfileOnce(profileId))}
      onSwitchAndUseAiRuntimeProfile={(profileId) => handleActionAndCloseDrawer(() => handleSwitchAndUseAiRuntimeProfile(profileId))}
      onStartProject={() => handleActionAndCloseDrawer(handleStartProjectTasks)}
      onStopProject={() => handleActionAndCloseDrawer(handleStopProjectTasks)}
      aiCommitStatus={aiCommitStatus}
      onOpenFolder={() => handleActionAndCloseDrawer(() => window.electronAPI.openFolder(project.path))}
      onOpenPathTerminal={() => handleActionAndCloseDrawer(() => window.electronAPI.openPathTerminal(project.path))}
      onOpenVsCode={() => handleActionAndCloseDrawer(() => window.electronAPI.openInVsCode(project.path))}
      onTogglePin={() => handleActionAndCloseDrawer(() => togglePin(project.id))}
      onEditMetadata={() => {
        onEditMetadata(project.id)
        onRequestCloseDrawer()
      }}
      onOpenRunTasks={onOpenRunConfig}
      info={info}
    />
  )
})

export const RecentProjectsMetaDialogHost = memo(function RecentProjectsMetaDialogHost({ projectId, onClose }: RecentProjectsMetaDialogHostProps) {
  const project = useAppStore((s) => getProjectById(s.projects, projectId))
  const folders = useAppStore((s) => s.folders)
  const tags = useAppStore((s) => s.tags)
  const assignProjectFolder = useAppStore((s) => s.assignProjectFolder)
  const setProjectTags = useAppStore((s) => s.setProjectTags)
  const setProjectCustomName = useAppStore((s) => s.setProjectCustomName)
  const setProjectCustomType = useAppStore((s) => s.setProjectCustomType)

  if (!project) return null

  return <ProjectMetaDialog open project={project} folders={folders} tags={tags} onClose={onClose} onAssignFolder={assignProjectFolder} onSetProjectTags={setProjectTags} onSetProjectCustomName={setProjectCustomName} onSetProjectCustomType={setProjectCustomType} />
})

// Memoized: the host re-renders on every route change; stable host callbacks
// + memo keep the drawer (and its project cards) from re-rendering with it.
export const RecentProjectsDrawer = memo(function RecentProjectsDrawer({ open, currentProjectId, onClose, onSelectProject, onRemoveProject, onEditProjectMetadata }: RecentProjectsDrawerProps) {
  const { t } = useI18n()
  const [shouldRender, setShouldRender] = useState(open)
  const [visible, setVisible] = useState(open)
  const [contentVisible, setContentVisible] = useState(open)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [runConfigOpen, setRunConfigOpen] = useState(false)
  // Stable callback so memoized RunTasksDialog doesn't re-render with the drawer.
  const closeRunConfigDialog = useCallback(() => setRunConfigOpen(false), [])
  const [runConfigProject, setRunConfigProject] = useState<ProjectInfo | null>(null)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const shouldScrollToActiveRef = useRef(false)
  const mouseXRef = useRef<number | null>(null)
  // 虚拟滚动:滚动容器/视口高度/滚动偏移,以及由隐藏探针卡片测出的单项高度
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const probeRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [itemHeight, setItemHeight] = useState(0)
  const currentProject = useAppStore((s) => getProjectById(s.projects, currentProjectId))
  // Subscribe to the projects array reference only; deriving the sorted list
  // in a selector would re-run filter+sort on every store notification.
  const projects = useAppStore((s) => s.projects)
  const allProjects = useMemo(() => {
    if (!open && !shouldRender) return EMPTY_RECENT_PROJECTS
    return projects.filter((project) => project.id !== currentProjectId).sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0))
  }, [projects, currentProjectId, open, shouldRender])
  const trimmedQuery = query.trim()
  const visibleProjects = useMemo(() => {
    if (!trimmedQuery) return allProjects
    return allProjects.filter((project) => fuzzyMatchProject(project, trimmedQuery))
  }, [allProjects, trimmedQuery])
  const activeProjectId = visibleProjects[activeIndex]?.id
  const contextMenuProjectId = contextMenu?.projectId
  const contextMenuProject = useAppStore((s) => getProjectById(s.projects, contextMenuProjectId))
  const slotHeight = itemHeight > 0 ? itemHeight + LIST_GAP_PX : 0
  const virtualRange = useMemo(() => {
    if (slotHeight <= 0 || viewportHeight <= 0 || visibleProjects.length === 0) return null
    const start = Math.max(0, Math.floor(scrollTop / slotHeight) - VIRTUAL_OVERSCAN)
    const end = Math.min(visibleProjects.length, start + Math.ceil(viewportHeight / slotHeight) + VIRTUAL_OVERSCAN * 2)
    return { start, end }
  }, [slotHeight, viewportHeight, scrollTop, visibleProjects.length])

  const handleOpenContextMenu = useCallback((projectId: string, x: number, y: number) => {
    setContextMenu({ projectId, x, y })
  }, [])

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  // Stable prop for the memoized context menu; contextMenuProject is a store
  // object whose reference only changes when the project itself is edited.
  const handleOpenRunConfig = useCallback(() => {
    if (!contextMenuProject) return
    setRunConfigProject(contextMenuProject)
    setRunConfigOpen(true)
  }, [contextMenuProject])

  const handleHoverProject = useCallback(
    (projectId: string) => {
      // 鼠标悬浮接管高亮时,丢弃可能残留的键盘滚动意图,避免触发一次意外滚动
      shouldScrollToActiveRef.current = false
      setActiveIndex((current) => {
        if (visibleProjects[current]?.id === projectId) return current
        const nextIndex = visibleProjects.findIndex((project) => project.id === projectId)
        return nextIndex === -1 ? current : nextIndex
      })
    },
    [visibleProjects],
  )

  const handleSearchKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        shouldScrollToActiveRef.current = true
        setActiveIndex((current) => Math.min(current + 1, Math.max(visibleProjects.length - 1, 0)))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        shouldScrollToActiveRef.current = true
        setActiveIndex((current) => Math.max(current - 1, 0))
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        const project = visibleProjects[activeIndex]
        if (!project) return
        const rect = document.getElementById(`recent-project-option-${project.id}`)?.getBoundingClientRect()
        if (!rect) return
        // 等效右键菜单:优先用鼠标当前 x 作为起始位置(鼠标未经过抽屉时回退到激活项位置),y 取激活项底部;CardContextMenu 内部会做视口边界钳制
        const x = mouseXRef.current ?? rect.left + 12
        setContextMenu({ projectId: project.id, x, y: rect.bottom + 4 })
        return
      }
      if (event.key === 'Enter') {
        if (event.nativeEvent.isComposing) return
        const project = visibleProjects[activeIndex]
        if (project) onSelectProject(project.id)
      }
    },
    [activeIndex, onSelectProject, visibleProjects],
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
    // 组件常驻,全局记录最近鼠标 x,保证抽屉首次打开时就有可用的菜单起始位置;仅写 ref,无渲染开销
    const onMouseMove = (event: MouseEvent) => {
      mouseXRef.current = event.clientX
    }
    window.addEventListener('mousemove', onMouseMove, { passive: true })
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
    }
  }, [])

  // 虚拟滚动测量:布局阶段读取视口高度与探针卡片高度,保证首帧即按虚拟窗口渲染
  useLayoutEffect(() => {
    if (!shouldRender) return
    const container = scrollContainerRef.current
    if (container) setViewportHeight(container.clientHeight)
    const probe = probeRef.current
    if (probe) setItemHeight(probe.getBoundingClientRect().height)
  }, [shouldRender])

  // 监听滚动与容器尺寸变化,驱动虚拟窗口重算
  useEffect(() => {
    if (!shouldRender) return
    const container = scrollContainerRef.current
    if (!container) return
    const onScroll = () => setScrollTop(container.scrollTop)
    container.addEventListener('scroll', onScroll, { passive: true })
    const resizeObserver = new ResizeObserver(() => setViewportHeight(container.clientHeight))
    resizeObserver.observe(container)
    return () => {
      container.removeEventListener('scroll', onScroll)
      resizeObserver.disconnect()
    }
  }, [shouldRender])

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

  useEffect(() => {
    if (open) return
    setContextMenu(null)
    setRunConfigOpen(false)
    setRunConfigProject(null)
    setQuery('')
    setActiveIndex(0)
    shouldScrollToActiveRef.current = false
    const container = scrollContainerRef.current
    if (container) container.scrollTop = 0
    setScrollTop(0)
  }, [open])

  useEffect(() => {
    if (!open || !shouldRender) return
    searchInputRef.current?.focus()
  }, [open, shouldRender])

  useEffect(() => {
    shouldScrollToActiveRef.current = false
    setActiveIndex(0)
  }, [trimmedQuery])

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(visibleProjects.length - 1, 0)))
  }, [visibleProjects.length])

  useEffect(() => {
    if (!activeProjectId || !shouldScrollToActiveRef.current) return
    shouldScrollToActiveRef.current = false
    document.getElementById(`recent-project-option-${activeProjectId}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeProjectId])

  useEffect(() => {
    if (!contextMenuProjectId || contextMenuProject) return
    setContextMenu(null)
  }, [contextMenuProject, contextMenuProjectId])

  if (!shouldRender) return null

  return (
    <>
      <button type="button" data-allow-recent-gesture="true" className={`fixed inset-0 z-[20000] bg-[color:var(--color-background-sunken)]/42 backdrop-blur-[3px] transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`} aria-label={t('common.closeRecentProjectsBackdrop')} onClick={onClose} />

      <aside className={`recent-project-drawer ${visible ? 'is-open' : ''}`} data-allow-recent-gesture="true" data-recent-project-drawer-open={open ? 'true' : 'false'}>
        <div className={`flex h-full min-h-0 flex-col transition-opacity duration-150 ${contentVisible ? 'opacity-100' : 'opacity-0'}`}>
          <div className="recent-project-drawer-header">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[color:var(--color-foreground)]">{t('common.recentProjects')}</p>
              <p className="text-[11px] text-[color:var(--color-muted-foreground)]">{t('common.recentProjectsHint')}</p>
            </div>
            <div className="recent-project-drawer-current" title={currentProject?.path} aria-label={currentProject ? `${t('common.currentProject')}: ${projectDisplayName(currentProject)}` : undefined}>
              {currentProject ? projectDisplayName(currentProject) : null}
            </div>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background)]/72 text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
              onClick={onClose}
              title={t('common.close')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="recent-project-drawer-search">
            <Search className="recent-project-drawer-search-icon" />
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t('common.searchProjects')}
              className="recent-project-drawer-search-input h-8 px-3 pl-9 text-xs"
              spellCheck={false}
              role="combobox"
              aria-expanded={visibleProjects.length > 0}
              aria-controls="recent-project-drawer-list"
              aria-activedescendant={activeProjectId ? `recent-project-option-${activeProjectId}` : undefined}
            />
          </div>

          <div ref={scrollContainerRef} className="recent-project-drawer-content">
            {visibleProjects.length > 0 && (
              <div ref={probeRef} aria-hidden="true" className="recent-project-drawer-item recent-project-drawer-probe">
                <div className="recent-project-drawer-open">
                  <span className="recent-project-drawer-name">Me</span>
                  <span className="recent-project-drawer-meta">
                    <span>0</span>
                  </span>
                </div>
              </div>
            )}
            {visibleProjects.length === 0 ? (
              <div className="recent-project-drawer-empty">
                <FolderOpen className="h-4 w-4" />
                <span>{trimmedQuery ? t('common.noRecentProjectMatches') : t('common.noRecentProjects')}</span>
              </div>
            ) : virtualRange ? (
              <div id="recent-project-drawer-list" role="listbox" className="recent-project-drawer-list is-virtual" style={{ height: visibleProjects.length * slotHeight - LIST_GAP_PX }}>
                {visibleProjects.slice(virtualRange.start, virtualRange.end).map((project, offset) => {
                  const index = virtualRange.start + offset
                  return (
                    <RecentProjectDrawerCard
                      key={project.id}
                      project={project}
                      style={{ top: index * slotHeight }}
                      isContextActive={contextMenuProjectId === project.id}
                      isKeyboardActive={index === activeIndex}
                      onHoverProject={handleHoverProject}
                      onSelectProject={onSelectProject}
                      onRemoveProject={onRemoveProject}
                      onOpenContextMenu={handleOpenContextMenu}
                    />
                  )
                })}
              </div>
            ) : (
              <div id="recent-project-drawer-list" role="listbox" className="recent-project-drawer-list">
                {visibleProjects.map((project, index) => (
                  <RecentProjectDrawerCard
                    key={project.id}
                    project={project}
                    isContextActive={contextMenuProjectId === project.id}
                    isKeyboardActive={index === activeIndex}
                    onHoverProject={handleHoverProject}
                    onSelectProject={onSelectProject}
                    onRemoveProject={onRemoveProject}
                    onOpenContextMenu={handleOpenContextMenu}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>

      {contextMenu && contextMenuProject && <RecentProjectsContextMenu contextMenu={contextMenu} project={contextMenuProject} onClose={handleCloseContextMenu} onRequestCloseDrawer={onClose} onEditMetadata={onEditProjectMetadata} onOpenRunConfig={handleOpenRunConfig} />}

      {runConfigOpen && runConfigProject && <RunTasksDialog project={runConfigProject} open onClose={closeRunConfigDialog} baseZIndex={20010} />}
    </>
  )
})
