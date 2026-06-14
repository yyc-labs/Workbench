import { memo, type Ref } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy, RefreshCw, X } from 'lucide-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { ModalShell } from '../../components/ModalShell'
import type {
  InterpolationValues,
  MessageKey,
  ResolvedLocale,
  SettingsSectionMessageKey,
} from '../../i18n/messages'
import {
  type MarkdownCodeBlockExpandPayload,
  type MarkdownStructuredBlockClickPayload,
  transformMarkdownUrl,
} from '../code/code.markdown'
import { remarkBoxDrawingTables } from '../code/code.markdownBoxTables'

export type TranscriptStructuredPreviewState = {
  kind: MarkdownStructuredBlockClickPayload['kind']
  startLine: number
  endLine: number
  markdown: string
}

export type TranscriptCodePreviewState = MarkdownCodeBlockExpandPayload

type CaptureState = {
  status: 'idle' | 'running' | 'success' | 'error'
  targetRef: Ref<HTMLDivElement>
  contentRef: Ref<HTMLElement>
  capture: () => Promise<boolean>
}

type TranscriptPreviewModalsProps = {
  structuredPreview: TranscriptStructuredPreviewState | null
  codePreview: TranscriptCodePreviewState | null
  structuredPreviewMarkdown: string
  structuredPreviewComponents: Components
  structuredPreviewCapture: CaptureState
  structuredPreviewCaptureLabel: string
  codePreviewCapture: CaptureState
  codePreviewCaptureLabel: string
  codePreviewLanguageLabel: string
  effectiveTheme: 'light' | 'dark'
  locale: ResolvedLocale
  t: (key: MessageKey | SettingsSectionMessageKey, values?: InterpolationValues) => string
  formatStructuredBlockKindLabel: (locale: ResolvedLocale, value: string) => string
  onCloseStructuredPreview: () => void
  onCloseCodePreview: () => void
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

function CaptureButton({
  label,
  status,
  onCapture,
}: {
  label: string
  status: CaptureState['status']
  onCapture: () => void
}) {
  return (
    <button
      type="button"
      className={`quiet-control inline-flex h-8 items-center gap-1.5 rounded-full border-0 px-3 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        status === 'success'
          ? 'text-[color:var(--color-success)]'
          : status === 'error'
            ? 'text-[color:var(--color-destructive)]'
            : 'text-[color:var(--color-foreground)]'
      }`}
      onClick={onCapture}
      title={label}
      disabled={status === 'running'}
    >
      {status === 'running' ? (
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
      ) : status === 'success' ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      <span>{label}</span>
    </button>
  )
}

export function TranscriptPreviewModals({
  structuredPreview,
  codePreview,
  structuredPreviewMarkdown,
  structuredPreviewComponents,
  structuredPreviewCapture,
  structuredPreviewCaptureLabel,
  codePreviewCapture,
  codePreviewCaptureLabel,
  codePreviewLanguageLabel,
  effectiveTheme,
  locale,
  t,
  formatStructuredBlockKindLabel,
  onCloseStructuredPreview,
  onCloseCodePreview,
}: TranscriptPreviewModalsProps) {
  return (
    <>
      <ModalShell
        open={Boolean(structuredPreview)}
        onClose={onCloseStructuredPreview}
        widthClassName="max-w-[min(1280px,calc(100vw-40px))]"
        baseZIndex={1180}
        ariaLabel={t('transcript.structuredPreview')}
        overlayClassName="backdrop-blur-0 bg-black/18"
        panelClassName="transcript-structured-preview-modal p-4 sm:p-5"
      >
        <div className="relative flex max-h-[min(88vh,980px)] min-h-0 flex-col">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="section-label mb-1">{t('transcript.listTitle')}</p>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-[color:var(--color-foreground)]">
                  {structuredPreview ? formatStructuredBlockKindLabel(locale, structuredPreview.kind) : formatStructuredBlockKindLabel(locale, 'default')}
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
              <CaptureButton
                label={structuredPreviewCaptureLabel}
                status={structuredPreviewCapture.status}
                onCapture={() => {
                  void structuredPreviewCapture.capture()
                }}
              />
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                onClick={onCloseStructuredPreview}
                title={t('common.close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div
            ref={structuredPreviewCapture.targetRef}
            data-capture-surface="structured-preview"
            className="min-h-0 flex-1 overflow-auto rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-background-subtle)]"
          >
            <StructuredPreviewMarkdown
              contentRef={structuredPreviewCapture.contentRef}
              markdown={structuredPreviewMarkdown}
              components={structuredPreviewComponents}
            />
          </div>
        </div>
      </ModalShell>

      <ModalShell
        open={Boolean(codePreview)}
        onClose={onCloseCodePreview}
        widthClassName="max-w-[min(1280px,calc(100vw-40px))]"
        baseZIndex={1180}
        ariaLabel={t('codeMarkdown.previewAria')}
        overlayClassName="backdrop-blur-0 bg-black/18"
        panelClassName="code-markdown-code-preview-modal p-4 sm:p-5"
      >
        <div className="relative flex max-h-[min(88vh,980px)] min-h-0 flex-col">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="section-label mb-1">{t('codeWorkspace.markdown')}</p>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-[color:var(--color-foreground)]">
                  {t('codeMarkdown.previewTitle')}
                </p>
                {codePreview && (
                  <span className="rounded-full border border-[color:var(--color-border)] px-2.5 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)]">
                    {codePreviewLanguageLabel}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <CaptureButton
                label={codePreviewCaptureLabel}
                status={codePreviewCapture.status}
                onCapture={() => {
                  void codePreviewCapture.capture()
                }}
              />
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                onClick={onCloseCodePreview}
                title={t('common.close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div
            ref={codePreviewCapture.targetRef}
            className="min-h-0 flex-1 overflow-auto rounded-[20px] border border-[color:var(--color-border)] bg-[color:var(--color-background-subtle)]"
          >
            <article
              ref={codePreviewCapture.contentRef}
              className="code-markdown-content code-markdown-content--modal code-markdown-code-preview-content px-5 py-6"
            >
              {codePreview ? (
                <SyntaxHighlighter
                  language={codePreview.language}
                  style={effectiveTheme === 'dark' ? oneDark : oneLight}
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
    </>
  )
}
