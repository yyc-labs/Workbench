import { memo, type Ref, type RefObject } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import { Check, ChevronDown, ChevronUp, Code2, Columns2, Copy, Eye, FileText, MessageSquareText, RefreshCw, X } from 'lucide-react'
import type { ProjectFileNodeKind } from '../../../shared/types'
import type { TranscriptFileReference } from '../../../shared/types'
import type { ProjectFilePreviewKind } from '../../../shared/types'
import { ModalShell } from '../../components/ModalShell'
import { Tooltip } from '../../components/ui/tooltip'
import { ZoomPanViewport } from '../../components/ZoomPanViewport'
import { useScrollableContentCapture } from '../../hooks/useScrollableContentCapture'
import { useI18n } from '../../i18n'
import { MonacoCodeEditor, type MonacoCodeEditorHandle, type MonacoEditorScrollState } from './MonacoCodeEditor'
import { formatCodeLanguageLabel } from './code.markdown'
import { transformMarkdownUrl } from './code.markdownUrls'
import { remarkBoxDrawingTables } from './code.markdownBoxTables'
import { MarkdownPreviewSurface } from './MarkdownPreviewSurface'
import { MarkdownPreviewVisibilityProvider } from './code.markdownVisibility'
import type { ParsedMarkdownDocument } from './code.frontmatterParser'
import type { MarkdownPreviewMode } from './code.workspace.types'
import { buildYycWorkbenchPreviewUrl } from './code.helpers'
import { FileCsvViewer } from './viewers/FileCsvViewer'
import { FileExcludedViewer } from './viewers/FileExcludedViewer'
import { FileHtmlViewer } from './viewers/FileHtmlViewer'
import { FileImageViewer } from './viewers/FileImageViewer'
import { FileMediaViewer } from './viewers/FileMediaViewer'
import { FilePdfViewer } from './viewers/FilePdfViewer'
import { FileUnsupportedViewer } from './viewers/FileUnsupportedViewer'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'

type MarkdownStructuredPreviewState = {
  kind: 'table' | 'box-flow' | 'vertical-flow' | 'box-diagram' | 'mermaid' | 'architecture-diagram'
  startLine: number
  endLine: number
  markdown: string
}

type MarkdownCodePreviewState = {
  codeText: string
  language: string
}

const StructuredPreviewMarkdown = memo(function StructuredPreviewMarkdown({ contentRef, markdown, components }: { contentRef?: Ref<HTMLElement>; markdown: string; components: Components }) {
  return (
    <MarkdownPreviewVisibilityProvider forceRenderAllBlocks>
      <article ref={contentRef} className="code-markdown-content code-markdown-content--modal transcript-markdown-content px-5 py-8">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBoxDrawingTables]} components={components} urlTransform={transformMarkdownUrl}>
          {markdown}
        </ReactMarkdown>
      </article>
    </MarkdownPreviewVisibilityProvider>
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
    case 'mermaid':
      return 'Mermaid'
    case 'architecture-diagram':
      return 'Architecture Diagram'
    default:
      return 'Structured Block'
  }
}

type CodeWorkspaceEditorPaneProps = {
  activeLanguage: string | null
  activeRelativePath: string | null
  binaryDataUrl: string | null
  closeCodePreview: () => void
  closeStructuredPreview: () => void
  codePreview: MarkdownCodePreviewState | null
  editorRef: Ref<MonacoCodeEditorHandle>
  editorValue: string
  effectiveMarkdownPreviewMode: MarkdownPreviewMode
  excludedNodeKind: ProjectFileNodeKind
  fileKind: ProjectFilePreviewKind
  fileMtimeMs: number | null
  fileSize: number
  handlePasteImage: (file: File | null, clipboardEvent?: ClipboardEvent) => Promise<string | null>
  isInitialRestoring: boolean
  isMdcFile: boolean
  isMarkdownFile: boolean
  isNarrowViewport: boolean
  isReading: boolean
  markdownComponents: Components
  markdownPreviewContent: string
  isMarkdownPreviewStale: boolean
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
  onOpenSmartEmptyFile: (relativePath: string) => void
  onOpenTranscriptReference: (item: TranscriptFileReference) => void
  onOpenFile?: (relativePath: string) => void
  parsedMarkdownDoc: ParsedMarkdownDocument | null
  previewRootRef: RefObject<Element | null>
  previewScrollRef: Ref<HTMLDivElement>
  previewSearchInputRef: Ref<HTMLInputElement>
  previewSearchMatches: Array<unknown>
  previewSearchQuery: string
  previewSearchVisible: boolean
  previewSearchMatchIndex: number
  projectId: string
  projectPath: string
  smartEmptyFiles: string[]
  structuredPreview: MarkdownStructuredPreviewState | null
  structuredPreviewComponents: Components
  transcriptReferences: TranscriptFileReference[]
  viewMode: 'files' | 'search'
}

