import { AlertCircle, ExternalLink, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { TranscriptSession } from '../../../shared/types'
import { useEffectiveTheme } from '../../hooks/useEffectiveTheme'
import { useI18n } from '../../i18n'
import { readMonacoEditorFontSizePreference } from '../../lib/monacoFontPreference'
import { useAppStore } from '../../stores/appStore'
import { createMarkdownComponents, shouldDisableMarkdownSyntaxHighlight } from './code.markdown'
import { remarkBoxDrawingTables } from './code.markdownBoxTables'
import { transformMarkdownUrl } from './code.markdownUrls'
import { MarkdownPreviewVisibilityProvider } from './code.markdownVisibility'

const DRAWER_TRANSITION_MS = 220
const DRAWER_CONTENT_REVEAL_MS = 80
const ANCHOR_SCROLL_TIMEOUT_MS = 1500

export type TranscriptContentDrawerTarget = {
  transcriptId: string
  referenceId: string
  transcriptTitle: string
}

type TranscriptContentDrawerProps = {
  open: boolean
  target: TranscriptContentDrawerTarget | null
  projectId: string
  projectPath: string
  onClose: () => void
  onOpenInTranscriptPage: (target: TranscriptContentDrawerTarget) => void
}

type DrawerStatus = 'idle' | 'loading' | 'ready' | 'not-found' | 'error'

function findReferenceAnchor(root: HTMLElement | null, referenceId: string): Element | null {
  if (!root) return null
  const exact = root.querySelector(`a[href="transcript-ref://${referenceId}"]`)
  if (exact) return exact
  // href 大小写兜底扫描
  const anchors = root.querySelectorAll('.code-markdown-transcript-ref')
  const normalized = `transcript-ref://${referenceId}`.toLowerCase()
  for (const anchor of anchors) {
    const href = anchor.getAttribute('href')
    if (href && href.trim().toLowerCase() === normalized) return anchor
  }
  return null
}

export function TranscriptContentDrawer({ open, target, projectId, projectPath, onClose, onOpenInTranscriptPage }: TranscriptContentDrawerProps) {
  const { t } = useI18n()
  const effectiveTheme = useEffectiveTheme()
  const loadTranscriptSession = useAppStore((s) => s.loadTranscriptSession)

  const [shouldRender, setShouldRender] = useState(open)
  const [visible, setVisible] = useState(open)
  const [contentVisible, setContentVisible] = useState(open)
  const [status, setStatus] = useState<DrawerStatus>(() => (target ? 'loading' : 'idle'))
  const [session, setSession] = useState<TranscriptSession | null>(null)
  const [activeReferenceId, setActiveReferenceId] = useState<string | null>(null)
  // 正文字号继承编辑器字号偏好（workbench.monacoEditorFontSize），每次打开时重读。
  const [baseFontSize, setBaseFontSize] = useState(() => readMonacoEditorFontSizePreference())

  const scrollContentRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    setBaseFontSize(readMonacoEditorFontSizePreference())
  }, [open])

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
    if (!open || !target) {
      setStatus(target ? 'loading' : 'idle')
      setSession(null)
      setActiveReferenceId(null)
      return
    }

    let cancelled = false
    setStatus('loading')
    setSession(null)
    setActiveReferenceId(target.referenceId)

    void loadTranscriptSession(projectId, target.transcriptId)
      .then((loaded) => {
        if (cancelled) return
        if (!loaded) {
          setStatus('not-found')
          return
        }
        setSession(loaded)
        setStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        console.error('[TranscriptContentDrawer] load failed:', error)
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [loadTranscriptSession, open, projectId, target])

  // 滚动定位：rAF 重试兜底 mermaid/图片异步布局导致的位移；高亮由 activeInternalHref 的 is-active 样式完成。
  useEffect(() => {
    if (!open || status !== 'ready' || !activeReferenceId) return

    let rafId = 0
    const startedAt = Date.now()
    const attemptScroll = () => {
      const anchor = findReferenceAnchor(scrollContentRef.current, activeReferenceId)
      if (anchor) {
        anchor.scrollIntoView({ behavior: 'auto', block: 'center' })
        return
      }
      if (Date.now() - startedAt >= ANCHOR_SCROLL_TIMEOUT_MS) return
      rafId = window.requestAnimationFrame(attemptScroll)
    }
    rafId = window.requestAnimationFrame(attemptScroll)

    return () => {
      window.cancelAnimationFrame(rafId)
    }
  }, [activeReferenceId, open, status])

  const markdownComponents = useMemo(() => {
    if (!session) return {}
    return createMarkdownComponents({
      activeRelativePath: null,
      activeInternalHref: activeReferenceId ? `transcript-ref://${activeReferenceId}` : null,
      enableMarkdownSyntaxHighlight: !shouldDisableMarkdownSyntaxHighlight(session.markdownText),
      onInternalLinkClick: (href) => {
        const matched = session.references.find((reference) => reference.href === href)
        if (matched) setActiveReferenceId(matched.id)
      },
      projectPath,
      themeMode: effectiveTheme,
    })
  }, [activeReferenceId, effectiveTheme, projectPath, session])

  if (!shouldRender || !target) return null

  return createPortal(
    <div className="fixed inset-0 overflow-hidden" style={{ zIndex: 1150 }}>
      <button type="button" className={`absolute inset-0 bg-[color:var(--color-background-sunken)]/54 backdrop-blur-[5px] transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`} aria-label={t('codeWorkspace.transcriptRefDrawerAria')} onClick={onClose} />

      <aside
        className={`absolute inset-y-3 right-3 w-[min(860px,calc(100%-1.5rem))] overflow-hidden rounded-[26px] border border-[color:var(--color-border)] bg-[color:var(--color-popover)]/96 shadow-[0_28px_84px_rgba(15,15,20,0.34)] backdrop-blur-[26px] transition-[transform,opacity] duration-220 ease-out will-change-transform max-[920px]:left-3 max-[920px]:right-3 max-[920px]:w-auto ${
          visible ? 'translate-x-0 opacity-100' : 'translate-x-[32px] opacity-0'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={t('codeWorkspace.transcriptRefDrawerAria')}
      >
        <div className={`flex h-full min-h-0 flex-col transition-opacity duration-150 ${contentVisible ? 'opacity-100' : 'opacity-0'}`}>
          <div className="flex shrink-0 items-center justify-between border-b border-[color:var(--color-border)]/85 bg-[color:var(--color-card)]/62 px-5 py-4 backdrop-blur-[14px]">
            <div className="min-w-0">
              <p className="section-label">{t('codeWorkspace.transcriptRefDrawerTitle')}</p>
              <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">{target.transcriptTitle}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" className="quiet-control inline-flex h-8 items-center gap-1.5 rounded-full border-0 px-3 text-xs transition-colors" onClick={() => onOpenInTranscriptPage(target)} title={t('codeWorkspace.transcriptRefDrawerOpenInTranscript')}>
                <ExternalLink className="h-3.5 w-3.5" />
                {t('codeWorkspace.transcriptRefDrawerOpenInTranscript')}
              </button>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background)]/80 text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
                onClick={onClose}
                title={t('common.close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {status === 'loading' && (
              <div className="flex h-full items-center justify-center gap-2 text-[11px] text-[color:var(--color-muted-foreground)]">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                {t('codeWorkspace.transcriptRefDrawerLoading')}
              </div>
            )}

            {status === 'not-found' && (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <TriangleAlert className="h-10 w-10 text-[color:var(--color-warning)]" />
                <p className="text-sm font-medium text-[color:var(--color-foreground)]">{t('codeWorkspace.transcriptRefDrawerNotFound')}</p>
              </div>
            )}

            {status === 'error' && (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <AlertCircle className="h-10 w-10 text-[color:var(--color-destructive)]" />
                <p className="text-sm font-medium text-[color:var(--color-foreground)]">{t('codeWorkspace.transcriptRefDrawerLoadFailed')}</p>
              </div>
            )}

            {status === 'ready' && session && (
              <MarkdownPreviewVisibilityProvider forceRenderAllBlocks>
                <article ref={scrollContentRef} className="code-markdown-content transcript-markdown-content px-5 py-8" style={{ fontSize: baseFontSize }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkBoxDrawingTables]} components={markdownComponents} urlTransform={transformMarkdownUrl}>
                    {session.markdownText}
                  </ReactMarkdown>
                </article>
              </MarkdownPreviewVisibilityProvider>
            )}
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  )
}
