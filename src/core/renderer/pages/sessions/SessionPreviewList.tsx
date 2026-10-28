import { Bell, Bot, ChevronRight, CircleAlert, FileCode2, ScrollText, Shield, Terminal, TriangleAlert, User, X } from 'lucide-react'
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AgentHistoryPreviewMessage } from '../../../shared/types/agentHistory'
import type { AgentHistoryRenderingConfig } from '../../../shared/types/agentHistoryRendering'
import { ModalShell } from '../../components/ModalShell'
import { ZoomPanViewport } from '../../components/ZoomPanViewport'
import { useEffectiveTheme } from '../../hooks/useEffectiveTheme'
import { useI18n } from '../../i18n'
import { extractFilePathCandidates, inlineMessageFileLinks, resolveCandidateRelativePath, SESSION_FILE_LINK_SCHEME } from '../../lib/agentHistoryFileLinks'
import { type AgentHistoryMessageSegment, segmentAgentHistoryMessage } from '../../lib/agentHistoryRendering'
import { middleTruncatePath } from '../../lib/projectDisplay'
import { createMarkdownComponents, isDirectImageSrc, toProjectWorkbenchImageUrl } from '../code/code.markdown'
import { remarkBoxDrawingTables } from '../code/code.markdownBoxTables'
import { toFileUrlFromAbsolutePath, transformMarkdownUrl } from '../code/code.markdownUrls'
import { SessionFileDrawer, type SessionFileDrawerTarget } from './SessionFileDrawer'

type AgentHistoryTagSegment = Extract<AgentHistoryMessageSegment, { kind: 'tag' }>

function MessageMarkdown({ content, components, urlTransform }: { content: string; components: ReturnType<typeof createMarkdownComponents>; urlTransform?: (url: string) => string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBoxDrawingTables]} components={components} urlTransform={urlTransform ?? transformMarkdownUrl}>
      {content}
    </ReactMarkdown>
  )
}

const commandChipMeta: Record<string, { icon: typeof Terminal; labelKey?: string }> = {
  'command-name': { icon: Terminal },
  'command-message': { icon: Terminal },
  'command-args': { icon: Terminal },
  'local-command-stdout': { icon: ScrollText, labelKey: 'agentHistory.tagCommandOutput' },
  'local-command-caveat': { icon: TriangleAlert, labelKey: 'agentHistory.tagCommandCaveat' },
  'task-notification': { icon: Bell, labelKey: 'agentHistory.tagTaskNotification' },
  'persisted-output': { icon: ScrollText, labelKey: 'agentHistory.tagPersistedOutput' },
  tool_use_error: { icon: CircleAlert, labelKey: 'agentHistory.tagToolError' },
}

function CommandTagChip({ segment, icon: Icon, label }: { segment: AgentHistoryTagSegment; icon: typeof Terminal; label: string }) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [cardPosition, setCardPosition] = useState<{ right: number; top: number; placement: 'above' | 'below' } | null>(null)

  const showCard = () => {
    const rect = anchorRef.current?.getBoundingClientRect()
    if (!rect) return
    const right = Math.max(8, Math.min(window.innerWidth - rect.right, window.innerWidth - 436))
    if (rect.top > 260) {
      setCardPosition({ right, top: rect.top - 8, placement: 'above' })
    } else {
      setCardPosition({ right, top: rect.bottom + 8, placement: 'below' })
    }
  }

  return (
    <span ref={anchorRef} className="relative inline-flex max-w-full align-bottom" onMouseEnter={showCard} onMouseLeave={() => setCardPosition(null)}>
      <span className="inline-flex min-w-0 items-center gap-1.5 rounded-lg border border-[color:var(--color-border)]/70 bg-[color:var(--color-card)] px-2 py-0.5 text-[12px] text-[color:var(--color-muted-foreground)]">
        <Icon className="h-3 w-3 shrink-0" strokeWidth={1.8} />
        <span className="truncate">{label}</span>
      </span>
      {cardPosition &&
        createPortal(
          <div
            className={`pointer-events-none fixed z-[9999] max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-popover)] px-3 py-2 text-[12px] leading-5 text-[color:var(--color-foreground)] shadow-[var(--shadow-popover)] ${cardPosition.placement === 'above' ? '-translate-y-full' : ''}`}
            style={{ right: cardPosition.right, top: cardPosition.top, width: 'max-content', maxWidth: 'min(420px, calc(100vw - 16px))' }}
          >
            {segment.content.trim() || segment.raw}
          </div>,
          document.body,
        )}
    </span>
  )
}

