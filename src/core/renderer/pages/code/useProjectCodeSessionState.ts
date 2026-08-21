import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { ProjectCodeSession } from '../../../shared/types'
import type { CodeFileDrawerState } from './code.types'
import { buildKnownFilePathSet } from './code.tree'
import {
  isSameCursorPositionMap,
  isSameProjectCodeTabList,
  MAX_PROJECT_CODE_SESSION_CURSOR_POSITIONS,
  MAX_PROJECT_CODE_SESSION_TABS,
  normalizeProjectCodeSession,
  PROJECT_CODE_SESSION_SAVE_DEBOUNCE_MS,
  sanitizeCodeFileDrawerStateByPaths,
  sanitizeCursorPositionsForTabs,
  sanitizePathsForKnownFiles,
  sanitizeProjectCodeSessionByPaths,
  type EditorCursorPosition,
} from './useProjectCodeSession'
import { isSameCodeFileDrawerState, normalizeCodeFileDrawerState } from './code.helpers'

type UseProjectCodeSessionStateOptions = {
  projectId: string
  persistedProjectCodeSession: ProjectCodeSession | undefined
  persistedCodeFileDrawerState: CodeFileDrawerState | undefined
  persistedLastCodeFile?: string
  activeRelativePath: string | null
  contentSearchScopeInput: string
  setContentSearchScopeInput: Dispatch<SetStateAction<string>>
  knownFilePaths: Set<string>
  allProjectFilePathSet?: Set<string>
  excludedPaths?: ReadonlySet<string>
  treeStatus: 'idle' | 'loading' | 'ready' | 'error'
  setProjectCodeSession: (projectId: string, session?: ProjectCodeSession) => Promise<void>
  setProjectCodeFileDrawerState: (projectId: string, state: CodeFileDrawerState) => Promise<void>
  setProjectLastCodeFile: (projectId: string, relativePath?: string) => Promise<void>
}

