import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, ExternalLink, FileCode2, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import type { ProjectCodeSession, TranscriptReference } from '../../../shared/types'
import { MonacoTextViewer, type MonacoTextViewerHandle } from '../../components/MonacoTextViewer'
import { useI18n } from '../../i18n'
import { middleTruncatePath } from '../../lib/projectDisplay'
import { inferLanguageFromRelativePath } from '../code/code.helpers'

type TranscriptReferenceDrawerProps = {
  open: boolean
  baseZIndex?: number
  projectPath: string
  projectName: string
  reference: TranscriptReference | null
  currentCodeSession?: ProjectCodeSession
  onClose: () => void
  onOpenInCodeWorkspace: (payload: {
    relativePath: string
    lineNumber: number
    column: number
  }) => Promise<void> | void
}

type DrawerState = 'idle' | 'loading' | 'ready' | 'not-found' | 'error'

const DRAWER_TRANSITION_MS = 220
const DRAWER_CONTENT_REVEAL_MS = 80
const REFERENCE_CONTEXT_BEFORE_LINES = 50
const REFERENCE_CONTEXT_AFTER_LINES = 150

function buildReferenceLabel(reference: TranscriptReference): string {
  const line = reference.lineNumber ?? 1
  const column = reference.column ? `:${reference.column}` : ''
  return `${reference.relativePath}:${line}${column}`
}

function isFileNotFoundError(message: string): boolean {
  const normalized = message.toLowerCase()
  return normalized.includes('enoent')
    || normalized.includes('no such file')
    || normalized.includes('cannot find')
}

function buildReferencePreview(
  content: string,
  targetLineNumber: number
): {
  previewText: string
  previewStartLine: number
  previewEndLine: number
  relativeRevealLine: number
} {
  const lines = content.split('\n')
  const safeTargetLine = Math.min(
    Math.max(1, Math.floor(targetLineNumber)),
    Math.max(1, lines.length)
  )
  const previewStartLine = Math.max(1, safeTargetLine - REFERENCE_CONTEXT_BEFORE_LINES)
  const previewEndLine = Math.min(lines.length, safeTargetLine + REFERENCE_CONTEXT_AFTER_LINES)
  const previewText = lines.slice(previewStartLine - 1, previewEndLine).join('\n')
  return {
    previewText,
    previewStartLine,
    previewEndLine,
    relativeRevealLine: safeTargetLine - previewStartLine + 1,
  }
}