function TagImage({ source, alt, projectPath }: { source: string; alt: string; projectPath: string }) {
  const { t } = useI18n()
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [displaySrc, setDisplaySrc] = useState(() => {
    if (isDirectImageSrc(source)) return source
    const fileUrl = toFileUrlFromAbsolutePath(source) || source
    return toProjectWorkbenchImageUrl(fileUrl, projectPath)
  })

  useEffect(() => {
    let cancelled = false
    if (isDirectImageSrc(source)) {
      setDisplaySrc(source)
      return () => {
        cancelled = true
      }
    }
    const fileUrl = toFileUrlFromAbsolutePath(source) || source
    const workbenchSrc = toProjectWorkbenchImageUrl(fileUrl, projectPath)
    if (workbenchSrc) {
      setDisplaySrc(workbenchSrc)
      return () => {
        cancelled = true
      }
    }
    setDisplaySrc('')
    void window.electronAPI
      .readLocalImageAsDataUrl(fileUrl)
      .then((dataUrl) => {
        if (!cancelled) setDisplaySrc(dataUrl)
      })
      .catch(() => {
        if (!cancelled) setDisplaySrc('')
      })
    return () => {
      cancelled = true
    }
  }, [source, projectPath])

  const imageTitle = useMemo(() => {
    const lower = source.toLowerCase()
    if (lower.startsWith('data:') || lower.startsWith('blob:')) return alt || t('codeMarkdown.imagePreviewTitle')
    const base =
      source
        .trim()
        .replace(/[\\/]+$/, '')
        .split(/[\\/]/)
        .pop() ?? ''
    return base || alt || t('codeMarkdown.imagePreviewTitle')
  }, [source, alt, t])

  if (!displaySrc) return <code className="text-xs">{source}</code>
  return (
    <>
      <img
        className="max-h-[420px] max-w-full cursor-zoom-in rounded-[14px] border border-[color:var(--color-border)] object-contain shadow-sm"
        src={displaySrc}
        alt={imageTitle}
        role="button"
        tabIndex={0}
        onClick={() => setIsPreviewOpen(true)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          setIsPreviewOpen(true)
        }}
      />
      <ModalShell open={isPreviewOpen} onClose={() => setIsPreviewOpen(false)} widthClassName="max-w-[min(1440px,calc(100vw-32px))]" baseZIndex={1240} ariaLabel={t('codeMarkdown.imagePreviewAria')} overlayClassName="backdrop-blur-0 bg-black/35" panelClassName="code-markdown-image-preview-modal p-4 sm:p-5">
        <div className="flex h-full min-h-0 flex-col">
          <div className="mb-3 flex min-w-0 items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[color:var(--color-foreground)]">{imageTitle}</p>
            </div>
            <button type="button" className="quiet-control flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-0 text-[color:var(--color-muted-foreground)]" onClick={() => setIsPreviewOpen(false)} title={t('common.close')}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <ZoomPanViewport resetKey={displaySrc}>
            <div className="code-markdown-image-preview-canvas">
              <img src={displaySrc} alt={imageTitle} draggable={false} />
            </div>
          </ZoomPanViewport>
        </div>
      </ModalShell>
    </>
  )
}

