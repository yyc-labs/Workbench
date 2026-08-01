import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { getMarkdownPreviewSourceLineAtScrollTop, scrollMarkdownPreviewToSourceLine } from '../code/code.markdownShared'

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

export function useMarkdownDocumentScrollSync(mode: 'edit' | 'preview' | 'split', editorRef: RefObject<HTMLTextAreaElement | null>, documentKey: string | null) {
  const previewRef = useRef<HTMLDivElement | null>(null)
  const previousModeRef = useRef(mode)
  const editorLineRef = useRef<number | null>(null)
  const previewLineRef = useRef<number | null>(null)
  const sourceRef = useRef<'editor' | 'preview' | null>(null)
  const releaseTimerRef = useRef<number | null>(null)

  const markSource = useCallback((source: 'editor' | 'preview') => {
    sourceRef.current = source
    if (releaseTimerRef.current != null) window.clearTimeout(releaseTimerRef.current)
    releaseTimerRef.current = window.setTimeout(() => {
      sourceRef.current = null
      releaseTimerRef.current = null
    }, 120)
  }, [])

  const handleEditorScroll = useCallback(() => {
    const editor = editorRef.current
    const preview = previewRef.current
    if (!editor) return
    const line = getTextareaSourceLine(editor)
    editorLineRef.current = line
    if (mode !== 'split' || !preview || sourceRef.current === 'preview') return
    markSource('editor')
    scrollMarkdownPreviewToSourceLine(preview, line)
  }, [editorRef, markSource, mode])

  const handlePreviewScroll = useCallback(() => {
    const preview = previewRef.current
    const editor = editorRef.current
    if (!preview) return
    const line = getMarkdownPreviewSourceLineAtScrollTop(preview)
    if (line == null) return
    previewLineRef.current = line
    if (mode !== 'split' || !editor || sourceRef.current === 'editor') return
    markSource('preview')
    scrollTextareaToSourceLine(editor, line)
  }, [editorRef, markSource, mode])

  useEffect(() => {
    const preview = previewRef.current
    if (!preview) return
    preview.addEventListener('scroll', handlePreviewScroll, { passive: true })
    return () => preview.removeEventListener('scroll', handlePreviewScroll)
  }, [handlePreviewScroll])

  useLayoutEffect(() => {
    const previousMode = previousModeRef.current
    previousModeRef.current = mode
    const timer = window.setTimeout(() => {
      const editor = editorRef.current
      const preview = previewRef.current
      if (mode === 'preview' && preview && editor && previousMode !== 'preview') scrollMarkdownPreviewToSourceLine(preview, editorLineRef.current ?? getTextareaSourceLine(editor))
      if (mode === 'edit' && editor && previousMode !== 'edit' && previewLineRef.current != null) scrollTextareaToSourceLine(editor, previewLineRef.current)
      if (mode === 'split' && preview && editor) {
        if (previousMode === 'edit') scrollMarkdownPreviewToSourceLine(preview, editorLineRef.current ?? getTextareaSourceLine(editor))
        if (previousMode === 'preview' && previewLineRef.current != null) scrollTextareaToSourceLine(editor, previewLineRef.current)
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [documentKey, editorRef, mode])

  useEffect(
    () => () => {
      if (releaseTimerRef.current != null) window.clearTimeout(releaseTimerRef.current)
    },
    [],
  )

  return { previewRef, handleEditorScroll }
}