export function TranscriptReferenceDrawer({
  open,
  baseZIndex = 1150,
  projectPath,
  projectName,
  reference,
  currentCodeSession,
  onClose,
  onOpenInCodeWorkspace,
}: TranscriptReferenceDrawerProps) {
  const { t } = useI18n()
  const [shouldRender, setShouldRender] = useState(open)
  const [visible, setVisible] = useState(open)
  const [contentVisible, setContentVisible] = useState(open)
  const [status, setStatus] = useState<DrawerState>(() => (reference ? 'loading' : 'idle'))
  const [fileContent, setFileContent] = useState('')
  const [fileLanguage, setFileLanguage] = useState('plaintext')
  const [readError, setReadError] = useState<string | null>(null)
  const [isOpeningCodeWorkspace, setIsOpeningCodeWorkspace] = useState(false)
  const viewerRef = useRef<MonacoTextViewerHandle | null>(null)

  const filePathLabel = reference ? buildReferenceLabel(reference) : ''
  const lineNumber = reference?.lineNumber ?? 1
  const column = reference?.column ?? 1

  const knownOpenTabs = useMemo(() => {
    if (!currentCodeSession?.tabs?.length) return []
    return currentCodeSession.tabs.filter((item) => item.trim())
  }, [currentCodeSession?.tabs])

  const preview = useMemo(() => {
    if (!fileContent) {
      return {
        previewText: '',
        previewStartLine: lineNumber,
        previewEndLine: lineNumber,
        relativeRevealLine: 1,
      }
    }
    return buildReferencePreview(fileContent, lineNumber)
  }, [fileContent, lineNumber])

  useEffect(() => {
    if (open) {
      setShouldRender(true)
      setContentVisible(false)
      const enterTimer = window.setTimeout(() => setVisible(true), 16)
      const revealTimer = window.setTimeout(() => setContentVisible(true), DRAWER_CONTENT_REVEAL_MS)
      return () => {
        window.clearTimeout(enterTimer)
        window.clearTimeout(revealTimer)
      }
    }
    setContentVisible(false)
    setVisible(false)
    const closeTimer = window.setTimeout(() => setShouldRender(false), DRAWER_TRANSITION_MS)
    return () => {
      window.clearTimeout(closeTimer)
    }
  }, [open])

  useEffect(() => {
    if (!shouldRender) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose, shouldRender])

  useEffect(() => {
    if (!open || !reference) {
      setStatus(reference ? 'loading' : 'idle')
      setFileContent('')
      setReadError(null)
      return
    }

    let cancelled = false
    setStatus('loading')
    setFileContent('')
    setReadError(null)

    void window.electronAPI.readProjectFile(projectPath, reference.relativePath)
      .then((result) => {
        if (cancelled) return
        setFileContent(result.content)
        setFileLanguage(result.language || inferLanguageFromRelativePath(result.relativePath))
        setStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : String(error)
        setReadError(message)
        setStatus(isFileNotFoundError(message) ? 'not-found' : 'error')
      })

    return () => {
      cancelled = true
    }
  }, [open, projectPath, reference])

  useEffect(() => {
    if (!open || status !== 'ready' || !reference) return
    const timer = window.setTimeout(() => {
      viewerRef.current?.revealPosition(preview.relativeRevealLine, column, REFERENCE_CONTEXT_BEFORE_LINES)
      viewerRef.current?.highlightLine(preview.relativeRevealLine)
    }, 0)
    return () => {
      window.clearTimeout(timer)
    }
  }, [column, open, preview.relativeRevealLine, reference, status])

  if (!shouldRender || !reference) return null

  return createPortal(
    <div className="fixed inset-0 overflow-hidden" style={{ zIndex: baseZIndex }}>
      <button
        type="button"
        className={`absolute inset-0 bg-[color:var(--color-background-sunken)]/54 backdrop-blur-[5px] transition-opacity duration-200 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        aria-label={t('referenceDrawer.closeBackdrop')}
        onClick={onClose}
      />

      <aside
        className={`absolute inset-y-3 right-3 w-[min(980px,calc(100%-1.5rem))] overflow-hidden rounded-[26px] border border-[color:var(--color-border)] bg-[color:var(--color-popover)]/96 shadow-[0_28px_84px_rgba(15,15,20,0.34)] backdrop-blur-[26px] transition-[transform,opacity] duration-220 ease-out will-change-transform max-[920px]:left-3 max-[920px]:right-3 max-[920px]:w-auto ${
          visible ? 'translate-x-0 opacity-100' : 'translate-x-[32px] opacity-0'
        }`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('referenceDrawer.ariaLabel')}
      >
        <div className={`flex h-full min-h-0 flex-col transition-opacity duration-150 ${contentVisible ? 'opacity-100' : 'opacity-0'}`}>
          <div className="flex shrink-0 items-center justify-between border-b border-[color:var(--color-border)]/85 bg-[color:var(--color-card)]/62 px-5 py-4 backdrop-blur-[14px]">
            <div className="min-w-0">
              <p className="section-label">{t('referenceDrawer.title')}</p>
              <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">
                {projectName} · {middleTruncatePath(projectPath, 20, 18)}
              </p>
            </div>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background)]/80 text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
              onClick={onClose}
              title={t('common.close')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[color:var(--color-border)]/85 bg-[color:var(--color-background)]/72 px-5 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-medium text-[color:var(--color-muted-foreground)]">
                <FileCode2 className="h-3.5 w-3.5" />
                {t('referenceDrawer.projectFileReference')}
              </div>
              <p className="mt-1 truncate text-base font-semibold text-[color:var(--color-foreground)]">
                {filePathLabel}
              </p>
              <p className="mt-1 truncate text-[11px] text-[color:var(--color-muted-foreground)]">
                {reference.rawText}
              </p>
            </div>

            <button
              type="button"
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => {
                setIsOpeningCodeWorkspace(true)
                Promise.resolve(onOpenInCodeWorkspace({
                  relativePath: reference.relativePath,
                  lineNumber,
                  column,
                }))
                  .finally(() => setIsOpeningCodeWorkspace(false))
              }}
              disabled={isOpeningCodeWorkspace}
              title={t('referenceDrawer.openInCodeWorkspace')}
            >
              <ExternalLink className="h-4 w-4" />
              {isOpeningCodeWorkspace ? t('common.opening') : t('referenceDrawer.openInCodeWorkspace')}
            </button>
          </div>

          <div className="min-h-0 flex-1 p-3 sm:p-4">
            <div className="flex h-full min-h-0 flex-col rounded-[18px] border border-[color:var(--color-border)]/90 bg-[color:var(--color-background)]/76 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]">
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[color:var(--color-border)]/85 bg-[color:var(--color-card)]/54 px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-mono text-[12px] text-[color:var(--color-foreground)]">
                    {reference.relativePath}
                  </p>
                  <p className="text-[10.5px] text-[color:var(--color-muted-foreground)]">
                    {status === 'ready'
                      ? t('referenceDrawer.previewMeta', {
                        language: fileLanguage,
                        start: preview.previewStartLine,
                        end: preview.previewEndLine,
                        target: `${lineNumber}${reference.column ? `:${reference.column}` : ''}`,
                      })
                      : t('referenceDrawer.filePreviewLoading')}
                  </p>
                </div>
                {knownOpenTabs.length > 0 && (
                  <span className="shrink-0 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background-sunken)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted-foreground)]">
                    {t('referenceDrawer.rememberedTabs', { count: knownOpenTabs.length })}
                  </span>
                )}
              </div>

              <div className="min-h-0 flex-1">
                {status === 'loading' && (
                  <div className="flex h-full items-center justify-center gap-2 text-[11px] text-[color:var(--color-muted-foreground)]">
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    {t('referenceDrawer.loadingPreview')}
                  </div>
                )}

                {status === 'not-found' && (
                  <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                    <TriangleAlert className="h-10 w-10 text-[color:var(--color-warning)]" />
                    <div>
                      <p className="text-sm font-medium text-[color:var(--color-foreground)]">{t('referenceDrawer.fileNotFound')}</p>
                      <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
                        {t('referenceDrawer.fileNotFoundHint')}
                      </p>
                      {readError && (
                        <p className="mt-2 text-[11px] text-[color:var(--color-muted-foreground)]">
                          {readError}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {status === 'error' && (
                  <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                    <AlertCircle className="h-10 w-10 text-[color:var(--color-destructive)]" />
                    <div>
                      <p className="text-sm font-medium text-[color:var(--color-foreground)]">{t('referenceDrawer.fileLoadError')}</p>
                      <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">
                        {t('referenceDrawer.fileLoadErrorHint')}
                      </p>
                      {readError && (
                        <p className="mt-2 text-[11px] text-[color:var(--color-destructive)]">
                          {readError}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {status === 'ready' && (
                  <MonacoTextViewer
                    ref={viewerRef}
                    value={preview.previewText}
                    filePath={reference.relativePath}
                    language={fileLanguage}
                    readOnly
                    focusOnReveal={false}
                    modelNamespace="transcript-reference-drawer"
                    stickyScroll
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>,
    document.body
  )
}
