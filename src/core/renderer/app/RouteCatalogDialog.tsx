import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Bot,
  Code2,
  FileText,
  FolderOpen,
  GraduationCap,
  Home,
  Map,
  Route as RouteIcon,
  Search,
  Settings,
  type LucideIcon,
  X,
} from 'lucide-react'
import type { ProjectInfo } from '../../shared/types'
import { ModalShell } from '../components/ModalShell'
import { useI18n } from '../i18n'
import { middleTruncatePath, projectDisplayName } from '../lib/projectDisplay'
import { preloadProjectPane } from '../lib/projectPagePreload'
import { SETTINGS_SECTIONS, DEFAULT_SETTINGS_SECTION, type Section } from '../pages/settings/settings.types'
import { useAppStore } from '../stores/appStore'

type RouteCatalogGroupId = 'base' | 'project' | 'settings'
type RouteCatalogIconName =
  | 'home'
  | 'learning'
  | 'project'
  | 'code'
  | 'ai'
  | 'transcript'
  | 'settings'
  | 'route'
type ProjectPaneRoute = 'code' | 'aicommit' | 'transcript'

type RouteCatalogEntry = {
  id: string
  groupId: RouteCatalogGroupId
  icon: RouteCatalogIconName
  label: string
  pattern: string
  description: string
  targetPath: string | null
  targetLabel?: string
  disabledReason?: string
  projectId?: string
  preloadPane?: ProjectPaneRoute
}

type RouteCatalogGroup = {
  id: RouteCatalogGroupId
  label: string
  description: string
}

type RouteCatalogProject = Pick<ProjectInfo, 'id' | 'path' | 'name' | 'customName' | 'lastOpened'>

const routeIconMap: Record<RouteCatalogIconName, LucideIcon> = {
  home: Home,
  learning: GraduationCap,
  project: FolderOpen,
  code: Code2,
  ai: Bot,
  transcript: FileText,
  settings: Settings,
  route: RouteIcon,
}

const settingsDescriptionKeyBySection: Record<Section, string> = {
  general: 'common.routeCatalog.settingsDescriptions.general',
  shortcuts: 'common.routeCatalog.settingsDescriptions.shortcuts',
  data: 'common.routeCatalog.settingsDescriptions.data',
  runtime: 'common.routeCatalog.settingsDescriptions.runtime',
  agents: 'common.routeCatalog.settingsDescriptions.agents',
  gateway: 'common.routeCatalog.settingsDescriptions.gateway',
  'browser-ai': 'common.routeCatalog.settingsDescriptions.browserAi',
  transcripts: 'common.routeCatalog.settingsDescriptions.transcripts',
  hooks: 'common.routeCatalog.settingsDescriptions.hooks',
  'agent-logs': 'common.routeCatalog.settingsDescriptions.agentLogs',
  logs: 'common.routeCatalog.settingsDescriptions.logs',
  ai: 'common.routeCatalog.settingsDescriptions.ai',
  rules: 'common.routeCatalog.settingsDescriptions.rules',
  about: 'common.routeCatalog.settingsDescriptions.about',
}

function getProjectIdFromPath(pathname: string): string | undefined {
  const segments = pathname.split('/').filter(Boolean)
  return segments[0] === 'project' && segments[1] ? segments[1] : undefined
}

function resolveProjectForRoutes(
  projects: RouteCatalogProject[],
  currentProjectId: string | undefined
): RouteCatalogProject | undefined {
  const currentProject = currentProjectId
    ? projects.find((project) => project.id === currentProjectId)
    : undefined
  if (currentProject) return currentProject

  return projects
    .slice()
    .sort((a, b) => {
      const lastOpenedDiff = (b.lastOpened ?? 0) - (a.lastOpened ?? 0)
      if (lastOpenedDiff !== 0) return lastOpenedDiff
      return projectDisplayName(a).localeCompare(projectDisplayName(b))
    })[0]
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase()
}

function RouteCatalogDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const { t, getSettingsSectionLabel } = useI18n()
  const storeProjects = useAppStore((s) => s.projects)
  const projects = useMemo<RouteCatalogProject[]>(() =>
    storeProjects.map((project) => ({
      id: project.id,
      path: project.path,
      name: project.name,
      customName: project.customName,
      lastOpened: project.lastOpened,
    })),
    [storeProjects]
  )
  const updateLastOpened = useAppStore((s) => s.updateLastOpened)
  const [query, setQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [open])

  const currentProjectId = useMemo(
    () => getProjectIdFromPath(location.pathname),
    [location.pathname]
  )
  const routeProject = useMemo(
    () => resolveProjectForRoutes(projects, currentProjectId),
    [currentProjectId, projects]
  )

  const targetProjectLabel = useMemo(() => {
    if (!routeProject) return t('common.routeCatalog.noProjectTarget')
    return `${projectDisplayName(routeProject)} - ${middleTruncatePath(routeProject.path, 34, 24)}`
  }, [routeProject, t])

  const groups = useMemo<RouteCatalogGroup[]>(() => [
    {
      id: 'base',
      label: t('common.routeCatalog.groups.base'),
      description: t('common.routeCatalog.groups.baseDescription'),
    },
    {
      id: 'project',
      label: t('common.routeCatalog.groups.project'),
      description: t('common.routeCatalog.groups.projectDescription'),
    },
    {
      id: 'settings',
      label: t('common.routeCatalog.groups.settings'),
      description: t('common.routeCatalog.groups.settingsDescription'),
    },
  ], [t])

  const entries = useMemo<RouteCatalogEntry[]>(() => {
    const projectId = routeProject?.id
    const projectDisabledReason = projectId ? undefined : t('common.routeCatalog.noProjectHint')
    const projectTargetLabel = routeProject ? targetProjectLabel : t('common.routeCatalog.noProjectTarget')
    const projectPath = (suffix?: string) =>
      projectId ? `/project/${projectId}${suffix ? `/${suffix}` : ''}` : null

    const baseEntries: RouteCatalogEntry[] = [
      {
        id: 'home',
        groupId: 'base',
        icon: 'home',
        label: t('common.routeCatalog.routes.homeLabel'),
        pattern: '/',
        description: t('common.routeCatalog.routes.homeDescription'),
        targetPath: '/',
      },
      {
        id: 'learning',
        groupId: 'base',
        icon: 'learning',
        label: t('common.routeCatalog.routes.learningLabel'),
        pattern: '/learning',
        description: t('common.routeCatalog.routes.learningDescription'),
        targetPath: '/learning',
      },
    ]

    const projectEntries: RouteCatalogEntry[] = [
      {
        id: 'project-default',
        groupId: 'project',
        icon: 'project',
        label: t('common.routeCatalog.routes.projectDefaultLabel'),
        pattern: '/project/:projectId',
        description: t('common.routeCatalog.routes.projectDefaultDescription'),
        targetPath: projectPath(),
        targetLabel: projectTargetLabel,
        disabledReason: projectDisabledReason,
        projectId,
        preloadPane: 'code',
      },
      {
        id: 'project-code',
        groupId: 'project',
        icon: 'code',
        label: t('common.routeCatalog.routes.projectCodeLabel'),
        pattern: '/project/:projectId/code',
        description: t('common.routeCatalog.routes.projectCodeDescription'),
        targetPath: projectPath('code'),
        targetLabel: projectTargetLabel,
        disabledReason: projectDisabledReason,
        projectId,
        preloadPane: 'code',
      },
      {
        id: 'project-aicommit',
        groupId: 'project',
        icon: 'ai',
        label: t('common.routeCatalog.routes.projectAiCommitLabel'),
        pattern: '/project/:projectId/aicommit',
        description: t('common.routeCatalog.routes.projectAiCommitDescription'),
        targetPath: projectPath('aicommit'),
        targetLabel: projectTargetLabel,
        disabledReason: projectDisabledReason,
        projectId,
        preloadPane: 'aicommit',
      },
      {
        id: 'project-git-alias',
        groupId: 'project',
        icon: 'route',
        label: t('common.routeCatalog.routes.projectGitAliasLabel'),
        pattern: '/project/:projectId/git',
        description: t('common.routeCatalog.routes.projectGitAliasDescription'),
        targetPath: projectPath('git'),
        targetLabel: projectTargetLabel,
        disabledReason: projectDisabledReason,
        projectId,
        preloadPane: 'aicommit',
      },
      {
        id: 'project-transcript',
        groupId: 'project',
        icon: 'transcript',
        label: t('common.routeCatalog.routes.projectTranscriptLabel'),
        pattern: '/project/:projectId/transcript',
        description: t('common.routeCatalog.routes.projectTranscriptDescription'),
        targetPath: projectPath('transcript'),
        targetLabel: projectTargetLabel,
        disabledReason: projectDisabledReason,
        projectId,
        preloadPane: 'transcript',
      },
    ]

    const settingsEntries: RouteCatalogEntry[] = [
      {
        id: 'settings-default',
        groupId: 'settings',
        icon: 'settings',
        label: t('common.routeCatalog.routes.settingsDefaultLabel'),
        pattern: '/settings',
        description: t('common.routeCatalog.routes.settingsDefaultDescription'),
        targetPath: `/settings/${DEFAULT_SETTINGS_SECTION}`,
      },
      ...SETTINGS_SECTIONS.map((section) => ({
        id: `settings-${section}`,
        groupId: 'settings' as const,
        icon: 'settings' as const,
        label: getSettingsSectionLabel(section),
        pattern: `/settings/${section}`,
        description: t(settingsDescriptionKeyBySection[section]),
        targetPath: `/settings/${section}`,
      })),
      {
        id: 'settings-ai-runtime-alias',
        groupId: 'settings',
        icon: 'route',
        label: t('common.routeCatalog.routes.settingsAiRuntimeAliasLabel'),
        pattern: '/settings/ai-runtime',
        description: t('common.routeCatalog.routes.settingsAiRuntimeAliasDescription'),
        targetPath: '/settings/ai-runtime',
      },
      {
        id: 'settings-codex-alias',
        groupId: 'settings',
        icon: 'route',
        label: t('common.routeCatalog.routes.settingsCodexAliasLabel'),
        pattern: '/settings/codex',
        description: t('common.routeCatalog.routes.settingsCodexAliasDescription'),
        targetPath: '/settings/codex',
      },
    ]

    return [...baseEntries, ...projectEntries, ...settingsEntries]
  }, [getSettingsSectionLabel, routeProject, t, targetProjectLabel])

  const normalizedQuery = normalizeSearchText(query)
  const filteredEntries = useMemo(() => {
    if (!normalizedQuery) return entries

    return entries.filter((entry) =>
      normalizeSearchText([
        entry.label,
        entry.pattern,
        entry.description,
        entry.targetLabel ?? '',
        groups.find((group) => group.id === entry.groupId)?.label ?? '',
      ].join(' ')).includes(normalizedQuery)
    )
  }, [entries, groups, normalizedQuery])

  const handleOpenEntry = (entry: RouteCatalogEntry) => {
    if (!entry.targetPath) return

    if (entry.preloadPane) {
      preloadProjectPane(entry.preloadPane, { intent: 'navigate' })
    }
    if (entry.projectId) {
      updateLastOpened(entry.projectId)
    }
    onClose()
    navigate(entry.targetPath)
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      widthClassName="max-w-[980px]"
      baseZIndex={10020}
      ariaLabel={t('common.routeCatalog.title')}
      panelClassName="route-catalog-panel"
      overlayClassName="route-catalog-overlay"
    >
      <div className="route-catalog-header">
        <div className="route-catalog-title-row">
          <div className="route-catalog-title-mark">
            <Map className="h-5 w-5" strokeWidth={1.8} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="route-catalog-kicker">{t('common.routeCatalog.shortcutHint')}</div>
            <h2 className="route-catalog-title">{t('common.routeCatalog.title')}</h2>
            <p className="route-catalog-subtitle">{t('common.routeCatalog.subtitle')}</p>
          </div>
          <button
            type="button"
            className="route-catalog-close"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>

        <div className="route-catalog-toolbar">
          <label className="route-catalog-search">
            <Search className="h-4 w-4" strokeWidth={1.8} />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('common.routeCatalog.searchPlaceholder')}
            />
          </label>
          <div className="route-catalog-count">
            {t('common.routeCatalog.availableCount', {
              count: filteredEntries.length,
              total: entries.length,
            })}
          </div>
        </div>

        <div className="route-catalog-context">
          <div>
            <span>{t('common.routeCatalog.currentRoute')}</span>
            <code>{location.pathname}</code>
          </div>
          <div>
            <span>{t('common.routeCatalog.targetProject')}</span>
            <code>{targetProjectLabel}</code>
          </div>
        </div>
      </div>

      <div className="route-catalog-body">
        {groups.map((group) => {
          const groupEntries = filteredEntries.filter((entry) => entry.groupId === group.id)
          if (groupEntries.length === 0) return null

          return (
            <section key={group.id} className="route-catalog-group">
              <div className="route-catalog-group-header">
                <div>
                  <h3>{group.label}</h3>
                  <p>{group.description}</p>
                </div>
                <span>{groupEntries.length}</span>
              </div>

              <div className="route-catalog-list">
                {groupEntries.map((entry) => {
                  const Icon = routeIconMap[entry.icon]
                  const isCurrent = entry.targetPath === location.pathname
                  const isDisabled = !entry.targetPath

                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className={`route-catalog-item${isCurrent ? ' is-current' : ''}`}
                      disabled={isDisabled}
                      onClick={() => handleOpenEntry(entry)}
                    >
                      <span className="route-catalog-item-icon">
                        <Icon className="h-4 w-4" strokeWidth={1.8} />
                      </span>
                      <span className="route-catalog-item-main">
                        <span className="route-catalog-item-heading">
                          <span>{entry.label}</span>
                          {isCurrent ? (
                            <span className="route-catalog-current-badge">
                              {t('common.routeCatalog.currentBadge')}
                            </span>
                          ) : null}
                        </span>
                        <code className="route-catalog-pattern">{entry.pattern}</code>
                        <span className="route-catalog-description">{entry.description}</span>
                        {entry.targetLabel ? (
                          <span className="route-catalog-target">{entry.targetLabel}</span>
                        ) : null}
                        {entry.disabledReason ? (
                          <span className="route-catalog-disabled-reason">{entry.disabledReason}</span>
                        ) : null}
                      </span>
                      <span className="route-catalog-item-action" aria-label={t('common.routeCatalog.openRoute')}>
                        <ArrowRight className="h-4 w-4" strokeWidth={1.8} />
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          )
        })}

        {filteredEntries.length === 0 ? (
          <div className="route-catalog-empty">{t('common.noMatches')}</div>
        ) : null}
      </div>
    </ModalShell>
  )
}

export function RouteCatalogDialogHost() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onOpenRouteCatalog = () => setOpen(true)
    window.addEventListener('app:open-route-catalog', onOpenRouteCatalog as EventListener)
    return () => {
      window.removeEventListener('app:open-route-catalog', onOpenRouteCatalog as EventListener)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isRouteCatalogShortcut =
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'h'

      if (isRouteCatalogShortcut) {
        event.preventDefault()
        event.stopPropagation()
        if (event.repeat) return
        setOpen((prev) => !prev)
        return
      }

      if (open && event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open])

  return (
    <RouteCatalogDialog
      open={open}
      onClose={() => setOpen(false)}
    />
  )
}
