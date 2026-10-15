import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { editor as MonacoEditor } from 'monaco-editor'

export type EditorSearchMode = 'find' | 'replace'

const SEARCH_HISTORY_LIMIT = 20
const WHOLE_WORD_SEPARATORS = ' \t\n\r`~!@#$%^&*()-=+[{]}\\|;:\'",.<>/?'

type UseMonacoSearchWidgetOptions = {
  editorRef: MutableRefObject<MonacoEditor.IStandaloneCodeEditor | null>
}

function isMonacoCanceledError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const name = 'name' in error ? error.name : undefined
  const message = 'message' in error ? error.message : undefined

  return name === 'Canceled' || message === 'Canceled'
}

// #11-3：取「光标下方最近」的匹配——第一个起点 ≥ 光标位置的匹配，无则向后环绕取最后一个。
function findNearestMatchIndex(matches: MonacoEditor.FindMatch[], position: { lineNumber: number; column: number } | null): number {
  if (matches.length <= 0 || !position) return 0
  for (let index = 0; index < matches.length; index++) {
    const start = matches[index].range.getStartPosition()
    if (start.lineNumber > position.lineNumber || (start.lineNumber === position.lineNumber && start.column >= position.column)) {
      return index
    }
  }
  return matches.length - 1
}

export function useMonacoSearchWidget({ editorRef }: UseMonacoSearchWidgetOptions) {
  const [searchVisible, setSearchVisible] = useState(false)
  const [searchMode, setSearchMode] = useState<EditorSearchMode>('find')
  const [searchQuery, setSearchQueryState] = useState('')
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
  const searchMatchDecorationsRef = useRef<string[]>([])
  const searchHistoryRef = useRef<string[]>([])
  const searchHistoryIndexRef = useRef(-1)
  const searchHistoryDraftRef = useRef('')
  // #11-4：prefill（双击选词）成功时置位，下一次刷新按 keep 处理以保持当前匹配；消费一次后清除。
  const preserveSelectionOnNextRefreshRef = useRef(false)

  const rememberSearchQuery = useCallback((query: string) => {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return
    searchHistoryRef.current = [normalizedQuery, ...searchHistoryRef.current.filter((item) => item !== normalizedQuery)].slice(0, SEARCH_HISTORY_LIMIT)
  }, [])

  const setSearchQuery = useCallback((query: string) => {
    searchHistoryIndexRef.current = -1
    searchHistoryDraftRef.current = ''
    searchQueryRef.current = query
    setSearchQueryState(query)
  }, [])

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

  const computeSearchMatches = useCallback((model: MonacoEditor.ITextModel, query: string): MonacoEditor.FindMatch[] => {
    if (!query) return []
    return model.findMatches(query, false, searchRegexRef.current, searchCaseSensitiveRef.current, searchWholeWordRef.current ? WHOLE_WORD_SEPARATORS : null, true, 5000)
  }, [])

  const selectSearchMatch = useCallback((editor: MonacoEditor.IStandaloneCodeEditor, matches: MonacoEditor.FindMatch[], index: number) => {
    if (matches.length <= 0) {
      setActiveSearchMatchIndex(0)
      return
    }
    const normalizedIndex = ((index % matches.length) + matches.length) % matches.length
    const match = matches[normalizedIndex]
    editor.setSelection(match.range)
    editor.revealRangeInCenter(match.range)
    setActiveSearchMatchIndex(normalizedIndex + 1)
  }, [])

  const syncSearchMatchIndexFromSelection = useCallback((editor: MonacoEditor.IStandaloneCodeEditor, matches: MonacoEditor.FindMatch[]) => {
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
  }, [])

  const applySearchMatchDecorations = useCallback((editor: MonacoEditor.IStandaloneCodeEditor, matches: MonacoEditor.FindMatch[], currentIndex: number) => {
    const decorations = matches.map((match, index) => ({
      range: match.range,
      options: {
        inlineClassName: index === currentIndex ? 'code-editor-find-match-current' : 'code-editor-find-match',
      },
    }))
    searchMatchDecorationsRef.current = editor.deltaDecorations(searchMatchDecorationsRef.current, decorations)
  }, [])

  const clearSearchMatchDecorations = useCallback((editor: MonacoEditor.IStandaloneCodeEditor) => {
    searchMatchDecorationsRef.current = editor.deltaDecorations(searchMatchDecorationsRef.current, [])
  }, [])

  const refreshSearchResult = useCallback(
    (editor: MonacoEditor.IStandaloneCodeEditor, mode: 'keep' | 'reset-to-first' | 'reset-to-nearest' = 'keep') => {
      const model = editor.getModel()
      if (!model) return
      const matches = computeSearchMatches(model, searchQueryRef.current)
      if (mode === 'reset-to-first' || mode === 'reset-to-nearest') {
        const index = mode === 'reset-to-first' ? 0 : findNearestMatchIndex(matches, editor.getPosition())
        applySearchMatchDecorations(editor, matches, matches.length > 0 ? index : -1)
        setSearchMatchCount(matches.length)
        if (matches.length <= 0) {
          setActiveSearchMatchIndex(0)
          return
        }
        selectSearchMatch(editor, matches, index)
        return
      }
      const selection = editor.getSelection()
      const currentIndex = selection && matches.length > 0 ? matches.findIndex((match) => selection.intersectRanges(match.range) !== null) : -1
      applySearchMatchDecorations(editor, matches, currentIndex)
      syncSearchMatchIndexFromSelection(editor, matches)
    },
    [applySearchMatchDecorations, computeSearchMatches, selectSearchMatch, syncSearchMatchIndexFromSelection],
  )

  // 打开查找面板时的统一刷新策略：prefill 成功保持当前匹配（#11-4），否则选中光标最近匹配（#11-3）。
  const refreshSearchResultForOpen = useCallback(
    (editor: MonacoEditor.IStandaloneCodeEditor) => {
      if (preserveSelectionOnNextRefreshRef.current) {
        preserveSelectionOnNextRefreshRef.current = false
        refreshSearchResult(editor, 'keep')
        return
      }
      refreshSearchResult(editor, 'reset-to-nearest')
    },
    [refreshSearchResult],
  )

  const getSelectedTextForSearch = useCallback((editor: MonacoEditor.IStandaloneCodeEditor): string => {
    const model = editor.getModel()
    const selection = editor.getSelection()
    if (!model || !selection || selection.isEmpty()) return ''
    const selectedText = model.getValueInRange(selection)
    return selectedText.replace(/\r?\n/g, ' ')
  }, [])

  const closeMonacoFindWidget = useCallback((editor: MonacoEditor.IStandaloneCodeEditor | null) => {
    const closeAction = editor?.getAction('closeFindWidget')
    if (!closeAction) return

    void closeAction.run().catch((error: unknown) => {
      if (isMonacoCanceledError(error)) return
      console.error('Failed to close Monaco find widget.', error)
    })
  }, [])

  const openSearchPanel = useCallback(
    (mode: EditorSearchMode, options?: { prefillFromSelection?: boolean }) => {
      const editor = editorRef.current
      if (!editor) return
      const selectedQuery = options?.prefillFromSelection ? getSelectedTextForSearch(editor) : ''
      if (selectedQuery) {
        preserveSelectionOnNextRefreshRef.current = true
        rememberSearchQuery(searchQueryRef.current)
        searchQueryRef.current = selectedQuery
        setSearchQueryState(selectedQuery)
      }
      if (!selectedQuery && !searchQueryRef.current && searchHistoryRef.current[0]) {
        searchQueryRef.current = searchHistoryRef.current[0]
        setSearchQueryState(searchHistoryRef.current[0])
      }
      searchHistoryIndexRef.current = -1
      searchHistoryDraftRef.current = ''
      setSearchMode(mode)
      setSearchVisible(true)
      closeMonacoFindWidget(editor)
      window.setTimeout(() => {
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
        refreshSearchResultForOpen(editor)
      }, 0)
    },
    [closeMonacoFindWidget, editorRef, getSelectedTextForSearch, refreshSearchResultForOpen, rememberSearchQuery],
  )

  const closeSearchPanel = useCallback(() => {
    rememberSearchQuery(searchQueryRef.current)
    setSearchVisible(false)
    const editor = editorRef.current
    editor?.focus()
    if (editor) clearSearchMatchDecorations(editor)
    closeMonacoFindWidget(editor)
  }, [clearSearchMatchDecorations, closeMonacoFindWidget, editorRef, rememberSearchQuery])

  const cycleSearchHistory = useCallback((direction: 'older' | 'newer') => {
    const history = searchHistoryRef.current
    if (history.length === 0) return

    const currentIndex = searchHistoryIndexRef.current
    if (currentIndex === -1) {
      searchHistoryDraftRef.current = searchQueryRef.current
    }

    const nextIndex = direction === 'older' ? (currentIndex === -1 ? 0 : Math.min(history.length - 1, currentIndex + 1)) : currentIndex === -1 ? -1 : currentIndex - 1
    searchHistoryIndexRef.current = nextIndex
    const nextQuery = nextIndex === -1 ? searchHistoryDraftRef.current : history[nextIndex]
    searchQueryRef.current = nextQuery
    setSearchQueryState(nextQuery)
  }, [])

  const goToNextMatch = useCallback(() => {
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
  }, [activeSearchMatchIndex, computeSearchMatches, editorRef, searchQuery, selectSearchMatch])

  const goToPreviousMatch = useCallback(() => {
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
  }, [activeSearchMatchIndex, computeSearchMatches, editorRef, searchQuery, selectSearchMatch])

  const replaceCurrentMatch = useCallback(() => {
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
  }, [activeSearchMatchIndex, computeSearchMatches, editorRef, refreshSearchResult, replaceQuery, searchQuery])

  const replaceAllMatches = useCallback(() => {
    const editor = editorRef.current
    if (!editor || !searchQuery) return
    const model = editor.getModel()
    if (!model) return
    const matches = computeSearchMatches(model, searchQuery)
    if (matches.length <= 0) return
    const edits = matches.map((match) => ({ range: match.range, text: replaceQuery }))
    editor.executeEdits('custom-find-replace-all', edits)
    refreshSearchResult(editor, 'reset-to-first')
  }, [computeSearchMatches, editorRef, refreshSearchResult, replaceQuery, searchQuery])

  const handleEditorCursorSelectionChange = useCallback(() => {
    const editor = editorRef.current
    if (!editor || !searchVisibleRef.current) return
    refreshSearchResult(editor)
  }, [editorRef, refreshSearchResult])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    closeMonacoFindWidget(editor)
  }, [closeMonacoFindWidget, editorRef, searchVisible])

  useEffect(() => {
    if (!searchVisible) return
    const editor = editorRef.current
    if (!editor) return
    refreshSearchResultForOpen(editor)
  }, [editorRef, refreshSearchResultForOpen, searchCaseSensitive, searchQuery, searchRegex, searchVisible, searchWholeWord])

  return {
    activeSearchMatchIndex,
    closeSearchPanel,
    cycleSearchHistory,
    goToNextMatch,
    goToPreviousMatch,
    handleEditorCursorSelectionChange,
    openSearchPanel,
    refreshSearchResult,
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
  }
}
