import type { editor as MonacoEditor, Selection } from 'monaco-editor'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { installMonacoFindWidgetHoverGuard, type MonacoThemeName } from '../../lib/monacoEnvironment'
import { loadMonacoEditorModule } from '../../lib/monacoPreload'
import { MonacoCodeEditorFindBar } from './MonacoCodeEditorFindBar'
import { MonacoEditorContextMenu } from './MonacoEditorContextMenu'
import { extractRelativeImportRanges, resolveImportCandidatePaths, resolveFilePathFromModelUri, resolveImportTarget } from './code.importLink'
import { createMonacoModelUri, evictStaleMonacoModels, toMonacoModelCacheKey, touchMonacoModelCacheEntry } from './monacoModelCache'
import { ensureTextmateForLanguage, syncTextmateTheme } from './textmate.monaco'
import { useMonacoSearchWidget } from './useMonacoSearchWidget'

export interface MonacoEditorScrollState {
  firstVisibleLine: number
  scrollTop: number
  scrollHeight: number
  viewportHeight: number
}

export interface MonacoCodeEditorHandle {
  getScrollState: () => MonacoEditorScrollState | null
  setScrollTop: (scrollTop: number) => void
  setScrollTopForLine: (lineNumber: number) => void
  revealPosition: (lineNumber: number, column?: number) => void
  highlightLine: (lineNumber: number) => void
  openSearch: (mode?: 'find' | 'replace') => void
}

interface PendingRevealPosition {
  lineNumber: number
  column: number
  modelKey: string
}

interface PendingHighlightLine {
  lineNumber: number
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
}

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
      const currentFilePath = resolveFilePathFromModelUri(model.uri)
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
}

export const MonacoCodeEditor = forwardRef<MonacoCodeEditorHandle, MonacoCodeEditorProps>(function MonacoCodeEditor({ value, language, theme, filePath, projectPath, isReadOnly = false, onChange, onOpenFile, onPasteImage, onSave, onFocusSearch, onScrollStateChange, onCursorPositionChange }, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const modelRef = useRef<MonacoEditor.ITextModel | null>(null)
  const modelCacheRef = useRef<Map<string, MonacoEditor.ITextModel>>(new Map())
  const filePathRef = useRef(filePath)
  const activeModelKeyRef = useRef(toMonacoModelCacheKey(filePath))
  const pendingRevealRef = useRef<PendingRevealPosition | null>(null)
  const pendingHighlightLineRef = useRef<PendingHighlightLine | null>(null)
  const revealHighlightDecorationsRef = useRef<string[]>([])
  const revealHighlightClearTimerRef = useRef<number | null>(null)
  const syncGuardRef = useRef(false)
  const onSaveRef = useRef(onSave)
  const onPasteImageRef = useRef(onPasteImage)
  const onFocusSearchRef = useRef(onFocusSearch)
  const onScrollStateChangeRef = useRef(onScrollStateChange)
  const onCursorPositionChangeRef = useRef(onCursorPositionChange)
  filePathRef.current = filePath
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

  const [activeTheme, setActiveTheme] = useState<MonacoThemeName>(theme)
  const activeThemeRef = useRef(activeTheme)
  const [editorContextMenu, setEditorContextMenu] = useState<EditorContextMenuSnapshot | null>(null)

  const runEditorContextMenuAction = (actionId: string) => {
    const editor = editorRef.current
    editor?.trigger('editor-context-menu', actionId, null)
    editor?.focus()
    setEditorContextMenu(null)
  }

  const handleThemeChange = (nextTheme: MonacoThemeName) => {
    setActiveTheme(nextTheme)
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

  const highlightLineInEditor = (editor: MonacoEditor.IStandaloneCodeEditor, lineNumber: number) => {
    const monaco = monacoRef.current
    const model = editor.getModel()
    if (!monaco || !model) return false

    const safeLine = Math.min(Math.max(1, Math.floor(lineNumber)), model.getLineCount())
    revealHighlightDecorationsRef.current = editor.deltaDecorations(revealHighlightDecorationsRef.current, [
      {
        range: new monaco.Range(safeLine, 1, safeLine, model.getLineMaxColumn(safeLine)),
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
      if (highlightLineInEditor(editor, pendingHighlight.lineNumber)) {
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
    onFocusSearchRef.current = onFocusSearch
  }, [onFocusSearch])

  useEffect(() => {
    onScrollStateChangeRef.current = onScrollStateChange
  }, [onScrollStateChange])

  useEffect(() => {
    onCursorPositionChangeRef.current = onCursorPositionChange
  }, [onCursorPositionChange])

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
          modelKey: toMonacoModelCacheKey(filePathRef.current),
        }
        flushPendingReveal()
      },
      highlightLine: (lineNumber: number) => {
        pendingHighlightLineRef.current = {
          lineNumber,
          modelKey: toMonacoModelCacheKey(filePathRef.current),
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
      syncTextmateTheme(activeThemeRef.current)
      await ensureTextmateForLanguage(monaco, language)
      if (disposed) return

      const uri = monaco.Uri.parse(createMonacoModelUri(filePath))
      const model = monaco.editor.createModel(value, language, uri)
      modelRef.current = model
      const initialKey = toMonacoModelCacheKey(filePath)
      touchMonacoModelCacheEntry(modelCacheRef.current, initialKey, model)
      evictStaleMonacoModels(modelCacheRef.current, initialKey)

      const editor = monaco.editor.create(container, {
        model,
        automaticLayout: true,
        minimap: { enabled: false },
        // Prefer CJK-capable monospace fonts to keep width metrics stable for mixed Chinese + numbers.
        fontFamily: "'Sarasa Mono SC', 'Noto Sans Mono CJK SC', 'JetBrains Mono', 'Cascadia Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
        fontSize: 13,
        lineHeight: 20,
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
      editorRef.current = editor
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
      for (const model of modelCacheRef.current.values()) {
        model.dispose()
      }
      modelCacheRef.current.clear()
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
    syncTextmateTheme(activeTheme)
  }, [activeTheme])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.updateOptions({ readOnly: isReadOnly })
  }, [isReadOnly])

  useEffect(() => {
    const monaco = monacoRef.current
    const editor = editorRef.current
    if (!monaco || !editor) return

    // 切换文件/语言/内容同步时关闭可能打开的自定义右键菜单。
    setEditorContextMenu(null)

    const currentModel = modelRef.current
    const nextKey = toMonacoModelCacheKey(filePath)
    const previousKey = activeModelKeyRef.current
    let nextModel = modelCacheRef.current.get(nextKey) ?? null

    if (!nextModel) {
      const nextUri = monaco.Uri.parse(createMonacoModelUri(filePath))
      nextModel = monaco.editor.createModel(value, language, nextUri)
    }
    touchMonacoModelCacheEntry(modelCacheRef.current, nextKey, nextModel)
    evictStaleMonacoModels(modelCacheRef.current, nextKey)

    if (previousKey !== nextKey) {
      clearRevealHighlight()
    }

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
  }, [filePath, language, value])

  return (
    <div className="relative h-full w-full">
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
          currentTheme={activeTheme}
          onThemeChange={handleThemeChange}
          onAction={runEditorContextMenuAction}
          onClose={() => setEditorContextMenu(null)}
        />
      ) : null}
    </div>
  )
})
