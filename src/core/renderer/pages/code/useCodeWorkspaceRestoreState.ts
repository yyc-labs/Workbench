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
  const pendingRevealRef = useRef<RevealLocation | null>(null)
  const pendingCursorRevealRef = useRef<RevealLocation | null>(null)
  const revealInEditor = useCallback((location: RevealLocation | null): boolean => {
    if (!location) return false
    const editor = editorRef.current
    if (!editor) return false
    editor.revealPosition(location.lineNumber, location.column)
    return true
  }, [editorRef])
  const revealPendingLocation = useCallback((location: RevealLocation | null): boolean => {
    if (!location) return false

    let handled = false
    if (isShowingPreview) {
      handled = revealPreviewPosition(location.lineNumber, location.column) || handled
    }
    if (isShowingEditor) {
      handled = revealInEditor(location) || handled
    }
    return handled
  }, [isShowingEditor, isShowingPreview, revealInEditor, revealPreviewPosition])

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
      if (revealPendingLocation(pending)) {
        pendingRevealRef.current = null
      }
    }, 0)
  }, [openFile, revealPendingLocation])

  useEffect(() => {
    const pending = pendingRevealRef.current
    if (!pending || pending.relativePath !== activeRelativePath) return
    if (!isShowingEditor && !isShowingPreview) return
    if (revealPendingLocation(pending)) {
      pendingRevealRef.current = null
    }
  }, [activeRelativePath, editorValue, isShowingEditor, isShowingPreview, revealPendingLocation])

  useEffect(() => {
    const pending = pendingCursorRevealRef.current
    if (!pending || pending.relativePath !== activeRelativePath) return
    if (isShowingEditor && revealInEditor(pending)) {
      pendingCursorRevealRef.current = null
    }
  }, [activeRelativePath, editorValue, isShowingEditor, revealInEditor])

  return {
    handleOpenedCodeFile,
    openContentSearchMatch,
  }
}
