import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import type { ProjectCodeSession } from '../../../shared/types'
import type { MonacoCodeEditorHandle } from './MonacoCodeEditor'
import { sanitizeProjectCodeSessionByPaths } from './useProjectCodeSession'

type UseCodeWorkspaceRestoreStateOptions = {
  activeRelativePath: string | null
  allProjectFilePathSet: Set<string>
  editorRef: RefObject<MonacoCodeEditorHandle | null>
  editorValue: string
  ensureTreePathLoaded: (relativePath: string) => Promise<void>
  isRestoringCodeSessionRef: MutableRefObject<boolean>
  openFile: (relativePath: string, preferDisk?: boolean) => Promise<boolean>
  persistedLastCodeFile?: string
  persistedProjectCodeSession: ProjectCodeSession | undefined
  projectId: string
  treeStatus: 'idle' | 'loading' | 'ready' | 'error'
}

type RevealLocation = {
  relativePath: string
  lineNumber: number
  column: number
}

export function useCodeWorkspaceRestoreState({
  activeRelativePath,
  allProjectFilePathSet,
  editorRef,
  editorValue,
  ensureTreePathLoaded,
  isRestoringCodeSessionRef,
  openFile,
  persistedLastCodeFile,
  persistedProjectCodeSession,
  projectId,
  treeStatus,
}: UseCodeWorkspaceRestoreStateOptions) {
  const [hasAttemptedInitialRestore, setHasAttemptedInitialRestore] = useState(false)
  const pendingRevealRef = useRef<RevealLocation | null>(null)
  const pendingCursorRevealRef = useRef<RevealLocation | null>(null)

  useEffect(() => {
    setHasAttemptedInitialRestore(false)
    pendingRevealRef.current = null
    pendingCursorRevealRef.current = null
  }, [projectId])

  useEffect(() => {
    if (treeStatus !== 'ready') return
    if (hasAttemptedInitialRestore) return
    setHasAttemptedInitialRestore(true)

    const sanitizedSession = sanitizeProjectCodeSessionByPaths(
      persistedProjectCodeSession,
      allProjectFilePathSet
    )
    const restoreCandidates = Array.from(new Set([
      persistedLastCodeFile?.trim() || '',
      sanitizedSession?.activePath?.trim() || '',
      sanitizedSession?.tabs[0]?.trim() || '',
    ].filter(Boolean)))

    if (restoreCandidates.length <= 0) {
      isRestoringCodeSessionRef.current = false
      return
    }

    void (async () => {
      for (const relativePath of restoreCandidates) {
        try {
          await ensureTreePathLoaded(relativePath)
          const opened = await openFile(relativePath)
          if (opened) return
        } catch {
          continue
        }
      }
    })()
      .finally(() => {
        isRestoringCodeSessionRef.current = false
      })
  }, [
    allProjectFilePathSet,
    ensureTreePathLoaded,
    hasAttemptedInitialRestore,
    isRestoringCodeSessionRef,
    openFile,
    persistedLastCodeFile,
    persistedProjectCodeSession,
    treeStatus,
  ])

  const handleOpenedCodeFile = useCallback((relativePath: string) => {
    const normalizedPath = relativePath.trim()
    if (!normalizedPath) return

    if (isRestoringCodeSessionRef.current) {
      const persistedCursor = persistedProjectCodeSession?.cursorPositions?.[normalizedPath]
      if (persistedCursor) {
        pendingCursorRevealRef.current = {
          relativePath: normalizedPath,
          lineNumber: persistedCursor.lineNumber,
          column: persistedCursor.column,
        }
      }
      return
    }

    pendingCursorRevealRef.current = null
  }, [isRestoringCodeSessionRef, persistedProjectCodeSession?.cursorPositions])

  const openContentSearchMatch = useCallback(async (relativePath: string, lineNumber: number, column: number) => {
    const opened = await openFile(relativePath)
    if (!opened) return
    pendingRevealRef.current = { relativePath, lineNumber, column }
    window.setTimeout(() => {
      const pending = pendingRevealRef.current
      if (!pending) return
      if (pending.relativePath !== relativePath || pending.lineNumber !== lineNumber || pending.column !== column) return
      editorRef.current?.revealPosition(lineNumber, column)
    }, 0)
  }, [editorRef, openFile])

  useEffect(() => {
    const pending = pendingRevealRef.current
    if (!pending || pending.relativePath !== activeRelativePath) return
    editorRef.current?.revealPosition(pending.lineNumber, pending.column)
    pendingRevealRef.current = null
  }, [activeRelativePath, editorRef, editorValue])

  useEffect(() => {
    const pending = pendingCursorRevealRef.current
    if (!pending || pending.relativePath !== activeRelativePath) return
    editorRef.current?.revealPosition(pending.lineNumber, pending.column)
    pendingCursorRevealRef.current = null
  }, [activeRelativePath, editorRef, editorValue])

  return {
    handleOpenedCodeFile,
    openContentSearchMatch,
  }
}
