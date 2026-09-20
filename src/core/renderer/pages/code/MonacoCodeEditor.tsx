import type { editor as MonacoEditor, Selection } from 'monaco-editor'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { TranscriptFileReference } from '../../../shared/types'
import { installMonacoFindWidgetHoverGuard, getMonacoOverflowWidgetsContainer, syncMonacoOverflowWidgetsTheme, type MonacoThemeName } from '../../lib/monacoEnvironment'
import { MONO_FONT_STACK } from '../../lib/fonts'
import { monacoLineHeightForFontSize, readMonacoEditorFontSizePreference, writeMonacoEditorFontSizePreference } from '../../lib/monacoFontPreference'
import { loadMonacoEditorModule } from '../../lib/monacoPreload'
import { MonacoCodeEditorFindBar } from './MonacoCodeEditorFindBar'
import { MonacoEditorContextMenu } from './MonacoEditorContextMenu'
import { TranscriptReferenceHoverCard } from './TranscriptReferenceHoverCard'
import { extractRelativeImportRanges, resolveImportCandidatePaths, resolveFilePathFromModelUri, resolveImportTarget } from './code.importLink'
import { acquireMonacoModelCacheKey, getOrCreateMonacoModel, releaseMonacoModelCacheKey, toMonacoModelCacheKey } from './monacoModelCache'
import { ensureTextmateForLanguage, syncTextmateTheme } from './textmate.monaco'
import { useMonacoSearchWidget } from './useMonacoSearchWidget'
import { useMonacoTranscriptGutter } from './useMonacoTranscriptGutter'

export interface MonacoEditorScrollState {
  firstVisibleLine: number
  scrollTop: number
  scrollHeight: number
  viewportHeight: number
}

export interface MonacoCodeEditorHandle {
  getScrollState: () => MonacoEditorScrollState | null
  getPosition: () => { lineNumber: number; column: number } | null
  setScrollTop: (scrollTop: number) => void
  setScrollTopForLine: (lineNumber: number) => void
  revealPosition: (lineNumber: number, column?: number) => void
  highlightLine: (lineNumber: number, endLine?: number) => void
  openSearch: (mode?: 'find' | 'replace') => void
}

interface PendingRevealPosition {
  lineNumber: number
  column: number
  modelKey: string
}

interface PendingHighlightLine {
  lineNumber: number
  endLine?: number
  modelKey: string
}

interface MonacoCodeEditorProps {
  value: string
  language: string
  theme: MonacoThemeName
  filePath: string | null
  projectPath?: string | null
  isReadOnly?: boolean
  onChange: (value: string) => void
  onOpenFile?: (relativePath: string) => void
  onPasteImage?: (file: File | null, clipboardEvent?: ClipboardEvent) => Promise<string | null>
  onSave: () => void
  onFocusSearch?: () => void
  onScrollStateChange?: (state: MonacoEditorScrollState) => void
  onCursorPositionChange?: (position: { lineNumber: number; column: number }) => void
  /** Ctrl + 右键时上抛坐标，由外层打开项目级通用右键卡片；不传时 Ctrl + 右键仍打开编辑器菜单。 */
  onRequestProjectContextMenu?: (x: number, y: number) => void
  /** 转录文件引用：在行号右侧渲染 gutter 标记，点击打开转录内容抽屉。 */
  transcriptReferences?: TranscriptFileReference[]
  onOpenTranscriptReference?: (item: TranscriptFileReference) => void
}

const EMPTY_TRANSCRIPT_FILE_REFERENCES: TranscriptFileReference[] = []

const REVEAL_HIGHLIGHT_DURATION_MS = 2200

// Languages with built-in Monaco formatters (json/css/html/ts 及变体)。
const FORMATTABLE_LANGUAGES = new Set(['json', 'jsonc', 'json5', 'css', 'scss', 'less', 'html', 'handlebars', 'razor', 'typescript', 'javascript'])

const CODE_OPEN_SCHEME = 'codeopen'

let importLinkSupportInstalled = false
let activeImportLinkProjectPath: string | null = null
let activeImportLinkOpenHandler: ((relativePath: string) => void) | null = null

