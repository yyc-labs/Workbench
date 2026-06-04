import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { editor as MonacoEditor } from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { ChevronDown, ChevronUp, Replace, X } from 'lucide-react'
import { ensureTextmateForLanguage, syncTextmateTheme } from './textmate.monaco'

export interface MonacoEditorScrollState {
  scrollTop: number
  scrollHeight: number
  viewportHeight: number
}

export interface MonacoCodeEditorHandle {
  getScrollState: () => MonacoEditorScrollState | null
  setScrollTop: (scrollTop: number) => void
  revealPosition: (lineNumber: number, column?: number) => void
  openSearch: (mode?: 'find' | 'replace') => void
}

type EditorSearchMode = 'find' | 'replace'

interface MonacoCodeEditorProps {
  value: string
  language: string
  theme: 'vs' | 'vs-dark'
  filePath: string | null
  isReadOnly?: boolean
  onChange: (value: string) => void
  onPasteImage?: (file: File | null, clipboardEvent?: ClipboardEvent) => Promise<string | null>
  onSave: () => void
  onFocusSearch?: () => void
  onScrollStateChange?: (state: MonacoEditorScrollState) => void
  onCursorPositionChange?: (position: { lineNumber: number; column: number }) => void
}

interface MonacoEnvironmentShape {
  getWorker: (_workerId: string, label: string) => Worker
}

const FIND_WIDGET_HOVER_GUARD_CLASS = 'monaco-find-widget-control-hover'
const FIND_WIDGET_CONTROL_SELECTOR = '.find-widget .button, .find-widget .monaco-custom-toggle, .findOptionsWidget .button, .findOptionsWidget .monaco-custom-toggle'

declare global {
  interface Window {
    MonacoEnvironment?: MonacoEnvironmentShape
  }
}

let monacoEnvironmentReady = false

function ensureMonacoEnvironmentConfigured(): void {
  if (monacoEnvironmentReady) return
  if (typeof window === 'undefined') return

  window.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === 'json') return new JsonWorker()
      if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
      if (label === 'typescript' || label === 'javascript') return new TsWorker()
      return new EditorWorker()
    },
  }

  monacoEnvironmentReady = true
}

