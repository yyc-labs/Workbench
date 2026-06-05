import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Components } from 'react-markdown'
import {
  createMarkdownComponents,
  dirnameFromRelativePath,
  joinPosixPaths,
  MARKDOWN_PASTE_IMAGE_DIRECTORY,
  normalizeMarkdownImageExtensionFromMime,
  parseImageFileFromClipboardEvent,
  relativePosixPath,
  resolveMonacoTheme,
  sanitizeMarkdownImageAlt,
  shouldDisableMarkdownSyntaxHighlight,
} from './code.markdown'
import { parseMarkdownDocument } from './code.frontmatterParser'
import type { MarkdownPreviewMode } from './code.workspace.types'

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

function normalizeMarkdownPreviewMode(value: string | undefined): MarkdownPreviewMode {
  if (value === 'preview' || value === 'split') {
    return value
  }
  return 'edit'
}

export function useMarkdownPreviewModeState({
  activeRelativePath,
  editorValue,
  isNarrowViewport,
  persistedLastMarkdownPreviewMode,
  projectId,
  projectPath,
  setProjectLastMarkdownPreviewMode,
  themeMode,
}: UseMarkdownPreviewModeStateOptions) {
  const [markdownPreviewMode, setMarkdownPreviewMode] = useState<MarkdownPreviewMode>(
    () => normalizeMarkdownPreviewMode(persistedLastMarkdownPreviewMode)
  )
  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>(
    () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
  )

  useEffect(() => {
    setMarkdownPreviewMode(normalizeMarkdownPreviewMode(persistedLastMarkdownPreviewMode))
  }, [persistedLastMarkdownPreviewMode, projectId])

  useEffect(() => {
    void setProjectLastMarkdownPreviewMode(projectId, markdownPreviewMode)
  }, [markdownPreviewMode, projectId, setProjectLastMarkdownPreviewMode])

  useEffect(() => {
    const root = document.documentElement
    const sync = () => {
      const attr = root.getAttribute('data-theme')
      setEffectiveTheme(attr === 'dark' ? 'dark' : 'light')
    }

    sync()
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' && record.attributeName === 'data-theme') {
          sync()
          break
        }
      }
    })
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

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
    return (
      normalized.endsWith('.md') ||
      normalized.endsWith('.markdown') ||
      normalized.endsWith('.mdx') ||
      normalized.endsWith('.mdc')
    )
  }, [activeRelativePath])

  const parsedMarkdownDoc = useMemo(
    () => (shouldParseFrontmatter ? parseMarkdownDocument(editorValue) : null),
    [editorValue, shouldParseFrontmatter]
  )

  const markdownPreviewContent = useMemo(() => {
    if (parsedMarkdownDoc?.hasFrontmatter) {
      return parsedMarkdownDoc.markdownBody
    }
    return editorValue
  }, [editorValue, parsedMarkdownDoc])

  const enableMarkdownSyntaxHighlight = useMemo(
    () => !shouldDisableMarkdownSyntaxHighlight(markdownPreviewContent),
    [markdownPreviewContent]
  )

  const effectiveMarkdownPreviewMode = isMarkdownFile
    ? (markdownPreviewMode === 'split' && isNarrowViewport ? 'preview' : markdownPreviewMode)
    : 'edit'

  const isShowingEditor = effectiveMarkdownPreviewMode !== 'preview'
  const isShowingPreview = effectiveMarkdownPreviewMode === 'preview' || effectiveMarkdownPreviewMode === 'split'
  const shouldHandleFindInPreview = isMarkdownFile && isShowingPreview && !isShowingEditor

  const monacoTheme = useMemo(
    () => (effectiveTheme === 'dark' ? 'vs-dark' : resolveMonacoTheme(themeMode)),
    [effectiveTheme, themeMode]
  )

  const markdownComponents = useMemo<Components>(() => createMarkdownComponents({
    activeRelativePath,
    enableMarkdownSyntaxHighlight,
    projectPath,
    themeMode: effectiveTheme,
  }), [activeRelativePath, effectiveTheme, enableMarkdownSyntaxHighlight, projectPath])

  const handlePasteImage = useCallback(async (file: File | null, clipboardEvent?: ClipboardEvent): Promise<string | null> => {
    if (!isMarkdownFile || !activeRelativePath) return null
    const fromClipboardEvent = clipboardEvent ? parseImageFileFromClipboardEvent(clipboardEvent) : null
    const candidateFile = fromClipboardEvent ?? file

    if (!candidateFile || !candidateFile.type || !candidateFile.type.startsWith('image/')) {
      const pngBase64 = window.electronAPI.readClipboardImagePngBase64()
      if (!pngBase64) return null

      const fileDirectory = dirnameFromRelativePath(activeRelativePath)
      const imageDirectory = fileDirectory
        ? joinPosixPaths(fileDirectory, MARKDOWN_PASTE_IMAGE_DIRECTORY)
        : MARKDOWN_PASTE_IMAGE_DIRECTORY
      const savedImage = await window.electronAPI.writeProjectImageFile(
        projectPath,
        imageDirectory,
        'png',
        pngBase64
      )
      const relativeImagePath = relativePosixPath(fileDirectory, savedImage.relativePath)
      const normalizedRelativeImagePath = relativeImagePath.startsWith('./') || relativeImagePath.startsWith('../')
        ? relativeImagePath
        : `./${relativeImagePath}`
      const alt = sanitizeMarkdownImageAlt(savedImage.relativePath)
      return `![${alt}](${normalizedRelativeImagePath})`
    }

    const fileDirectory = dirnameFromRelativePath(activeRelativePath)
    const imageDirectory = fileDirectory
      ? joinPosixPaths(fileDirectory, MARKDOWN_PASTE_IMAGE_DIRECTORY)
      : MARKDOWN_PASTE_IMAGE_DIRECTORY
    const extension = normalizeMarkdownImageExtensionFromMime(candidateFile.type)
    const arrayBuffer = await candidateFile.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)

    let binary = ''
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i])
    }
    const dataBase64 = btoa(binary)

    const savedImage = await window.electronAPI.writeProjectImageFile(
      projectPath,
      imageDirectory,
      extension,
      dataBase64
    )
    const relativeImagePath = relativePosixPath(fileDirectory, savedImage.relativePath)
    const normalizedRelativeImagePath = relativeImagePath.startsWith('./') || relativeImagePath.startsWith('../')
      ? relativeImagePath
      : `./${relativeImagePath}`
    const alt = sanitizeMarkdownImageAlt(savedImage.relativePath)
    return `![${alt}](${normalizedRelativeImagePath})`
  }, [activeRelativePath, isMarkdownFile, projectPath])

  return {
    effectiveMarkdownPreviewMode,
    handlePasteImage,
    isMarkdownFile,
    isMdcFile,
    isShowingEditor,
    isShowingPreview,
    markdownComponents,
    markdownPreviewContent,
    markdownPreviewMode,
    monacoTheme,
    parsedMarkdownDoc,
    setMarkdownPreviewMode,
    shouldHandleFindInPreview,
  }
}