function parseCodeOpenQuery(query: string): { from: string; importPath: string } | null {
  const params = new URLSearchParams(query)
  const from = params.get('from')
  const importPath = params.get('import')
  if (!from || !importPath) return null
  return { from, importPath }
}

function ensureImportLinkSupport(monaco: typeof import('monaco-editor')): void {
  if (importLinkSupportInstalled) return
  importLinkSupportInstalled = true

  monaco.languages.registerLinkProvider('*', {
    provideLinks(model) {
      const projectPath = activeImportLinkProjectPath
      if (!projectPath) return { links: [] }
      const currentFilePath = resolveFilePathFromModelUri(model.uri, activeImportLinkProjectPath)
      if (!currentFilePath) return { links: [] }

      const links: import('monaco-editor').languages.ILink[] = []
      const lineCount = model.getLineCount()
      for (let lineNumber = 1; lineNumber <= lineCount; lineNumber += 1) {
        const lineText = model.getLineContent(lineNumber)
        for (const match of extractRelativeImportRanges(lineText)) {
          const target = resolveImportTarget(currentFilePath, match.importPath)
          links.push({
            range: {
              startLineNumber: lineNumber,
              startColumn: match.startColumn,
              endLineNumber: lineNumber,
              endColumn: match.endColumn,
            },
            url: `${CODE_OPEN_SCHEME}://open?from=${encodeURIComponent(currentFilePath)}&import=${encodeURIComponent(match.importPath)}`,
            tooltip: target,
          })
        }
      }
      return { links }
    },
  })

  monaco.editor.registerLinkOpener({
    open: async (resource) => {
      if (resource.scheme !== CODE_OPEN_SCHEME) return false
      const handler = activeImportLinkOpenHandler
      const projectPath = activeImportLinkProjectPath
      if (!handler || !projectPath) return false

      const query = parseCodeOpenQuery(resource.query)
      if (!query) return false

      const candidates = resolveImportCandidatePaths(query.from, query.importPath)
      for (const candidate of candidates) {
        try {
          await window.electronAPI.statProjectFile(projectPath, candidate)
          handler(candidate)
          return true
        } catch {
          // 尝试下一个候选后缀
        }
      }
      return false
    },
  })
}

interface EditorContextMenuSnapshot {
  x: number
  y: number
  selection: Selection | null
  isReadOnly: boolean
  canComment: boolean
  canFormat: boolean
  currentLineNumber: number
}