export function useProjectCodeSessionState({
  projectId,
  persistedProjectCodeSession,
  persistedCodeFileDrawerState,
  persistedLastCodeFile,
  activeRelativePath,
  contentSearchScopeInput,
  setContentSearchScopeInput,
  knownFilePaths,
  allProjectFilePathSet,
  excludedPaths,
  treeStatus,
  setProjectCodeSession,
  setProjectCodeFileDrawerState,
  setProjectLastCodeFile,
}: UseProjectCodeSessionStateOptions) {
  const [openTabPaths, setOpenTabPaths] = useState<string[]>(() => persistedProjectCodeSession?.tabs ?? [])
  const [cursorPositionsByPath, setCursorPositionsByPath] = useState<Record<string, EditorCursorPosition>>(() => persistedProjectCodeSession?.cursorPositions ?? {})
  const [codeFileDrawerState, setCodeFileDrawerState] = useState<CodeFileDrawerState>(() => normalizeCodeFileDrawerState(persistedCodeFileDrawerState))
  // Tree paths are lazy-loaded by directory, so persisted session paths can be valid before they appear in the tree.
  const effectiveKnownFilePaths = useMemo(
    () => buildKnownFilePathSet(allProjectFilePathSet ?? knownFilePaths, openTabPaths, activeRelativePath, codeFileDrawerState, persistedProjectCodeSession, persistedLastCodeFile, excludedPaths),
    [activeRelativePath, allProjectFilePathSet, codeFileDrawerState, excludedPaths, knownFilePaths, openTabPaths, persistedLastCodeFile, persistedProjectCodeSession],
  )

  const saveCodeSessionTimerRef = useRef<number | null>(null)
  const lastPersistedCodeSessionJsonRef = useRef<string>('')
  const isRestoringCodeSessionRef = useRef(true)

  const visibleOpenTabs = useMemo(() => openTabPaths.filter((path) => effectiveKnownFilePaths.has(path)).slice(0, MAX_PROJECT_CODE_SESSION_TABS), [effectiveKnownFilePaths, openTabPaths])

  useEffect(() => {
    const normalized = normalizeCodeFileDrawerState(persistedCodeFileDrawerState)
    setCodeFileDrawerState((prev) => (isSameCodeFileDrawerState(prev, normalized) ? prev : normalized))
  }, [persistedCodeFileDrawerState, projectId])

  useEffect(() => {
    const normalizedSession = normalizeProjectCodeSession(persistedProjectCodeSession)
    setOpenTabPaths(normalizedSession?.tabs ?? [])
    setCursorPositionsByPath(normalizedSession?.cursorPositions ?? {})
    setContentSearchScopeInput(normalizedSession?.contentSearchScope ?? '')
    lastPersistedCodeSessionJsonRef.current = JSON.stringify(normalizedSession ?? null)
    if (saveCodeSessionTimerRef.current != null) {
      window.clearTimeout(saveCodeSessionTimerRef.current)
      saveCodeSessionTimerRef.current = null
    }
    isRestoringCodeSessionRef.current = true
  }, [persistedProjectCodeSession, projectId, setContentSearchScopeInput])

  useEffect(() => {
    if (!projectId) return
    void setProjectCodeFileDrawerState(projectId, codeFileDrawerState)
  }, [codeFileDrawerState, projectId, setProjectCodeFileDrawerState])

  useEffect(() => {
    if (!projectId) return
    // Avoid overwriting the persisted active tab before the initial restore picks a file.
    if (!activeRelativePath && isRestoringCodeSessionRef.current) return
    const activePath = activeRelativePath?.trim() || undefined
    // 被排除条目只作为解释视图，不进入 tab / session。
    const isExcludedPath = (path: string | undefined): boolean => Boolean(path && excludedPaths?.has(path))
    const persistableActivePath = isExcludedPath(activePath) ? undefined : activePath
    const tabs = openTabPaths.filter((path) => !isExcludedPath(path)).slice(0, MAX_PROJECT_CODE_SESSION_TABS)
    if (persistableActivePath && !tabs.includes(persistableActivePath)) {
      tabs.push(persistableActivePath)
      if (tabs.length > MAX_PROJECT_CODE_SESSION_TABS) {
        tabs.splice(0, tabs.length - MAX_PROJECT_CODE_SESSION_TABS)
      }
    }

    let sessionCursorEntries = Object.entries(cursorPositionsByPath).filter(([pathKey]) => pathKey.trim().length > 0)
    const sessionTabSet = new Set(tabs)
    sessionCursorEntries = sessionCursorEntries.filter(([pathKey]) => sessionTabSet.has(pathKey))
    if (sessionCursorEntries.length > MAX_PROJECT_CODE_SESSION_CURSOR_POSITIONS) {
      sessionCursorEntries = sessionCursorEntries.slice(0, MAX_PROJECT_CODE_SESSION_CURSOR_POSITIONS)
    }

    const nextSession = normalizeProjectCodeSession({
      tabs,
      activePath: persistableActivePath,
      cursorPositions: Object.fromEntries(sessionCursorEntries),
      contentSearchScope: contentSearchScopeInput,
    })
    const nextSessionJson = JSON.stringify(nextSession ?? null)
    if (nextSessionJson === lastPersistedCodeSessionJsonRef.current) return

    if (saveCodeSessionTimerRef.current != null) {
      window.clearTimeout(saveCodeSessionTimerRef.current)
    }
    saveCodeSessionTimerRef.current = window.setTimeout(() => {
      lastPersistedCodeSessionJsonRef.current = nextSessionJson
      void setProjectCodeSession(projectId, nextSession)
      saveCodeSessionTimerRef.current = null
    }, PROJECT_CODE_SESSION_SAVE_DEBOUNCE_MS)
  }, [activeRelativePath, contentSearchScopeInput, cursorPositionsByPath, excludedPaths, openTabPaths, projectId, setProjectCodeSession])

  useEffect(() => {
    if (treeStatus !== 'ready') return

    const sanitizedLocalTabs = sanitizePathsForKnownFiles(openTabPaths, effectiveKnownFilePaths, MAX_PROJECT_CODE_SESSION_TABS)
    if (!isSameProjectCodeTabList(openTabPaths, sanitizedLocalTabs)) {
      setOpenTabPaths(sanitizedLocalTabs)
    }

    const tabSet = new Set(sanitizedLocalTabs)
    const sanitizedLocalCursors = sanitizeCursorPositionsForTabs(cursorPositionsByPath, tabSet)
    if (!isSameCursorPositionMap(cursorPositionsByPath, sanitizedLocalCursors)) {
      setCursorPositionsByPath(sanitizedLocalCursors)
    }

    const normalizedPersistedSession = normalizeProjectCodeSession(persistedProjectCodeSession)
    const sanitizedPersistedSession = sanitizeProjectCodeSessionByPaths(persistedProjectCodeSession, effectiveKnownFilePaths)
    const normalizedPersistedSessionJson = JSON.stringify(normalizedPersistedSession ?? null)
    const sanitizedPersistedSessionJson = JSON.stringify(sanitizedPersistedSession ?? null)
    if (normalizedPersistedSessionJson !== sanitizedPersistedSessionJson) {
      lastPersistedCodeSessionJsonRef.current = sanitizedPersistedSessionJson
      if (saveCodeSessionTimerRef.current != null) {
        window.clearTimeout(saveCodeSessionTimerRef.current)
        saveCodeSessionTimerRef.current = null
      }
      void setProjectCodeSession(projectId, sanitizedPersistedSession)
    }

    const normalizedPersistedDrawer = normalizeCodeFileDrawerState(persistedCodeFileDrawerState)
    const sanitizedPersistedDrawer = sanitizeCodeFileDrawerStateByPaths(normalizedPersistedDrawer, effectiveKnownFilePaths)
    if (!isSameCodeFileDrawerState(normalizedPersistedDrawer, sanitizedPersistedDrawer)) {
      void setProjectCodeFileDrawerState(projectId, sanitizedPersistedDrawer)
    }

    const normalizedLastCodeFile = persistedLastCodeFile?.trim()
    if (normalizedLastCodeFile && !effectiveKnownFilePaths.has(normalizedLastCodeFile)) {
      void setProjectLastCodeFile(projectId, undefined)
    }
  }, [cursorPositionsByPath, effectiveKnownFilePaths, openTabPaths, persistedCodeFileDrawerState, persistedLastCodeFile, persistedProjectCodeSession, projectId, setProjectCodeFileDrawerState, setProjectCodeSession, setProjectLastCodeFile, treeStatus])

  useEffect(() => {
    return () => {
      if (saveCodeSessionTimerRef.current != null) {
        window.clearTimeout(saveCodeSessionTimerRef.current)
        saveCodeSessionTimerRef.current = null
      }
    }
  }, [])

  return {
    codeFileDrawerState,
    cursorPositionsByPath,
    isRestoringCodeSessionRef,
    openTabPaths,
    setCodeFileDrawerState,
    setCursorPositionsByPath,
    setOpenTabPaths,
    visibleOpenTabs,
  }
}
