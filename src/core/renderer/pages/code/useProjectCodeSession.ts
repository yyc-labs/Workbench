import type { ProjectCodeSession } from '../../../shared/types'
import type { CodeFileDrawerState } from './code.types'

export const MAX_PROJECT_CODE_SESSION_TABS = 5
export const MAX_PROJECT_CODE_SESSION_CURSOR_POSITIONS = 60
export const PROJECT_CODE_SESSION_SAVE_DEBOUNCE_MS = 220
export const CODE_FILE_DRAWER_SECTION_LIMIT = 40

export type EditorCursorPosition = { lineNumber: number; column: number }

/** Add an opened file to the document-session tab list without duplicating or exceeding its cap. */
export function appendProjectCodeTab(tabs: string[], relativePath: string, limit = MAX_PROJECT_CODE_SESSION_TABS): string[] {
  const normalizedPath = relativePath.trim()
  if (!normalizedPath || tabs.includes(normalizedPath)) return tabs
  return [...tabs, normalizedPath].slice(-Math.max(1, limit))
}

function fallbackActiveTabPath(tabs: string[]): string | undefined {
  return tabs.length > 0 ? tabs[tabs.length - 1] : undefined
}

function normalizeContentSearchScope(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function normalizeProjectCodeCursorPosition(value: unknown): EditorCursorPosition | null {
  if (!value || typeof value !== 'object') return null
  const lineNumber = Math.max(1, Math.floor(Number((value as { lineNumber?: unknown }).lineNumber)))
  const column = Math.max(1, Math.floor(Number((value as { column?: unknown }).column)))
  if (!Number.isFinite(lineNumber) || !Number.isFinite(column)) return null
  return { lineNumber, column }
}

export function normalizeProjectCodeSession(value: ProjectCodeSession | undefined): ProjectCodeSession | undefined {
  if (!value) return undefined
  const tabs = Array.isArray(value.tabs) ? Array.from(new Set(value.tabs.map((item) => item.trim()).filter(Boolean))).slice(0, MAX_PROJECT_CODE_SESSION_TABS) : []

  const activePath = typeof value.activePath === 'string' ? value.activePath.trim() : ''
  const normalizedActivePath = activePath && tabs.includes(activePath) ? activePath : fallbackActiveTabPath(tabs)
  const cursorEntries: Array<[string, EditorCursorPosition]> = []

  if (value.cursorPositions && typeof value.cursorPositions === 'object') {
    for (const [pathKey, position] of Object.entries(value.cursorPositions)) {
      const normalizedPath = pathKey.trim()
      if (!normalizedPath) continue
      const normalizedPosition = normalizeProjectCodeCursorPosition(position)
      if (!normalizedPosition) continue
      cursorEntries.push([normalizedPath, normalizedPosition])
      if (cursorEntries.length >= MAX_PROJECT_CODE_SESSION_CURSOR_POSITIONS) break
    }
  }

  const cursorPositions = cursorEntries.length > 0 ? Object.fromEntries(cursorEntries) : undefined

  const contentSearchScope = normalizeContentSearchScope(value.contentSearchScope)

  if (tabs.length <= 0 && !cursorPositions && !contentSearchScope) return undefined

  return {
    tabs,
    activePath: normalizedActivePath,
    cursorPositions,
    contentSearchScope: contentSearchScope || undefined,
  }
}

function isSameStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false
  }
  return true
}

export function sanitizePathsForKnownFiles(paths: string[], knownFilePaths: Set<string>, limit: number): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const rawPath of paths) {
    const path = rawPath.trim()
    if (!path) continue
    if (!knownFilePaths.has(path)) continue
    if (seen.has(path)) continue
    seen.add(path)
    result.push(path)
    if (result.length >= limit) break
  }
  return result
}

export function isSameProjectCodeTabList(left: string[], right: string[]): boolean {
  return isSameStringArray(left, right)
}

export function isSameCursorPositionMap(left: Record<string, EditorCursorPosition>, right: Record<string, EditorCursorPosition>): boolean {
  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)
  if (leftEntries.length !== rightEntries.length) return false

  for (const [path, position] of leftEntries) {
    const next = right[path]
    if (!next) return false
    if (next.lineNumber !== position.lineNumber || next.column !== position.column) return false
  }

  return true
}

export function sanitizeCursorPositionsForTabs(cursorPositions: Record<string, EditorCursorPosition> | undefined, tabSet: Set<string>): Record<string, EditorCursorPosition> {
  if (!cursorPositions) return {}
  if (tabSet.size <= 0) return {}

  const result: Record<string, EditorCursorPosition> = {}
  for (const [path, position] of Object.entries(cursorPositions)) {
    if (!tabSet.has(path)) continue
    result[path] = position
    if (Object.keys(result).length >= MAX_PROJECT_CODE_SESSION_CURSOR_POSITIONS) break
  }
  return result
}

export function sanitizeCodeFileDrawerStateByPaths(state: CodeFileDrawerState, knownFilePaths: Set<string>): CodeFileDrawerState {
  return {
    favorites: sanitizePathsForKnownFiles(state.favorites, knownFilePaths, CODE_FILE_DRAWER_SECTION_LIMIT),
    recents: sanitizePathsForKnownFiles(state.recents, knownFilePaths, CODE_FILE_DRAWER_SECTION_LIMIT),
  }
}

export function sanitizeProjectCodeSessionByPaths(session: ProjectCodeSession | undefined, knownFilePaths: Set<string>): ProjectCodeSession | undefined {
  const normalized = normalizeProjectCodeSession(session)
  if (!normalized) return undefined

  const tabs = sanitizePathsForKnownFiles(normalized.tabs, knownFilePaths, MAX_PROJECT_CODE_SESSION_TABS)
  const tabSet = new Set(tabs)
  const cursorPositions = sanitizeCursorPositionsForTabs(normalized.cursorPositions, tabSet)
  const activePathRaw = normalized.activePath?.trim() || ''
  const activePath = activePathRaw && tabSet.has(activePathRaw) ? activePathRaw : fallbackActiveTabPath(tabs)

  return normalizeProjectCodeSession({
    tabs,
    activePath,
    cursorPositions: Object.keys(cursorPositions).length > 0 ? cursorPositions : undefined,
    contentSearchScope: normalized.contentSearchScope,
  })
}