export const CodeWorkspaceEditorPane = memo(function CodeWorkspaceEditorPane({
  activeLanguage,
  activeRelativePath,
  binaryDataUrl,
  closeCodePreview,
  closeStructuredPreview,
  codePreview,
  editorRef,
  editorValue,
  effectiveMarkdownPreviewMode,
  excludedNodeKind,
  fileKind,
  fileMtimeMs,
  fileSize,
  handlePasteImage,
  isInitialRestoring,
  isMdcFile,
  isMarkdownFile,
  isNarrowViewport,
  isReading,
  markdownComponents,
  markdownPreviewContent,
  isMarkdownPreviewStale,
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
  onOpenSmartEmptyFile,
  onOpenTranscriptReference,
  onOpenFile,
  parsedMarkdownDoc,
  previewRootRef,
  previewScrollRef,
  previewSearchInputRef,
  previewSearchMatches,
  previewSearchQuery,
  previewSearchVisible,
  previewSearchMatchIndex,
  projectId,
  projectPath,
  smartEmptyFiles,
  structuredPreview,
  structuredPreviewComponents,
  transcriptReferences,
  viewMode,
}: CodeWorkspaceEditorPaneProps) {
  const { t } = useI18n()
  const structuredPreviewCapture = useScrollableContentCapture()
  const codePreviewCapture = useScrollableContentCapture()
  const codePreviewLanguageLabel = codePreview ? formatCodeLanguageLabel(codePreview.language, t) : ''

  const structuredPreviewCaptureLabel =
    structuredPreviewCapture.status === 'running'
      ? t('transcript.copyStructuredPreviewImageRunning')
      : structuredPreviewCapture.status === 'success'
        ? t('transcript.copyStructuredPreviewImageCopied')
        : structuredPreviewCapture.status === 'error'
          ? t('transcript.copyStructuredPreviewImageFailed')
          : t('transcript.copyStructuredPreviewImage')
  const codePreviewCaptureLabel =
    codePreviewCapture.status === 'running'
      ? t('transcript.copyStructuredPreviewImageRunning')
      : codePreviewCapture.status === 'success'
        ? t('transcript.copyStructuredPreviewImageCopied')
        : codePreviewCapture.status === 'error'
          ? t('transcript.copyStructuredPreviewImageFailed')
          : t('transcript.copyStructuredPreviewImage')

  if (isInitialRestoring) {
    return (
      <div className="code-panel-empty px-6">
        <div className="text-center text-sm text-[color:var(--color-muted-foreground)]">{t('codeWorkspace.readingFile')}</div>
      </div>
    )
  }

  if (!activeRelativePath) {
    return (
      <div className="code-panel-empty px-6">
        <div className="text-center text-sm text-[color:var(--color-muted-foreground)]">{isNarrowViewport ? (viewMode === 'search' ? t('codeWorkspace.emptySearchNarrow') : t('codeWorkspace.emptyExplorerNarrow')) : viewMode === 'search' ? t('codeWorkspace.emptySearchWide') : t('codeWorkspace.emptyExplorerWide')}</div>
        {smartEmptyFiles.length > 0 && (
          <div className="mt-5 w-full max-w-[520px]">
            <p className="mb-2 text-center text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">{t('codeWorkspace.smartOpen')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {smartEmptyFiles.map((path) => (
                <button key={path} type="button" className="min-w-0 rounded-[12px] border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 py-2 text-left transition-colors hover:bg-[color:var(--color-accent)]" onClick={() => onOpenSmartEmptyFile(path)} title={path}>
                  <span className="flex min-w-0 items-center gap-2">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted-foreground)]" />
                    <span className="truncate font-mono text-[12px] text-[color:var(--color-foreground)]">{path}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="code-editor-shell relative">
      {isReading && activeRelativePath && (
        <div className="pointer-events-none absolute right-3 top-2 z-20 flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background)]/85 px-2.5 py-1 text-[11px] text-[color:var(--color-muted-foreground)] backdrop-blur-sm">
          <RefreshCw className="h-3 w-3 animate-spin" />
          {t('codeWorkspace.readingFile')}
        </div>
      )}
      {transcriptReferences.length > 0 && (
        <div className="mb-2 flex shrink-0 flex-nowrap items-center gap-2 overflow-hidden rounded-[14px] border border-[color:var(--color-border)] bg-[color:var(--color-background)]/78 px-3 py-2">
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-[color:var(--color-muted-foreground)]">
            <MessageSquareText className="h-3.5 w-3.5" />
            {t('codeWorkspace.transcriptRefs', { count: transcriptReferences.length })}
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap">
            {transcriptReferences.slice(0, 3).map((item) => (
              <button
                key={`${item.transcriptId}:${item.reference.id}`}
                type="button"
                className="inline-flex max-w-[240px] items-center gap-1.5 truncate rounded-full border border-[color:var(--color-border)] px-2.5 py-1 text-[11px] text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
                onClick={() => onOpenTranscriptReference(item)}
                title={`${item.transcriptTitle} · ${item.reference.relativePath}:${item.reference.lineNumber ?? 1}`}
              >
                <span className="truncate">{item.transcriptTitle}</span>
                <span className="shrink-0 text-[color:var(--color-muted-foreground)]">:{item.reference.lineNumber ?? 1}</span>
              </button>
            ))}
            {transcriptReferences.length > 3 && (
              <Tooltip
                side="bottom"
                align="end"
                interactive
                delayMs={120}
                className="inline-flex w-11 shrink-0 justify-center"
                contentClassName="p-1.5"
                content={
                  <div className="flex max-h-[60vh] min-w-[64px] flex-col gap-0.5 overflow-y-auto">
                    {transcriptReferences.slice(3).map((item) => (
                      <button
                        key={`${item.transcriptId}:${item.reference.id}`}
                        type="button"
                        className="rounded-md px-2 py-1 text-center text-[12px] text-[color:var(--color-popover-foreground)] transition-colors hover:bg-[color:var(--color-accent)]"
                        onClick={() => onOpenTranscriptReference(item)}
                        title={`${item.transcriptTitle} · ${item.reference.relativePath}:${item.reference.lineNumber ?? 1}`}
                      >
                        {item.reference.lineNumber ?? 1}
                      </button>
                    ))}
                  </div>
                }
              >
                <span className="shrink-0 text-[11px] text-[color:var(--color-muted-foreground)]">…+{transcriptReferences.length - 3}</span>
              </Tooltip>
            )}
          </div>
        </div>
      )}
      {isMarkdownFile && (
        <div className="code-editor-preview-toolbar">
          <span className="text-[11px] text-[color:var(--color-muted-foreground)]">{t('codeWorkspace.markdown')}</span>
          {isMarkdownPreviewStale && (
            <span className="text-[11px] text-[color:var(--color-muted-foreground)]" role="status">
              {t('codeWorkspace.previewUpdating')}
            </span>
          )}
          <div className="code-editor-preview-mode-group">
            <button
              type="button"
              className={`code-editor-preview-mode-btn ${effectiveMarkdownPreviewMode === 'edit' ? 'is-active' : ''}`}
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
              className={`code-editor-preview-mode-btn ${effectiveMarkdownPreviewMode === 'preview' ? 'is-active' : ''}`}
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
              className={`code-editor-preview-mode-btn ${effectiveMarkdownPreviewMode === 'split' ? 'is-active' : ''}`}
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

      <div className={`code-editor-content ${effectiveMarkdownPreviewMode === 'split' ? 'code-editor-content--split' : 'code-editor-content--single'}`}>
        {effectiveMarkdownPreviewMode !== 'preview' && (
          <div className={`code-editor-pane ${effectiveMarkdownPreviewMode === 'split' ? 'code-editor-pane--split' : ''}`}>
            {fileKind === 'image' && binaryDataUrl ? (
              <FileImageViewer src={binaryDataUrl} projectPath={projectPath} relativePath={activeRelativePath} />
            ) : fileKind === 'pdf' && binaryDataUrl ? (
              <FilePdfViewer src={binaryDataUrl} projectPath={projectPath} relativePath={activeRelativePath} />
            ) : fileKind === 'html' ? (
              <FileHtmlViewer previewUrl={buildYycWorkbenchPreviewUrl(projectId, activeRelativePath, monacoTheme === 'vs-dark' ? 'dark' : 'light')} sourceHtml={editorValue} projectPath={projectPath} relativePath={activeRelativePath} monacoTheme={monacoTheme} activeLanguage={activeLanguage} />
            ) : fileKind === 'video' && binaryDataUrl ? (
              <FileMediaViewer dataUrl={binaryDataUrl} kind="video" projectPath={projectPath} relativePath={activeRelativePath} />
            ) : fileKind === 'audio' && binaryDataUrl ? (
              <FileMediaViewer dataUrl={binaryDataUrl} kind="audio" projectPath={projectPath} relativePath={activeRelativePath} />
            ) : fileKind === 'csv' ? (
              <FileCsvViewer sourceText={editorValue} projectPath={projectPath} relativePath={activeRelativePath} monacoTheme={monacoTheme} />
            ) : fileKind === 'unsupported' ? (
              <FileUnsupportedViewer size={fileSize} mtimeMs={fileMtimeMs ?? 0} projectPath={projectPath} relativePath={activeRelativePath} />
            ) : fileKind === 'excluded' ? (
              <FileExcludedViewer nodeKind={excludedNodeKind} projectPath={projectPath} relativePath={activeRelativePath} />
            ) : (
              <MonacoCodeEditor
                ref={editorRef}
                filePath={activeRelativePath}
                projectPath={projectPath}
                value={editorValue}
                language={activeLanguage || 'plaintext'}
                theme={monacoTheme}
                onOpenFile={onOpenFile}
                onPasteImage={handlePasteImage}
                onChange={onChangeEditorValue}
                onScrollStateChange={onEditorScrollStateChange}
                onCursorPositionChange={onSetCursorPosition}
                onFocusSearch={onFocusSearch}
                onSave={onHandleSave}
              />
            )}
          </div>
        )}

        {(effectiveMarkdownPreviewMode === 'preview' || effectiveMarkdownPreviewMode === 'split') && (
          <div ref={previewScrollRef} className="code-editor-pane code-editor-pane--preview code-markdown-preview-scroll-root" onScroll={onPreviewScroll}>
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
                  <span className="code-editor-findbar-count">{previewSearchMatches.length > 0 ? `${previewSearchMatchIndex + 1}/${previewSearchMatches.length}` : t('codeWorkspace.noResults')}</span>
                  <button type="button" className="code-editor-findbar-icon-btn" onClick={onGoToPreviousPreviewSearchMatch} title={t('codeWorkspace.previousMatch')} disabled={previewSearchMatches.length <= 0}>
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" className="code-editor-findbar-icon-btn" onClick={onGoToNextPreviewSearchMatch} title={t('codeWorkspace.nextMatch')} disabled={previewSearchMatches.length <= 0}>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" className="code-editor-findbar-icon-btn" onClick={onClosePreviewSearch} title={t('common.close')}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
            <article className="code-markdown-content code-markdown-content--viewport-scroll code-markdown-content--performance">
              {isMdcFile && parsedMarkdownDoc?.ruleMetadata && (
                <section className="code-mdc-meta-card">
                  <h3 className="code-mdc-meta-title">{t('codeWorkspace.agentRuleMetadata')}</h3>
                  <div className="code-mdc-meta-grid">
                    <div className="code-mdc-meta-row">
                      <span className="code-mdc-meta-key">{t('codeWorkspace.metadataType')}</span>
                      <span className="code-mdc-meta-value">
                        <span className="code-mdc-meta-badge">{parsedMarkdownDoc.ruleMetadata.ruleType}</span>
                      </span>
                    </div>
                    <div className="code-mdc-meta-row">
                      <span className="code-mdc-meta-key">{t('codeWorkspace.metadataAlwaysApply')}</span>
                      <span className="code-mdc-meta-value">
                        <span className="code-mdc-meta-badge code-mdc-meta-badge--boolean">{parsedMarkdownDoc.ruleMetadata.alwaysApply ? 'true' : 'false'}</span>
                      </span>
                    </div>
                    <div className="code-mdc-meta-row">
                      <span className="code-mdc-meta-key">{t('codeWorkspace.metadataDescription')}</span>
                      <span className="code-mdc-meta-value">{parsedMarkdownDoc.ruleMetadata.description?.trim() || t('codeWorkspace.metadataNotAvailable')}</span>
                    </div>
                    <div className="code-mdc-meta-row">
                      <span className="code-mdc-meta-key">{t('codeWorkspace.metadataGlobs')}</span>
                      <span className="code-mdc-meta-value code-mdc-meta-value--mono">{parsedMarkdownDoc.ruleMetadata.globs.length > 0 ? parsedMarkdownDoc.ruleMetadata.globs.join(', ') : t('codeWorkspace.metadataNotAvailable')}</span>
                    </div>
                  </div>
                </section>
              )}
              {!isMdcFile && parsedMarkdownDoc?.markdownMetadata && (
                <section className="code-mdc-meta-card">
                  <h3 className="code-mdc-meta-title">{t('codeWorkspace.documentMetadata')}</h3>
                  <div className="code-mdc-meta-grid">
                    <div className="code-mdc-meta-row">
                      <span className="code-mdc-meta-key">{t('codeWorkspace.metadataTitle')}</span>
                      <span className="code-mdc-meta-value">{parsedMarkdownDoc.markdownMetadata.title?.trim() || t('codeWorkspace.metadataNotAvailable')}</span>
                    </div>
                    <div className="code-mdc-meta-row">
                      <span className="code-mdc-meta-key">{t('codeWorkspace.metadataDescription')}</span>
                      <span className="code-mdc-meta-value">{parsedMarkdownDoc.markdownMetadata.description?.trim() || t('codeWorkspace.metadataNotAvailable')}</span>
                    </div>
                  </div>
                </section>
              )}
              {parsedMarkdownDoc && parsedMarkdownDoc.customMetadata.length > 0 && (
                <section className="code-mdc-meta-card">
                  <h3 className="code-mdc-meta-title">{t('codeWorkspace.customMetadata')}</h3>
                  <div className="code-mdc-meta-grid">
                    {parsedMarkdownDoc.customMetadata.map((item) => (
                      <div className="code-mdc-meta-row" key={item.key}>
                        <span className="code-mdc-meta-key">{item.key}</span>
                        <span className="code-mdc-meta-value code-mdc-meta-value--mono">{item.value}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              <MarkdownPreviewSurface components={markdownComponents} content={markdownPreviewContent} previewRootRef={previewRootRef} />
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
        <div className="relative flex h-full min-h-0 flex-col">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="section-label mb-1">{t('codeWorkspace.markdown')}</p>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-[color:var(--color-foreground)]">{structuredPreview ? formatStructuredBlockKind(structuredPreview.kind) : t('codeWorkspace.structuredPreviewTitle')}</p>
                {structuredPreview && <span className="rounded-full border border-[color:var(--color-border)] px-2.5 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)]">{t('transcript.lineRange', { start: structuredPreview.startLine, end: structuredPreview.endLine })}</span>}
              </div>
              <p className="mt-1 text-[11px] text-[color:var(--color-muted-foreground)]">{t('transcript.structuredPreviewHint')}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={`quiet-control inline-flex h-8 items-center gap-1.5 rounded-full border-0 px-3 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  structuredPreviewCapture.status === 'success' ? 'text-[color:var(--color-success)]' : structuredPreviewCapture.status === 'error' ? 'text-[color:var(--color-destructive)]' : 'text-[color:var(--color-foreground)]'
                }`}
                onClick={() => {
                  void structuredPreviewCapture.capture()
                }}
                title={structuredPreviewCaptureLabel}
                disabled={structuredPreviewCapture.status === 'running'}
              >
                {structuredPreviewCapture.status === 'running' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : structuredPreviewCapture.status === 'success' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{structuredPreviewCaptureLabel}</span>
              </button>
              <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]" onClick={closeStructuredPreview} title={t('common.close')}>
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <ZoomPanViewport captureTargetRef={structuredPreviewCapture.targetRef} resetKey={structuredPreview?.markdown ?? ''}>
            <div data-capture-surface="structured-preview" className="transcript-preview-zoom-capture">
              <StructuredPreviewMarkdown contentRef={structuredPreviewCapture.contentRef} markdown={structuredPreview?.markdown ?? ''} components={structuredPreviewComponents} />
            </div>
          </ZoomPanViewport>
        </div>
      </ModalShell>

      <ModalShell open={Boolean(codePreview)} onClose={closeCodePreview} widthClassName="max-w-[min(1280px,calc(100vw-40px))]" baseZIndex={1180} ariaLabel={t('codeMarkdown.previewAria')} overlayClassName="backdrop-blur-0 bg-black/18" panelClassName="code-markdown-code-preview-modal p-4 sm:p-5">
        <div className="relative flex max-h-[min(88vh,980px)] min-h-0 flex-col">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="section-label mb-1">{t('codeWorkspace.markdown')}</p>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-[color:var(--color-foreground)]">{t('codeMarkdown.previewTitle')}</p>
                {codePreview && <span className="rounded-full border border-[color:var(--color-border)] px-2.5 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)]">{codePreviewLanguageLabel}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={`quiet-control inline-flex h-8 items-center gap-1.5 rounded-full border-0 px-3 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  codePreviewCapture.status === 'success' ? 'text-[color:var(--color-success)]' : codePreviewCapture.status === 'error' ? 'text-[color:var(--color-destructive)]' : 'text-[color:var(--color-foreground)]'
                }`}
                onClick={() => {
                  void codePreviewCapture.capture()
                }}
                title={codePreviewCaptureLabel}
                disabled={codePreviewCapture.status === 'running'}
              >
                {codePreviewCapture.status === 'running' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : codePreviewCapture.status === 'success' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{codePreviewCaptureLabel}</span>
              </button>
              <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]" onClick={closeCodePreview} title={t('common.close')}>
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div ref={codePreviewCapture.targetRef} className="min-h-0 flex-1 overflow-auto rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-background-subtle)]">
            <article ref={codePreviewCapture.contentRef} className="code-markdown-content code-markdown-content--modal code-markdown-code-preview-content px-5 py-6">
              {codePreview ? (
                <SyntaxHighlighter
                  language={codePreview.language}
                  style={monacoTheme === 'vs-dark' ? oneDark : oneLight}
                  PreTag="div"
                  className="code-markdown-syntax-block code-markdown-syntax-block--modal"
                  customStyle={{ margin: 0, borderRadius: 16, paddingTop: 16 }}
                  codeTagProps={{
                    style: {
                      fontFamily: "'JetBrains Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace",
                    },
                  }}
                >
                  {codePreview.codeText}
                </SyntaxHighlighter>
              ) : null}
            </article>
          </div>
        </div>
      </ModalShell>
    </div>
  )
})
