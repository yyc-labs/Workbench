import { memo, type Ref } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import { Check, ChevronDown, ChevronUp, Code2, Columns2, Copy, Eye, RefreshCw, X } from 'lucide-react'
import { ModalShell } from '../../components/ModalShell'
import { useScrollableContentCapture } from '../../hooks/useScrollableContentCapture'
import { useI18n } from '../../i18n'
import { MonacoCodeEditor, type MonacoCodeEditorHandle, type MonacoEditorScrollState } from './MonacoCodeEditor'
import { transformMarkdownUrl } from './code.markdown'
import { remarkBoxDrawingTables } from './code.markdownBoxTables'
import type { ParsedMarkdownDocument } from './code.frontmatterParser'
import type { MarkdownPreviewMode } from './code.workspace.types'

type MarkdownStructuredPreviewState = {
  kind: 'table' | 'box-flow' | 'vertical-flow' | 'box-diagram' | 'architecture-diagram'
  startLine: number
  endLine: number
  markdown: string
}

const StructuredPreviewMarkdown = memo(function StructuredPreviewMarkdown({
  contentRef,
  markdown,
  components,
}: {
  contentRef?: Ref<HTMLElement>
  markdown: string
  components: Components
}) {
  return (
    <article
      ref={contentRef}
      className="code-markdown-content code-markdown-content--modal transcript-markdown-content px-5 py-8"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBoxDrawingTables]}
        components={components}
        urlTransform={transformMarkdownUrl}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  )
})

function formatStructuredBlockKind(kind: MarkdownStructuredPreviewState['kind']): string {
  switch (kind) {
    case 'box-flow':
      return 'Flow'
    case 'vertical-flow':
      return 'Vertical Flow'
    case 'table':
      return 'Table'
    case 'box-diagram':
      return 'Diagram'
    case 'architecture-diagram':
      return 'Architecture Diagram'
    default:
      return 'Structured Block'
  }
}

type CodeWorkspaceEditorPaneProps = {
  activeLanguage: string | null
  activeRelativePath: string | null
  closeStructuredPreview: () => void
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
  structuredPreview: MarkdownStructuredPreviewState | null
  structuredPreviewComponents: Components
  viewMode: 'files' | 'search'
}

