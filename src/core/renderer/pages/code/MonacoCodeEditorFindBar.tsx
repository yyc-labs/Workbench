import type { MutableRefObject } from 'react'
import { ChevronDown, ChevronUp, Replace, X } from 'lucide-react'
import type { EditorSearchMode } from './useMonacoSearchWidget'

type MonacoCodeEditorFindBarProps = {
  activeSearchMatchIndex: number
  onChangeReplaceQuery: (value: string) => void
  onChangeSearchQuery: (value: string) => void
  onClose: () => void
  onGoToNextMatch: () => void
  onGoToPreviousMatch: () => void
  onReplaceAllMatches: () => void
  onReplaceCurrentMatch: () => void
  onToggleRegex: () => void
  onToggleReplaceMode: () => void
  onToggleSearchCaseSensitive: () => void
  onToggleSearchWholeWord: () => void
  replaceQuery: string
  searchCaseSensitive: boolean
  searchInputRef: MutableRefObject<HTMLInputElement | null>
  searchMatchCount: number
  searchMode: EditorSearchMode
  searchQuery: string
  searchRegex: boolean
  searchWholeWord: boolean
}

export function MonacoCodeEditorFindBar({
  activeSearchMatchIndex,
  onChangeReplaceQuery,
  onChangeSearchQuery,
  onClose,
  onGoToNextMatch,
  onGoToPreviousMatch,
  onReplaceAllMatches,
  onReplaceCurrentMatch,
  onToggleRegex,
  onToggleReplaceMode,
  onToggleSearchCaseSensitive,
  onToggleSearchWholeWord,
  replaceQuery,
  searchCaseSensitive,
  searchInputRef,
  searchMatchCount,
  searchMode,
  searchQuery,
  searchRegex,
  searchWholeWord,
}: MonacoCodeEditorFindBarProps) {
  return (
    <div className="code-editor-findbar">
      <div className="code-editor-findbar-row">
        <input
          ref={(node) => {
            searchInputRef.current = node
          }}
          type="text"
          value={searchQuery}
          onChange={(event) => {
            onChangeSearchQuery(event.target.value)
          }}
          placeholder="Find"
          className="code-editor-findbar-input"
          spellCheck={false}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.shiftKey) {
              event.preventDefault()
              onGoToPreviousMatch()
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              onGoToNextMatch()
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            }
          }}
        />
        <span className="code-editor-findbar-count">
          {searchMatchCount > 0 ? `${activeSearchMatchIndex}/${searchMatchCount}` : 'No results'}
        </span>
        <button
          type="button"
          className={`code-editor-findbar-toggle ${searchCaseSensitive ? 'is-active' : ''}`}
          onClick={onToggleSearchCaseSensitive}
          title="Match Case"
          aria-pressed={searchCaseSensitive}
        >
          Aa
        </button>
        <button
          type="button"
          className={`code-editor-findbar-toggle ${searchWholeWord ? 'is-active' : ''}`}
          onClick={onToggleSearchWholeWord}
          title="Match Whole Word"
          aria-pressed={searchWholeWord}
        >
          ab
        </button>
        <button
          type="button"
          className={`code-editor-findbar-toggle ${searchRegex ? 'is-active' : ''}`}
          onClick={onToggleRegex}
          title="Use Regular Expression"
          aria-pressed={searchRegex}
        >
          .*
        </button>
        <button
          type="button"
          className="code-editor-findbar-icon-btn"
          onClick={onGoToPreviousMatch}
          title="Previous Match"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="code-editor-findbar-icon-btn"
          onClick={onGoToNextMatch}
          title="Next Match"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={`code-editor-findbar-icon-btn ${searchMode === 'replace' ? 'is-active' : ''}`}
          onClick={onToggleReplaceMode}
          title={searchMode === 'replace' ? 'Hide Replace' : 'Show Replace'}
        >
          <Replace className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="code-editor-findbar-icon-btn"
          onClick={onClose}
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
            onChange={(event) => onChangeReplaceQuery(event.target.value)}
            placeholder="Replace"
            className="code-editor-findbar-input"
            spellCheck={false}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && event.shiftKey) {
                event.preventDefault()
                onReplaceAllMatches()
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                onReplaceCurrentMatch()
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                onClose()
              }
            }}
          />
          <button
            type="button"
            className="code-editor-findbar-action-btn"
            onClick={onReplaceCurrentMatch}
            disabled={searchMatchCount <= 0}
          >
            Replace
          </button>
          <button
            type="button"
            className="code-editor-findbar-action-btn"
            onClick={onReplaceAllMatches}
            disabled={searchMatchCount <= 0}
          >
            Replace All
          </button>
        </div>
      )}
    </div>
  )
}
