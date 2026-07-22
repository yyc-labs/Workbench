import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { getMarkdownPreviewSourceLineAtScrollTop, scrollMarkdownPreviewToSourceLine } from '../../code/code.markdownShared'
import type { LearningEditorDisplayMode } from './learningCenterTypes'

type UseLearningMarkdownScrollSyncOptions = {
  editorDisplayMode: LearningEditorDisplayMode
  editorTextareaRef: RefObject<HTMLTextAreaElement>
  noteId: string | undefined
}

function getTextareaSourceLine(textarea: HTMLTextAreaElement): number {
  const styles = window.getComputedStyle(textarea)
  const lineHeight = Number.parseFloat(styles.lineHeight) || 24
  const paddingTop = Number.parseFloat(styles.paddingTop) || 0
  return Math.max(1, Math.floor(Math.max(0, textarea.scrollTop - paddingTop) / lineHeight) + 1)
}

function scrollTextareaToSourceLine(textarea: HTMLTextAreaElement, lineNumber: number): void {
  const styles = window.getComputedStyle(textarea)
  const lineHeight = Number.parseFloat(styles.lineHeight) || 24
  const paddingTop = Number.parseFloat(styles.paddingTop) || 0
  textarea.scrollTop = Math.max(0, paddingTop + (Math.max(1, Math.floor(lineNumber)) - 1) * lineHeight)
}

export function useLearningMarkdownScrollSync({ editorDisplayMode, editorTextareaRef, noteId }: UseLearningMarkdownScrollSyncOptions) {
  const previewViewportRef = useRef<HTMLDivElement | null>(null)
  const previousDisplayModeRef = useRef(editorDisplayMode)
  const lastEditorSourceLineRef = useRef<number | null>(null)
  const lastPreviewSourceLineRef = useRef<number | null>(null)
  const activeSyncSourceRef = useRef<'editor' | 'preview' | null>(null)
  const releaseTimerRef = useRef<number | null>(null)
  const initialSplitSyncKeyRef = useRef<string | null>(null)

  const setActiveSyncSource = useCallback((source: 'editor' | 'preview') => {
    activeSyncSourceRef.current = source
    if (releaseTimerRef.current != null) window.clearTimeout(releaseTimerRef.current)
    releaseTimerRef.current = window.setTimeout(() => {
      activeSyncSourceRef.current = null
      releaseTimerRef.current = null
    }, 120)
  }, [])

  const handleEditorScroll = useCallback(() => {
    const textarea = editorTextareaRef.current
    const preview = previewViewportRef.current
    if (!textarea) return

    const sourceLine = getTextareaSourceLine(textarea)
    lastEditorSourceLineRef.current = sourceLine
    if (editorDisplayMode !== 'split' || !preview || activeSyncSourceRef.current === 'preview') return

    setActiveSyncSource('editor')
    scrollMarkdownPreviewToSourceLine(preview, sourceLine)
  }, [editorDisplayMode, editorTextareaRef, setActiveSyncSource])

  const handlePreviewScroll = useCallback(() => {
    const preview = previewViewportRef.current
    const textarea = editorTextareaRef.current
    if (!preview) return

    const sourceLine = getMarkdownPreviewSourceLineAtScrollTop(preview)
    if (sourceLine == null) return
    lastPreviewSourceLineRef.current = sourceLine
    if (editorDisplayMode !== 'split' || !textarea || activeSyncSourceRef.current === 'editor') return

    setActiveSyncSource('preview')
    scrollTextareaToSourceLine(textarea, sourceLine)
  }, [editorDisplayMode, editorTextareaRef, setActiveSyncSource])

  useEffect(() => {
    const preview = previewViewportRef.current
    if (!preview) return
    preview.addEventListener('scroll', handlePreviewScroll, { passive: true })
    return () => preview.removeEventListener('scroll', handlePreviewScroll)
  }, [editorDisplayMode, handlePreviewScroll])

  useLayoutEffect(() => {
    const previousMode = previousDisplayModeRef.current
    if (previousMode === editorDisplayMode) return
    previousDisplayModeRef.current = editorDisplayMode

    const timer = window.setTimeout(() => {
      const textarea = editorTextareaRef.current
      const preview = previewViewportRef.current
      if (editorDisplayMode === 'preview' && (previousMode === 'edit' || previousMode === 'split') && preview) {
        const sourceLine = lastEditorSourceLineRef.current ?? (textarea ? getTextareaSourceLine(textarea) : null)
        if (sourceLine != null) scrollMarkdownPreviewToSourceLine(preview, sourceLine)
      }
      if (editorDisplayMode === 'edit' && (previousMode === 'preview' || previousMode === 'split') && textarea) {
        const sourceLine = lastPreviewSourceLineRef.current
        if (sourceLine != null) scrollTextareaToSourceLine(textarea, sourceLine)
      }
      if (editorDisplayMode === 'split') {
        if (previousMode === 'edit' && preview) {
          const sourceLine = lastEditorSourceLineRef.current ?? (textarea ? getTextareaSourceLine(textarea) : null)
          if (sourceLine != null) scrollMarkdownPreviewToSourceLine(preview, sourceLine)
        }
        if (previousMode === 'preview' && textarea && lastPreviewSourceLineRef.current != null) {
          scrollTextareaToSourceLine(textarea, lastPreviewSourceLineRef.current)
        }
      }
    }, 0)

    return () => window.clearTimeout(timer)
  }, [editorDisplayMode, editorTextareaRef])

  useLayoutEffect(() => {
    if (editorDisplayMode !== 'split' || !noteId) return

    const syncKey = `${noteId}:${editorDisplayMode}`
    if (initialSplitSyncKeyRef.current === syncKey) return
    initialSplitSyncKeyRef.current = syncKey

    let animationFrame = window.requestAnimationFrame(() => {
      animationFrame = window.requestAnimationFrame(() => {
        const textarea = editorTextareaRef.current
        const preview = previewViewportRef.current
        if (!textarea || !preview) return

        const sourceLine = getTextareaSourceLine(textarea)
        lastEditorSourceLineRef.current = sourceLine
        scrollMarkdownPreviewToSourceLine(preview, sourceLine)
      })
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [editorDisplayMode, editorTextareaRef, noteId])

  useEffect(
    () => () => {
      if (releaseTimerRef.current != null) window.clearTimeout(releaseTimerRef.current)
    },
    [],
  )

  return { handleEditorScroll, previewViewportRef }
}
