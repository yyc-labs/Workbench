import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { MonacoCodeEditorHandle, MonacoEditorScrollState } from './MonacoCodeEditor'
import { getMarkdownPreviewSourceLineAtScrollTop, scrollMarkdownPreviewToSourceLine } from './code.markdownShared'
import type { MarkdownPreviewMode, MarkdownScrollModeKey } from './code.workspace.types'

type UseCodeWorkspaceScrollSyncOptions = {
  activeRelativePath: string | null
  editorRef: RefObject<MonacoCodeEditorHandle | null>
  isMarkdownFile: boolean
  isShowingEditor: boolean
  isShowingPreview: boolean
  markdownPreviewContent: string
  previewMode: MarkdownPreviewMode
  previewScrollRef: RefObject<HTMLDivElement | null>
}

function pickFirstFiniteScrollTop(...values: Array<number | undefined>): number {
  for (const value of values) {
    if (Number.isFinite(value)) {
      return Math.max(0, Number(value))
    }
  }
  return 0
}

export function useCodeWorkspaceScrollSync({ activeRelativePath, editorRef, isMarkdownFile, isShowingEditor, isShowingPreview, markdownPreviewContent, previewMode, previewScrollRef }: UseCodeWorkspaceScrollSyncOptions) {
  const editorScrollStateRef = useRef<MonacoEditorScrollState | null>(null)
  const previewScrollStateRef = useRef<{ scrollTop: number; scrollHeight: number; viewportHeight: number } | null>(null)
  const markdownScrollMemoryRef = useRef<Record<string, Partial<Record<MarkdownScrollModeKey, number>>>>({})
  const activeScrollSyncSourceRef = useRef<'editor' | 'preview' | null>(null)
  const scrollSyncReleaseTimerRef = useRef<number | null>(null)
  const pendingModeSwitchRef = useRef<{ from: MarkdownPreviewMode; to: MarkdownPreviewMode } | null>(null)
  const pendingEditorRestoreTopRef = useRef<number | null>(null)
  const pendingEditorRestoreReleaseTimerRef = useRef<number | null>(null)
  const lastEditorSourceLineRef = useRef<number | null>(null)
  const lastPreviewSourceLineRef = useRef<number | null>(null)
  const previousPreviewModeRef = useRef<MarkdownPreviewMode>(previewMode)
  const splitSyncReadyRef = useRef(false)

  const setActiveSyncSource = useCallback((source: 'editor' | 'preview') => {
    activeScrollSyncSourceRef.current = source
    if (scrollSyncReleaseTimerRef.current != null) {
      window.clearTimeout(scrollSyncReleaseTimerRef.current)
    }
    scrollSyncReleaseTimerRef.current = window.setTimeout(() => {
      activeScrollSyncSourceRef.current = null
      scrollSyncReleaseTimerRef.current = null
    }, 64)
  }, [])

  const storeScrollTop = useCallback((path: string, key: MarkdownScrollModeKey, scrollTop: number) => {
    if (!Number.isFinite(scrollTop)) return
    const current = markdownScrollMemoryRef.current[path] ?? {}
    markdownScrollMemoryRef.current[path] = {
      ...current,
      [key]: Math.max(0, scrollTop),
    }
  }, [])

  const mapScrollTopByRatio = useCallback((source: { scrollTop: number; scrollHeight: number; viewportHeight: number } | null, target: { scrollHeight: number; viewportHeight: number } | null): number | null => {
    if (!source || !target) return null
    const sourceMax = Math.max(0, source.scrollHeight - source.viewportHeight)
    const targetMax = Math.max(0, target.scrollHeight - target.viewportHeight)
    if (sourceMax <= 0 || targetMax <= 0) return 0
    const ratio = Math.min(1, Math.max(0, source.scrollTop / sourceMax))
    return ratio * targetMax
  }, [])

  const applyPreviewScrollTop = useCallback(
    (scrollTop: number) => {
      const preview = previewScrollRef.current
      if (!preview) return
      preview.scrollTop = Math.max(0, scrollTop)
    },
    [previewScrollRef],
  )

  const applyEditorScrollTop = useCallback(
    (scrollTop: number) => {
      editorRef.current?.setScrollTop(Math.max(0, scrollTop))
    },
    [editorRef],
  )

  const applyEditorScrollTopForLine = useCallback(
    (lineNumber: number) => {
      editorRef.current?.setScrollTopForLine(lineNumber)
    },
    [editorRef],
  )

  const restoreEditorScrollTop = useCallback(
    (scrollTop: number) => {
      const normalized = Math.max(0, scrollTop)
      pendingEditorRestoreTopRef.current = normalized
      if (pendingEditorRestoreReleaseTimerRef.current != null) {
        window.clearTimeout(pendingEditorRestoreReleaseTimerRef.current)
      }
      editorRef.current?.setScrollTop(normalized)
      pendingEditorRestoreReleaseTimerRef.current = window.setTimeout(() => {
        pendingEditorRestoreTopRef.current = null
        pendingEditorRestoreReleaseTimerRef.current = null
      }, 80)
    },
    [editorRef],
  )

  const captureCurrentModeScroll = useCallback(() => {
    if (!isMarkdownFile || !activeRelativePath) return

    if (previewMode === 'edit') {
      const state = editorRef.current?.getScrollState() ?? editorScrollStateRef.current
      if (state) {
        lastEditorSourceLineRef.current = state.firstVisibleLine
        const current = markdownScrollMemoryRef.current[activeRelativePath] ?? {}
        markdownScrollMemoryRef.current[activeRelativePath] = {
          ...current,
          edit: Math.max(0, state.scrollTop),
        }
      }
      return
    }

    if (previewMode === 'preview') {
      const preview = previewScrollRef.current
      if (preview) {
        lastPreviewSourceLineRef.current = getMarkdownPreviewSourceLineAtScrollTop(preview)
        const current = markdownScrollMemoryRef.current[activeRelativePath] ?? {}
        markdownScrollMemoryRef.current[activeRelativePath] = {
          ...current,
          preview: Math.max(0, preview.scrollTop),
        }
      }
      return
    }

    const editorState = editorRef.current?.getScrollState() ?? editorScrollStateRef.current
    const preview = previewScrollRef.current
    lastEditorSourceLineRef.current = editorState?.firstVisibleLine ?? lastEditorSourceLineRef.current
    lastPreviewSourceLineRef.current = preview ? getMarkdownPreviewSourceLineAtScrollTop(preview) : lastPreviewSourceLineRef.current
    const current = markdownScrollMemoryRef.current[activeRelativePath] ?? {}
    markdownScrollMemoryRef.current[activeRelativePath] = {
      ...current,
      splitEditor: editorState ? Math.max(0, editorState.scrollTop) : current.splitEditor,
      splitPreview: preview ? Math.max(0, preview.scrollTop) : current.splitPreview,
    }
  }, [activeRelativePath, editorRef, isMarkdownFile, previewMode, previewScrollRef])

  const resetScrollSyncState = useCallback(() => {
    splitSyncReadyRef.current = false
    activeScrollSyncSourceRef.current = null
    pendingEditorRestoreTopRef.current = null
  }, [])

  useLayoutEffect(() => {
    const previous = previousPreviewModeRef.current
    if (previous === previewMode) return
    activeScrollSyncSourceRef.current = null
    pendingEditorRestoreTopRef.current = null
    pendingModeSwitchRef.current = { from: previous, to: previewMode }
    previousPreviewModeRef.current = previewMode
  }, [previewMode])

  useEffect(() => {
    return () => {
      if (scrollSyncReleaseTimerRef.current != null) {
        window.clearTimeout(scrollSyncReleaseTimerRef.current)
        scrollSyncReleaseTimerRef.current = null
      }
      if (pendingEditorRestoreReleaseTimerRef.current != null) {
        window.clearTimeout(pendingEditorRestoreReleaseTimerRef.current)
        pendingEditorRestoreReleaseTimerRef.current = null
      }
    }
  }, [])

  useLayoutEffect(() => {
    if (!isMarkdownFile || !activeRelativePath) return
    splitSyncReadyRef.current = false

    if (pendingModeSwitchRef.current?.to !== previewMode) {
      pendingModeSwitchRef.current = null
    }

    const timer = window.setTimeout(() => {
      const stored = markdownScrollMemoryRef.current[activeRelativePath] ?? {}
      const switchFrom = pendingModeSwitchRef.current?.to === previewMode ? pendingModeSwitchRef.current.from : null

      if (previewMode === 'edit') {
        const sourceLine = switchFrom === 'preview' || switchFrom === 'split' ? lastPreviewSourceLineRef.current : null
        if (sourceLine != null) {
          applyEditorScrollTopForLine(sourceLine)
          pendingModeSwitchRef.current = null
          return
        }
        const nextTop =
          switchFrom === 'preview'
            ? pickFirstFiniteScrollTop(stored.preview, stored.splitPreview, stored.splitEditor, stored.edit)
            : switchFrom === 'split'
              ? pickFirstFiniteScrollTop(stored.splitEditor, stored.splitPreview, stored.edit, stored.preview)
              : pickFirstFiniteScrollTop(stored.edit, stored.splitEditor, stored.preview, stored.splitPreview)
        restoreEditorScrollTop(nextTop)
        pendingModeSwitchRef.current = null
        return
      }

      if (previewMode === 'preview') {
        const sourceLine = switchFrom === 'edit' || switchFrom === 'split' ? lastEditorSourceLineRef.current : null
        if (sourceLine != null && previewScrollRef.current) {
          scrollMarkdownPreviewToSourceLine(previewScrollRef.current, sourceLine)
          pendingModeSwitchRef.current = null
          return
        }
        const nextTop =
          switchFrom === 'edit'
            ? pickFirstFiniteScrollTop(stored.edit, stored.splitEditor, stored.splitPreview, stored.preview)
            : switchFrom === 'split'
              ? pickFirstFiniteScrollTop(stored.splitPreview, stored.splitEditor, stored.preview, stored.edit)
              : pickFirstFiniteScrollTop(stored.preview, stored.splitPreview, stored.splitEditor, stored.edit)
        applyPreviewScrollTop(nextTop)
        pendingModeSwitchRef.current = null
        return
      }

      const nextEditorTop = switchFrom === 'preview' ? pickFirstFiniteScrollTop(stored.preview, stored.splitPreview, stored.splitEditor, stored.edit) : pickFirstFiniteScrollTop(stored.splitEditor, stored.edit, stored.preview, stored.splitPreview)
      const nextPreviewTop = switchFrom === 'edit' ? pickFirstFiniteScrollTop(stored.edit, stored.splitEditor, stored.splitPreview, stored.preview) : pickFirstFiniteScrollTop(stored.splitPreview, stored.preview, stored.splitEditor, stored.edit)
      restoreEditorScrollTop(nextEditorTop)
      if (switchFrom === 'edit' && lastEditorSourceLineRef.current != null && previewScrollRef.current) {
        scrollMarkdownPreviewToSourceLine(previewScrollRef.current, lastEditorSourceLineRef.current)
      } else if (switchFrom === 'preview' && lastPreviewSourceLineRef.current != null) {
        applyEditorScrollTopForLine(lastPreviewSourceLineRef.current)
        applyPreviewScrollTop(nextPreviewTop)
      } else {
        applyPreviewScrollTop(nextPreviewTop)
      }
      splitSyncReadyRef.current = true
      pendingModeSwitchRef.current = null
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [activeRelativePath, applyPreviewScrollTop, applyEditorScrollTopForLine, isMarkdownFile, previewMode, restoreEditorScrollTop])

  const handleEditorScrollStateChange = useCallback(
    (state: MonacoEditorScrollState) => {
      editorScrollStateRef.current = state
      lastEditorSourceLineRef.current = state.firstVisibleLine
      if (isMarkdownFile && isShowingEditor && pendingEditorRestoreTopRef.current != null) {
        const maxTop = Math.max(0, state.scrollHeight - state.viewportHeight)
        const pendingTop = Math.min(Math.max(0, pendingEditorRestoreTopRef.current), maxTop)
        if (Math.abs(state.scrollTop - pendingTop) > 1) {
          editorRef.current?.setScrollTop(pendingTop)
          return
        }
        pendingEditorRestoreTopRef.current = null
      }

      if (!isMarkdownFile || !activeRelativePath || !isShowingEditor) return
      const modeKey: MarkdownScrollModeKey = previewMode === 'split' ? 'splitEditor' : 'edit'
      storeScrollTop(activeRelativePath, modeKey, state.scrollTop)

      if (previewMode !== 'split' || !isShowingPreview || !splitSyncReadyRef.current) return
      if (activeScrollSyncSourceRef.current === 'preview') return

      setActiveSyncSource('editor')
      const mapped = previewScrollRef.current && scrollMarkdownPreviewToSourceLine(previewScrollRef.current, state.firstVisibleLine)
      if (mapped) {
        storeScrollTop(activeRelativePath, 'splitPreview', previewScrollRef.current?.scrollTop ?? 0)
        return
      }
      const targetTop = mapScrollTopByRatio(state, previewScrollStateRef.current)
      if (targetTop == null) return
      applyPreviewScrollTop(targetTop)
      storeScrollTop(activeRelativePath, 'splitPreview', targetTop)
    },
    [activeRelativePath, applyPreviewScrollTop, editorRef, isMarkdownFile, isShowingEditor, isShowingPreview, mapScrollTopByRatio, previewMode, setActiveSyncSource, storeScrollTop],
  )

  const handlePreviewScroll = useCallback(() => {
    const preview = previewScrollRef.current
    if (!preview || !isMarkdownFile || !activeRelativePath || !isShowingPreview) return

    const nextState = {
      scrollTop: preview.scrollTop,
      scrollHeight: preview.scrollHeight,
      viewportHeight: preview.clientHeight,
    }
    previewScrollStateRef.current = nextState
    lastPreviewSourceLineRef.current = getMarkdownPreviewSourceLineAtScrollTop(preview)

    const modeKey: MarkdownScrollModeKey = previewMode === 'split' ? 'splitPreview' : 'preview'
    storeScrollTop(activeRelativePath, modeKey, nextState.scrollTop)

    if (previewMode !== 'split' || !isShowingEditor || !splitSyncReadyRef.current) return
    if (activeScrollSyncSourceRef.current === 'editor') return

    setActiveSyncSource('preview')
    const sourceLine = getMarkdownPreviewSourceLineAtScrollTop(preview)
    if (sourceLine != null) {
      applyEditorScrollTopForLine(sourceLine)
      return
    }
    const targetTop = mapScrollTopByRatio(nextState, editorScrollStateRef.current)
    if (targetTop == null) return
    applyEditorScrollTop(targetTop)
    storeScrollTop(activeRelativePath, 'splitEditor', targetTop)
  }, [activeRelativePath, applyEditorScrollTop, applyEditorScrollTopForLine, isMarkdownFile, isShowingEditor, isShowingPreview, mapScrollTopByRatio, previewMode, previewScrollRef, setActiveSyncSource, storeScrollTop])

  useEffect(() => {
    if (!isShowingPreview) return
    const preview = previewScrollRef.current
    if (!preview) return

    const syncPreviewState = () => {
      previewScrollStateRef.current = {
        scrollTop: preview.scrollTop,
        scrollHeight: preview.scrollHeight,
        viewportHeight: preview.clientHeight,
      }
    }

    syncPreviewState()
    const resizeObserver = new ResizeObserver(() => {
      syncPreviewState()
    })
    resizeObserver.observe(preview)

    return () => {
      resizeObserver.disconnect()
    }
  }, [isShowingPreview, markdownPreviewContent, previewMode, previewScrollRef])

  return {
    captureCurrentModeScroll,
    handleEditorScrollStateChange,
    handlePreviewScroll,
    resetScrollSyncState,
  }
}
