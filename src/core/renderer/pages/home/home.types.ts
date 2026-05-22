import type { ProjectInfo, ProjectFolder, ProjectTag, StartupDefaultFilter } from '../../../shared/types'
import type { ClassifierFilter } from '../../components/WorkspaceClassifierPanel'

export type EnvFilter = 'all' | 'ubuntu' | 'windows'

export interface EnvGroup {
  key: EnvFilter | 'other'
  label: string
  projects: ProjectInfo[]
}

export type EnvGroupKey = 'ubuntu' | 'windows' | 'other'

export type HomeClassifierCounts = {
  all: number
  pinned: number
  running: number
  uncategorized: number
  byFolder: Record<string, number>
  byTag: Record<string, number>
}

export type HomeProjectsContentProps = {
  folders: ProjectFolder[]
  tags: ProjectTag[]
  configStartupDefaultFilter?: StartupDefaultFilter
  classifierFilter: ClassifierFilter
  classifierCounts: HomeClassifierCounts
  setClassifierFilter: (filter: ClassifierFilter) => void
  reorderFolders: (activeFolderId: string, overFolderId: string) => Promise<void>
  reorderTags: (activeTagId: string, overTagId: string) => Promise<void>
  setStartupDefaultFilter: (filter?: ClassifierFilter) => Promise<void>
  pinnedProjects: ProjectInfo[]
  recentProjects: ProjectInfo[]
  groupedRecentProjects: EnvGroup[]
  envFilteredProjectsCount: number
  runningCount: number
  onSelect: (id: string) => void
  searchQuery: string
  envFilter: EnvFilter
}