function MessageSegment({
  segment,
  components,
  projectPath,
  urlTransform,
  renderTagLabel,
  plainText,
}: {
  segment: AgentHistoryMessageSegment
  components: ReturnType<typeof createMarkdownComponents>
  projectPath: string
  urlTransform?: (url: string) => string
  renderTagLabel: (segment: AgentHistoryTagSegment) => string
  plainText: boolean
}) {
  const { t } = useI18n()
  if (segment.kind === 'text') return plainText ? <span className="whitespace-pre-wrap">{segment.text}</span> : <MessageMarkdown content={segment.text} components={components} urlTransform={urlTransform} />
  if (segment.mode === 'hidden') return null
  if (segment.mode === 'image') {
    const rawSource = segment.attributes.path ?? segment.attributes.src ?? segment.content.trim()
    return <TagImage source={rawSource} alt={segment.attributes.name ?? ''} projectPath={projectPath} />
  }
  if (segment.mode === 'inline') return <code className="rounded-md bg-[color:var(--color-accent)] px-1.5 py-0.5 text-[12px] text-[color:var(--color-muted-foreground)]">{segment.content.trim() || segment.raw}</code>
  if (segment.rule.category === 'command') {
    const meta = commandChipMeta[segment.tagName] ?? { icon: Terminal }
    return <CommandTagChip segment={segment} icon={meta.icon} label={renderTagLabel(segment)} />
  }
  const categoryLabel = segment.rule.category === 'context' ? 'agentHistory.tagContext' : segment.rule.category === 'attachment' ? 'agentHistory.tagImage' : 'agentHistory.tagMetadata'
  return (
    <details className="group/tag w-full rounded-xl border border-[color:var(--color-border)]/70 bg-[color:var(--color-card)]/60">
      <summary className="flex w-fit max-w-full cursor-pointer select-none list-none items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-foreground)] [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3 w-3 shrink-0 transition-transform group-open/tag:rotate-90" strokeWidth={2} />
        <span className="truncate">
          {t(categoryLabel)} · {renderTagLabel(segment)}
        </span>
        <code className="shrink-0 text-[10px] font-normal opacity-60">{`<${segment.tagName}>`}</code>
      </summary>
      <div className="border-t border-[color:var(--color-border)]/60 px-3 py-2 text-[12px] leading-6">
        <MessageMarkdown content={segment.content} components={components} urlTransform={urlTransform} />
      </div>
    </details>
  )
}

function SystemPrompt({ text, components }: { text: string; components: ReturnType<typeof createMarkdownComponents> }) {
  const { t } = useI18n()
  return (
    <details className="group/system w-full rounded-xl border border-[color:var(--color-border)]/70 bg-[color:var(--color-card)]/60">
      <summary className="flex cursor-pointer select-none list-none items-center gap-2 px-3 py-2 text-xs font-medium text-[color:var(--color-muted-foreground)] [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3 w-3 transition-transform group-open/system:rotate-90" />
        {t('agentHistory.tagSystem')}
      </summary>
      <div className="border-t border-[color:var(--color-border)]/60 px-3 py-2 text-xs leading-5">
        <MessageMarkdown content={text} components={components} />
      </div>
    </details>
  )
}

function SessionFileLinkChip({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={label}
      className="inline-flex max-w-full items-center gap-1 rounded-lg border border-[color:var(--color-border)]/70 bg-[color:var(--color-card)] px-2 py-0.5 align-bottom text-[12px] text-[color:var(--color-muted-foreground)] transition-colors hover:border-[color:var(--color-border)] hover:text-[color:var(--color-foreground)]"
    >
      <FileCode2 className="h-3 w-3 shrink-0" strokeWidth={1.8} />
      <span className="truncate">{label}</span>
    </button>
  )
}

const EMPTY_FILE_LINKS: ReadonlyMap<string, string> = new Map()

/** 对助手消息中的路径候选做项目内存在性校验，返回 token → 项目相对路径。 */
function useVerifiedProjectFileLinks(projectPath: string, messages: AgentHistoryPreviewMessage[]): ReadonlyMap<string, string> {
  const [resolved, setResolved] = useState<ReadonlyMap<string, string>>(EMPTY_FILE_LINKS)
  const candidateSignature = useMemo(
    () =>
      messages
        .filter((message) => message.role === 'assistant')
        .flatMap((message) => extractFilePathCandidates(message.text))
        .join('\n'),
    [messages],
  )

  useEffect(() => {
    if (!projectPath || !candidateSignature) {
      setResolved(EMPTY_FILE_LINKS)
      return
    }
    let cancelled = false
    const candidates = candidateSignature.split('\n')
    void (async () => {
      const next = new Map<string, string>()
      for (const candidate of candidates) {
        const relativePath = resolveCandidateRelativePath(projectPath, candidate)
        if (!relativePath) continue
        try {
          await window.electronAPI.statProjectFile(projectPath, relativePath)
        } catch {
          continue
        }
        if (cancelled) return
        next.set(candidate, relativePath)
      }
      if (!cancelled) setResolved(next)
    })()
    return () => {
      cancelled = true
    }
  }, [projectPath, candidateSignature])

  return resolved
}

