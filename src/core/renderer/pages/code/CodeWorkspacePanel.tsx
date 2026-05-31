import { Children, isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, ChevronDown, ChevronUp, Code2, Columns2, Copy, Eye, FileSearch, Files, LocateFixed, PanelLeftOpen, RefreshCw, Save, Search, Star, TextSearch, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { ProjectCodeSession, ProjectFileContentSearchResponse, ProjectFileNode, ProjectFileNodeKind, ProjectFileReadResult } from '../../../shared/types'
import { ModalShell } from '../../components/ModalShell'
import { useAppStore } from '../../stores/appStore'
import { CodeContentSearchTree, type CodeContentSearchTreeHandle } from './CodeContentSearchTree'
import { CodeFileTree } from './CodeFileTree'
import { CodeFileQuickDrawer } from './CodeFileQuickDrawer'
import { DebouncedSearchInput } from './DebouncedSearchInput'
import { MonacoCodeEditor, type MonacoCodeEditorHandle, type MonacoEditorScrollState } from './MonacoCodeEditor'
import { useCodeFileState } from './useCodeFileState'
import { useMarkdownPreviewSearch } from './useMarkdownPreviewSearch'
import {
  collectAllFileRelativePaths,
  collectParentDirectories,
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
import { resolveTreeNodeFolderPath } from './code.pathActions'
import { parseMarkdownDocument } from './code.frontmatterParser'
import type { CodeFileDrawerState, FileTreeState } from './code.types'

const FILE_SEARCH_DEBOUNCE_MS = 180
const NARROW_VIEWPORT_QUERY = '(max-width: 960px)'
const CONTENT_SEARCH_AUTO_COLLAPSE_MATCH_THRESHOLD = 10
const MARKDOWN_DISABLE_SYNTAX_HIGHLIGHT_CHAR_THRESHOLD = 180_000
const MARKDOWN_DISABLE_SYNTAX_HIGHLIGHT_LINE_THRESHOLD = 3500
const MARKDOWN_CODE_BLOCK_DISABLE_HIGHLIGHT_CHAR_THRESHOLD = 40_000
const MARKDOWN_CODE_BLOCK_DISABLE_HIGHLIGHT_LINE_THRESHOLD = 700
const MARKDOWN_CODE_BLOCK_PRELOAD_ROOT_MARGIN = '320px 0px'
const MAX_PROJECT_CODE_SESSION_TABS = 5
const MAX_PROJECT_CODE_SESSION_CURSOR_POSITIONS = 60
const PROJECT_CODE_SESSION_SAVE_DEBOUNCE_MS = 220
const MAX_CONTENT_SEARCH_HISTORY = 12
const MAX_CONTENT_SEARCH_SCOPE_GLOBS = 24
const CONTENT_SEARCH_SCOPE_SEPARATOR_RE = /[\s,;\n，；]+/

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

function countTextLines(value: string): number {
  if (!value) return 0
  let count = 1
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) === 10) count += 1
  }
  return count
}

function shouldDisableMarkdownSyntaxHighlight(markdown: string): boolean {
  if (markdown.length > MARKDOWN_DISABLE_SYNTAX_HIGHLIGHT_CHAR_THRESHOLD) return true
  return countTextLines(markdown) > MARKDOWN_DISABLE_SYNTAX_HIGHLIGHT_LINE_THRESHOLD
}

function canHighlightMarkdownCodeBlock(codeText: string): boolean {
  if (codeText.length > MARKDOWN_CODE_BLOCK_DISABLE_HIGHLIGHT_CHAR_THRESHOLD) return false
  return countTextLines(codeText) <= MARKDOWN_CODE_BLOCK_DISABLE_HIGHLIGHT_LINE_THRESHOLD
}

function useNearViewport<T extends Element>(rootMargin: string): [React.RefObject<T>, boolean] {
  const ref = useRef<T | null>(null)
  const [isNearViewport, setIsNearViewport] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    if (typeof IntersectionObserver === 'undefined') {
      setIsNearViewport(true)
      return
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) {
        setIsNearViewport(true)
      }
    }, {
      root: null,
      rootMargin,
      threshold: 0.01,
    })

    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [rootMargin])

  return [ref, isNearViewport]
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
  enableSyntaxHighlight: boolean
}

function MarkdownCodeBlock({ codeText, language, themeMode, enableSyntaxHighlight }: MarkdownCodeBlockProps) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [containerRef, isNearViewport] = useNearViewport<HTMLDivElement>(MARKDOWN_CODE_BLOCK_PRELOAD_ROOT_MARGIN)
  const shouldRenderSyntax = enableSyntaxHighlight && canHighlightMarkdownCodeBlock(codeText) && isNearViewport

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
    <div ref={containerRef} className="code-markdown-syntax-wrap">
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

      {shouldRenderSyntax ? (
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
      ) : (
        <pre className="code-markdown-plain-block">
          <code className={`language-${language}`}>{codeText}</code>
        </pre>
      )}
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
type CodeViewMode = 'files' | 'search'
const CODE_FILE_DRAWER_SECTION_LIMIT = 40

function pickFirstFiniteScrollTop(...values: Array<number | undefined>): number {
  for (const value of values) {
    if (Number.isFinite(value)) {
      return Math.max(0, Number(value))
    }
  }
  return 0
}

function fileNameFromRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/')
  const segments = normalized.split('/')
  return segments[segments.length - 1] || relativePath
}

type EditorSearchMode = 'find' | 'replace'
type EditorCursorPosition = { lineNumber: number; column: number }

function normalizeContentSearchHistory(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(
    value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0)
  )).slice(0, MAX_CONTENT_SEARCH_HISTORY)
}

