import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Components } from 'react-markdown'
import { useEffectiveTheme } from '../../hooks/useEffectiveTheme'
import {
  createMarkdownComponents,
  dirnameFromRelativePath,
  joinPosixPaths,
  MARKDOWN_PASTE_IMAGE_DIRECTORY,
  type MarkdownStructuredBlockClickPayload,
  normalizeMarkdownImageExtensionFromMime,
  parseImageFileFromClipboardEvent,
  relativePosixPath,
  resolveMonacoTheme,
  sanitizeMarkdownImageAlt,
  shouldDisableMarkdownSyntaxHighlight,
} from './code.markdown'
import { parseMarkdownDocument } from './code.frontmatterParser'
import type { MarkdownPreviewMode } from './code.workspace.types'
import { markMarkdownPreviewPerformance, measureMarkdownPreviewSync } from './markdownPreviewPerformance'

const MARKDOWN_PREVIEW_DEBOUNCE_MS = 220

type UseMarkdownPreviewModeStateOptions = {
  activeRelativePath: string | null
  editorValue: string
  isNarrowViewport: boolean
  persistedLastMarkdownPreviewMode: string | undefined
  projectId: string
  projectPath: string
  setProjectLastMarkdownPreviewMode: (projectId: string, mode: MarkdownPreviewMode) => Promise<void>
  themeMode: 'system' | 'light' | 'dark'
}

type MarkdownStructuredPreviewState = {
  kind: MarkdownStructuredBlockClickPayload['kind']
  startLine: number
  endLine: number
  markdown: string
}

type MarkdownCodePreviewState = {
  codeText: string
  language: string
}

function sliceMarkdownLines(markdown: string, startLine: number, endLine: number): string {
  if (!markdown) return ''
  const lines = markdown.split('\n')
  const safeStartLine = Math.max(1, Math.floor(startLine))
  const safeEndLine = Math.max(safeStartLine, Math.floor(endLine))
  return lines
    .slice(safeStartLine - 1, safeEndLine)
    .join('\n')
    .trim()
}

function normalizeMarkdownPreviewMode(value: string | undefined): MarkdownPreviewMode {
  if (value === 'preview' || value === 'split') {
    return value
  }
  return 'edit'
}