export function SessionPreviewList({ messages, projectPath, renderingConfig }: { messages: AgentHistoryPreviewMessage[]; projectPath: string; renderingConfig: AgentHistoryRenderingConfig }) {
  const { t } = useI18n()
  const effectiveTheme = useEffectiveTheme()
  const verifiedFileLinks = useVerifiedProjectFileLinks(projectPath, messages)
  const [fileDrawerTarget, setFileDrawerTarget] = useState<SessionFileDrawerTarget | null>(null)
  const markdownComponents = useMemo(
    () =>
      createMarkdownComponents({
        activeRelativePath: null,
        activeInternalHref: null,
        enableMarkdownSyntaxHighlight: true,
        projectPath,
        themeMode: effectiveTheme,
      }),
    [effectiveTheme, projectPath],
  )
  const allowSessionFileUrlTransform = useCallback((url: string) => (url.startsWith(SESSION_FILE_LINK_SCHEME) ? url : transformMarkdownUrl(url)), [])
  const assistantMarkdownComponents = useMemo<typeof markdownComponents>(() => {
    const baseLinkRenderer = typeof markdownComponents.a === 'function' ? markdownComponents.a : undefined
    return {
      ...markdownComponents,
      a(anchorProps) {
        const href = typeof anchorProps.href === 'string' ? anchorProps.href : ''
        if (href.startsWith(SESSION_FILE_LINK_SCHEME)) {
          const relativePath = decodeURIComponent(href.slice(SESSION_FILE_LINK_SCHEME.length))
          return <SessionFileLinkChip label={middleTruncatePath(relativePath)} onOpen={() => setFileDrawerTarget({ relativePath })} />
        }
        if (baseLinkRenderer) return createElement(baseLinkRenderer, anchorProps)
        return <a href={href}>{anchorProps.children}</a>
      },
    }
  }, [markdownComponents])
  if (messages.length === 0) {
    return <p className="text-xs text-[color:var(--color-muted-foreground)]">{t('agentHistory.previewEmpty')}</p>
  }
  return (
    <div className="flex flex-col gap-4">
      {messages.map((message, index) => (
        <div key={index} className={`flex items-start gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[color:var(--color-border)]/80 bg-[color:var(--color-card)] text-[color:var(--color-muted-foreground)]">
            {message.role === 'user' ? <User className="h-3.5 w-3.5" strokeWidth={2} /> : message.role === 'system' ? <Shield className="h-3.5 w-3.5" strokeWidth={1.8} /> : <Bot className="h-3.5 w-3.5" strokeWidth={1.8} />}
          </span>
          <div className={`flex min-w-0 max-w-[88%] flex-col gap-1 ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
            <span className="px-1 text-[11px] font-semibold tracking-wide text-[color:var(--color-muted-foreground)]">{t(message.role === 'user' ? 'agentHistory.roleUser' : message.role === 'system' ? 'agentHistory.tagSystem' : 'agentHistory.roleAssistant')}</span>
            <div
              className={`whitespace-pre-wrap break-words text-[13px] leading-7 ${message.role === 'user' ? 'rounded-[16px] rounded-tr-md border border-[color:var(--color-border)]/75 bg-[color:var(--color-card)] px-4 py-3 text-[color:var(--color-foreground)] shadow-[0_4px_16px_rgb(15_23_42/0.045)]' : 'border-l-2 border-[color:var(--color-border)]/80 py-1 pl-4 text-[color:var(--color-foreground)]'}`}
            >
              {message.role === 'system' ? (
                <SystemPrompt text={message.text} components={markdownComponents} />
              ) : (
                <article className="code-markdown-content session-message-markdown">
                  {segmentAgentHistoryMessage(message.role === 'user' ? message.text : inlineMessageFileLinks(message.text, verifiedFileLinks), renderingConfig).map((segment, segmentIndex) => (
                    <MessageSegment
                      key={`${index}-${segmentIndex}`}
                      segment={segment}
                      components={message.role === 'user' ? markdownComponents : assistantMarkdownComponents}
                      projectPath={projectPath}
                      urlTransform={message.role === 'user' ? undefined : allowSessionFileUrlTransform}
                      plainText={message.role === 'user'}
                      renderTagLabel={(tagSegment) => {
                        const meta = commandChipMeta[tagSegment.tagName]
                        if (meta?.labelKey) return t(meta.labelKey)
                        return tagSegment.tagName
                      }}
                    />
                  ))}
                </article>
              )}
            </div>
          </div>
        </div>
      ))}
      <SessionFileDrawer projectPath={projectPath} target={fileDrawerTarget} onClose={() => setFileDrawerTarget(null)} />
    </div>
  )
}
