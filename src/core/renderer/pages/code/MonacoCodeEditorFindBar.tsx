import type { MutableRefObject } from 'react'
import { ChevronDown, ChevronUp, Replace, X } from 'lucide-react'
import { useI18n } from '../../i18n'
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
  const { t } = useI18n()

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
          placeholder={t('codeWorkspace.find')}
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
          {searchMatchCount > 0 ? `${activeSearchMatchIndex}/${searchMatchCount}` : t('codeWorkspace.noResults')}
        </span>
        <button
          type="button"
          className={`code-editor-findbar-toggle ${searchCaseSensitive ? 'is-active' : ''}`}
          onClick={onToggleSearchCaseSensitive}
          title={t('common.matchCase')}
          aria-pressed={searchCaseSensitive}
        >
          Aa
        </button>
        <button
          type="button"
          className={`code-editor-findbar-toggle ${searchWholeWord ? 'is-active' : ''}`}
          onClick={onToggleSearchWholeWord}
          title={t('common.matchWholeWord')}
          aria-pressed={searchWholeWord}
        >
          ab
        </button>
        <button
          type="button"
          className={`code-editor-findbar-toggle ${searchRegex ? 'is-active' : ''}`}
          onClick={onToggleRegex}
          title={t('common.useRegularExpression')}
          aria-pressed={searchRegex}
        >
          .*
        </button>
        <button
          type="button"
          className="code-editor-findbar-icon-btn"
          onClick={onGoToPreviousMatch}
          title={t('codeWorkspace.previousMatch')}
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="code-editor-findbar-icon-btn"
          onClick={onGoToNextMatch}
          title={t('codeWorkspace.nextMatch')}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={`code-editor-findbar-icon-btn ${searchMode === 'replace' ? 'is-active' : ''}`}
          onClick={onToggleReplaceMode}
          title={searchMode === 'replace' ? t('common.hideReplace') : t('common.showReplace')}
        >
          <Replace className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="code-editor-findbar-icon-btn"
          onClick={onClose}
          title={t('common.close')}
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
            placeholder={t('codeWorkspace.replace')}
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
            {t('codeWorkspace.replace')}
          </button>
          <button
            type="button"
            className="code-editor-findbar-action-btn"
            onClick={onReplaceAllMatches}
            disabled={searchMatchCount <= 0}
          >
            {t('common.replaceAll')}
          </button>
        </div>
      )}
    </div>
  )
}
