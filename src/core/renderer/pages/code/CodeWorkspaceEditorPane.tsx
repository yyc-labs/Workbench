import type { Ref } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import { ChevronDown, ChevronUp, Code2, Columns2, Eye, X } from 'lucide-react'
import { MonacoCodeEditor, type MonacoCodeEditorHandle, type MonacoEditorScrollState } from './MonacoCodeEditor'
import { transformMarkdownUrl } from './code.markdown'
import type { ParsedMarkdownDocument } from './code.frontmatterParser'
import type { MarkdownPreviewMode } from './code.workspace.types'

type CodeWorkspaceEditorPaneProps = {
  activeLanguage: string | null
  activeRelativePath: string | null
  editorRef: Ref<MonacoCodeEditorHandle>
  editorValue: string
  effectiveMarkdownPreviewMode: MarkdownPreviewMode
  handlePasteImage: (file: File | null, clipboardEvent?: ClipboardEvent) => Promise<string | null>
  isMdcFile: boolean
  isMarkdownFile: boolean
  isNarrowViewport: boolean
  markdownComponents: Components
  markdownPreviewContent: string
  monacoTheme: 'vs' | 'vs-dark'
  onCaptureCurrentModeScroll: () => void
  onChangeEditorValue: (value: string) => void
  onClosePreviewSearch: () => void
  onEditorScrollStateChange: (state: MonacoEditorScrollState) => void
  onFocusSearch: () => void
  onGoToNextPreviewSearchMatch: () => void
  onGoToPreviousPreviewSearchMatch: () => void
  onHandleSave: () => void
  onPreviewScroll: () => void
  onSetActivePreviewSearchMatchIndex: React.Dispatch<React.SetStateAction<number>>
  onSetCursorPosition: (position: { lineNumber: number; column: number }) => void
  onSetMarkdownPreviewMode: React.Dispatch<React.SetStateAction<MarkdownPreviewMode>>
  onSetPreviewSearchQuery: React.Dispatch<React.SetStateAction<string>>
  parsedMarkdownDoc: ParsedMarkdownDocument | null
  previewScrollRef: Ref<HTMLDivElement>
  previewSearchInputRef: Ref<HTMLInputElement>
  previewSearchMatches: Array<unknown>
  previewSearchQuery: string
  previewSearchVisible: boolean
  previewSearchMatchIndex: number
  viewMode: 'files' | 'search'
}

export function CodeWorkspaceEditorPane({
  activeLanguage,
  activeRelativePath,
  editorRef,
  editorValue,
  effectiveMarkdownPreviewMode,
  handlePasteImage,
  isMdcFile,
  isMarkdownFile,
  isNarrowViewport,
  markdownComponents,
  markdownPreviewContent,
  monacoTheme,
  onCaptureCurrentModeScroll,
  onChangeEditorValue,
  onClosePreviewSearch,
  onEditorScrollStateChange,
  onFocusSearch,
  onGoToNextPreviewSearchMatch,
  onGoToPreviousPreviewSearchMatch,
  onHandleSave,
  onPreviewScroll,
  onSetActivePreviewSearchMatchIndex,
  onSetCursorPosition,
  onSetMarkdownPreviewMode,
  onSetPreviewSearchQuery,
  parsedMarkdownDoc,
  previewScrollRef,
  previewSearchInputRef,
  previewSearchMatches,
  previewSearchQuery,
  previewSearchVisible,
  previewSearchMatchIndex,
  viewMode,
}: CodeWorkspaceEditorPaneProps) {
  if (!activeRelativePath) {
    return (
      <div className="code-panel-empty">
        <div className="text-sm text-[color:var(--color-muted-foreground)]">
          {isNarrowViewport
            ? (viewMode === 'search' ? 'Open Search to choose a match.' : 'Open Explorer to choose a file.')
            : (viewMode === 'search'
              ? 'Select a search result from the left panel to open and edit.'
              : 'Select a file from the left panel to start editing.')}
        </div>
      </div>
    )
  }

  return (
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
                onCaptureCurrentModeScroll()
                onSetMarkdownPreviewMode('edit')
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
                onCaptureCurrentModeScroll()
                onSetMarkdownPreviewMode('preview')
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
                onCaptureCurrentModeScroll()
                onSetMarkdownPreviewMode('split')
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
              onPasteImage={handlePasteImage}
              onChange={onChangeEditorValue}
              onScrollStateChange={onEditorScrollStateChange}
              onCursorPositionChange={onSetCursorPosition}
              onFocusSearch={onFocusSearch}
              onSave={onHandleSave}
            />
          </div>
        )}

        {(effectiveMarkdownPreviewMode === 'preview' || effectiveMarkdownPreviewMode === 'split') && (
          <div
            ref={previewScrollRef}
            className="code-editor-pane code-editor-pane--preview"
            onScroll={onPreviewScroll}
          >
            {previewSearchVisible && effectiveMarkdownPreviewMode === 'preview' && (
              <div className="code-editor-findbar code-editor-findbar--preview">
                <div className="code-editor-findbar-row">
                  <input
                    ref={previewSearchInputRef}
                    type="text"
                    value={previewSearchQuery}
                    onChange={(event) => {
                      onSetPreviewSearchQuery(event.target.value)
                      onSetActivePreviewSearchMatchIndex(0)
                    }}
                    placeholder="Find in preview"
                    className="code-editor-findbar-input"
                    spellCheck={false}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && event.shiftKey) {
                        event.preventDefault()
                        onGoToPreviousPreviewSearchMatch()
                        return
                      }
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        onGoToNextPreviewSearchMatch()
                        return
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        onClosePreviewSearch()
                      }
                    }}
                  />
                  <span className="code-editor-findbar-count">
                    {previewSearchMatches.length > 0
                      ? `${previewSearchMatchIndex + 1}/${previewSearchMatches.length}`
                      : 'No results'}
                  </span>
                  <button
                    type="button"
                    className="code-editor-findbar-icon-btn"
                    onClick={onGoToPreviousPreviewSearchMatch}
                    title="Previous Match"
                    disabled={previewSearchMatches.length <= 0}
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="code-editor-findbar-icon-btn"
                    onClick={onGoToNextPreviewSearchMatch}
                    title="Next Match"
                    disabled={previewSearchMatches.length <= 0}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="code-editor-findbar-icon-btn"
                    onClick={onClosePreviewSearch}
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
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
                urlTransform={transformMarkdownUrl}
              >
                {markdownPreviewContent}
              </ReactMarkdown>
            </article>
          </div>
        )}
      </div>
    </div>
  )
}
