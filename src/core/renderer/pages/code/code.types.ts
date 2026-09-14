import type { ProjectFileNode, ProjectFileReadResult } from '../../../shared/types'

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface ActiveCodeFile extends ProjectFileReadResult {
  relativePath: string
}

export interface FileTreeState {
  status: LoadStatus
  nodes: ProjectFileNode[]
  error: string | null
  knownFilePaths: Set<string>
  loadingDirectories: Set<string>
  isRefreshingRoot: boolean
  lastRootLoadedAtMs: number | null
  lastRootRefreshStartedAtMs: number | null
  autoLoadBlocked: boolean
  autoLoadFileCountSample: number
  autoLoadLimit: number
}

export interface CodeFileDrawerState {
  favorites: string[]
  recents: string[]
}

/** 文件搜索查询中 `path:N` / `path:N-M` 携带的行区间定位目标。 */
export interface FileSearchLineTarget {
  startLine: number
  endLine: number
}
