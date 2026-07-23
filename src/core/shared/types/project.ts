/** Project/workspace domain contract. */
export type ProjectType = 'next.js' | 'vite' | 'android' | 'nuxt' | 'node' | 'django' | 'flask' | 'fastapi' | 'python' | 'unknown'

export type {
  DetectionRule,
  ProjectCodeCursorPosition,
  ProjectCodeFileDrawerState,
  ProjectCodeSession,
  ProjectDocLink,
  ProjectDocLinkKind,
  ProjectDocLinkSshRoute,
  ProjectDocLinkTag,
  ProjectFolder,
  ProjectInfo,
  ProjectTag,
  SavedProject,
} from '../types'
