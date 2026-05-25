import { Children, isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Clock3, Code2, Columns2, Copy, Eye, PanelLeftOpen, RefreshCw, Save, Search, Star, Trash2, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { ProjectFileReadResult } from '../../../shared/types'
import { useAppStore } from '../../stores/appStore'
import { CodeFileTree } from './CodeFileTree'
import { MonacoCodeEditor, type MonacoCodeEditorHandle, type MonacoEditorScrollState } from './MonacoCodeEditor'
import {
  collectAllFileRelativePaths,
  collectParentDirectories,
  collectMatchedFilesByQuery,
  createDefaultExpandedDirectorySet,
  formatFileSize,
  inferLanguageFromRelativePath,
  isSameCodeFileDrawerState,
  normalizeCodeFileDrawerState,
  pushRecentCodeFilePath,
  removeCodeFilePathFromDrawerState,
  sortTreeNodes,
  toggleFavoriteCodeFilePath,
} from './code.helpers'
import { parseMarkdownDocument } from './code.frontmatterParser'
import type { CodeFileDrawerState, FileTreeState, SaveStatus } from './code.types'

const SAVE_STATUS_RESET_DELAY_MS = 1600
const FILE_EXTERNAL_CHANGE_POLL_MS = 1200
const FILE_SEARCH_DEBOUNCE_MS = 180
const NARROW_VIEWPORT_QUERY = '(max-width: 960px)'

function resolveMonacoTheme(themeMode: 'system' | 'light' | 'dark'): 'vs' | 'vs-dark' {
  if (themeMode === 'dark') return 'vs-dark'
  if (themeMode === 'light') return 'vs'
  return 'vs'
}

function normalizeSyntaxLanguage(value: string | null | undefined): string {
  const raw = (value ?? '').trim().toLowerCase()
  if (!raw) return 'text'

  if (raw === 'ts') return 'typescript'
  if (raw === 'tsx') return 'tsx'
  if (raw === 'js') return 'javascript'
  if (raw === 'jsx') return 'jsx'
  if (raw === 'sh' || raw === 'shell') return 'bash'
  if (raw === 'yml') return 'yaml'
  if (raw === 'md') return 'markdown'
  if (raw === 'py') return 'python'
  if (raw === 'rb') return 'ruby'
  if (raw === 'rs') return 'rust'
  if (raw === 'kt') return 'kotlin'
  if (raw === 'cs') return 'csharp'
  if (raw === 'ps1') return 'powershell'
  return raw
}

function extractCodeLanguageFromClassName(className?: string): string | null {
  const match = /language-([A-Za-z0-9_+-]+)/.exec(className ?? '')
  return match?.[1] ?? null
}

function extractCodeBlockFromPreChildren(children: ReactNode): { codeText: string; language: string } | null {
  const childNodes = Children.toArray(children)
  if (childNodes.length !== 1) return null

  const onlyChild = childNodes[0]
  if (!isValidElement(onlyChild)) {
    return null
  }

  const codeProps = onlyChild.props as {
    className?: string
    children?: ReactNode
    node?: { tagName?: string }
  }
  if (codeProps.node?.tagName !== 'code' && onlyChild.type !== 'code') {
    return null
  }

  const codeText = String(codeProps.children ?? '').replace(/\n$/, '')
  const language = normalizeSyntaxLanguage(extractCodeLanguageFromClassName(codeProps.className))
  return { codeText, language }
}

function shouldOpenInSystemBrowser(href: string): boolean {
  const value = href.trim().toLowerCase()
  return (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('mailto:') ||
    value.startsWith('tel:')
  )
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fallback below.
    }
  }

  if (typeof document === 'undefined') return false

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '-9999px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)

  textarea.focus()
  textarea.select()

  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  } finally {
    document.body.removeChild(textarea)
  }

  return copied
}

type MarkdownCodeBlockProps = {
  codeText: string
  language: string
  themeMode: 'light' | 'dark'
}

function MarkdownCodeBlock({ codeText, language, themeMode }: MarkdownCodeBlockProps) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle')

  useEffect(() => {
    if (copyStatus === 'idle') return
    const timer = window.setTimeout(() => {
      setCopyStatus('idle')
    }, 1500)
    return () => {
      window.clearTimeout(timer)
    }
  }, [copyStatus])

  const handleCopy = useCallback(async () => {
    const ok = await copyTextToClipboard(codeText)
    setCopyStatus(ok ? 'success' : 'error')
  }, [codeText])

  const copyLabel = copyStatus === 'success' ? 'Copied' : copyStatus === 'error' ? 'Copy failed' : 'Copy'

  return (
    <div className="code-markdown-syntax-wrap">
      <button
        type="button"
        className={`code-markdown-copy-btn ${
          copyStatus === 'success' ? 'is-success' : copyStatus === 'error' ? 'is-error' : ''
        }`}
        onClick={() => {
          void handleCopy()
        }}
        title={copyLabel}
      >
        {copyStatus === 'success' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        <span>{copyLabel}</span>
      </button>

      <SyntaxHighlighter
        language={language}
        style={themeMode === 'dark' ? oneDark : oneLight}
        PreTag="div"
        className="code-markdown-syntax-block"
        customStyle={{ margin: 0, borderRadius: 10, paddingTop: 38 }}
        codeTagProps={{
          style: {
            fontFamily: "'JetBrains Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace",
          },
        }}
      >
        {codeText}
      </SyntaxHighlighter>
    </div>
  )
}

type CodeWorkspacePanelProps = {
  projectId: string
  projectPath: string
  themeMode: 'system' | 'light' | 'dark'
}

type MarkdownPreviewMode = 'edit' | 'preview' | 'split'
type MarkdownScrollModeKey = 'edit' | 'preview' | 'splitEditor' | 'splitPreview'
const CODE_FILE_DRAWER_SECTION_LIMIT = 40