function normalizeContentSearchScope(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function normalizeContentSearchScopeToken(value: string): string {
  const token = value.trim()
  if (!token) return ''

  if (token.startsWith('.')) {
    return `*${token}`
  }

  if (!token.includes('*') && !token.includes('/') && /^[A-Za-z0-9_-]+$/.test(token)) {
    return `*.${token}`
  }

  if (token.endsWith('/') || (!token.includes('*') && token.includes('/'))) {
    const normalized = token.replace(/\/+$/, '')
    return `${normalized}/**`
  }

  return token
}

function parseContentSearchScopeGlobs(scopeInput: string): string[] {
  const tokens = scopeInput
    .split(CONTENT_SEARCH_SCOPE_SEPARATOR_RE)
    .map(normalizeContentSearchScopeToken)
    .filter((item) => item.length > 0)
  return Array.from(new Set(tokens)).slice(0, MAX_CONTENT_SEARCH_SCOPE_GLOBS)
}

function normalizeProjectCodeCursorPosition(
  value: unknown
): EditorCursorPosition | null {
  if (!value || typeof value !== 'object') return null
  const lineNumber = Math.max(1, Math.floor(Number((value as { lineNumber?: unknown }).lineNumber)))
  const column = Math.max(1, Math.floor(Number((value as { column?: unknown }).column)))
  if (!Number.isFinite(lineNumber) || !Number.isFinite(column)) return null
  return { lineNumber, column }
}

function normalizeProjectCodeSession(value: ProjectCodeSession | undefined): ProjectCodeSession | undefined {
  if (!value) return undefined
  const tabs = Array.isArray(value.tabs)
    ? Array.from(new Set(value.tabs.map((item) => item.trim()).filter(Boolean))).slice(0, MAX_PROJECT_CODE_SESSION_TABS)
    : []

  const activePath = typeof value.activePath === 'string' ? value.activePath.trim() : ''
  const normalizedActivePath = activePath && tabs.includes(activePath) ? activePath : tabs[0]
  const cursorEntries: Array<[string, EditorCursorPosition]> = []

  if (value.cursorPositions && typeof value.cursorPositions === 'object') {
    for (const [pathKey, position] of Object.entries(value.cursorPositions)) {
      const normalizedPath = pathKey.trim()
      if (!normalizedPath) continue
      const normalizedPosition = normalizeProjectCodeCursorPosition(position)
      if (!normalizedPosition) continue
      cursorEntries.push([normalizedPath, normalizedPosition])
      if (cursorEntries.length >= MAX_PROJECT_CODE_SESSION_CURSOR_POSITIONS) break
    }
  }

  const cursorPositions = cursorEntries.length > 0
    ? Object.fromEntries(cursorEntries)
    : undefined

  const contentSearchHistory = normalizeContentSearchHistory(value.contentSearchHistory)
  const contentSearchScope = normalizeContentSearchScope(value.contentSearchScope)

  if (tabs.length <= 0 && !cursorPositions && contentSearchHistory.length <= 0 && !contentSearchScope) return undefined

  return {
    tabs,
    activePath: normalizedActivePath,
    cursorPositions,
    contentSearchHistory: contentSearchHistory.length > 0 ? contentSearchHistory : undefined,
    contentSearchScope: contentSearchScope || undefined,
  }
}

export function CodeWorkspacePanel({ projectId, projectPath, themeMode }: CodeWorkspacePanelProps) {
  const projectMeta = useAppStore((s) => s.projects.find((p) => p.id === projectId))
  const persistedLastCodeFile = projectMeta?.lastCodeFile
  const persistedProjectCodeSession = useMemo(
    () => normalizeProjectCodeSession(projectMeta?.codeSession),
    [projectMeta?.codeSession]
  )
  const persistedLastMarkdownPreviewMode = projectMeta?.lastMarkdownPreviewMode
  const persistedCodeFileDrawerState = projectMeta?.codeFileDrawerState
  const setProjectCodeSession = useAppStore((s) => s.setProjectCodeSession)
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
  const [viewMode, setViewMode] = useState<CodeViewMode>('files')
  const [fileSearchQuery, setFileSearchQuery] = useState('')
  const [searchResultNodes, setSearchResultNodes] = useState<ProjectFileNode[]>([])
  const [isSearchingFiles, setIsSearchingFiles] = useState(false)
  const [fileSearchError, setFileSearchError] = useState<string | null>(null)
  const [contentSearchQuery, setContentSearchQuery] = useState('')
  const [contentSearchQuerySyncNonce, setContentSearchQuerySyncNonce] = useState(0)
  const [contentSearchHistory, setContentSearchHistory] = useState<string[]>(
    () => persistedProjectCodeSession?.contentSearchHistory ?? []
  )
  const [contentSearchScopeInput, setContentSearchScopeInput] = useState(
    () => persistedProjectCodeSession?.contentSearchScope ?? ''
  )
  const [contentSearchCaseSensitive, setContentSearchCaseSensitive] = useState(false)
  const [contentSearchResult, setContentSearchResult] = useState<ProjectFileContentSearchResponse>({
    files: [],
    totalMatches: 0,
    limited: false,
  })
  const [isSearchingContent, setIsSearchingContent] = useState(false)
  const [contentSearchError, setContentSearchError] = useState<string | null>(null)
  const [isContentSearchAllExpanded, setIsContentSearchAllExpanded] = useState(true)
  const [openTabPaths, setOpenTabPaths] = useState<string[]>(
    () => persistedProjectCodeSession?.tabs ?? []
  )
  const [cursorPositionsByPath, setCursorPositionsByPath] = useState<Record<string, EditorCursorPosition>>(
    () => persistedProjectCodeSession?.cursorPositions ?? {}
  )
  const [activeContentSearchLocation, setActiveContentSearchLocation] = useState<{
    relativePath: string
    lineNumber: number
    column: number
  } | null>(null)
  const [hasAttemptedInitialRestore, setHasAttemptedInitialRestore] = useState(false)
  const [locateRequestToken, setLocateRequestToken] = useState(0)
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
  const contentSearchTreeRef = useRef<CodeContentSearchTreeHandle | null>(null)
  const previewScrollRef = useRef<HTMLDivElement | null>(null)
  const editorScrollStateRef = useRef<MonacoEditorScrollState | null>(null)
  const previewScrollStateRef = useRef<{ scrollTop: number; scrollHeight: number; viewportHeight: number } | null>(null)
  const markdownScrollMemoryRef = useRef<Record<string, Partial<Record<MarkdownScrollModeKey, number>>>>({})
  const activeScrollSyncSourceRef = useRef<'editor' | 'preview' | null>(null)
  const scrollSyncReleaseTimerRef = useRef<number | null>(null)
  const pendingModeSwitchRef = useRef<{ from: MarkdownPreviewMode; to: MarkdownPreviewMode } | null>(null)
  const pendingEditorRestoreTopRef = useRef<number | null>(null)
  const splitSyncReadyRef = useRef(false)
  const searchRequestSeqRef = useRef(0)
  const contentSearchRequestSeqRef = useRef(0)
  const pendingRevealRef = useRef<{ relativePath: string; lineNumber: number; column: number } | null>(null)
  const pendingCursorRevealRef = useRef<{ relativePath: string; lineNumber: number; column: number } | null>(null)
  const saveCodeSessionTimerRef = useRef<number | null>(null)
  const lastPersistedCodeSessionJsonRef = useRef<string>('')
  const isRestoringCodeSessionRef = useRef(true)
  const fileSearchInputRef = useRef<HTMLInputElement | null>(null)
  const contentSearchInputRef = useRef<HTMLInputElement | null>(null)
  const captureCurrentModeScrollRef = useRef<() => void>(() => {})
  const pushOpenTabPath = useCallback((tabs: string[], relativePath: string): string[] => {
    const normalizedPath = relativePath.trim()
    if (!normalizedPath) return tabs
    if (tabs.includes(normalizedPath)) return tabs
    return [...tabs, normalizedPath].slice(-MAX_PROJECT_CODE_SESSION_TABS)
  }, [])
  const handleBeforeOpenCodeFile = useCallback(() => {
    captureCurrentModeScrollRef.current()
  }, [])
  const handleDidOpenCodeFile = useCallback((result: ProjectFileReadResult) => {
    const nextPath = result.relativePath.trim()
    if (nextPath) {
      setOpenTabPaths((prev) => pushOpenTabPath(prev, nextPath))
      if (isRestoringCodeSessionRef.current) {
        const persistedCursor = persistedProjectCodeSession?.cursorPositions?.[nextPath]
        if (persistedCursor) {
          pendingCursorRevealRef.current = {
            relativePath: nextPath,
            lineNumber: persistedCursor.lineNumber,
            column: persistedCursor.column,
          }
        }
      } else {
        pendingCursorRevealRef.current = null
      }
    }

    splitSyncReadyRef.current = false
    setExpandedDirectories((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const parent of collectParentDirectories(result.relativePath)) {
        if (next.has(parent)) continue
        next.add(parent)
        changed = true
      }
      return changed ? next : prev
    })
    setCodeFileDrawerState((prev) => pushRecentCodeFilePath(prev, result.relativePath))
  }, [persistedProjectCodeSession?.cursorPositions, pushOpenTabPath])
  const {
    activeFile,
    editorValue,
    setEditorValue,
    activeRelativePath,
    isReading,
    readError,
    saveStatus,
    saveError,
    hasExternalChange,
    setHasExternalChange,
    isReloadingFromDisk,
    discardUnsavedConfirm,
    resolveDiscardUnsavedConfirm,
    isDirty,
    openFile,
    handleSave,
    saveText,
    saveIndicatorText,
    saveIndicatorToneClass,
  } = useCodeFileState({
    projectId,
    projectPath,
    persistedLastCodeFile,
    onBeforeOpenFile: handleBeforeOpenCodeFile,
    onDidOpenFile: handleDidOpenCodeFile,
  })

  const monacoTheme = useMemo(
    () => (effectiveTheme === 'dark' ? 'vs-dark' : resolveMonacoTheme(themeMode)),
    [effectiveTheme, themeMode]
  )
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
  const enableMarkdownSyntaxHighlight = useMemo(
    () => !shouldDisableMarkdownSyntaxHighlight(markdownPreviewContent),
    [markdownPreviewContent]
  )
  const effectiveMarkdownPreviewMode = isMarkdownFile
    ? (markdownPreviewMode === 'split' && isNarrowViewport ? 'preview' : markdownPreviewMode)
    : 'edit'
  const previousEffectiveMarkdownModeRef = useRef<MarkdownPreviewMode>(effectiveMarkdownPreviewMode)
  const isShowingEditor = effectiveMarkdownPreviewMode !== 'preview'
  const isShowingPreview = effectiveMarkdownPreviewMode === 'preview' || effectiveMarkdownPreviewMode === 'split'
  const shouldHandleFindInPreview = isMarkdownFile && isShowingPreview && !isShowingEditor
  const {
    previewSearchVisible,
    previewSearchQuery,
    setPreviewSearchQuery,
    activePreviewSearchMatchIndex,
    setActivePreviewSearchMatchIndex,
    previewSearchMatches,
    previewSearchInputRef,
    closePreviewSearch,
    openPreviewSearch,
    goToNextPreviewSearchMatch,
    goToPreviousPreviewSearchMatch,
  } = useMarkdownPreviewSearch(previewScrollRef, shouldHandleFindInPreview, markdownPreviewContent)
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
          enableSyntaxHighlight={enableMarkdownSyntaxHighlight}
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
  }), [effectiveTheme, enableMarkdownSyntaxHighlight])

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

  useEffect(() => {
    captureCurrentModeScrollRef.current = captureCurrentModeScroll
  }, [captureCurrentModeScroll])

  const loadTree = useCallback(async () => {
    setTree((prev) => ({ ...prev, status: 'loading', error: null }))
    setFileSearchError(null)

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
      setSearchResultNodes([])
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
    const normalizedSession = normalizeProjectCodeSession(persistedProjectCodeSession)
    setOpenTabPaths(normalizedSession?.tabs ?? [])
    setCursorPositionsByPath(normalizedSession?.cursorPositions ?? {})
    setContentSearchHistory(normalizedSession?.contentSearchHistory ?? [])
    setContentSearchScopeInput(normalizedSession?.contentSearchScope ?? '')
    lastPersistedCodeSessionJsonRef.current = JSON.stringify(normalizedSession ?? null)
    if (saveCodeSessionTimerRef.current != null) {
      window.clearTimeout(saveCodeSessionTimerRef.current)
      saveCodeSessionTimerRef.current = null
    }
    isRestoringCodeSessionRef.current = true
    pendingCursorRevealRef.current = null
  }, [persistedProjectCodeSession, projectId])

  useEffect(() => {
    if (!projectId) return
    void setProjectCodeFileDrawerState(projectId, codeFileDrawerState)
  }, [codeFileDrawerState, projectId, setProjectCodeFileDrawerState])

  useEffect(() => {
    if (!projectId) return
    const activePath = activeRelativePath?.trim() || undefined
    const tabs = openTabPaths.slice(0, MAX_PROJECT_CODE_SESSION_TABS)
    if (activePath && !tabs.includes(activePath)) {
      tabs.push(activePath)
      if (tabs.length > MAX_PROJECT_CODE_SESSION_TABS) {
        tabs.splice(0, tabs.length - MAX_PROJECT_CODE_SESSION_TABS)
      }
    }

    let sessionCursorEntries = Object.entries(cursorPositionsByPath)
      .filter(([pathKey]) => pathKey.trim().length > 0)
    const sessionTabSet = new Set(tabs)
    sessionCursorEntries = sessionCursorEntries.filter(([pathKey]) => sessionTabSet.has(pathKey))
    if (sessionCursorEntries.length > MAX_PROJECT_CODE_SESSION_CURSOR_POSITIONS) {
      sessionCursorEntries = sessionCursorEntries.slice(0, MAX_PROJECT_CODE_SESSION_CURSOR_POSITIONS)
    }

    const nextSession = normalizeProjectCodeSession({
      tabs,
      activePath,
      cursorPositions: Object.fromEntries(sessionCursorEntries),
      contentSearchHistory,
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
  }, [
    activeRelativePath,
    contentSearchHistory,
    contentSearchScopeInput,
    cursorPositionsByPath,
    openTabPaths,
    projectId,
    setProjectCodeSession,
  ])

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

  const toggleFavoriteForPath = useCallback((relativePath: string) => {
    setCodeFileDrawerState((prev) => toggleFavoriteCodeFilePath(prev, relativePath))
  }, [])

  const removePathFromQuickDrawer = useCallback((relativePath: string) => {
    setCodeFileDrawerState((prev) => removeCodeFilePathFromDrawerState(prev, relativePath))
  }, [])

  const contentSearchScopeGlobs = useMemo(
    () => parseContentSearchScopeGlobs(contentSearchScopeInput),
    [contentSearchScopeInput]
  )
  const contentSearchScopeSummary = useMemo(() => (
    contentSearchScopeGlobs.length > 0 ? contentSearchScopeGlobs.join(' · ') : 'All files'
  ), [contentSearchScopeGlobs])
  const isActiveFileFavorite = Boolean(activeRelativePath && codeFileDrawerState.favorites.includes(activeRelativePath))
  const hasContentSearchQuery = contentSearchQuery.trim().length > 0
  const hasContentSearchScope = contentSearchScopeGlobs.length > 0
  const showContentSearchSummary = hasContentSearchQuery && !isSearchingContent && !contentSearchError
  const canToggleContentSearchTree = hasContentSearchQuery && !isSearchingContent && contentSearchResult.files.length > 0
  const contentSearchToggleLabel = isContentSearchAllExpanded ? 'Collapse all' : 'Expand all'
  const handleFileSearchQueryChange = useCallback((nextValue: string) => {
    setFileSearchQuery(nextValue)
  }, [])
  const handleContentSearchQueryChange = useCallback((nextValue: string) => {
    setContentSearchQuery(nextValue)
  }, [])
  const pushContentSearchHistory = useCallback((query: string) => {
    const normalized = query.trim()
    if (!normalized) return
    setContentSearchHistory((prev) => [normalized, ...prev.filter((item) => item !== normalized)].slice(0, MAX_CONTENT_SEARCH_HISTORY))
  }, [])
  const applyContentSearchQueryFromHistory = useCallback((query: string) => {
    const normalized = query.trim()
    if (!normalized) return
    setContentSearchQuery(normalized)
    setContentSearchQuerySyncNonce((prev) => prev + 1)
    pushContentSearchHistory(normalized)
  }, [pushContentSearchHistory])
  const removeContentSearchHistoryItem = useCallback((query: string) => {
    setContentSearchHistory((prev) => prev.filter((item) => item !== query))
  }, [])
  const focusSearchInputByMode = useCallback(() => {
    const focusTarget = () => {
      const target = viewMode === 'search' ? contentSearchInputRef.current : fileSearchInputRef.current
      if (!target) return
      target.focus()
      target.select()
    }

    if (isNarrowViewport && !isExplorerOpen) {
      setIsExplorerOpen(true)
      window.setTimeout(() => {
        focusTarget()
      }, 0)
      return
    }

    focusTarget()
  }, [isExplorerOpen, isNarrowViewport, viewMode])

  const openEditorSearchByMode = useCallback((mode: EditorSearchMode = 'find') => {
    if (!activeRelativePath || !isShowingEditor) {
      focusSearchInputByMode()
      return
    }

    const trigger = () => {
      const editorHandle = editorRef.current
      if (!editorHandle) {
        focusSearchInputByMode()
        return
      }
      editorHandle.openSearch(mode)
    }

    if (isNarrowViewport && isExplorerOpen) {
      setIsExplorerOpen(false)
      window.setTimeout(trigger, 0)
      return
    }

    trigger()
  }, [activeRelativePath, focusSearchInputByMode, isExplorerOpen, isNarrowViewport, isShowingEditor])

  const toggleCodeViewMode = useCallback(() => {
    setViewMode((prev) => (prev === 'files' ? 'search' : 'files'))
    if (isNarrowViewport && !isExplorerOpen) {
      setIsExplorerOpen(true)
    }
  }, [isExplorerOpen, isNarrowViewport])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      const isGlobalSearchShortcut = key === 'f' && (event.shiftKey || event.altKey)
      if (isGlobalSearchShortcut) {
        event.preventDefault()
        focusSearchInputByMode()
        return
      }
      if (key === 'f' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        if (shouldHandleFindInPreview) {
          openPreviewSearch()
          return
        }
        openEditorSearchByMode('find')
        return
      }
      if (key === 'h' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        openEditorSearchByMode('replace')
        return
      }
      if (key !== 's') return
      event.preventDefault()
      void handleSave()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusSearchInputByMode, handleSave, openEditorSearchByMode, openPreviewSearch, shouldHandleFindInPreview])

  useEffect(() => {
    let timer: number | null = null
    const off = window.electronAPI.onCodeFocusSearch(() => {
      if (timer != null) {
        window.clearTimeout(timer)
      }
      timer = window.setTimeout(() => {
        focusSearchInputByMode()
        timer = null
      }, 16)
    })
    return () => {
      off()
      if (timer != null) {
        window.clearTimeout(timer)
      }
    }
  }, [focusSearchInputByMode])

  useEffect(() => {
    return window.electronAPI.onCodeToggleViewMode(() => {
      toggleCodeViewMode()
    })
  }, [toggleCodeViewMode])

  useEffect(() => {
    const normalizedQuery = fileSearchQuery.trim()
    if (!normalizedQuery) {
      setIsSearchingFiles(false)
      setFileSearchError(null)
      setSearchResultNodes([])
      return
    }

    const requestSeq = searchRequestSeqRef.current + 1
    searchRequestSeqRef.current = requestSeq
    setIsSearchingFiles(true)
    setFileSearchError(null)

    void window.electronAPI.searchProjectFiles(projectPath, normalizedQuery)
      .then((result) => {
        if (searchRequestSeqRef.current !== requestSeq) return
        setSearchResultNodes(result)
      })
      .catch((error) => {
        if (searchRequestSeqRef.current !== requestSeq) return
        setSearchResultNodes([])
        setFileSearchError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (searchRequestSeqRef.current !== requestSeq) return
        setIsSearchingFiles(false)
      })
  }, [fileSearchQuery, projectPath])

  useEffect(() => {
    const normalizedQuery = contentSearchQuery.trim()
    if (!normalizedQuery) {
      setIsSearchingContent(false)
      setContentSearchError(null)
      setIsContentSearchAllExpanded(false)
      setContentSearchResult({
        files: [],
        totalMatches: 0,
        limited: false,
      })
      return
    }

    const requestSeq = contentSearchRequestSeqRef.current + 1
    contentSearchRequestSeqRef.current = requestSeq
    setIsSearchingContent(true)
    setContentSearchError(null)
    setIsContentSearchAllExpanded(false)

    void window.electronAPI.searchProjectContent(projectPath, normalizedQuery, {
      caseSensitive: contentSearchCaseSensitive,
      includeGlobs: contentSearchScopeGlobs.length > 0 ? contentSearchScopeGlobs : undefined,
    })
      .then((result) => {
        if (contentSearchRequestSeqRef.current !== requestSeq) return
        setContentSearchResult(result)
        setIsContentSearchAllExpanded(result.files.length > 0)
        pushContentSearchHistory(normalizedQuery)
      })
      .catch((error) => {
        if (contentSearchRequestSeqRef.current !== requestSeq) return
        setContentSearchResult({
          files: [],
          totalMatches: 0,
          limited: false,
        })
        setIsContentSearchAllExpanded(false)
        setContentSearchError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (contentSearchRequestSeqRef.current !== requestSeq) return
        setIsSearchingContent(false)
      })
  }, [
    contentSearchCaseSensitive,
    contentSearchQuery,
    contentSearchScopeGlobs,
    projectPath,
    pushContentSearchHistory,
  ])

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
  const treeNodesForView = hasSearchQuery ? searchResultNodes : tree.nodes
  const showExplorerPanelForMode = viewMode === 'files' ? showExplorerPanel : true
  const showEditorPanelForMode = viewMode === 'files' ? showEditorPanel : true
  const handleToggleTreeDirectory = useCallback((relativePath: string) => {
    if (hasSearchQuery) return
    setExpandedDirectories((prev) => {
      const next = new Set(prev)
      if (next.has(relativePath)) next.delete(relativePath)
      else next.add(relativePath)
      return next
    })
  }, [hasSearchQuery])
  const handleSelectTreeFile = useCallback((relativePath: string) => {
    void openFile(relativePath)
    if (isNarrowViewport) {
      setIsExplorerOpen(false)
    }
  }, [isNarrowViewport, openFile])
  const handleOpenTreeNodeFolder = useCallback(async (relativePath: string, nodeKind: ProjectFileNodeKind) => {
    const folderPath = resolveTreeNodeFolderPath(projectPath, relativePath, nodeKind)
    await window.electronAPI.openFolder(folderPath)
  }, [projectPath])
  const handleCopyTreeNodeName = useCallback((nodeName: string) => {
    void copyTextToClipboard(nodeName)
  }, [])

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

  const restoreEditorScrollTop = useCallback((scrollTop: number) => {
    const normalized = Math.max(0, scrollTop)
    pendingEditorRestoreTopRef.current = normalized
    editorRef.current?.setScrollTop(normalized)
  }, [])

  useLayoutEffect(() => {
    const previous = previousEffectiveMarkdownModeRef.current
    if (previous === effectiveMarkdownPreviewMode) return
    pendingModeSwitchRef.current = { from: previous, to: effectiveMarkdownPreviewMode }
    previousEffectiveMarkdownModeRef.current = effectiveMarkdownPreviewMode
  }, [effectiveMarkdownPreviewMode])

  useEffect(() => {
    if (tree.status !== 'ready') return
    if (hasAttemptedInitialRestore) return
    setHasAttemptedInitialRestore(true)

    const sessionActivePath = persistedProjectCodeSession?.activePath
    const sessionFirstTabPath = persistedProjectCodeSession?.tabs[0]
    const restorePath = sessionActivePath || sessionFirstTabPath || persistedLastCodeFile
    if (!restorePath) {
      isRestoringCodeSessionRef.current = false
      return
    }
    void openFile(restorePath).finally(() => {
      isRestoringCodeSessionRef.current = false
    })
  }, [hasAttemptedInitialRestore, openFile, persistedLastCodeFile, persistedProjectCodeSession, tree.status])

  useEffect(() => {
    return () => {
      if (scrollSyncReleaseTimerRef.current) {
        window.clearTimeout(scrollSyncReleaseTimerRef.current)
        scrollSyncReleaseTimerRef.current = null
      }
      if (saveCodeSessionTimerRef.current != null) {
        window.clearTimeout(saveCodeSessionTimerRef.current)
        saveCodeSessionTimerRef.current = null
      }
    }
  }, [])

  useLayoutEffect(() => {
    if (!isMarkdownFile || !activeRelativePath) return
    splitSyncReadyRef.current = false
    const switchContext = pendingModeSwitchRef.current
    if (switchContext?.to !== effectiveMarkdownPreviewMode) {
      pendingModeSwitchRef.current = null
    }

    const timer = window.setTimeout(() => {
      const stored = markdownScrollMemoryRef.current[activeRelativePath] ?? {}
      const switchFrom = pendingModeSwitchRef.current?.to === effectiveMarkdownPreviewMode
        ? pendingModeSwitchRef.current.from
        : null

      if (effectiveMarkdownPreviewMode === 'edit') {
        const nextTop = switchFrom === 'preview'
          ? pickFirstFiniteScrollTop(stored.preview, stored.splitPreview, stored.splitEditor, stored.edit)
          : switchFrom === 'split'
            ? pickFirstFiniteScrollTop(stored.splitEditor, stored.splitPreview, stored.edit, stored.preview)
            : pickFirstFiniteScrollTop(stored.edit, stored.splitEditor, stored.preview, stored.splitPreview)
        restoreEditorScrollTop(nextTop)
        pendingModeSwitchRef.current = null
        return
      }

      if (effectiveMarkdownPreviewMode === 'preview') {
        const nextTop = switchFrom === 'edit'
          ? pickFirstFiniteScrollTop(stored.edit, stored.splitEditor, stored.splitPreview, stored.preview)
          : switchFrom === 'split'
            ? pickFirstFiniteScrollTop(stored.splitPreview, stored.splitEditor, stored.preview, stored.edit)
            : pickFirstFiniteScrollTop(stored.preview, stored.splitPreview, stored.splitEditor, stored.edit)
        applyPreviewScrollTop(nextTop)
        pendingModeSwitchRef.current = null
        return
      }

      const nextEditorTop = switchFrom === 'preview'
        ? pickFirstFiniteScrollTop(stored.preview, stored.splitPreview, stored.splitEditor, stored.edit)
        : pickFirstFiniteScrollTop(stored.splitEditor, stored.edit, stored.preview, stored.splitPreview)
      const nextPreviewTop = switchFrom === 'edit'
        ? pickFirstFiniteScrollTop(stored.edit, stored.splitEditor, stored.splitPreview, stored.preview)
        : pickFirstFiniteScrollTop(stored.splitPreview, stored.preview, stored.splitEditor, stored.edit)
      restoreEditorScrollTop(nextEditorTop)
      applyPreviewScrollTop(nextPreviewTop)
      splitSyncReadyRef.current = true
      pendingModeSwitchRef.current = null
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [
    activeRelativePath,
    restoreEditorScrollTop,
    applyPreviewScrollTop,
    effectiveMarkdownPreviewMode,
    isMarkdownFile,
  ])

  const handleEditorScrollStateChange = useCallback((state: MonacoEditorScrollState) => {
    editorScrollStateRef.current = state
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

  const openContentSearchMatch = useCallback(async (relativePath: string, lineNumber: number, column: number) => {
    const opened = await openFile(relativePath)
    if (!opened) return
    setActiveContentSearchLocation({ relativePath, lineNumber, column })
    pendingRevealRef.current = { relativePath, lineNumber, column }
    window.setTimeout(() => {
      if (!pendingRevealRef.current) return
      const pending = pendingRevealRef.current
      if (pending.relativePath !== relativePath || pending.lineNumber !== lineNumber || pending.column !== column) return
      editorRef.current?.revealPosition(lineNumber, column)
    }, 0)
  }, [openFile])
  const handleOpenContentSearchResult = useCallback((relativePath: string, lineNumber: number, column: number) => {
    void openContentSearchMatch(relativePath, lineNumber, column)
    if (isNarrowViewport) {
      setIsExplorerOpen(false)
    }
  }, [isNarrowViewport, openContentSearchMatch])

  const handleToggleContentSearchTree = useCallback(() => {
    const tree = contentSearchTreeRef.current
    if (!tree) return

    if (isContentSearchAllExpanded) {
      tree.collapseAll()
      setIsContentSearchAllExpanded(false)
      return
    }

    tree.expandAll()
    setIsContentSearchAllExpanded(true)
  }, [isContentSearchAllExpanded])

  const handleSelectOpenTab = useCallback((relativePath: string) => {
    void openFile(relativePath)
  }, [openFile])

  const handleCloseOpenTab = useCallback((relativePath: string) => {
    const normalizedPath = relativePath.trim()
    if (!normalizedPath) return

    const nextTabs = openTabPaths.filter((item) => item !== normalizedPath)
    setOpenTabPaths(nextTabs)
    setCursorPositionsByPath((prev) => {
      if (!(normalizedPath in prev)) return prev
      const next = { ...prev }
      delete next[normalizedPath]
      return next
    })

    if (activeRelativePath !== normalizedPath) return
    const nextActivePath = nextTabs[0]
    if (nextActivePath) {
      void openFile(nextActivePath)
    }
  }, [activeRelativePath, openFile, openTabPaths])

  useEffect(() => {
    const pending = pendingRevealRef.current
    if (!pending) return
    if (pending.relativePath !== activeRelativePath) return
    editorRef.current?.revealPosition(pending.lineNumber, pending.column)
    pendingRevealRef.current = null
  }, [activeRelativePath, editorValue])

  useEffect(() => {
    const pending = pendingCursorRevealRef.current
    if (!pending) return
    if (pending.relativePath !== activeRelativePath) return
    editorRef.current?.revealPosition(pending.lineNumber, pending.column)
    pendingCursorRevealRef.current = null
  }, [activeRelativePath, editorValue])

  const visibleOpenTabs = useMemo(() => (
    openTabPaths.filter((path) => allProjectFilePathSet.has(path)).slice(0, MAX_PROJECT_CODE_SESSION_TABS)
  ), [allProjectFilePathSet, openTabPaths])

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
          {viewMode === 'files' && activeRelativePath && (
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
          {activeRelativePath && (
            <>
              <button
                type="button"
                className="inline-flex items-center rounded-full border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-45"
                onClick={() => openEditorSearchByMode('find')}
                title={isShowingEditor ? 'Find in current file (Ctrl/Cmd+F)' : 'Switch to editor mode first'}
                disabled={!isShowingEditor}
              >
                Find
              </button>
              <button
                type="button"
                className="inline-flex items-center rounded-full border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-45"
                onClick={() => openEditorSearchByMode('replace')}
                title={isShowingEditor ? 'Replace in current file (Ctrl/Cmd+H)' : 'Switch to editor mode first'}
                disabled={!isShowingEditor}
              >
                Replace
              </button>
            </>
          )}
          <button
            type="button"
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
          <div className="code-view-mode-switch" role="tablist" aria-label="Code workspace mode">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'files'}
              className={`code-view-mode-btn ${viewMode === 'files' ? 'is-active' : ''}`}
              onClick={() => setViewMode('files')}
              title="File explorer and editor"
            >
              <Files className="h-3.5 w-3.5" />
              Files
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'search'}
              className={`code-view-mode-btn ${viewMode === 'search' ? 'is-active' : ''}`}
              onClick={() => setViewMode('search')}
              title="Global content search"
            >
              <TextSearch className="h-3.5 w-3.5" />
              Search
            </button>
          </div>
          {isNarrowViewport && (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 py-1.5 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
              onClick={() => setIsExplorerOpen((prev) => !prev)}
              title={isExplorerOpen ? 'Switch to editor' : (viewMode === 'search' ? 'Open search panel' : 'Open file explorer')}
            >
              <Code2 className="h-3.5 w-3.5" />
              {isExplorerOpen ? 'Editor' : (viewMode === 'search' ? 'Search' : 'Explorer')}
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

      {visibleOpenTabs.length > 0 && (
        <div className="code-open-tabs mb-3">
          {visibleOpenTabs.map((path) => {
            const isActive = activeRelativePath === path
            return (
              <button
                key={path}
                type="button"
                className={`code-open-tab ${isActive ? 'is-active' : ''}`}
                onClick={() => {
                  handleSelectOpenTab(path)
                }}
                title={path}
              >
                <span className="code-open-tab-label">{fileNameFromRelativePath(path)}</span>
                <span className="code-open-tab-path">{path}</span>
                <span
                  role="button"
                  tabIndex={0}
                  className="code-open-tab-close"
                  aria-label={`Close ${path}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    handleCloseOpenTab(path)
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    event.stopPropagation()
                    handleCloseOpenTab(path)
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </span>
              </button>
            )
          })}
        </div>
      )}

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

      <ModalShell
        open={Boolean(discardUnsavedConfirm)}
        onClose={() => resolveDiscardUnsavedConfirm(false)}
        widthClassName="max-w-[440px]"
        baseZIndex={1100}
        ariaLabel="Unsaved changes confirmation"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="section-label mb-1">Unsaved Changes</p>
            <p className="text-sm font-semibold text-[color:var(--color-foreground)]">
              当前文件有未保存修改
            </p>
          </div>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
            onClick={() => resolveDiscardUnsavedConfirm(false)}
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)]/70 px-3 py-2 text-[12px] text-[color:var(--color-foreground)]">
          {discardUnsavedConfirm?.forceReload
            ? '重新加载后将丢弃当前未保存内容，是否继续？'
            : `切换到 ${discardUnsavedConfirm?.nextRelativePath ?? '目标文件'} 后将丢弃当前未保存内容，是否继续？`}
        </p>
        <p className="mt-2 text-[10.5px] text-[color:var(--color-muted-foreground)]">
          你也可以先保存当前文件，再执行切换或重载。
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            className="quiet-control inline-flex h-9 items-center justify-center rounded-full border-0 px-4 text-xs text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
            onClick={() => resolveDiscardUnsavedConfirm(false)}
          >
            取消
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-xs font-medium text-white transition-colors hover:bg-primary-hover"
            onClick={() => resolveDiscardUnsavedConfirm(true)}
          >
            丢弃并继续
          </button>
        </div>
      </ModalShell>

      <CodeFileQuickDrawer
        open={isQuickDrawerOpen}
        activeRelativePath={activeRelativePath}
        favorites={quickDrawerFavorites}
        recents={quickDrawerRecents}
        onClose={() => setIsQuickDrawerOpen(false)}
        onOpenFile={openFileFromQuickDrawer}
        onToggleFavorite={toggleFavoriteForPath}
        onRemovePath={removePathFromQuickDrawer}
      />

      <div className="min-h-0 flex-1">
        <div className="code-layout-grid h-full" style={isNarrowViewport ? { gridTemplateColumns: 'minmax(0, 1fr)' } : undefined}>
          {showExplorerPanelForMode && (
            <aside className="code-tree-panel surface-card">
              {viewMode === 'files' ? (
                <>
                  <div className="code-panel-header">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <DebouncedSearchInput
                        inputRef={fileSearchInputRef}
                        leadingIcon={<Search className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />}
                        placeholder="Search files (e.g. abvd)"
                        inputClassName="code-search-input"
                        debounceMs={FILE_SEARCH_DEBOUNCE_MS}
                        onQueryChange={handleFileSearchQueryChange}
                      />
                    </div>
                    <button
                      type="button"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)] disabled:opacity-45"
                      onClick={() => {
                        if (!activeRelativePath) return
                        setLocateRequestToken((prev) => prev + 1)
                      }}
                      title={activeRelativePath ? 'Locate current file' : 'No active file'}
                      disabled={!activeRelativePath}
                    >
                      <LocateFixed className="h-3.5 w-3.5" />
                    </button>
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
                  ) : hasSearchQuery && isSearchingFiles ? (
                    <div className="code-panel-empty text-xs text-[color:var(--color-muted-foreground)]">Searching files...</div>
                  ) : hasSearchQuery && fileSearchError ? (
                    <div className="code-panel-empty text-xs text-[color:var(--color-destructive)]">{fileSearchError}</div>
                  ) : hasSearchQuery && treeNodesForView.length === 0 ? (
                    <div className="code-panel-empty text-xs text-[color:var(--color-muted-foreground)]">No matching files.</div>
                  ) : (
                    <CodeFileTree
                      nodes={treeNodesForView}
                      activeRelativePath={activeRelativePath}
                      expandedDirectories={expandedDirectories}
                      flatFileListMode={hasSearchQuery}
                      locateRequestToken={locateRequestToken}
                      onToggleDirectory={handleToggleTreeDirectory}
                      onSelectFile={handleSelectTreeFile}
                      onOpenNodeFolder={handleOpenTreeNodeFolder}
                      onCopyNodeName={handleCopyTreeNodeName}
                    />
                  )}
                </>
              ) : (
                <>
                  <div className="code-panel-header code-search-main-header">
                    <div className="code-search-main-query">
                      <DebouncedSearchInput
                        inputRef={contentSearchInputRef}
                        leadingIcon={<FileSearch className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />}
                        placeholder="Search text across files (rg)"
                        inputClassName="code-search-input"
                        debounceMs={FILE_SEARCH_DEBOUNCE_MS}
                        onQueryChange={handleContentSearchQueryChange}
                        syncValue={contentSearchQuery}
                        syncNonce={contentSearchQuerySyncNonce}
                        trailingAction={(
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              className={`code-search-meta-action ${contentSearchCaseSensitive ? 'is-active' : ''}`}
                              onClick={() => setContentSearchCaseSensitive((prev) => !prev)}
                              title={contentSearchCaseSensitive ? 'Case sensitive search: on' : 'Case sensitive search: off'}
                              aria-pressed={contentSearchCaseSensitive}
                            >
                              Aa
                            </button>
                            <button
                              type="button"
                              className="code-search-meta-action code-search-toggle-action"
                              onClick={handleToggleContentSearchTree}
                              disabled={!canToggleContentSearchTree}
                              aria-disabled={!canToggleContentSearchTree}
                            >
                              {contentSearchToggleLabel}
                            </button>
                          </div>
                        )}
                      />
                    </div>
                    <div className="code-search-scope-row">
                      <div className="code-search-scope-input-wrap">
                        <input
                          type="text"
                          value={contentSearchScopeInput}
                          onChange={(event) => setContentSearchScopeInput(event.target.value)}
                          placeholder="Scope globs: src/**/*.ts, *.md, docs/**"
                          className="code-search-input code-search-scope-input"
                          spellCheck={false}
                          title={contentSearchScopeSummary}
                        />
                      </div>
                      {contentSearchHistory.length > 0 && (
                        <div className="code-search-history-inline">
                          <select
                            className="code-search-history-select"
                            value=""
                            onChange={(event) => {
                              const nextValue = event.target.value
                              if (!nextValue) return
                              applyContentSearchQueryFromHistory(nextValue)
                              event.currentTarget.value = ''
                            }}
                            title="Recent search queries"
                          >
                            <option value="">History</option>
                            {contentSearchHistory.map((query) => (
                              <option key={query} value={query}>{query}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                    {contentSearchHistory.length > 0 && (
                      <div className="code-search-history-chip-row">
                        {contentSearchHistory.slice(0, 6).map((query) => (
                          <div key={query} className="code-search-history-chip">
                            <button
                              type="button"
                              className="code-search-history-chip-main"
                              onClick={() => applyContentSearchQueryFromHistory(query)}
                              title={query}
                            >
                              {query}
                            </button>
                            <button
                              type="button"
                              className="code-search-history-chip-remove"
                              onClick={() => removeContentSearchHistoryItem(query)}
                              title="Remove from history"
                              aria-label={`Remove ${query} from history`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {showContentSearchSummary && (
                      <div className="code-search-main-toolbar">
                        <div className="code-search-main-meta">
                          <span className="code-search-main-meta-text">
                            <span className="code-search-main-stat">{contentSearchResult.files.length} files</span>
                            <span className="code-search-main-meta-sep">•</span>
                            <span className="code-search-main-stat">{contentSearchResult.totalMatches} matches</span>
                            <span className="code-search-main-meta-sep">•</span>
                            <span className="code-search-main-stat">
                              {hasContentSearchScope ? `${contentSearchScopeGlobs.length} globs` : 'all files'}
                            </span>
                            {contentSearchResult.limited && (
                              <span className="code-search-main-limited">limited</span>
                            )}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {contentSearchQuery.trim().length === 0 ? (
                    <div className="code-panel-empty">
                      <div className="text-sm text-[color:var(--color-muted-foreground)]">
                        Enter keywords to run global content search.
                      </div>
                    </div>
                  ) : isSearchingContent ? (
                    <div className="code-panel-empty text-xs text-[color:var(--color-muted-foreground)]">Searching content...</div>
                  ) : contentSearchError ? (
                    <div className="code-panel-empty text-xs text-[color:var(--color-destructive)]">{contentSearchError}</div>
                  ) : contentSearchResult.files.length === 0 ? (
                    <div className="code-panel-empty text-xs text-[color:var(--color-muted-foreground)]">No matching text found.</div>
                  ) : (
                    <CodeContentSearchTree
                      ref={contentSearchTreeRef}
                      files={contentSearchResult.files}
                      activeLocation={activeContentSearchLocation}
                      autoCollapseMatchThreshold={CONTENT_SEARCH_AUTO_COLLAPSE_MATCH_THRESHOLD}
                      onOpenMatch={handleOpenContentSearchResult}
                    />
                  )}
                </>
              )}
            </aside>
          )}

          {showEditorPanelForMode && (
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
                          onCursorPositionChange={(position) => {
                            if (!activeRelativePath) return
                            setCursorPositionsByPath((prev) => {
                              const current = prev[activeRelativePath]
                              if (current && current.lineNumber === position.lineNumber && current.column === position.column) {
                                return prev
                              }

                              const nextEntries = [
                                [activeRelativePath, position],
                                ...Object.entries(prev).filter(([pathKey]) => pathKey !== activeRelativePath),
                              ].slice(0, MAX_PROJECT_CODE_SESSION_CURSOR_POSITIONS)

                              return Object.fromEntries(nextEntries)
                            })
                          }}
                          onFocusSearch={focusSearchInputByMode}
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
                        {previewSearchVisible && effectiveMarkdownPreviewMode === 'preview' && (
                          <div className="code-editor-findbar code-editor-findbar--preview">
                            <div className="code-editor-findbar-row">
                              <input
                                ref={previewSearchInputRef}
                                type="text"
                                value={previewSearchQuery}
                                onChange={(event) => {
                                  setPreviewSearchQuery(event.target.value)
                                  setActivePreviewSearchMatchIndex(0)
                                }}
                                placeholder="Find in preview"
                                className="code-editor-findbar-input"
                                spellCheck={false}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' && event.shiftKey) {
                                    event.preventDefault()
                                    goToPreviousPreviewSearchMatch()
                                    return
                                  }
                                  if (event.key === 'Enter') {
                                    event.preventDefault()
                                    goToNextPreviewSearchMatch()
                                    return
                                  }
                                  if (event.key === 'Escape') {
                                    event.preventDefault()
                                    closePreviewSearch()
                                  }
                                }}
                              />
                              <span className="code-editor-findbar-count">
                                {previewSearchMatches.length > 0
                                  ? `${activePreviewSearchMatchIndex + 1}/${previewSearchMatches.length}`
                                  : 'No results'}
                              </span>
                              <button
                                type="button"
                                className="code-editor-findbar-icon-btn"
                                onClick={goToPreviousPreviewSearchMatch}
                                title="Previous Match"
                                disabled={previewSearchMatches.length <= 0}
                              >
                                <ChevronUp className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                className="code-editor-findbar-icon-btn"
                                onClick={goToNextPreviewSearchMatch}
                                title="Next Match"
                                disabled={previewSearchMatches.length <= 0}
                              >
                                <ChevronDown className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                className="code-editor-findbar-icon-btn"
                                onClick={closePreviewSearch}
                                title="Close"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        )}
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
                    {isNarrowViewport
                      ? (viewMode === 'search' ? 'Open Search to choose a match.' : 'Open Explorer to choose a file.')
                      : (viewMode === 'search'
                        ? 'Select a search result from the left panel to open and edit.'
                        : 'Select a file from the left panel to start editing.')}
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
