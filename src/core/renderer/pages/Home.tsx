import { useEffect, useCallback, useState, useRef, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { detectProjectEnvironment, projectEnvironmentLabel, type ProjectEnvironment } from '../lib/projectEnvironment'
import { projectDisplayName, projectDisplayType } from '../lib/projectDisplay'
import { WorkspaceManagerDialog } from '../components/ProjectMetaDialog'
import { HomeEmptyState } from './home/HomeEmptyState'
import { HomeProjectsContent } from './home/HomeProjectsContent'
import { HomeToolbar } from './home/HomeToolbar'
import { useLocale } from '../i18n'
import type { EnvGroup, EnvGroupKey } from './home/home.types'

export function HomePage() {
  const locale = useLocale()
  const location = useLocation()
  const projects = useAppStore((s) => s.projects)
  const folders = useAppStore((s) => s.folders)
  const tags = useAppStore((s) => s.tags)
  const isAppReady = useAppStore((s) => s.isAppReady)
  const config = useAppStore((s) => s.config)
  const sessions = useAppStore((s) => s.sessions)
  const processes = useAppStore((s) => s.processes)
  const searchQuery = useAppStore((s) => s.searchQuery)
  const envFilter = useAppStore((s) => s.homeEnvFilter)
  const classifierFilter = useAppStore((s) => s.homeClassifierFilter)
  const homeDefaultFilterApplied = useAppStore((s) => s.homeDefaultFilterApplied)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const setEnvFilter = useAppStore((s) => s.setHomeEnvFilter)
  const setClassifierFilter = useAppStore((s) => s.setHomeClassifierFilter)
  const markHomeDefaultFilterApplied = useAppStore((s) => s.markHomeDefaultFilterApplied)
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
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false)
  const lastGestureResetAtRef = useRef<number>(0)

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
    if (!isAppReady || homeDefaultFilterApplied) return
    markHomeDefaultFilterApplied()

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
  }, [config.startupDefaultFilter, folders, homeDefaultFilterApplied, isAppReady, markHomeDefaultFilterApplied, setClassifierFilter, setStartupDefaultFilter, tags])

  useEffect(() => {
    const marker = (location.state as { gestureResetToStartupDefault?: number } | null)?.gestureResetToStartupDefault
    if (!marker || marker === lastGestureResetAtRef.current) return
    lastGestureResetAtRef.current = marker

    setSearchQuery('')
    setEnvFilter('all')

    const defaultFilter = config.startupDefaultFilter
    if (!defaultFilter) {
      setClassifierFilter({ type: 'all' })
      return
    }

    if (defaultFilter.type === 'folder') {
      const exists = folders.some((folder) => folder.id === defaultFilter.folderId)
      setClassifierFilter(exists ? defaultFilter : { type: 'all' })
      return
    }

    if (defaultFilter.type === 'tag') {
      const exists = tags.some((tag) => tag.id === defaultFilter.tagId)
      setClassifierFilter(exists ? defaultFilter : { type: 'all' })
      return
    }

    setClassifierFilter(defaultFilter)
  }, [config.startupDefaultFilter, folders, location.state, setClassifierFilter, setEnvFilter, setSearchQuery, tags])

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects
    const q = searchQuery.toLowerCase().trim()
    return projects.filter((p) => p.name.toLowerCase().includes(q) || projectDisplayName(p).toLowerCase().includes(q) || p.path.toLowerCase().includes(q) || p.type.toLowerCase().includes(q) || projectDisplayType(p).toLowerCase().includes(q))
  }, [projects, searchQuery])

  const envByPath = useMemo(() => {
    const map = new Map<string, ProjectEnvironment>()
    for (const p of filteredProjects) {
      map.set(p.path, detectProjectEnvironment(p.path))
    }
    return map
  }, [filteredProjects])

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
        return envFilteredProjects.filter((p) => {
          const status = processes[p.id]?.status
          return status === 'running' || status === 'stopping'
        })
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
      ubuntu: { key: 'ubuntu', label: projectEnvironmentLabel('ubuntu', locale), projects: [] },
      windows: { key: 'windows', label: projectEnvironmentLabel('windows', locale), projects: [] },
      other: { key: 'other', label: locale === 'zh-CN' ? '其他' : 'Other', projects: [] },
    }

    for (const p of recentProjects) {
      const env = envByPath.get(p.path) ?? 'unknown'
      if (env === 'ubuntu' || env === 'windows') {
        groups[env].projects.push(p)
      } else {
        groups.other.projects.push(p)
      }
    }

    return groupOrder.map((k) => groups[k]).filter((g) => g.projects.length > 0)
  }, [recentProjects, envByPath, locale])

  const runningCount = useMemo(() => Object.values(sessions).filter((s) => s.status !== 'stopped').length, [sessions])

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
      running: envFilteredProjects.filter((p) => {
        const status = processes[p.id]?.status
        return status === 'running' || status === 'stopping'
      }).length,
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
      navigate(`/project/${id}/code`)
    },
    [updateLastOpened, navigate],
  )

  if (!isAppReady) {
    return <div className="h-full" />
  }

  if (projects.length === 0) {
    return (
      <HomeEmptyState
        onAddFolder={() => {
          void handleAddFolder()
        }}
        onOpenLearningCenter={() => navigate('/learning')}
        onOpenSettings={() => navigate('/settings')}
      />
    )
  }

  return (
    <div className="h-full flex flex-col">
      <HomeToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        envFilter={envFilter}
        onEnvFilterChange={setEnvFilter}
        onAddFolder={() => {
          void handleAddFolder()
        }}
        onLearningCenterClick={() => navigate('/learning')}
        onSettingsClick={() => navigate('/settings')}
        onManageWorkspace={() => setWorkspaceDialogOpen(true)}
        searchRef={searchRef}
      />

      <HomeProjectsContent
        folders={folders}
        tags={tags}
        configStartupDefaultFilter={config.startupDefaultFilter}
        classifierFilter={classifierFilter}
        classifierCounts={classifierCounts}
        setClassifierFilter={setClassifierFilter}
        reorderFolders={reorderFolders}
        reorderTags={reorderTags}
        setStartupDefaultFilter={setStartupDefaultFilter}
        pinnedProjects={pinnedProjects}
        recentProjects={recentProjects}
        groupedRecentProjects={groupedRecentProjects}
        envFilteredProjectsCount={envFilteredProjects.length}
        runningCount={runningCount}
        onSelect={handleSelect}
        searchQuery={searchQuery}
        envFilter={envFilter}
      />

      <WorkspaceManagerDialog open={workspaceDialogOpen} folders={folders} tags={tags} onClose={() => setWorkspaceDialogOpen(false)} onCreateFolder={createFolder} onRenameFolder={renameFolder} onRemoveFolder={removeFolder} onCreateTag={createTag} onRenameTag={renameTag} onRemoveTag={removeTag} />
    </div>
  )
}