export function CodeWorkspacePanel({ projectId, projectPath, themeMode }: CodeWorkspacePanelProps) {
  const projectMeta = useAppStore((s) => s.projects.find((p) => p.id === projectId))
  const persistedLastCodeFile = projectMeta?.lastCodeFile
  const persistedLastMarkdownPreviewMode = projectMeta?.lastMarkdownPreviewMode
  const persistedCodeFileDrawerState = projectMeta?.codeFileDrawerState
  const setProjectLastCodeFile = useAppStore((s) => s.setProjectLastCodeFile)
  const setProjectLastMarkdownPreviewMode = useAppStore((s) => s.setProjectLastMarkdownPreviewMode)
  const setProjectCodeFileDrawerState = useAppStore((s) => s.setProjectCodeFileDrawerState)
  const [isNarrowViewport, setIsNarrowViewport] = useState(() => window.matchMedia(NARROW_VIEWPORT_QUERY).matches)
  const [isExplorerOpen, setIsExplorerOpen] = useState(() => !window.matchMedia(NARROW_VIEWPORT_QUERY).matches)
  const [isQuickDrawerOpen, setIsQuickDrawerOpen] = useState(false)
  const [tree, setTree] = useState<FileTreeState>({
    status: 'idle',
    nodes: [],
    error: null,
    skippedDirectories: 0,
    skippedFiles: 0,
  })
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(new Set())
  const [fileSearchInput, setFileSearchInput] = useState('')
  const [fileSearchQuery, setFileSearchQuery] = useState('')
  const [activeFile, setActiveFile] = useState<ProjectFileReadResult | null>(null)
  const [editorValue, setEditorValue] = useState('')
  const [lastSavedValue, setLastSavedValue] = useState('')
  const [activeRelativePath, setActiveRelativePath] = useState<string | null>(null)
  const [isReading, setIsReading] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [hasExternalChange, setHasExternalChange] = useState(false)
  const [isReloadingFromDisk, setIsReloadingFromDisk] = useState(false)
  const [hasAttemptedInitialRestore, setHasAttemptedInitialRestore] = useState(false)
  const [markdownPreviewMode, setMarkdownPreviewMode] = useState<MarkdownPreviewMode>(
    () => (persistedLastMarkdownPreviewMode === 'edit' || persistedLastMarkdownPreviewMode === 'preview' || persistedLastMarkdownPreviewMode === 'split')
      ? persistedLastMarkdownPreviewMode
      : 'edit'
  )
  const [codeFileDrawerState, setCodeFileDrawerState] = useState<CodeFileDrawerState>(() => (
    normalizeCodeFileDrawerState(persistedCodeFileDrawerState)
  ))
  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>(
    () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
  )
  const editorRef = useRef<MonacoCodeEditorHandle | null>(null)
  const previewScrollRef = useRef<HTMLDivElement | null>(null)
  const editorScrollStateRef = useRef<MonacoEditorScrollState | null>(null)
  const previewScrollStateRef = useRef<{ scrollTop: number; scrollHeight: number; viewportHeight: number } | null>(null)
  const markdownScrollMemoryRef = useRef<Record<string, Partial<Record<MarkdownScrollModeKey, number>>>>({})
  const activeScrollSyncSourceRef = useRef<'editor' | 'preview' | null>(null)
  const scrollSyncReleaseTimerRef = useRef<number | null>(null)
  const splitSyncReadyRef = useRef(false)

  const monacoTheme = useMemo(
    () => (effectiveTheme === 'dark' ? 'vs-dark' : resolveMonacoTheme(themeMode)),
    [effectiveTheme, themeMode]
  )
  const isDirty = editorValue !== lastSavedValue
  const activeLanguage = activeFile?.language ?? inferLanguageFromRelativePath(activeRelativePath ?? '')
  const activeFileSize = activeFile?.size ?? 0
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
  const effectiveMarkdownPreviewMode = isMarkdownFile
    ? (markdownPreviewMode === 'split' && isNarrowViewport ? 'preview' : markdownPreviewMode)
    : 'edit'
  const isShowingEditor = effectiveMarkdownPreviewMode !== 'preview'
  const isShowingPreview = effectiveMarkdownPreviewMode === 'preview' || effectiveMarkdownPreviewMode === 'split'
  const allProjectFilePathSet = useMemo(() => new Set(collectAllFileRelativePaths(tree.nodes)), [tree.nodes])
  const quickDrawerFavorites = useMemo(
    () => codeFileDrawerState.favorites.filter((path) => allProjectFilePathSet.has(path)).slice(0, CODE_FILE_DRAWER_SECTION_LIMIT),
    [allProjectFilePathSet, codeFileDrawerState.favorites]
  )
  const quickDrawerRecents = useMemo(
    () => codeFileDrawerState.recents.filter((path) => allProjectFilePathSet.has(path)).slice(0, CODE_FILE_DRAWER_SECTION_LIMIT),
    [allProjectFilePathSet, codeFileDrawerState.recents]
  )
  const markdownComponents = useMemo<Components>(() => ({
    pre({ children }) {
      const codeBlock = extractCodeBlockFromPreChildren(children)
      if (!codeBlock) {
        return <pre>{children}</pre>
      }

      return (
        <MarkdownCodeBlock
          codeText={codeBlock.codeText}
          language={codeBlock.language}
          themeMode={effectiveTheme}
        />
      )
    },
    a({ href, children, ...props }) {
      const link = typeof href === 'string' ? href.trim() : ''
      const external = Boolean(link) && shouldOpenInSystemBrowser(link)

      return (
        <a
          {...props}
          href={link || href}
          target={external ? '_blank' : props.target}
          rel={external ? 'noopener noreferrer' : props.rel}
          onClick={(event) => {
            props.onClick?.(event)
            if (event.defaultPrevented) return
            if (!external) return
            event.preventDefault()
            void window.electronAPI.openExternal(link)
          }}
        >
          {children}
        </a>
      )
    },
    code({ className, children, node: _node, ...props }) {
      const mergedClassName = className ? `code-markdown-inline-code ${className}` : 'code-markdown-inline-code'
      return <code className={mergedClassName} {...props}>{children}</code>
    },
  }), [effectiveTheme])

  const captureCurrentModeScroll = useCallback(() => {
    if (!isMarkdownFile || !activeRelativePath) return

    if (effectiveMarkdownPreviewMode === 'edit') {
      const state = editorRef.current?.getScrollState() ?? editorScrollStateRef.current
      if (state) {
        const current = markdownScrollMemoryRef.current[activeRelativePath] ?? {}
        markdownScrollMemoryRef.current[activeRelativePath] = {
          ...current,
          edit: Math.max(0, state.scrollTop),
        }
      }
      return
    }

    if (effectiveMarkdownPreviewMode === 'preview') {
      const preview = previewScrollRef.current
      if (preview) {
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
    const current = markdownScrollMemoryRef.current[activeRelativePath] ?? {}
    markdownScrollMemoryRef.current[activeRelativePath] = {
      ...current,
      splitEditor: editorState ? Math.max(0, editorState.scrollTop) : current.splitEditor,
      splitPreview: preview ? Math.max(0, preview.scrollTop) : current.splitPreview,
    }
  }, [activeRelativePath, effectiveMarkdownPreviewMode, isMarkdownFile])

  const loadTree = useCallback(async () => {
    setTree((prev) => ({ ...prev, status: 'loading', error: null }))

    try {
      const result = await window.electronAPI.listProjectFiles(projectPath)
      const sortedNodes = sortTreeNodes(result.nodes)
      setTree({
        status: 'ready',
        nodes: sortedNodes,
        error: null,
        skippedDirectories: result.skipped.directories,
        skippedFiles: result.skipped.files,
      })
      setExpandedDirectories(createDefaultExpandedDirectorySet(sortedNodes))
    } catch (error) {
      setTree({
        status: 'error',
        nodes: [],
        error: error instanceof Error ? error.message : String(error),
        skippedDirectories: 0,
        skippedFiles: 0,
      })
    }
  }, [projectPath])

  useEffect(() => {
    void loadTree()
  }, [loadTree])

  useEffect(() => {
    const media = window.matchMedia(NARROW_VIEWPORT_QUERY)
    const handleChange = (event: MediaQueryListEvent) => {
      setIsNarrowViewport(event.matches)
      if (!event.matches) {
        setIsExplorerOpen(true)
      }
      if (!event.matches) {
        setIsQuickDrawerOpen(false)
      }
    }

    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    const normalized = normalizeCodeFileDrawerState(persistedCodeFileDrawerState)
    setCodeFileDrawerState((prev) => (
      isSameCodeFileDrawerState(prev, normalized) ? prev : normalized
    ))
  }, [persistedCodeFileDrawerState, projectId])

  useEffect(() => {
    if (!projectId) return
    void setProjectCodeFileDrawerState(projectId, codeFileDrawerState)
  }, [codeFileDrawerState, projectId, setProjectCodeFileDrawerState])

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

  const openFile = useCallback(async (relativePath: string, forceReload = false) => {
    if (activeRelativePath === relativePath && !forceReload) return
    if (isDirty && activeRelativePath && activeRelativePath !== relativePath) {
      const proceed = window.confirm('Current file has unsaved changes. Discard and continue?')
      if (!proceed) return
    }

    captureCurrentModeScroll()

    setIsReading(true)
    setReadError(null)
    setSaveError(null)
    setSaveStatus('idle')

    try {
      const result = await window.electronAPI.readProjectFile(projectPath, relativePath)
      setActiveFile(result)
      setActiveRelativePath(result.relativePath)
      splitSyncReadyRef.current = false
      setEditorValue(result.content)
      setLastSavedValue(result.content)
      setHasExternalChange(false)
      setExpandedDirectories((prev) => {
        const next = new Set(prev)
        for (const parent of collectParentDirectories(result.relativePath)) {
          next.add(parent)
        }
        return next
      })
      setCodeFileDrawerState((prev) => pushRecentCodeFilePath(prev, result.relativePath))
      void setProjectLastCodeFile(projectId, result.relativePath)
    } catch (error) {
      setReadError(error instanceof Error ? error.message : String(error))
      if (forceReload || persistedLastCodeFile === relativePath) {
        void setProjectLastCodeFile(projectId, undefined)
      }
    } finally {
      setIsReading(false)
    }
  }, [
    activeRelativePath,
    captureCurrentModeScroll,
    isDirty,
    persistedLastCodeFile,
    projectId,
    projectPath,
    setProjectLastCodeFile,
  ])

  const toggleFavoriteForPath = useCallback((relativePath: string) => {
    setCodeFileDrawerState((prev) => toggleFavoriteCodeFilePath(prev, relativePath))
  }, [])

  const removePathFromQuickDrawer = useCallback((relativePath: string) => {
    setCodeFileDrawerState((prev) => removeCodeFilePathFromDrawerState(prev, relativePath))
  }, [])

  const handleSave = useCallback(async () => {
    if (!activeRelativePath || !activeFile) return
    if (!isDirty) return

    setSaveStatus('saving')
    setSaveError(null)

    try {
      const result = await window.electronAPI.writeProjectFile(
        projectPath,
        activeRelativePath,
        editorValue,
        activeFile.mtimeMs
      )
      setActiveFile((prev) => (
        prev
          ? {
            ...prev,
            content: editorValue,
            size: result.size,
            mtimeMs: result.mtimeMs,
          }
          : prev
      ))
      setLastSavedValue(editorValue)
      setSaveStatus('saved')
      setHasExternalChange(false)
      window.setTimeout(() => {
        setSaveStatus((current) => (current === 'saved' ? 'idle' : current))
      }, SAVE_STATUS_RESET_DELAY_MS)
    } catch (error) {
      setSaveStatus('error')
      setSaveError(error instanceof Error ? error.message : String(error))
    }
  }, [activeFile, activeRelativePath, editorValue, isDirty, projectPath])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key.toLowerCase() !== 's') return
      event.preventDefault()
      void handleSave()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSave])

  useEffect(() => {
    if (!activeRelativePath || !activeFile) {
      setHasExternalChange(false)
      return
    }

    let cancelled = false
    let inFlight = false

    const checkOnce = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      try {
        const stat = await window.electronAPI.statProjectFile(projectPath, activeRelativePath)
        if (cancelled) return
        if (Math.abs(stat.mtimeMs - activeFile.mtimeMs) <= 0.001) return

        if (isDirty) {
          setHasExternalChange(true)
          return
        }

        setIsReloadingFromDisk(true)
        await openFile(activeRelativePath, true)
      } catch {
        // ignore transient stat/read errors during polling
      } finally {
        inFlight = false
        if (!cancelled) {
          setIsReloadingFromDisk(false)
        }
      }
    }

    const timer = window.setInterval(() => {
      void checkOnce()
    }, FILE_EXTERNAL_CHANGE_POLL_MS)
    void checkOnce()

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeFile, activeRelativePath, isDirty, openFile, projectPath])

  const saveText = saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : 'Save'
  const saveIndicatorText = !activeRelativePath
    ? 'No file selected'
    : saveStatus === 'saving'
      ? 'Saving...'
      : saveStatus === 'saved'
        ? 'Saved'
        : isDirty
          ? 'Unsaved changes'
          : 'All changes saved'
  const saveIndicatorToneClass = saveStatus === 'error'
    ? 'text-[color:var(--color-destructive)]'
    : saveStatus === 'saving' || isDirty
      ? 'text-[color:var(--color-warning)]'
      : 'text-[color:var(--color-muted-foreground)]'
  const isActiveFileFavorite = Boolean(activeRelativePath && codeFileDrawerState.favorites.includes(activeRelativePath))

  useEffect(() => {
    if (fileSearchInput === fileSearchQuery) return
    const timer = window.setTimeout(() => {
      setFileSearchQuery(fileSearchInput)
    }, FILE_SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [fileSearchInput, fileSearchQuery])

  useEffect(() => {
    const normalized = (persistedLastMarkdownPreviewMode === 'edit' || persistedLastMarkdownPreviewMode === 'preview' || persistedLastMarkdownPreviewMode === 'split')
      ? persistedLastMarkdownPreviewMode
      : 'edit'
    setMarkdownPreviewMode(normalized)
  }, [persistedLastMarkdownPreviewMode, projectId])

  useEffect(() => {
    void setProjectLastMarkdownPreviewMode(projectId, markdownPreviewMode)
  }, [markdownPreviewMode, projectId, setProjectLastMarkdownPreviewMode])

  const showExplorerPanel = !isNarrowViewport || isExplorerOpen
  const showEditorPanel = !isNarrowViewport || !isExplorerOpen
  const hasSearchQuery = fileSearchQuery.trim().length > 0
  const matchedFileNodes = useMemo(
    () => (hasSearchQuery ? collectMatchedFilesByQuery(tree.nodes, fileSearchQuery) : []),
    [fileSearchQuery, hasSearchQuery, tree.nodes]
  )
  const treeNodesForView = hasSearchQuery ? matchedFileNodes : tree.nodes

  const setActiveSyncSource = useCallback((source: 'editor' | 'preview') => {
    activeScrollSyncSourceRef.current = source
    if (scrollSyncReleaseTimerRef.current) {
      window.clearTimeout(scrollSyncReleaseTimerRef.current)
    }
    scrollSyncReleaseTimerRef.current = window.setTimeout(() => {
      activeScrollSyncSourceRef.current = null
      scrollSyncReleaseTimerRef.current = null
    }, 120)
  }, [])

  const storeScrollTop = useCallback((path: string, key: MarkdownScrollModeKey, scrollTop: number) => {
    if (!Number.isFinite(scrollTop)) return
    const current = markdownScrollMemoryRef.current[path] ?? {}
    markdownScrollMemoryRef.current[path] = {
      ...current,
      [key]: Math.max(0, scrollTop),
    }
  }, [])

  const mapScrollTopByRatio = useCallback(
    (
      source: { scrollTop: number; scrollHeight: number; viewportHeight: number } | null,
      target: { scrollHeight: number; viewportHeight: number } | null
    ): number | null => {
      if (!source || !target) return null
      const sourceMax = Math.max(0, source.scrollHeight - source.viewportHeight)
      const targetMax = Math.max(0, target.scrollHeight - target.viewportHeight)
      if (targetMax <= 0) return 0
      if (sourceMax <= 0) return 0
      const ratio = Math.min(1, Math.max(0, source.scrollTop / sourceMax))
      return ratio * targetMax
    },
    []
  )

  const applyPreviewScrollTop = useCallback((scrollTop: number) => {
    const preview = previewScrollRef.current
    if (!preview) return
    preview.scrollTop = Math.max(0, scrollTop)
  }, [])

  const applyEditorScrollTop = useCallback((scrollTop: number) => {
    editorRef.current?.setScrollTop(Math.max(0, scrollTop))
  }, [])

  useEffect(() => {
    if (tree.status !== 'ready') return
    if (hasAttemptedInitialRestore) return
    setHasAttemptedInitialRestore(true)

    if (!persistedLastCodeFile) return
    void openFile(persistedLastCodeFile)
  }, [hasAttemptedInitialRestore, openFile, persistedLastCodeFile, tree.status])

  useEffect(() => {
    return () => {
      if (scrollSyncReleaseTimerRef.current) {
        window.clearTimeout(scrollSyncReleaseTimerRef.current)
        scrollSyncReleaseTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!isQuickDrawerOpen) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('[data-code-quick-drawer-root="true"]')) return
      if (target.closest('[data-code-quick-drawer-trigger="true"]')) return
      setIsQuickDrawerOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsQuickDrawerOpen(false)
      }
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isQuickDrawerOpen])

  useLayoutEffect(() => {
    if (!isMarkdownFile || !activeRelativePath) return
    splitSyncReadyRef.current = false

    const timer = window.setTimeout(() => {
      if (effectiveMarkdownPreviewMode === 'edit') {
        const storedEdit = markdownScrollMemoryRef.current[activeRelativePath]?.edit
        const storedSplitEditor = markdownScrollMemoryRef.current[activeRelativePath]?.splitEditor
        const storedPreview = markdownScrollMemoryRef.current[activeRelativePath]?.preview
        const nextTop = Number.isFinite(storedEdit)
          ? Number(storedEdit)
          : (
            Number.isFinite(storedSplitEditor)
              ? Number(storedSplitEditor)
              : (Number.isFinite(storedPreview) ? Number(storedPreview) : 0)
          )
        applyEditorScrollTop(nextTop)
        return
      }

      if (effectiveMarkdownPreviewMode === 'preview') {
        const storedPreview = markdownScrollMemoryRef.current[activeRelativePath]?.preview
        const storedSplitPreview = markdownScrollMemoryRef.current[activeRelativePath]?.splitPreview
        const storedSplitEditor = markdownScrollMemoryRef.current[activeRelativePath]?.splitEditor
        const storedEdit = markdownScrollMemoryRef.current[activeRelativePath]?.edit
        const nextTop = Number.isFinite(storedPreview)
          ? Number(storedPreview)
          : (
            Number.isFinite(storedSplitPreview)
              ? Number(storedSplitPreview)
              : (
                Number.isFinite(storedSplitEditor)
                  ? Number(storedSplitEditor)
                  : (Number.isFinite(storedEdit) ? Number(storedEdit) : 0)
              )
          )
        applyPreviewScrollTop(nextTop)
        return
      }

      const storedSplitEditor = markdownScrollMemoryRef.current[activeRelativePath]?.splitEditor
      const storedSplitPreview = markdownScrollMemoryRef.current[activeRelativePath]?.splitPreview
      const storedEdit = markdownScrollMemoryRef.current[activeRelativePath]?.edit
      const storedPreview = markdownScrollMemoryRef.current[activeRelativePath]?.preview
      const fallbackEditor = Number.isFinite(storedEdit)
        ? Number(storedEdit)
        : (Number.isFinite(storedPreview) ? Number(storedPreview) : 0)
      const fallbackPreview = Number.isFinite(storedPreview) ? Number(storedPreview) : fallbackEditor
      const nextEditorTop = Number.isFinite(storedSplitEditor) ? Number(storedSplitEditor) : fallbackEditor
      const nextPreviewTop = Number.isFinite(storedSplitPreview)
        ? Number(storedSplitPreview)
        : (Number.isFinite(storedSplitEditor) ? nextEditorTop : fallbackPreview || fallbackEditor)
      applyEditorScrollTop(nextEditorTop)
      applyPreviewScrollTop(nextPreviewTop)
      splitSyncReadyRef.current = true
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [
    activeRelativePath,
    applyEditorScrollTop,
    applyPreviewScrollTop,
    effectiveMarkdownPreviewMode,
    isMarkdownFile,
  ])

  const handleEditorScrollStateChange = useCallback((state: MonacoEditorScrollState) => {
    editorScrollStateRef.current = state

    if (!isMarkdownFile || !activeRelativePath || !isShowingEditor) return
    const modeKey: MarkdownScrollModeKey = effectiveMarkdownPreviewMode === 'split' ? 'splitEditor' : 'edit'
    storeScrollTop(activeRelativePath, modeKey, state.scrollTop)

    if (effectiveMarkdownPreviewMode !== 'split' || !isShowingPreview || !splitSyncReadyRef.current) return
    if (activeScrollSyncSourceRef.current === 'preview') return

    const previewState = previewScrollStateRef.current
    const targetTop = mapScrollTopByRatio(state, previewState)
    if (targetTop == null) return
    setActiveSyncSource('editor')
    applyPreviewScrollTop(targetTop)
    storeScrollTop(activeRelativePath, 'splitPreview', targetTop)
  }, [
    activeRelativePath,
    applyPreviewScrollTop,
    effectiveMarkdownPreviewMode,
    isMarkdownFile,
    isShowingEditor,
    isShowingPreview,
    mapScrollTopByRatio,
    setActiveSyncSource,
    storeScrollTop,
  ])

  const handlePreviewScroll = useCallback(() => {
    const preview = previewScrollRef.current
    if (!preview || !isMarkdownFile || !activeRelativePath || !isShowingPreview) return

    const viewportHeight = preview.clientHeight
    const scrollHeight = preview.scrollHeight
    const scrollTop = preview.scrollTop
    const nextState = { scrollTop, scrollHeight, viewportHeight }
    previewScrollStateRef.current = nextState

    const modeKey: MarkdownScrollModeKey = effectiveMarkdownPreviewMode === 'split' ? 'splitPreview' : 'preview'
    storeScrollTop(activeRelativePath, modeKey, scrollTop)

    if (effectiveMarkdownPreviewMode !== 'split' || !isShowingEditor || !splitSyncReadyRef.current) return
    if (activeScrollSyncSourceRef.current === 'editor') return

    const editorState = editorScrollStateRef.current
    const targetTop = mapScrollTopByRatio(nextState, editorState)
    if (targetTop == null) return
    setActiveSyncSource('preview')
    applyEditorScrollTop(targetTop)
    storeScrollTop(activeRelativePath, 'splitEditor', targetTop)
  }, [
    activeRelativePath,
    applyEditorScrollTop,
    effectiveMarkdownPreviewMode,
    isMarkdownFile,
    isShowingEditor,
    isShowingPreview,
    mapScrollTopByRatio,
    setActiveSyncSource,
    storeScrollTop,
  ])

  const openFileFromQuickDrawer = useCallback((relativePath: string) => {
    void openFile(relativePath)
    if (isNarrowViewport) {
      setIsExplorerOpen(false)
    }
    setIsQuickDrawerOpen(false)
  }, [isNarrowViewport, openFile])

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
  }, [isShowingPreview, editorValue, effectiveMarkdownPreviewMode])

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div
        className="mb-3 flex min-h-[52px] items-center justify-between gap-3 rounded-[16px] border px-4 py-2"
        style={{ borderColor: 'var(--color-border)', background: 'color-mix(in srgb, var(--color-card) 95%, transparent)' }}
      >
        <div className="min-w-0">
          <p className="truncate text-xs text-[color:var(--color-muted-foreground)]" title={activeRelativePath ?? undefined}>
            {activeRelativePath ?? 'Select a file from the tree'}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-[color:var(--color-muted-foreground)]">
            {activeRelativePath
              ? `${activeLanguage || 'plaintext'} • ${formatFileSize(activeFileSize)}`
              : 'Choose a file to start editing'}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {activeRelativePath && (
            <button
              type="button"
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-xs transition-colors ${
                isActiveFileFavorite
                  ? 'border-[color:var(--color-warning)]/40 bg-[color:var(--color-warning-background)] text-[color:var(--color-warning)]'
                  : 'border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
              }`}
              onClick={() => toggleFavoriteForPath(activeRelativePath)}
              title={isActiveFileFavorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Star className={`h-3.5 w-3.5 ${isActiveFileFavorite ? 'fill-current' : ''}`} />
              {isActiveFileFavorite ? 'Favorited' : 'Favorite'}
            </button>
          )}
          <button
            type="button"
            data-code-quick-drawer-trigger="true"
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
              isQuickDrawerOpen
                ? 'border-[color:var(--color-primary)] bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)]'
                : 'border-[color:var(--color-border)] text-[color:var(--color-foreground)] hover:bg-[color:var(--color-accent)]'
            }`}
            onClick={() => setIsQuickDrawerOpen((prev) => !prev)}
            title="Quick file drawer"
          >
            <PanelLeftOpen className="h-3.5 w-3.5" />
            Files
          </button>
          {isNarrowViewport && (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
              onClick={() => setIsExplorerOpen((prev) => !prev)}
              title={isExplorerOpen ? 'Switch to editor' : 'Open file explorer'}
            >
              <Code2 className="h-3.5 w-3.5" />
              {isExplorerOpen ? 'Editor' : 'Explorer'}
            </button>
          )}
          <span className={`text-[11px] ${saveIndicatorToneClass}`}>{saveIndicatorText}</span>
          <button
            type="button"
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-all ${saveStatus === 'saving'
              ? 'border text-[color:var(--color-warning)] bg-[color:var(--color-warning-background)]'
              : 'bg-primary text-white shadow-sm hover:bg-primary-hover disabled:opacity-50'
              }`}
            onClick={() => void handleSave()}
            disabled={!activeRelativePath || !isDirty || saveStatus === 'saving'}
          >
            <Save className="h-3.5 w-3.5" />
            {saveText}
          </button>
        </div>
      </div>

      {activeRelativePath && hasExternalChange && (
        <div
          className="mb-3 flex items-center justify-between gap-3 rounded-[14px] border px-3 py-2 text-xs"
          style={{
            borderColor: 'color-mix(in srgb, var(--color-warning) 40%, transparent)',
            background: 'var(--color-warning-background)',
            color: 'var(--color-foreground)',
          }}
        >
          <span>
            File changed on disk. Reload to view latest content, or keep your unsaved edits.
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center rounded-full border border-[color:var(--color-border)] px-3 py-1 text-[11px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
              onClick={() => {
                setHasExternalChange(false)
              }}
            >
              Keep My Changes
            </button>
            <button
              type="button"
              className="inline-flex items-center rounded-full bg-primary px-3 py-1 text-[11px] font-medium text-white transition-colors hover:bg-primary-hover"
              onClick={() => {
                void openFile(activeRelativePath, true)
              }}
            >
              Reload from Disk
            </button>
          </div>
        </div>
      )}

      {isQuickDrawerOpen && (
        <button
          type="button"
          className="fixed inset-0 z-[29] bg-transparent"
          aria-label="Close file drawer backdrop"
          onClick={() => setIsQuickDrawerOpen(false)}
        />
      )}

      <aside
        data-code-quick-drawer-root="true"
        className={`code-file-quick-drawer ${isQuickDrawerOpen ? 'is-open' : ''}`}
      >
        <div className="code-file-quick-drawer-header">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[color:var(--color-foreground)]">File Drawer</p>
            <p className="text-[11px] text-[color:var(--color-muted-foreground)]">Favorites and recent files</p>
          </div>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
            onClick={() => setIsQuickDrawerOpen(false)}
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="code-file-quick-drawer-content">
          <section className="code-file-quick-drawer-section">
            <div className="code-file-quick-drawer-section-title">
              <Star className="h-3.5 w-3.5" />
              Favorites
            </div>
            {quickDrawerFavorites.length === 0 ? (
              <p className="code-file-quick-drawer-empty">No favorites yet.</p>
            ) : (
              <div className="code-file-quick-drawer-list">
                {quickDrawerFavorites.map((relativePath) => {
                  const isActive = activeRelativePath === relativePath
                  return (
                    <div key={`fav-${relativePath}`} className={`code-file-quick-drawer-item ${isActive ? 'is-active' : ''}`}>
                      <button
                        type="button"
                        className="code-file-quick-drawer-open"
                        onClick={() => openFileFromQuickDrawer(relativePath)}
                        title={relativePath}
                      >
                        <span className="code-file-quick-drawer-path">{relativePath}</span>
                        <span className="code-file-quick-drawer-meta">{inferLanguageFromRelativePath(relativePath)}</span>
                      </button>
                      <div className="code-file-quick-drawer-actions">
                        <button
                          type="button"
                          className="code-file-quick-drawer-action is-starred"
                          onClick={() => toggleFavoriteForPath(relativePath)}
                          title="Remove from favorites"
                        >
                          <Star className="h-3.5 w-3.5 fill-current" />
                        </button>
                        <button
                          type="button"
                          className="code-file-quick-drawer-action is-danger"
                          onClick={() => removePathFromQuickDrawer(relativePath)}
                          title="Delete from drawer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <section className="code-file-quick-drawer-section">
            <div className="code-file-quick-drawer-section-title">
              <Clock3 className="h-3.5 w-3.5" />
              Recent
            </div>
            {quickDrawerRecents.length === 0 ? (
              <p className="code-file-quick-drawer-empty">No recent files yet.</p>
            ) : (
              <div className="code-file-quick-drawer-list">
                {quickDrawerRecents.map((relativePath) => {
                  const isActive = activeRelativePath === relativePath
                  const isFavorite = codeFileDrawerState.favorites.includes(relativePath)
                  return (
                    <div key={`recent-${relativePath}`} className={`code-file-quick-drawer-item ${isActive ? 'is-active' : ''}`}>
                      <button
                        type="button"
                        className="code-file-quick-drawer-open"
                        onClick={() => openFileFromQuickDrawer(relativePath)}
                        title={relativePath}
                      >
                        <span className="code-file-quick-drawer-path">{relativePath}</span>
                        <span className="code-file-quick-drawer-meta">{inferLanguageFromRelativePath(relativePath)}</span>
                      </button>
                      <div className="code-file-quick-drawer-actions">
                        <button
                          type="button"
                          className={`code-file-quick-drawer-action ${isFavorite ? 'is-starred' : ''}`}
                          onClick={() => toggleFavoriteForPath(relativePath)}
                          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                        >
                          <Star className={`h-3.5 w-3.5 ${isFavorite ? 'fill-current' : ''}`} />
                        </button>
                        <button
                          type="button"
                          className="code-file-quick-drawer-action is-danger"
                          onClick={() => removePathFromQuickDrawer(relativePath)}
                          title="Delete from drawer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </aside>

      <div className="min-h-0 flex-1">
        <div className="code-layout-grid h-full" style={isNarrowViewport ? { gridTemplateColumns: 'minmax(0, 1fr)' } : undefined}>
          {showExplorerPanel && (
            <aside className="code-tree-panel surface-card">
              <div className="code-panel-header">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Search className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
                  <div className="relative min-w-0 flex-1">
                    <input
                      type="text"
                      value={fileSearchInput}
                      onChange={(event) => setFileSearchInput(event.target.value)}
                      placeholder="Search files (e.g. abvd)"
                      className="code-search-input"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      className={`absolute right-2 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full transition-colors ${
                        fileSearchInput.trim().length > 0
                          ? 'text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]'
                          : 'pointer-events-none opacity-0'
                      }`}
                      onClick={() => {
                        setFileSearchInput('')
                        setFileSearchQuery('')
                      }}
                      title="Clear search"
                      aria-label="Clear search"
                      tabIndex={fileSearchInput.trim().length > 0 ? 0 : -1}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                  onClick={() => void loadTree()}
                  title="Reload file tree"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${tree.status === 'loading' ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {tree.status === 'loading' ? (
                <div className="code-panel-empty text-xs text-[color:var(--color-muted-foreground)]">Loading files...</div>
              ) : tree.status === 'error' ? (
                <div className="code-panel-empty text-xs text-[color:var(--color-destructive)]">{tree.error ?? 'Failed to load file tree.'}</div>
              ) : hasSearchQuery && treeNodesForView.length === 0 ? (
                <div className="code-panel-empty text-xs text-[color:var(--color-muted-foreground)]">No matching files.</div>
              ) : (
                <CodeFileTree
                  nodes={treeNodesForView}
                  activeRelativePath={activeRelativePath}
                  expandedDirectories={expandedDirectories}
                  flatFileListMode={hasSearchQuery}
                  onToggleDirectory={(relativePath) => {
                    if (hasSearchQuery) return
                    const update = (prev: Set<string>) => {
                      const next = new Set(prev)
                      if (next.has(relativePath)) next.delete(relativePath)
                      else next.add(relativePath)
                      return next
                    }
                    setExpandedDirectories(update)
                  }}
                  onSelectFile={(relativePath) => {
                    void openFile(relativePath)
                    if (isNarrowViewport) {
                      setIsExplorerOpen(false)
                    }
                  }}
                />
              )}
            </aside>
          )}

          {showEditorPanel && (
            <section className="code-editor-panel surface-card">
              {activeRelativePath ? (
                <div className="code-editor-shell">
                  {isMarkdownFile && (
                    <div className="code-editor-preview-toolbar">
                      <span className="text-[11px] text-[color:var(--color-muted-foreground)]">Markdown</span>
                      <div className="code-editor-preview-mode-group">
                        <button
                          type="button"
                          className={`code-editor-preview-mode-btn ${
                            effectiveMarkdownPreviewMode === 'edit' ? 'is-active' : ''
                          }`}
                          onClick={() => {
                            captureCurrentModeScroll()
                            setMarkdownPreviewMode('edit')
                          }}
                          title="Editor"
                        >
                          <Code2 className="h-3.5 w-3.5" />
                          Editor
                        </button>
                        <button
                          type="button"
                          className={`code-editor-preview-mode-btn ${
                            effectiveMarkdownPreviewMode === 'preview' ? 'is-active' : ''
                          }`}
                          onClick={() => {
                            captureCurrentModeScroll()
                            setMarkdownPreviewMode('preview')
                          }}
                          title="Preview"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Preview
                        </button>
                        <button
                          type="button"
                          className={`code-editor-preview-mode-btn ${
                            effectiveMarkdownPreviewMode === 'split' ? 'is-active' : ''
                          }`}
                          onClick={() => {
                            captureCurrentModeScroll()
                            setMarkdownPreviewMode('split')
                          }}
                          title={isNarrowViewport ? 'Split is only available on wide layout' : 'Split view'}
                          disabled={isNarrowViewport}
                        >
                          <Columns2 className="h-3.5 w-3.5" />
                          Split
                        </button>
                      </div>
                    </div>
                  )}

                  <div
                    className={`code-editor-content ${
                      effectiveMarkdownPreviewMode === 'split'
                        ? 'code-editor-content--split'
                        : 'code-editor-content--single'
                    }`}
                  >
                    {effectiveMarkdownPreviewMode !== 'preview' && (
                      <div className={`code-editor-pane ${effectiveMarkdownPreviewMode === 'split' ? 'code-editor-pane--split' : ''}`}>
                        <MonacoCodeEditor
                          ref={editorRef}
                          filePath={activeRelativePath}
                          value={editorValue}
                          language={activeLanguage || 'plaintext'}
                          theme={monacoTheme}
                          onChange={setEditorValue}
                          onScrollStateChange={handleEditorScrollStateChange}
                          onSave={() => {
                            void handleSave()
                          }}
                        />
                      </div>
                    )}

                    {(effectiveMarkdownPreviewMode === 'preview' || effectiveMarkdownPreviewMode === 'split') && (
                      <div
                        ref={previewScrollRef}
                        className="code-editor-pane code-editor-pane--preview"
                        onScroll={handlePreviewScroll}
                      >
                        <article className="code-markdown-content">
                          {isMdcFile && parsedMarkdownDoc?.ruleMetadata && (
                            <section className="code-mdc-meta-card">
                              <h3 className="code-mdc-meta-title">Agent Rule Metadata</h3>
                              <div className="code-mdc-meta-grid">
                                <span className="code-mdc-meta-key">Type</span>
                                <span className="code-mdc-meta-value">{parsedMarkdownDoc.ruleMetadata.ruleType}</span>

                                <span className="code-mdc-meta-key">Always Apply</span>
                                <span className="code-mdc-meta-value">{parsedMarkdownDoc.ruleMetadata.alwaysApply ? 'true' : 'false'}</span>

                                <span className="code-mdc-meta-key">Description</span>
                                <span className="code-mdc-meta-value">
                                  {parsedMarkdownDoc.ruleMetadata.description?.trim() || 'N/A'}
                                </span>

                                <span className="code-mdc-meta-key">Globs</span>
                                <span className="code-mdc-meta-value">
                                  {parsedMarkdownDoc.ruleMetadata.globs.length > 0
                                    ? parsedMarkdownDoc.ruleMetadata.globs.join(', ')
                                    : 'N/A'}
                                </span>
                              </div>
                            </section>
                          )}
                          {!isMdcFile && parsedMarkdownDoc?.markdownMetadata && (
                            <section className="code-mdc-meta-card">
                              <h3 className="code-mdc-meta-title">Document Metadata</h3>
                              <div className="code-mdc-meta-grid">
                                <span className="code-mdc-meta-key">Title</span>
                                <span className="code-mdc-meta-value">
                                  {parsedMarkdownDoc.markdownMetadata.title?.trim() || 'N/A'}
                                </span>

                                <span className="code-mdc-meta-key">Description</span>
                                <span className="code-mdc-meta-value">
                                  {parsedMarkdownDoc.markdownMetadata.description?.trim() || 'N/A'}
                                </span>
                              </div>
                            </section>
                          )}
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                            {markdownPreviewContent}
                          </ReactMarkdown>
                        </article>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="code-panel-empty">
                  <div className="text-sm text-[color:var(--color-muted-foreground)]">
                    {isNarrowViewport ? 'Open Explorer to choose a file.' : 'Select a file from the left panel to start editing.'}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {(readError || saveError || isReading || isReloadingFromDisk || tree.skippedDirectories > 0 || tree.skippedFiles > 0) && (
        <div className="px-1 pb-1 pt-2">
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-[color:var(--color-muted-foreground)]">
            {isReading && <span>Reading file...</span>}
            {isReloadingFromDisk && <span>Reloading changed file from disk...</span>}
            {readError && <span className="text-[color:var(--color-destructive)]">{readError}</span>}
            {saveError && <span className="text-[color:var(--color-destructive)]">{saveError}</span>}
            {(tree.skippedDirectories > 0 || tree.skippedFiles > 0) && (
              <span>
                Skipped {tree.skippedDirectories} directories, {tree.skippedFiles} files.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