function createMonacoModelUri(filePath: string | null): string {
  if (filePath && filePath.trim()) {
    const normalized = filePath.replace(/\\/g, '/')
    return `file:///${normalized.replace(/^\/+/, '')}`
  }
  return `inmemory://model/${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function toModelCacheKey(filePath: string | null): string {
  const normalized = filePath?.trim().replace(/\\/g, '/')
  return normalized && normalized.length > 0 ? normalized : '__inmemory__'
}

const MAX_CACHED_MODELS = 8

export const MonacoCodeEditor = forwardRef<MonacoCodeEditorHandle, MonacoCodeEditorProps>(function MonacoCodeEditor({
  value,
  language,
  theme,
  filePath,
  isReadOnly = false,
  onChange,
  onPasteImage,
  onSave,
  onFocusSearch,
  onScrollStateChange,
  onCursorPositionChange,
}, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const modelRef = useRef<MonacoEditor.ITextModel | null>(null)
  const modelCacheRef = useRef<Map<string, MonacoEditor.ITextModel>>(new Map())
  const syncGuardRef = useRef(false)
  const onSaveRef = useRef(onSave)
  const onPasteImageRef = useRef(onPasteImage)
  const onFocusSearchRef = useRef(onFocusSearch)
  const onScrollStateChangeRef = useRef(onScrollStateChange)
  const onCursorPositionChangeRef = useRef(onCursorPositionChange)
  const [searchVisible, setSearchVisible] = useState(false)
  const [searchMode, setSearchMode] = useState<EditorSearchMode>('find')
  const [searchQuery, setSearchQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [searchMatchCount, setSearchMatchCount] = useState(0)
  const [activeSearchMatchIndex, setActiveSearchMatchIndex] = useState(0)
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false)
  const [searchWholeWord, setSearchWholeWord] = useState(false)
  const [searchRegex, setSearchRegex] = useState(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const searchVisibleRef = useRef(false)
  const searchQueryRef = useRef('')
  const activeSearchMatchIndexRef = useRef(0)
  const searchCaseSensitiveRef = useRef(false)
  const searchWholeWordRef = useRef(false)
  const searchRegexRef = useRef(false)

  useEffect(() => {
    searchVisibleRef.current = searchVisible
  }, [searchVisible])

  useEffect(() => {
    searchQueryRef.current = searchQuery
  }, [searchQuery])

  useEffect(() => {
    activeSearchMatchIndexRef.current = activeSearchMatchIndex
  }, [activeSearchMatchIndex])

  useEffect(() => {
    searchCaseSensitiveRef.current = searchCaseSensitive
  }, [searchCaseSensitive])

  useEffect(() => {
    searchWholeWordRef.current = searchWholeWord
  }, [searchWholeWord])

  useEffect(() => {
    searchRegexRef.current = searchRegex
  }, [searchRegex])

  const computeSearchMatches = (
    model: MonacoEditor.ITextModel,
    query: string
  ): MonacoEditor.FindMatch[] => {
    if (!query) return []
    return model.findMatches(
      query,
      false,
      searchRegexRef.current,
      searchCaseSensitiveRef.current,
      searchWholeWordRef.current ? ' \t\n\r`~!@#$%^&*()-=+[{]}\\|;:\'",.<>/?' : null,
      true,
      5000
    )
  }

  const touchModelCacheEntry = (key: string, model: MonacoEditor.ITextModel) => {
    const cache = modelCacheRef.current
    if (cache.has(key)) {
      cache.delete(key)
    }
    cache.set(key, model)
  }

  const evictStaleModels = (activeKey: string) => {
    const cache = modelCacheRef.current
    while (cache.size > MAX_CACHED_MODELS) {
      const oldestEntry = cache.entries().next()
      if (oldestEntry.done) break
      const [oldestKey, oldestModel] = oldestEntry.value
      if (oldestKey === activeKey) {
        cache.delete(oldestKey)
        cache.set(oldestKey, oldestModel)
        continue
      }
      cache.delete(oldestKey)
      oldestModel.dispose()
    }
  }

  const selectSearchMatch = (
    editor: MonacoEditor.IStandaloneCodeEditor,
    matches: MonacoEditor.FindMatch[],
    index: number
  ) => {
    if (matches.length <= 0) {
      setActiveSearchMatchIndex(0)
      return
    }
    const normalizedIndex = ((index % matches.length) + matches.length) % matches.length
    const match = matches[normalizedIndex]
    editor.setSelection(match.range)
    editor.revealRangeInCenter(match.range)
    setActiveSearchMatchIndex(normalizedIndex + 1)
  }

  const syncSearchMatchIndexFromSelection = (
    editor: MonacoEditor.IStandaloneCodeEditor,
    matches: MonacoEditor.FindMatch[]
  ) => {
    setSearchMatchCount(matches.length)
    if (matches.length <= 0) {
      setActiveSearchMatchIndex(0)
      return
    }

    const selection = editor.getSelection()
    if (!selection) {
      setActiveSearchMatchIndex(activeSearchMatchIndexRef.current > 0 ? activeSearchMatchIndexRef.current : 1)
      return
    }

    const activeMatchIndex = matches.findIndex((match) => selection.intersectRanges(match.range) !== null)
    if (activeMatchIndex >= 0) {
      setActiveSearchMatchIndex(activeMatchIndex + 1)
      return
    }

    const currentIndex = activeSearchMatchIndexRef.current
    const normalizedIndex = currentIndex > 0 && currentIndex <= matches.length ? currentIndex : 1
    setActiveSearchMatchIndex(normalizedIndex)
  }

  const refreshSearchResult = (
    editor: MonacoEditor.IStandaloneCodeEditor,
    mode: 'keep' | 'reset-to-first' = 'keep'
  ) => {
    const model = editor.getModel()
    if (!model) return
    const matches = computeSearchMatches(model, searchQueryRef.current)
    if (mode === 'reset-to-first') {
      setSearchMatchCount(matches.length)
      if (matches.length <= 0) {
        setActiveSearchMatchIndex(0)
        return
      }
      selectSearchMatch(editor, matches, 0)
      return
    }
    syncSearchMatchIndexFromSelection(editor, matches)
  }

  const getSelectedTextForSearch = (editor: MonacoEditor.IStandaloneCodeEditor): string => {
    const model = editor.getModel()
    const selection = editor.getSelection()
    if (!model || !selection || selection.isEmpty()) return ''
    const selectedText = model.getValueInRange(selection)
    return selectedText.replace(/\r?\n/g, ' ')
  }

  const openSearchPanel = (
    mode: EditorSearchMode,
    options?: { prefillFromSelection?: boolean }
  ) => {
    const editor = editorRef.current
    if (!editor) return
    const selectedQuery = options?.prefillFromSelection ? getSelectedTextForSearch(editor) : ''
    if (selectedQuery) {
      searchQueryRef.current = selectedQuery
      setSearchQuery(selectedQuery)
    }
    setSearchMode(mode)
    setSearchVisible(true)
    // Hide Monaco built-in find UI so only our wrapped UI is shown.
    editor.getAction('closeFindWidget')?.run()
    window.setTimeout(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
      refreshSearchResult(editor)
    }, 0)
  }

  const closeSearchPanel = () => {
    setSearchVisible(false)
    const editor = editorRef.current
    editor?.focus()
    editor?.getAction('closeFindWidget')?.run()
  }

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.getAction('closeFindWidget')?.run()
  }, [searchVisible])

  const goToNextMatch = () => {
    const editor = editorRef.current
    if (!editor) return
    const model = editor.getModel()
    if (!model) return
    const matches = computeSearchMatches(model, searchQuery)
    setSearchMatchCount(matches.length)
    if (matches.length <= 0) {
      setActiveSearchMatchIndex(0)
      return
    }
    const current = activeSearchMatchIndex > 0 ? activeSearchMatchIndex - 1 : -1
    const nextIndex = (current + 1) % matches.length
    selectSearchMatch(editor, matches, nextIndex)
  }

  const goToPreviousMatch = () => {
    const editor = editorRef.current
    if (!editor) return
    const model = editor.getModel()
    if (!model) return
    const matches = computeSearchMatches(model, searchQuery)
    setSearchMatchCount(matches.length)
    if (matches.length <= 0) {
      setActiveSearchMatchIndex(0)
      return
    }
    const current = activeSearchMatchIndex > 0 ? activeSearchMatchIndex - 1 : 0
    const prevIndex = (current - 1 + matches.length) % matches.length
    selectSearchMatch(editor, matches, prevIndex)
  }

  const replaceCurrentMatch = () => {
    const editor = editorRef.current
    if (!editor || !searchQuery) return
    const model = editor.getModel()
    if (!model) return
    const matches = computeSearchMatches(model, searchQuery)
    if (matches.length <= 0) return
    const current = activeSearchMatchIndex > 0 ? activeSearchMatchIndex - 1 : 0
    const normalizedIndex = ((current % matches.length) + matches.length) % matches.length
    const targetRange = matches[normalizedIndex].range
    editor.executeEdits('custom-find-replace', [{ range: targetRange, text: replaceQuery }])
    refreshSearchResult(editor, 'keep')
  }

  const replaceAllMatches = () => {
    const editor = editorRef.current
    if (!editor || !searchQuery) return
    const model = editor.getModel()
    if (!model) return
    const matches = computeSearchMatches(model, searchQuery)
    if (matches.length <= 0) return
    const edits = matches.map((match) => ({ range: match.range, text: replaceQuery }))
    editor.executeEdits('custom-find-replace-all', edits)
    refreshSearchResult(editor, 'reset-to-first')
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

  useImperativeHandle(ref, () => ({
    getScrollState: () => {
      const editor = editorRef.current
      if (!editor) return null
      const layout = editor.getLayoutInfo()
      return {
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
    revealPosition: (lineNumber: number, column = 1) => {
      const editor = editorRef.current
      if (!editor) return
      const safeLine = Math.max(1, Math.floor(lineNumber))
      const safeColumn = Math.max(1, Math.floor(column))
      editor.setPosition({ lineNumber: safeLine, column: safeColumn })
      editor.revealPositionInCenter({ lineNumber: safeLine, column: safeColumn })
      editor.focus()
    },
    openSearch: (mode = 'find') => {
      openSearchPanel(mode)
    },
  }), [])

  useEffect(() => {
    let disposed = false

    const setup = async () => {
      const container = containerRef.current
      if (!container) return

      ensureMonacoEnvironmentConfigured()
      const monaco = await import('monaco-editor')
      if (disposed) return

      monacoRef.current = monaco
      syncTextmateTheme(theme)
      await ensureTextmateForLanguage(monaco, language)
      if (disposed) return

      const uri = monaco.Uri.parse(createMonacoModelUri(filePath))
      const model = monaco.editor.createModel(value, language, uri)
      modelRef.current = model
      const initialKey = toModelCacheKey(filePath)
      touchModelCacheEntry(initialKey, model)
      evictStaleModels(initialKey)

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
        padding: { top: 14, bottom: 14 },
        readOnly: isReadOnly,
        theme,
      })
      editorRef.current = editor

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
        const insertRange = selection
          ?? (fallbackPosition
            ? new monaco.Range(
              fallbackPosition.lineNumber,
              fallbackPosition.column,
              fallbackPosition.lineNumber,
              fallbackPosition.column
            )
            : null)
        if (!insertRange) return

        void pasteImage(imageFile, event)
          .then((markdownText) => {
            if (!markdownText) return
            const text = `${markdownText}\n`
            const nextPosition = insertRange.getEndPosition()

            editor.pushUndoStop()
            editor.executeEdits('paste-image', [{
              range: insertRange,
              text,
              forceMoveMarkers: true,
            }])
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

      const handleCaptureMouseOver = (event: MouseEvent) => {
        const target = event.target
        if (!(target instanceof Element)) return
        const findWidgetControl = target.closest(FIND_WIDGET_CONTROL_SELECTOR)
        if (!findWidgetControl) return
        // Prevent Monaco's delayed hover from stealing hover state on find-widget controls.
        document.body.classList.add(FIND_WIDGET_HOVER_GUARD_CLASS)
        event.stopPropagation()
      }
      const handleCaptureMouseOut = (event: MouseEvent) => {
        const target = event.target
        if (!(target instanceof Element)) return
        const fromControl = target.closest(FIND_WIDGET_CONTROL_SELECTOR)
        if (!fromControl) return
        const related = event.relatedTarget
        if (related instanceof Element && related.closest(FIND_WIDGET_CONTROL_SELECTOR)) return
        document.body.classList.remove(FIND_WIDGET_HOVER_GUARD_CLASS)
      }
      container.addEventListener('mouseover', handleCaptureMouseOver, true)
      container.addEventListener('mouseout', handleCaptureMouseOut, true)

      editor.onDidChangeModelContent(() => {
        if (syncGuardRef.current) return
        onChange(editor.getValue())
      })

      editor.onDidScrollChange(() => {
        const cb = onScrollStateChangeRef.current
        if (!cb) return
        const layout = editor.getLayoutInfo()
        cb({
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
        const isSearchShortcut = (event.ctrlKey || event.metaKey)
          && event.shiftKey
          && event.keyCode === monaco.KeyCode.KeyF
        if (!isSearchShortcut) return
        event.preventDefault()
        event.stopPropagation()
        onFocusSearchRef.current?.()
      })

      editor.onDidChangeCursorSelection(() => {
        if (!searchVisibleRef.current) return
        refreshSearchResult(editor)
      })

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD, () => {
        editor.trigger('keyboard', 'editor.action.copyLinesDownAction', null)
      })

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, () => {
        editor.trigger('keyboard', 'editor.action.deleteLines', null)
      })

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
        container.removeEventListener('mouseover', handleCaptureMouseOver, true)
        container.removeEventListener('mouseout', handleCaptureMouseOut, true)
        document.body.classList.remove(FIND_WIDGET_HOVER_GUARD_CLASS)
        removeFontListener?.()
      }
    }

    let cleanupFontListener: (() => void) | undefined
    void (async () => {
      cleanupFontListener = await setup()
    })()

    return () => {
      disposed = true
      if (cleanupFontListener) {
        cleanupFontListener()
      }
      const editor = editorRef.current
      if (editor) {
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
    if (!searchVisible) return
    const editor = editorRef.current
    if (!editor) return
    refreshSearchResult(editor, 'reset-to-first')
  }, [searchCaseSensitive, searchQuery, searchRegex, searchWholeWord, searchVisible])

  useEffect(() => {
    const monaco = monacoRef.current
    if (!monaco) return
    monaco.editor.setTheme(theme)
    syncTextmateTheme(theme)
  }, [theme])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.updateOptions({ readOnly: isReadOnly })
  }, [isReadOnly])

  useEffect(() => {
    const monaco = monacoRef.current
    const editor = editorRef.current
    if (!monaco || !editor) return

    const currentModel = modelRef.current
    const nextKey = toModelCacheKey(filePath)
    let nextModel = modelCacheRef.current.get(nextKey) ?? null

    if (!nextModel) {
      const nextUri = monaco.Uri.parse(createMonacoModelUri(filePath))
      nextModel = monaco.editor.createModel(value, language, nextUri)
    }
    touchModelCacheEntry(nextKey, nextModel)
    evictStaleModels(nextKey)

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
      nextModel.pushEditOperations(
        [],
        [{ range: nextModel.getFullModelRange(), text: value }],
        () => null
      )
      syncGuardRef.current = false
    }
  }, [filePath, language, value])

  return (
    <div className="h-full w-full">
      {searchVisible && (
        <div className="code-editor-findbar">
          <div className="code-editor-findbar-row">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value)
              }}
              placeholder="Find"
              className="code-editor-findbar-input"
              spellCheck={false}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.shiftKey) {
                  event.preventDefault()
                  goToPreviousMatch()
                  return
                }
                if (event.key === 'Enter') {
                  event.preventDefault()
                  goToNextMatch()
                  return
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  closeSearchPanel()
                }
              }}
            />
            <span className="code-editor-findbar-count">
              {searchMatchCount > 0 ? `${activeSearchMatchIndex}/${searchMatchCount}` : 'No results'}
            </span>
            <button
              type="button"
              className={`code-editor-findbar-toggle ${searchCaseSensitive ? 'is-active' : ''}`}
              onClick={() => setSearchCaseSensitive((prev) => !prev)}
              title="Match Case"
              aria-pressed={searchCaseSensitive}
            >
              Aa
            </button>
            <button
              type="button"
              className={`code-editor-findbar-toggle ${searchWholeWord ? 'is-active' : ''}`}
              onClick={() => setSearchWholeWord((prev) => !prev)}
              title="Match Whole Word"
              aria-pressed={searchWholeWord}
            >
              ab
            </button>
            <button
              type="button"
              className={`code-editor-findbar-toggle ${searchRegex ? 'is-active' : ''}`}
              onClick={() => setSearchRegex((prev) => !prev)}
              title="Use Regular Expression"
              aria-pressed={searchRegex}
            >
              .*
            </button>
            <button
              type="button"
              className="code-editor-findbar-icon-btn"
              onClick={goToPreviousMatch}
              title="Previous Match"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="code-editor-findbar-icon-btn"
              onClick={goToNextMatch}
              title="Next Match"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className={`code-editor-findbar-icon-btn ${searchMode === 'replace' ? 'is-active' : ''}`}
              onClick={() => setSearchMode((prev) => (prev === 'replace' ? 'find' : 'replace'))}
              title={searchMode === 'replace' ? 'Hide Replace' : 'Show Replace'}
            >
              <Replace className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="code-editor-findbar-icon-btn"
              onClick={closeSearchPanel}
              title="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {searchMode === 'replace' && (
            <div className="code-editor-findbar-row">
              <input
                type="text"
                value={replaceQuery}
                onChange={(event) => setReplaceQuery(event.target.value)}
                placeholder="Replace"
                className="code-editor-findbar-input"
                spellCheck={false}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && event.shiftKey) {
                    event.preventDefault()
                    replaceAllMatches()
                    return
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    replaceCurrentMatch()
                    return
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    closeSearchPanel()
                  }
                }}
              />
              <button
                type="button"
                className="code-editor-findbar-action-btn"
                onClick={replaceCurrentMatch}
                disabled={searchMatchCount <= 0}
              >
                Replace
              </button>
              <button
                type="button"
                className="code-editor-findbar-action-btn"
                onClick={replaceAllMatches}
                disabled={searchMatchCount <= 0}
              >
                Replace All
              </button>
            </div>
          )}
        </div>
      )}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  )
})
