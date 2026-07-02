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
  isShowingPreview: boolean
  isShowingEditor: boolean
  isRestoringCodeSessionRef: MutableRefObject<boolean>
  openFile: (relativePath: string, preferDisk?: boolean) => Promise<boolean>
  persistedLastCodeFile?: string
  persistedProjectCodeSession: ProjectCodeSession | undefined
  projectId: string
  revealPreviewPosition: (lineNumber: number, column: number) => boolean
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
  isShowingPreview,
  isShowingEditor,
  isRestoringCodeSessionRef,
  openFile,
  persistedLastCodeFile,
  persistedProjectCodeSession,
  projectId,
  revealPreviewPosition,
  treeStatus,
}: UseCodeWorkspaceRestoreStateOptions) {
  const [hasAttemptedInitialRestore, setHasAttemptedInitialRestore] = useState(false)
  const [isRestoringCodeSession, setIsRestoringCodeSession] = useState(true)
  const pendingRevealRef = useRef<RevealLocation | null>(null)
  const pendingCursorRevealRef = useRef<RevealLocation | null>(null)
  const pendingRevealRetryTimerRef = useRef<number | null>(null)
  const pendingRevealRetryCountRef = useRef(0)
  const lastAutoRevealedCursorKeyRef = useRef<string | null>(null)
  const revealInEditor = useCallback((location: RevealLocation | null, highlight = false): boolean => {
    if (!location) return false
    const editor = editorRef.current
    if (!editor) return false
    editor.revealPosition(location.lineNumber, location.column)
    if (highlight) {
      editor.highlightLine(location.lineNumber)
    }
    return true
  }, [editorRef])
  const revealPendingLocation = useCallback((location: RevealLocation | null): boolean => {
    if (!location) return false

    let handled = false
    if (isShowingPreview) {
      handled = revealPreviewPosition(location.lineNumber, location.column) || handled
    }
    if (isShowingEditor) {
      handled = revealInEditor(location, true) || handled
    }
    return handled
  }, [isShowingEditor, isShowingPreview, revealInEditor, revealPreviewPosition])

  const clearPendingRevealRetry = useCallback(() => {
    if (pendingRevealRetryTimerRef.current != null) {
      window.clearTimeout(pendingRevealRetryTimerRef.current)
      pendingRevealRetryTimerRef.current = null
    }
    pendingRevealRetryCountRef.current = 0
  }, [])

  const flushPendingReveal = useCallback((): boolean => {
    let hasPending = false

    const pendingReveal = pendingRevealRef.current
    if (pendingReveal) {
      if (pendingReveal.relativePath === activeRelativePath && (isShowingEditor || isShowingPreview)) {
        if (revealPendingLocation(pendingReveal)) {
          pendingRevealRef.current = null
        } else {
          hasPending = true
        }
      } else {
        hasPending = true
      }
    }

    const pendingCursorReveal = pendingCursorRevealRef.current
    if (pendingCursorReveal) {
      if (pendingCursorReveal.relativePath === activeRelativePath && isShowingEditor) {
        if (revealInEditor(pendingCursorReveal)) {
          pendingCursorRevealRef.current = null
        } else {
          hasPending = true
        }
      } else {
        hasPending = true
      }
    }

    return hasPending
  }, [activeRelativePath, isShowingEditor, isShowingPreview, revealInEditor, revealPendingLocation])

  const schedulePendingRevealFlush = useCallback(() => {
    clearPendingRevealRetry()

    const run = () => {
      pendingRevealRetryCountRef.current += 1
      const hasPending = flushPendingReveal()
      if (hasPending && pendingRevealRetryCountRef.current < 240) {
        pendingRevealRetryTimerRef.current = window.setTimeout(run, 16)
        return
      }
      pendingRevealRetryTimerRef.current = null
      pendingRevealRetryCountRef.current = 0
    }

    pendingRevealRetryTimerRef.current = window.setTimeout(run, 0)
  }, [clearPendingRevealRetry, flushPendingReveal])

  useEffect(() => {
    setHasAttemptedInitialRestore(false)
    setIsRestoringCodeSession(true)
    pendingRevealRef.current = null
    pendingCursorRevealRef.current = null
    clearPendingRevealRetry()
    lastAutoRevealedCursorKeyRef.current = null
  }, [clearPendingRevealRetry, projectId])

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
      sanitizedSession?.tabs[sanitizedSession.tabs.length - 1]?.trim() || '',
    ].filter(Boolean)))

    if (restoreCandidates.length <= 0) {
      isRestoringCodeSessionRef.current = false
      setIsRestoringCodeSession(false)
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
        setIsRestoringCodeSession(false)
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
        schedulePendingRevealFlush()
      }
      return
    }

    pendingCursorRevealRef.current = null
  }, [isRestoringCodeSessionRef, persistedProjectCodeSession?.cursorPositions, schedulePendingRevealFlush])

  const openContentSearchMatch = useCallback(async (relativePath: string, lineNumber: number, column: number) => {
    const opened = await openFile(relativePath)
    if (!opened) return
    pendingRevealRef.current = { relativePath, lineNumber, column }
    schedulePendingRevealFlush()
  }, [openFile, schedulePendingRevealFlush])

  useEffect(() => {
    if (!pendingRevealRef.current && !pendingCursorRevealRef.current) return
    schedulePendingRevealFlush()
  }, [activeRelativePath, editorValue, isShowingEditor, isShowingPreview, schedulePendingRevealFlush])

  useEffect(() => {
    return () => {
      clearPendingRevealRetry()
    }
  }, [clearPendingRevealRetry])

  useEffect(() => {
    if (!activeRelativePath || isRestoringCodeSessionRef.current) return
    const persistedCursor = persistedProjectCodeSession?.cursorPositions?.[activeRelativePath]
    if (!persistedCursor) return

    const revealKey = `${activeRelativePath}:${persistedCursor.lineNumber}:${persistedCursor.column}:${isShowingEditor ? 'editor' : 'preview'}`
    if (lastAutoRevealedCursorKeyRef.current === revealKey) return

    const handled = isShowingEditor
      ? revealInEditor({
        relativePath: activeRelativePath,
        lineNumber: persistedCursor.lineNumber,
        column: persistedCursor.column,
      })
      : isShowingPreview
        ? revealPreviewPosition(persistedCursor.lineNumber, persistedCursor.column)
        : false

    if (handled) {
      lastAutoRevealedCursorKeyRef.current = revealKey
    }
  }, [
    activeRelativePath,
    isShowingEditor,
    isShowingPreview,
    isRestoringCodeSessionRef,
    persistedProjectCodeSession?.cursorPositions,
    revealInEditor,
    revealPreviewPosition,
  ])

  return {
    handleOpenedCodeFile,
    isRestoringCodeSession,
    openContentSearchMatch,
  }
}
