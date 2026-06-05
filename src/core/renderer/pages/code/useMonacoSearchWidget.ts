import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { editor as MonacoEditor } from 'monaco-editor'

export type EditorSearchMode = 'find' | 'replace'

const WHOLE_WORD_SEPARATORS = ' \t\n\r`~!@#$%^&*()-=+[{]}\\|;:\'",.<>/?'

type UseMonacoSearchWidgetOptions = {
  editorRef: MutableRefObject<MonacoEditor.IStandaloneCodeEditor | null>
}

export function useMonacoSearchWidget({
  editorRef,
}: UseMonacoSearchWidgetOptions) {
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

  const computeSearchMatches = useCallback((
    model: MonacoEditor.ITextModel,
    query: string
  ): MonacoEditor.FindMatch[] => {
    if (!query) return []
    return model.findMatches(
      query,
      false,
      searchRegexRef.current,
      searchCaseSensitiveRef.current,
      searchWholeWordRef.current ? WHOLE_WORD_SEPARATORS : null,
      true,
      5000
    )
  }, [])

  const selectSearchMatch = useCallback((
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
  }, [])

  const syncSearchMatchIndexFromSelection = useCallback((
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
  }, [])

  const refreshSearchResult = useCallback((
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
  }, [computeSearchMatches, selectSearchMatch, syncSearchMatchIndexFromSelection])

  const getSelectedTextForSearch = useCallback((editor: MonacoEditor.IStandaloneCodeEditor): string => {
    const model = editor.getModel()
    const selection = editor.getSelection()
    if (!model || !selection || selection.isEmpty()) return ''
    const selectedText = model.getValueInRange(selection)
    return selectedText.replace(/\r?\n/g, ' ')
  }, [])

  const openSearchPanel = useCallback((
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
    editor.getAction('closeFindWidget')?.run()
    window.setTimeout(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
      refreshSearchResult(editor)
    }, 0)
  }, [editorRef, getSelectedTextForSearch, refreshSearchResult])

  const closeSearchPanel = useCallback(() => {
    setSearchVisible(false)
    const editor = editorRef.current
    editor?.focus()
    editor?.getAction('closeFindWidget')?.run()
  }, [editorRef])

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
    editor.getAction('closeFindWidget')?.run()
  }, [editorRef, searchVisible])

  useEffect(() => {
    if (!searchVisible) return
    const editor = editorRef.current
    if (!editor) return
    refreshSearchResult(editor, 'reset-to-first')
  }, [editorRef, refreshSearchResult, searchCaseSensitive, searchQuery, searchRegex, searchVisible, searchWholeWord])

  return {
    activeSearchMatchIndex,
    closeSearchPanel,
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