export function CodeWorkspaceEditorPane({
  activeLanguage,
  activeRelativePath,
  closeStructuredPreview,
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
  structuredPreview,
  structuredPreviewComponents,
  viewMode,
}: CodeWorkspaceEditorPaneProps) {
  const { t } = useI18n()
  const structuredPreviewCapture = useScrollableContentCapture()

  const structuredPreviewCaptureLabel = structuredPreviewCapture.status === 'running'
    ? t('transcript.copyStructuredPreviewImageRunning')
    : structuredPreviewCapture.status === 'success'
      ? t('transcript.copyStructuredPreviewImageCopied')
      : structuredPreviewCapture.status === 'error'
        ? t('transcript.copyStructuredPreviewImageFailed')
        : t('transcript.copyStructuredPreviewImage')

  if (!activeRelativePath) {
    return (
      <div className="code-panel-empty">
        <div className="text-sm text-[color:var(--color-muted-foreground)]">
          {isNarrowViewport
            ? (viewMode === 'search' ? t('codeWorkspace.emptySearchNarrow') : t('codeWorkspace.emptyExplorerNarrow'))
            : (viewMode === 'search'
              ? t('codeWorkspace.emptySearchWide')
              : t('codeWorkspace.emptyExplorerWide'))}
        </div>
      </div>
    )
  }

  return (
    <div className="code-editor-shell">
      {isMarkdownFile && (
        <div className="code-editor-preview-toolbar">
          <span className="text-[11px] text-[color:var(--color-muted-foreground)]">{t('codeWorkspace.markdown')}</span>
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
              title={t('codeWorkspace.editor')}
            >
              <Code2 className="h-3.5 w-3.5" />
              {t('codeWorkspace.editor')}
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
              title={t('codeWorkspace.preview')}
            >
              <Eye className="h-3.5 w-3.5" />
              {t('codeWorkspace.preview')}
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
              title={isNarrowViewport ? t('codeWorkspace.splitWideOnly') : t('codeWorkspace.splitView')}
              disabled={isNarrowViewport}
            >
              <Columns2 className="h-3.5 w-3.5" />
              {t('codeWorkspace.split')}
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
            className="code-editor-pane code-editor-pane--preview code-markdown-preview-scroll-root"
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
                    placeholder={t('codeWorkspace.findInPreview')}
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
                      : t('codeWorkspace.noResults')}
                  </span>
                  <button
                    type="button"
                    className="code-editor-findbar-icon-btn"
                    onClick={onGoToPreviousPreviewSearchMatch}
                    title={t('codeWorkspace.previousMatch')}
                    disabled={previewSearchMatches.length <= 0}
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="code-editor-findbar-icon-btn"
                    onClick={onGoToNextPreviewSearchMatch}
                    title={t('codeWorkspace.nextMatch')}
                    disabled={previewSearchMatches.length <= 0}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="code-editor-findbar-icon-btn"
                    onClick={onClosePreviewSearch}
                    title={t('common.close')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
            <article className="code-markdown-content code-markdown-content--viewport-scroll">
              {isMdcFile && parsedMarkdownDoc?.ruleMetadata && (
                <section className="code-mdc-meta-card">
                  <h3 className="code-mdc-meta-title">{t('codeWorkspace.agentRuleMetadata')}</h3>
                  <div className="code-mdc-meta-grid">
                    <span className="code-mdc-meta-key">{t('codeWorkspace.metadataType')}</span>
                    <span className="code-mdc-meta-value">{parsedMarkdownDoc.ruleMetadata.ruleType}</span>

                    <span className="code-mdc-meta-key">{t('codeWorkspace.metadataAlwaysApply')}</span>
                    <span className="code-mdc-meta-value">{parsedMarkdownDoc.ruleMetadata.alwaysApply ? 'true' : 'false'}</span>

                    <span className="code-mdc-meta-key">{t('codeWorkspace.metadataDescription')}</span>
                    <span className="code-mdc-meta-value">
                      {parsedMarkdownDoc.ruleMetadata.description?.trim() || t('codeWorkspace.metadataNotAvailable')}
                    </span>

                    <span className="code-mdc-meta-key">{t('codeWorkspace.metadataGlobs')}</span>
                    <span className="code-mdc-meta-value">
                      {parsedMarkdownDoc.ruleMetadata.globs.length > 0
                        ? parsedMarkdownDoc.ruleMetadata.globs.join(', ')
                        : t('codeWorkspace.metadataNotAvailable')}
                    </span>
                  </div>
                </section>
              )}
              {!isMdcFile && parsedMarkdownDoc?.markdownMetadata && (
                <section className="code-mdc-meta-card">
                  <h3 className="code-mdc-meta-title">{t('codeWorkspace.documentMetadata')}</h3>
                  <div className="code-mdc-meta-grid">
                    <span className="code-mdc-meta-key">{t('codeWorkspace.metadataTitle')}</span>
                    <span className="code-mdc-meta-value">
                      {parsedMarkdownDoc.markdownMetadata.title?.trim() || t('codeWorkspace.metadataNotAvailable')}
                    </span>

                    <span className="code-mdc-meta-key">{t('codeWorkspace.metadataDescription')}</span>
                    <span className="code-mdc-meta-value">
                      {parsedMarkdownDoc.markdownMetadata.description?.trim() || t('codeWorkspace.metadataNotAvailable')}
                    </span>
                  </div>
                </section>
              )}
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBoxDrawingTables]}
                components={markdownComponents}
                urlTransform={transformMarkdownUrl}
              >
                {markdownPreviewContent}
              </ReactMarkdown>
            </article>
          </div>
        )}
      </div>

      <ModalShell
        open={Boolean(structuredPreview)}
        onClose={closeStructuredPreview}
        widthClassName="max-w-[min(1280px,calc(100vw-40px))]"
        baseZIndex={1180}
        ariaLabel={t('codeWorkspace.structuredPreviewAria')}
        overlayClassName="backdrop-blur-0 bg-black/18"
        panelClassName="transcript-structured-preview-modal p-4 sm:p-5"
      >
        <div className="relative flex max-h-[min(88vh,980px)] min-h-0 flex-col">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="section-label mb-1">{t('codeWorkspace.markdown')}</p>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-[color:var(--color-foreground)]">
                  {structuredPreview ? formatStructuredBlockKind(structuredPreview.kind) : t('codeWorkspace.structuredPreviewTitle')}
                </p>
                {structuredPreview && (
                  <span className="rounded-full border border-[color:var(--color-border)] px-2.5 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)]">
                    {t('transcript.lineRange', { start: structuredPreview.startLine, end: structuredPreview.endLine })}
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11px] text-[color:var(--color-muted-foreground)]">
                {t('transcript.structuredPreviewHint')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={`quiet-control inline-flex h-8 items-center gap-1.5 rounded-full border-0 px-3 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  structuredPreviewCapture.status === 'success'
                    ? 'text-[color:var(--color-success)]'
                    : structuredPreviewCapture.status === 'error'
                      ? 'text-[color:var(--color-destructive)]'
                      : 'text-[color:var(--color-foreground)]'
                }`}
                onClick={() => {
                  void structuredPreviewCapture.capture()
                }}
                title={structuredPreviewCaptureLabel}
                disabled={structuredPreviewCapture.status === 'running'}
              >
                {structuredPreviewCapture.status === 'running' ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : structuredPreviewCapture.status === 'success' ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span>{structuredPreviewCaptureLabel}</span>
              </button>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                onClick={closeStructuredPreview}
                title={t('common.close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div
            ref={structuredPreviewCapture.targetRef}
            className="min-h-0 flex-1 overflow-auto rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-background-subtle)]"
          >
            <StructuredPreviewMarkdown
              contentRef={structuredPreviewCapture.contentRef}
              markdown={structuredPreview?.markdown ?? ''}
              components={structuredPreviewComponents}
            />
          </div>
        </div>
      </ModalShell>
    </div>
  )
}
