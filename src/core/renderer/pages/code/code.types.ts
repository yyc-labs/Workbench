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
  skippedDirectories: number
  skippedFiles: number
}

export interface CodeFileDrawerState {
  favorites: string[]
  recents: string[]
}