export function useMarkdownPreviewModeState({ activeRelativePath, editorValue, isNarrowViewport, persistedLastMarkdownPreviewMode, projectId, projectPath, setProjectLastMarkdownPreviewMode, themeMode }: UseMarkdownPreviewModeStateOptions) {
  const [markdownPreviewMode, setMarkdownPreviewMode] = useState<MarkdownPreviewMode>(() => normalizeMarkdownPreviewMode(persistedLastMarkdownPreviewMode))
  const effectiveTheme = useEffectiveTheme()
  const [structuredPreview, setStructuredPreview] = useState<MarkdownStructuredPreviewState | null>(null)
  const [codePreview, setCodePreview] = useState<MarkdownCodePreviewState | null>(null)
  const [previewEditorValue, setPreviewEditorValue] = useState(editorValue)
  const previousPreviewPathRef = useRef(activeRelativePath)
  const previousPreviewModeRef = useRef<MarkdownPreviewMode>('edit')

  useEffect(() => {
    setMarkdownPreviewMode(normalizeMarkdownPreviewMode(persistedLastMarkdownPreviewMode))
  }, [persistedLastMarkdownPreviewMode, projectId])

  useEffect(() => {
    void setProjectLastMarkdownPreviewMode(projectId, markdownPreviewMode)
  }, [markdownPreviewMode, projectId, setProjectLastMarkdownPreviewMode])

  const isMarkdownFile = useMemo(() => {
    const normalized = (activeRelativePath ?? '').toLowerCase()
    return normalized.endsWith('.md') || normalized.endsWith('.markdown') || normalized.endsWith('.mdx') || normalized.endsWith('.mdc')
  }, [activeRelativePath])

  const isMdcFile = useMemo(() => {
    const normalized = (activeRelativePath ?? '').toLowerCase()
    return normalized.endsWith('.mdc')
  }, [activeRelativePath])

  const shouldParseFrontmatter = useMemo(() => {
    const normalized = (activeRelativePath ?? '').toLowerCase()
    return normalized.endsWith('.md') || normalized.endsWith('.markdown') || normalized.endsWith('.mdx') || normalized.endsWith('.mdc')
  }, [activeRelativePath])

  const parsedMarkdownDoc = useMemo(() => (shouldParseFrontmatter ? measureMarkdownPreviewSync('frontmatter.parse', () => parseMarkdownDocument(editorValue)) : null), [editorValue, shouldParseFrontmatter])

  useEffect(() => {
    markMarkdownPreviewPerformance('markdown.input-received')

    const pathChanged = previousPreviewPathRef.current !== activeRelativePath
    previousPreviewPathRef.current = activeRelativePath
    if (!isMarkdownFile || pathChanged) {
      setPreviewEditorValue(editorValue)
      return
    }

    const timer = window.setTimeout(() => {
      setPreviewEditorValue(editorValue)
    }, MARKDOWN_PREVIEW_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [activeRelativePath, editorValue, isMarkdownFile])

  const effectiveMarkdownPreviewMode = isMarkdownFile ? (markdownPreviewMode === 'split' && isNarrowViewport ? 'preview' : markdownPreviewMode) : 'edit'

  useEffect(() => {
    const modeChanged = previousPreviewModeRef.current !== effectiveMarkdownPreviewMode
    previousPreviewModeRef.current = effectiveMarkdownPreviewMode
    if (modeChanged && effectiveMarkdownPreviewMode !== 'edit') {
      setPreviewEditorValue(editorValue)
    }
  }, [editorValue, effectiveMarkdownPreviewMode])

  const parsedMarkdownPreviewDoc = useMemo(() => (shouldParseFrontmatter ? measureMarkdownPreviewSync('preview.frontmatter.parse', () => parseMarkdownDocument(previewEditorValue)) : null), [previewEditorValue, shouldParseFrontmatter])

  const markdownPreviewContent = useMemo(() => {
    if (parsedMarkdownPreviewDoc?.hasFrontmatter) {
      return parsedMarkdownPreviewDoc.markdownBody
    }
    return previewEditorValue
  }, [parsedMarkdownPreviewDoc, previewEditorValue])

  const enableMarkdownSyntaxHighlight = useMemo(() => !shouldDisableMarkdownSyntaxHighlight(markdownPreviewContent), [markdownPreviewContent])

  const isShowingEditor = effectiveMarkdownPreviewMode !== 'preview'
  const isShowingPreview = effectiveMarkdownPreviewMode === 'preview' || effectiveMarkdownPreviewMode === 'split'
  const shouldHandleFindInPreview = isMarkdownFile && isShowingPreview && !isShowingEditor

  const monacoTheme = useMemo(() => (effectiveTheme === 'dark' ? 'vs-dark' : resolveMonacoTheme(themeMode)), [effectiveTheme, themeMode])

  const markdownComponents = useMemo<Components>(
    () =>
      createMarkdownComponents({
        activeRelativePath,
        enableMarkdownSyntaxHighlight,
        lineOffset: parsedMarkdownPreviewDoc?.markdownBodyLineOffset ?? 0,
        onCodeBlockExpand: (payload) => {
          setCodePreview(payload)
        },
        onStructuredBlockClick: (payload) => {
          const markdownBodyLineOffset = parsedMarkdownPreviewDoc?.markdownBodyLineOffset ?? 0
          const bodyStartLine = Math.max(1, payload.startLine - markdownBodyLineOffset)
          const bodyEndLine = Math.max(bodyStartLine, payload.endLine - markdownBodyLineOffset)
          const markdown = sliceMarkdownLines(markdownPreviewContent, bodyStartLine, bodyEndLine)
          if (!markdown) return
          setStructuredPreview({
            ...payload,
            markdown,
          })
        },
        projectPath,
        themeMode: effectiveTheme,
      }),
    [activeRelativePath, effectiveTheme, enableMarkdownSyntaxHighlight, markdownPreviewContent, parsedMarkdownPreviewDoc?.markdownBodyLineOffset, projectPath],
  )

  const structuredPreviewComponents = useMemo<Components>(
    () =>
      createMarkdownComponents({
        activeRelativePath,
        enableMarkdownSyntaxHighlight,
        projectPath,
        themeMode: effectiveTheme,
      }),
    [activeRelativePath, effectiveTheme, enableMarkdownSyntaxHighlight, projectPath],
  )

  const handlePasteImage = useCallback(
    async (file: File | null, clipboardEvent?: ClipboardEvent): Promise<string | null> => {
      if (!isMarkdownFile || !activeRelativePath) return null
      const fromClipboardEvent = clipboardEvent ? parseImageFileFromClipboardEvent(clipboardEvent) : null
      const candidateFile = fromClipboardEvent ?? file

      if (!candidateFile || !candidateFile.type || !candidateFile.type.startsWith('image/')) {
        const pngBase64 = window.electronAPI.readClipboardImagePngBase64()
        if (!pngBase64) return null

        const fileDirectory = dirnameFromRelativePath(activeRelativePath)
        const imageDirectory = fileDirectory ? joinPosixPaths(fileDirectory, MARKDOWN_PASTE_IMAGE_DIRECTORY) : MARKDOWN_PASTE_IMAGE_DIRECTORY
        const savedImage = await window.electronAPI.writeProjectImageFile(projectPath, imageDirectory, 'png', pngBase64)
        const relativeImagePath = relativePosixPath(fileDirectory, savedImage.relativePath)
        const normalizedRelativeImagePath = relativeImagePath.startsWith('./') || relativeImagePath.startsWith('../') ? relativeImagePath : `./${relativeImagePath}`
        const alt = sanitizeMarkdownImageAlt(savedImage.relativePath)
        return `![${alt}](${normalizedRelativeImagePath})`
      }

      const fileDirectory = dirnameFromRelativePath(activeRelativePath)
      const imageDirectory = fileDirectory ? joinPosixPaths(fileDirectory, MARKDOWN_PASTE_IMAGE_DIRECTORY) : MARKDOWN_PASTE_IMAGE_DIRECTORY
      const extension = normalizeMarkdownImageExtensionFromMime(candidateFile.type)
      const arrayBuffer = await candidateFile.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)

      let binary = ''
      for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i])
      }
      const dataBase64 = btoa(binary)

      const savedImage = await window.electronAPI.writeProjectImageFile(projectPath, imageDirectory, extension, dataBase64)
      const relativeImagePath = relativePosixPath(fileDirectory, savedImage.relativePath)
      const normalizedRelativeImagePath = relativeImagePath.startsWith('./') || relativeImagePath.startsWith('../') ? relativeImagePath : `./${relativeImagePath}`
      const alt = sanitizeMarkdownImageAlt(savedImage.relativePath)
      return `![${alt}](${normalizedRelativeImagePath})`
    },
    [activeRelativePath, isMarkdownFile, projectPath],
  )

  return {
    closeStructuredPreview: useCallback(() => {
      setStructuredPreview(null)
    }, []),
    closeCodePreview: useCallback(() => {
      setCodePreview(null)
    }, []),
    codePreview,
    effectiveMarkdownPreviewMode,
    effectiveTheme,
    handlePasteImage,
    isMarkdownFile,
    isMdcFile,
    isMarkdownPreviewStale: isShowingPreview && previewEditorValue !== editorValue,
    isShowingEditor,
    isShowingPreview,
    markdownComponents,
    markdownPreviewContent,
    markdownPreviewMode,
    monacoTheme,
    parsedMarkdownDoc,
    setMarkdownPreviewMode,
    structuredPreview,
    structuredPreviewComponents,
    shouldHandleFindInPreview,
  }
}