export const MonacoCodeEditor = forwardRef<MonacoCodeEditorHandle, MonacoCodeEditorProps>(function MonacoCodeEditor(
  { value, language, theme, filePath, projectPath, isReadOnly = false, onChange, onOpenFile, onPasteImage, onSave, onFocusSearch, onScrollStateChange, onCursorPositionChange, onRequestProjectContextMenu, transcriptReferences, onOpenTranscriptReference },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const modelRef = useRef<MonacoEditor.ITextModel | null>(null)
  // 模块级缓存持有的 Model 引用计数 key；卸载时只释放计数，Model 保留以维持撤销栈。
  const acquiredModelKeysRef = useRef<Set<string>>(new Set())
  // 无文件路径的临时 Model 不入模块缓存，由本实例持有并在卸载时 dispose。
  const localModelsRef = useRef<MonacoEditor.ITextModel[]>([])
  const filePathRef = useRef(filePath)
  const projectPathRef = useRef(projectPath)
  const activeModelKeyRef = useRef(toMonacoModelCacheKey(projectPath, filePath))
  const pendingRevealRef = useRef<PendingRevealPosition | null>(null)
  const pendingHighlightLineRef = useRef<PendingHighlightLine | null>(null)
  const revealHighlightDecorationsRef = useRef<string[]>([])
  const revealHighlightClearTimerRef = useRef<number | null>(null)
  const syncGuardRef = useRef(false)
  const onSaveRef = useRef(onSave)
  const onPasteImageRef = useRef(onPasteImage)
  const onRequestProjectContextMenuRef = useRef(onRequestProjectContextMenu)
  const onFocusSearchRef = useRef(onFocusSearch)
  const onScrollStateChangeRef = useRef(onScrollStateChange)
  const onCursorPositionChangeRef = useRef(onCursorPositionChange)
  const onOpenTranscriptReferenceRef = useRef(onOpenTranscriptReference)
  filePathRef.current = filePath
  projectPathRef.current = projectPath

  const acquireModelCacheKey = (key: string) => {
    if (acquiredModelKeysRef.current.has(key)) return
    acquiredModelKeysRef.current.add(key)
    acquireMonacoModelCacheKey(key)
  }

  const releaseModelCacheKey = (key: string) => {
    if (!acquiredModelKeysRef.current.delete(key)) return
    releaseMonacoModelCacheKey(key)
  }
  const {
    activeSearchMatchIndex,
    closeSearchPanel,
    goToNextMatch,
    goToPreviousMatch,
    handleEditorCursorSelectionChange,
    openSearchPanel,
    replaceAllMatches,
    replaceCurrentMatch,
    replaceQuery,
    searchCaseSensitive,
    searchInputRef,
    searchMatchCount,
    searchMode,
    searchQuery,
    searchRegex,
    searchVisible,
    searchWholeWord,
    setReplaceQuery,
    setSearchCaseSensitive,
    setSearchMode,
    setSearchQuery,
    setSearchRegex,
    setSearchWholeWord,
  } = useMonacoSearchWidget({ editorRef })

  const transcriptGutter = useMonacoTranscriptGutter({
    editorRef,
    monacoRef,
    references: transcriptReferences ?? EMPTY_TRANSCRIPT_FILE_REFERENCES,
    onOpenReference: (item) => onOpenTranscriptReferenceRef.current?.(item),
  })

  const [activeTheme, setActiveTheme] = useState<MonacoThemeName>(theme)
  const activeThemeRef = useRef(activeTheme)
  // 字号偏好存 localStorage（见 monacoFontPreference.ts），跨会话生效于所有代码编辑器。
  const [fontSize, setFontSize] = useState(() => readMonacoEditorFontSizePreference())
  const fontSizeRef = useRef(fontSize)
  fontSizeRef.current = fontSize
  const [editorContextMenu, setEditorContextMenu] = useState<EditorContextMenuSnapshot | null>(null)

  const handleFontSizeChange = (nextFontSize: number) => {
    setFontSize(nextFontSize)
  }

  const runEditorContextMenuAction = (actionId: string) => {
    const editor = editorRef.current
    editor?.trigger('editor-context-menu', actionId, null)
    editor?.focus()
    setEditorContextMenu(null)
  }

  const handleThemeChange = (nextTheme: MonacoThemeName) => {
    setActiveTheme(nextTheme)
  }

  // 右键菜单"跳转到行"：revealPositionInEditor 内部会把行号钳制到 [1, 最后一行]。
  const runGoToLine = (lineNumber: number) => {
    const editor = editorRef.current
    if (!editor) return
    revealPositionInEditor(editor, lineNumber, 1)
    highlightLineInEditor(editor, lineNumber)
  }

  useEffect(() => {
    activeImportLinkProjectPath = projectPath ?? null
    activeImportLinkOpenHandler = onOpenFile ?? null
    return () => {
      activeImportLinkProjectPath = null
      activeImportLinkOpenHandler = null
    }
  }, [projectPath, onOpenFile])

  const revealPositionInEditor = (editor: MonacoEditor.IStandaloneCodeEditor, lineNumber: number, column = 1) => {
    const model = editor.getModel()
    if (!model) return false

    const safeLine = Math.min(Math.max(1, Math.floor(lineNumber)), model.getLineCount())
    const safeColumn = Math.min(Math.max(1, Math.floor(column)), model.getLineMaxColumn(safeLine))
    editor.setPosition({ lineNumber: safeLine, column: safeColumn })
    editor.revealPositionInCenter({ lineNumber: safeLine, column: safeColumn })
    editor.focus()
    return true
  }

  const clearRevealHighlight = () => {
    if (revealHighlightClearTimerRef.current != null) {
      window.clearTimeout(revealHighlightClearTimerRef.current)
      revealHighlightClearTimerRef.current = null
    }

    const editor = editorRef.current
    if (!editor || revealHighlightDecorationsRef.current.length <= 0) {
      revealHighlightDecorationsRef.current = []
      return
    }

    revealHighlightDecorationsRef.current = editor.deltaDecorations(revealHighlightDecorationsRef.current, [])
  }

  const highlightLineInEditor = (editor: MonacoEditor.IStandaloneCodeEditor, lineNumber: number, endLine?: number) => {
    const monaco = monacoRef.current
    const model = editor.getModel()
    if (!monaco || !model) return false

    const safeLine = Math.min(Math.max(1, Math.floor(lineNumber)), model.getLineCount())
    const rawEndLine = endLine != null ? Math.floor(endLine) : safeLine
    const safeEndLine = Math.min(Math.max(safeLine, rawEndLine), model.getLineCount())
    revealHighlightDecorationsRef.current = editor.deltaDecorations(revealHighlightDecorationsRef.current, [
      {
        range: new monaco.Range(safeLine, 1, safeEndLine, model.getLineMaxColumn(safeEndLine)),
        options: {
          isWholeLine: true,
          className: 'monaco-code-editor-reveal-line',
          linesDecorationsClassName: 'monaco-code-editor-reveal-line-gutter',
          lineNumberClassName: 'monaco-code-editor-reveal-line-number',
        },
      },
    ])

    if (revealHighlightClearTimerRef.current != null) {
      window.clearTimeout(revealHighlightClearTimerRef.current)
    }
    revealHighlightClearTimerRef.current = window.setTimeout(() => {
      clearRevealHighlight()
    }, REVEAL_HIGHLIGHT_DURATION_MS)

    return true
  }

  const flushPendingReveal = () => {
    const editor = editorRef.current
    if (!editor) return

    const pendingReveal = pendingRevealRef.current
    if (pendingReveal && activeModelKeyRef.current === pendingReveal.modelKey) {
      if (revealPositionInEditor(editor, pendingReveal.lineNumber, pendingReveal.column)) {
        pendingRevealRef.current = null
      }
    }

    const pendingHighlight = pendingHighlightLineRef.current
    if (pendingHighlight && activeModelKeyRef.current === pendingHighlight.modelKey) {
      if (highlightLineInEditor(editor, pendingHighlight.lineNumber, pendingHighlight.endLine)) {
        pendingHighlightLineRef.current = null
      }
    }
  }

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  useEffect(() => {
    onPasteImageRef.current = onPasteImage
  }, [onPasteImage])

  useEffect(() => {
    onRequestProjectContextMenuRef.current = onRequestProjectContextMenu
  }, [onRequestProjectContextMenu])

  useEffect(() => {
    onFocusSearchRef.current = onFocusSearch
  }, [onFocusSearch])

  useEffect(() => {
    onScrollStateChangeRef.current = onScrollStateChange
  }, [onScrollStateChange])

  useEffect(() => {
    onCursorPositionChangeRef.current = onCursorPositionChange
  }, [onCursorPositionChange])

  useEffect(() => {
    onOpenTranscriptReferenceRef.current = onOpenTranscriptReference
  }, [onOpenTranscriptReference])

  useImperativeHandle(
    ref,
    () => ({
      getScrollState: () => {
        const editor = editorRef.current
        if (!editor) return null
        const layout = editor.getLayoutInfo()
        return {
          firstVisibleLine: editor.getVisibleRanges()[0]?.startLineNumber ?? 1,
          scrollTop: editor.getScrollTop(),
          scrollHeight: editor.getScrollHeight(),
          viewportHeight: Math.max(1, layout.height - layout.horizontalScrollbarHeight),
        }
      },
      getPosition: () => {
        const position = editorRef.current?.getPosition()
        return position ? { lineNumber: position.lineNumber, column: position.column } : null
      },
      setScrollTop: (scrollTop: number) => {
        const editor = editorRef.current
        if (!editor) return
        editor.setScrollTop(Math.max(0, scrollTop))
      },
      setScrollTopForLine: (lineNumber: number) => {
        const editor = editorRef.current
        const model = editor?.getModel()
        if (!editor || !model) return
        const safeLine = Math.min(Math.max(1, Math.floor(lineNumber)), model.getLineCount())
        editor.setScrollTop(Math.max(0, editor.getTopForLineNumber(safeLine)))
      },
      revealPosition: (lineNumber: number, column = 1) => {
        pendingRevealRef.current = {
          lineNumber,
          column,
          modelKey: toMonacoModelCacheKey(projectPathRef.current, filePathRef.current),
        }
        flushPendingReveal()
      },
      highlightLine: (lineNumber: number, endLine?: number) => {
        pendingHighlightLineRef.current = {
          lineNumber,
          endLine,
          modelKey: toMonacoModelCacheKey(projectPathRef.current, filePathRef.current),
        }
        flushPendingReveal()
      },
      openSearch: (mode = 'find') => {
        openSearchPanel(mode)
      },
    }),
    [],
  )

  useEffect(() => {
    let disposed = false

    const setup = async () => {
      const container = containerRef.current
      if (!container) return
      const removeFindWidgetHoverGuard = installMonacoFindWidgetHoverGuard(container)

      const monaco = await loadMonacoEditorModule()
      if (disposed) return

      monacoRef.current = monaco
      ensureImportLinkSupport(monaco)
      await syncTextmateTheme(monaco, activeThemeRef.current)
      await ensureTextmateForLanguage(monaco, language)
      if (disposed) return

      const initialKey = toMonacoModelCacheKey(projectPath, filePath)
      const createdLease = getOrCreateMonacoModel(monaco, projectPath, filePath, value, language)
      const model = createdLease.model
      modelRef.current = model
      if (createdLease.cached) {
        acquireModelCacheKey(initialKey)
      } else {
        localModelsRef.current.push(model)
      }

      const editor = monaco.editor.create(container, {
        model,
        automaticLayout: true,
        fixedOverflowWidgets: true,
        overflowWidgetsDomNode: getMonacoOverflowWidgetsContainer(),
        minimap: { enabled: false },
        fontFamily: MONO_FONT_STACK,
        fontSize: fontSizeRef.current,
        lineHeight: monacoLineHeightForFontSize(fontSizeRef.current),
        tabSize: 2,
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        disableMonospaceOptimizations: true,
        allowVariableFonts: false,
        fontLigatures: false,
        fontWeight: '400',
        renderWhitespace: 'selection',
        bracketPairColorization: { enabled: true },
        cursorStyle: 'line',
        cursorWidth: 2,
        overtypeCursorStyle: 'line',
        overtypeOnPaste: false,
        matchBrackets: 'near',
        roundedSelection: false,
        contextmenu: false,
        padding: { top: 14, bottom: 14 },
        readOnly: isReadOnly,
        theme: activeThemeRef.current,
      })
      syncMonacoOverflowWidgetsTheme(activeThemeRef.current)
      editorRef.current = editor
      transcriptGutter.syncEditorInstance(editor)
      activeModelKeyRef.current = initialKey
      flushPendingReveal()

      const handleCaptureKeyDown = (event: KeyboardEvent) => {
        const hasPrimaryModifier = event.ctrlKey || event.metaKey
        if (!hasPrimaryModifier) return
        const key = event.key.toLowerCase()
        const isSearchShortcut = key === 'f' || event.code === 'KeyF'
        if (!isSearchShortcut) {
          const isReplaceShortcut = (key === 'h' || event.code === 'KeyH') && !event.shiftKey && !event.altKey
          if (!isReplaceShortcut) return
          event.preventDefault()
          event.stopPropagation()
          event.stopImmediatePropagation()
          openSearchPanel('replace')
          return
        }

        const isWorkspaceSearchShortcut = event.shiftKey || event.altKey
        if (isWorkspaceSearchShortcut) {
          event.preventDefault()
          event.stopPropagation()
          event.stopImmediatePropagation()
          onFocusSearchRef.current?.()
          return
        }

        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        openSearchPanel('find', { prefillFromSelection: true })
      }
      container.addEventListener('keydown', handleCaptureKeyDown, true)

      const handleCapturePaste = (event: ClipboardEvent) => {
        const pasteImage = onPasteImageRef.current
        const clipboardData = event.clipboardData
        const items = clipboardData?.items
        if (!pasteImage || !items || items.length <= 0) return
        if (editor.getOption(monaco.editor.EditorOption.readOnly)) return

        let imageFile: File | null = null
        for (const item of items) {
          if (!item.type.startsWith('image/')) continue
          imageFile = item.getAsFile()
          if (imageFile) break
        }

        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()

        const selection = editor.getSelection()
        const fallbackPosition = editor.getPosition()
        const insertRange = selection ?? (fallbackPosition ? new monaco.Range(fallbackPosition.lineNumber, fallbackPosition.column, fallbackPosition.lineNumber, fallbackPosition.column) : null)
        if (!insertRange) return

        void pasteImage(imageFile, event)
          .then((markdownText) => {
            if (!markdownText) return
            const text = `${markdownText}\n`
            const nextPosition = insertRange.getEndPosition()

            editor.pushUndoStop()
            editor.executeEdits('paste-image', [
              {
                range: insertRange,
                text,
                forceMoveMarkers: true,
              },
            ])
            editor.pushUndoStop()
            editor.setPosition({
              lineNumber: nextPosition.lineNumber + 1,
              column: 1,
            })
            const positionAfterInsert = editor.getPosition()
            if (positionAfterInsert) {
              editor.revealPositionInCenter(positionAfterInsert)
            }
          })
          .catch(() => {
            // Keep default silent behavior when image paste handling fails.
          })
      }
      container.addEventListener('paste', handleCapturePaste, true)

      editor.onDidChangeModelContent(() => {
        if (syncGuardRef.current) return
        onChange(editor.getValue())
      })

      editor.onDidScrollChange(() => {
        const cb = onScrollStateChangeRef.current
        if (!cb) return
        const layout = editor.getLayoutInfo()
        cb({
          firstVisibleLine: editor.getVisibleRanges()[0]?.startLineNumber ?? 1,
          scrollTop: editor.getScrollTop(),
          scrollHeight: editor.getScrollHeight(),
          viewportHeight: Math.max(1, layout.height - layout.horizontalScrollbarHeight),
        })
      })

      editor.onDidChangeCursorPosition((event) => {
        onCursorPositionChangeRef.current?.({
          lineNumber: event.position.lineNumber,
          column: event.position.column,
        })
      })

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        onSaveRef.current()
      })

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => {
        onFocusSearchRef.current?.()
      })

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => {
        onFocusSearchRef.current?.()
      })

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => {
        openSearchPanel('find', { prefillFromSelection: true })
      })

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH, () => {
        openSearchPanel('replace')
      })

      editor.onKeyDown((event) => {
        const isSearchShortcut = (event.ctrlKey || event.metaKey) && event.shiftKey && event.keyCode === monaco.KeyCode.KeyF
        if (!isSearchShortcut) return
        event.preventDefault()
        event.stopPropagation()
        onFocusSearchRef.current?.()
      })

      editor.onDidChangeCursorSelection(handleEditorCursorSelectionChange)

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD, () => {
        editor.trigger('keyboard', 'editor.action.copyLinesDownAction', null)
      })

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, () => {
        editor.trigger('keyboard', 'editor.action.deleteLines', null)
      })

      const handleEditorContextMenu = (e: MonacoEditor.IEditorMouseEvent) => {
        const targetType = e.target.type
        if (targetType === monaco.editor.MouseTargetType.OVERLAY_WIDGET || targetType === monaco.editor.MouseTargetType.CONTENT_WIDGET || targetType === monaco.editor.MouseTargetType.SCROLLBAR) {
          return
        }
        e.event.preventDefault()
        e.event.stopPropagation()

        // Ctrl + 右键：打开项目级通用右键卡片；普通右键继续使用编辑器封装菜单。
        const browserEvent = e.event.browserEvent
        if (browserEvent.ctrlKey && onRequestProjectContextMenuRef.current) {
          setEditorContextMenu(null)
          onRequestProjectContextMenuRef.current(browserEvent.clientX, browserEvent.clientY)
          return
        }

        const model = editor.getModel()
        if (!model) return

        // 复刻 VS Code 右键行为：点击位置不在当前选区内时移动光标过去。
        const position = e.target.position
        if (position) {
          const selections = editor.getSelections()
          const inSelection = selections ? selections.some((selection) => selection.containsPosition(position)) : false
          if (!inSelection) editor.setPosition(position)
        }
        editor.focus()

        const languageId = model.getLanguageId()
        const languageConfiguration = (monaco.languages as unknown as { getLanguageConfiguration?: (languageId: string) => { comments?: unknown } | undefined }).getLanguageConfiguration?.(languageId)
        setEditorContextMenu({
          x: e.event.browserEvent.clientX,
          y: e.event.browserEvent.clientY,
          selection: editor.getSelection(),
          isReadOnly: editor.getOption(monaco.editor.EditorOption.readOnly),
          canComment: Boolean(languageConfiguration?.comments),
          canFormat: FORMATTABLE_LANGUAGES.has(languageId),
          currentLineNumber: editor.getPosition()?.lineNumber ?? 1,
        })
      }
      const contextMenuDisposable = editor.onContextMenu(handleEditorContextMenu)

      const refreshFontMetrics = () => {
        monaco.editor.remeasureFonts()
        editor.layout()
        editor.render(true)
      }

      void (async () => {
        if (typeof document === 'undefined' || !document.fonts) return
        await document.fonts.ready
        if (disposed) return
        refreshFontMetrics()
      })()

      let removeFontListener: (() => void) | undefined
      if (typeof document !== 'undefined' && document.fonts && typeof document.fonts.addEventListener === 'function') {
        const onFontsLoaded = () => {
          if (disposed) return
          refreshFontMetrics()
        }
        document.fonts.addEventListener('loadingdone', onFontsLoaded)
        removeFontListener = () => {
          document.fonts.removeEventListener('loadingdone', onFontsLoaded)
        }
      }

      const initialCb = onScrollStateChangeRef.current
      if (initialCb) {
        const layout = editor.getLayoutInfo()
        initialCb({
          firstVisibleLine: editor.getVisibleRanges()[0]?.startLineNumber ?? 1,
          scrollTop: editor.getScrollTop(),
          scrollHeight: editor.getScrollHeight(),
          viewportHeight: Math.max(1, layout.height - layout.horizontalScrollbarHeight),
        })
      }

      const initialPosition = editor.getPosition()
      if (initialPosition) {
        onCursorPositionChangeRef.current?.({
          lineNumber: initialPosition.lineNumber,
          column: initialPosition.column,
        })
      }

      return () => {
        container.removeEventListener('keydown', handleCaptureKeyDown, true)
        container.removeEventListener('paste', handleCapturePaste, true)
        removeFindWidgetHoverGuard()
        removeFontListener?.()
        contextMenuDisposable.dispose()
      }
    }

    let cleanupMonacoSetup: (() => void) | undefined
    void (async () => {
      cleanupMonacoSetup = await setup()
    })()

    return () => {
      disposed = true
      if (cleanupMonacoSetup) {
        cleanupMonacoSetup()
      }
      const editor = editorRef.current
      if (editor) {
        clearRevealHighlight()
        editor.dispose()
        editorRef.current = null
      }
      transcriptGutter.syncEditorInstance(null)
      // 模块缓存中的 Model 保留（撤销栈跨挂载不丢失），只释放本实例的引用计数。
      for (const key of Array.from(acquiredModelKeysRef.current)) {
        releaseModelCacheKey(key)
      }
      for (const localModel of localModelsRef.current) {
        localModel.dispose()
      }
      localModelsRef.current = []
      modelRef.current = null
      monacoRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setActiveTheme(theme)
  }, [theme])

  useEffect(() => {
    activeThemeRef.current = activeTheme
    const monaco = monacoRef.current
    if (!monaco) return
    monaco.editor.setTheme(activeTheme)
    syncMonacoOverflowWidgetsTheme(activeTheme)
    void syncTextmateTheme(monaco, activeTheme)
  }, [activeTheme])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.updateOptions({ readOnly: isReadOnly })
  }, [isReadOnly])

  // 字号变更：立即热更新编辑器并持久化到 localStorage；首次挂载时编辑器尚未
  // 创建完成，初始字号已在 setup 内通过 fontSizeRef 应用。
  useEffect(() => {
    writeMonacoEditorFontSizePreference(fontSize)
    const editor = editorRef.current
    if (!editor) return
    editor.updateOptions({ fontSize, lineHeight: monacoLineHeightForFontSize(fontSize) })
  }, [fontSize])

  useEffect(() => {
    const monaco = monacoRef.current
    const editor = editorRef.current
    if (!monaco || !editor) return

    // 切换文件/语言/内容同步时关闭可能打开的自定义右键菜单。
    setEditorContextMenu(null)

    const currentModel = modelRef.current
    const nextKey = toMonacoModelCacheKey(projectPath, filePath)
    const previousKey = activeModelKeyRef.current

    const hasFilePath = Boolean(filePath && filePath.trim())
    const nextModel = hasFilePath ? getOrCreateMonacoModel(monaco, projectPath, filePath, value, language).model : currentModel
    if (!nextModel) return

    if (previousKey !== nextKey) {
      clearRevealHighlight()
      // 仅在真正切换 Model 时释放旧 key；临时模型复用当前 Model 时旧 key 仍被占用。
      if (currentModel !== nextModel) {
        releaseModelCacheKey(previousKey)
      }
    }
    acquireModelCacheKey(nextKey)

    if (currentModel !== nextModel) {
      modelRef.current = nextModel
      editor.setModel(nextModel)
    }

    if (nextModel.getLanguageId() !== language) {
      void ensureTextmateForLanguage(monaco, language)
      monaco.editor.setModelLanguage(nextModel, language)
    }

    if (nextModel.getValue() !== value) {
      syncGuardRef.current = true
      nextModel.pushEditOperations([], [{ range: nextModel.getFullModelRange(), text: value }], () => null)
      syncGuardRef.current = false
    }

    activeModelKeyRef.current = nextKey
    flushPendingReveal()
  }, [filePath, language, value, projectPath])

  return (
    <div className="relative h-full w-full">
      {transcriptGutter.hover && (
        <TranscriptReferenceHoverCard
          hover={transcriptGutter.hover}
          onMouseEnter={transcriptGutter.cancelHoverHide}
          onOpenReference={(item) => {
            transcriptGutter.cancelHoverHide()
            onOpenTranscriptReferenceRef.current?.(item)
          }}
        />
      )}
      {searchVisible && (
        <MonacoCodeEditorFindBar
          activeSearchMatchIndex={activeSearchMatchIndex}
          onChangeReplaceQuery={setReplaceQuery}
          onChangeSearchQuery={setSearchQuery}
          onClose={closeSearchPanel}
          onGoToNextMatch={goToNextMatch}
          onGoToPreviousMatch={goToPreviousMatch}
          onReplaceAllMatches={replaceAllMatches}
          onReplaceCurrentMatch={replaceCurrentMatch}
          onToggleRegex={() => setSearchRegex((prev) => !prev)}
          onToggleReplaceMode={() => setSearchMode((prev) => (prev === 'replace' ? 'find' : 'replace'))}
          onToggleSearchCaseSensitive={() => setSearchCaseSensitive((prev) => !prev)}
          onToggleSearchWholeWord={() => setSearchWholeWord((prev) => !prev)}
          replaceQuery={replaceQuery}
          searchCaseSensitive={searchCaseSensitive}
          searchInputRef={searchInputRef}
          searchMatchCount={searchMatchCount}
          searchMode={searchMode}
          searchQuery={searchQuery}
          searchRegex={searchRegex}
          searchWholeWord={searchWholeWord}
        />
      )}
      <div ref={containerRef} className="h-full w-full" />
      {editorContextMenu ? (
        <MonacoEditorContextMenu
          x={editorContextMenu.x}
          y={editorContextMenu.y}
          selection={editorContextMenu.selection}
          isReadOnly={editorContextMenu.isReadOnly}
          canComment={editorContextMenu.canComment}
          canFormat={editorContextMenu.canFormat}
          currentLineNumber={editorContextMenu.currentLineNumber}
          currentTheme={activeTheme}
          onThemeChange={handleThemeChange}
          currentFontSize={fontSize}
          onFontSizeChange={handleFontSizeChange}
          onAction={runEditorContextMenuAction}
          onGoToLine={runGoToLine}
          onClose={() => setEditorContextMenu(null)}
        />
      ) : null}
    </div>
  )
})
