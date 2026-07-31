import { Children, isValidElement, useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Copy, Maximize2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { Components, ExtraProps } from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { joinProjectPath } from './code.pathActions'
import { copyTextToClipboard } from './code.clipboard'
import { MermaidBlock } from './code.markdownMermaid'
import { createSourceTrackedBlockComponent, createStructuredBlockComponent, getSourceLineDataProps, type MarkdownStructuredBlockClickPayload, type MarkdownStructuredBlockKind, type SourceLineDataProps, shouldIgnoreStructuredBlockActivation } from './code.markdownStructuredBlocks'
import { decodeMarkdownUrlPathSafely, isWindowsAbsolutePath, normalizeAbsoluteMarkdownFileUrl, toFileUrlFromAbsolutePath } from './code.markdownUrls'
import { useI18n } from '../../i18n'
import { useMarkdownNearViewport } from './code.markdownVisibility'

export type {
  MarkdownStructuredBlockClickPayload,
  MarkdownStructuredBlockKind,
  SourceLineDataProps,
} from './code.markdownStructuredBlocks'

const MARKDOWN_DISABLE_SYNTAX_HIGHLIGHT_CHAR_THRESHOLD = 180_000
const MARKDOWN_DISABLE_SYNTAX_HIGHLIGHT_LINE_THRESHOLD = 3500
const MARKDOWN_CODE_BLOCK_DISABLE_HIGHLIGHT_CHAR_THRESHOLD = 40_000
const MARKDOWN_CODE_BLOCK_DISABLE_HIGHLIGHT_LINE_THRESHOLD = 700
const MARKDOWN_CODE_BLOCK_PRELOAD_ROOT_MARGIN = '320px 0px'
export const MARKDOWN_PASTE_IMAGE_DIRECTORY = '.attachments'
const MARKDOWN_PREVIEW_SOURCE_LINE_SELECTOR = '[data-source-start-line][data-source-end-line]'
const MARKDOWN_PREVIEW_REVEAL_HIGHLIGHT_CLASS = 'code-markdown-source-reveal'
const MARKDOWN_PREVIEW_REVEAL_HIGHLIGHT_DURATION_MS = 1800

export type MarkdownCodeBlockExpandPayload = {
  codeText: string
  language: string
}

function normalizePathSegments(value: string): string[] {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
}

export function dirnameFromRelativePath(relativePath: string): string {
  const segments = normalizePathSegments(relativePath)
  if (segments.length <= 1) return ''
  return segments.slice(0, -1).join('/')
}

export function joinPosixPaths(...values: string[]): string {
  const segments: string[] = []
  for (const value of values) {
    segments.push(...normalizePathSegments(value))
  }
  return segments.join('/')
}

export function relativePosixPath(fromDirectory: string, toPath: string): string {
  const from = normalizePathSegments(fromDirectory)
  const to = normalizePathSegments(toPath)

  let shared = 0
  const sharedMax = Math.min(from.length, to.length)
  while (shared < sharedMax && from[shared] === to[shared]) {
    shared += 1
  }

  const upSegments = from.slice(shared).map(() => '..')
  const downSegments = to.slice(shared)
  const result = [...upSegments, ...downSegments].join('/')
  return result || '.'
}

export function sanitizeMarkdownImageAlt(relativePath: string): string {
  const fileName = fileNameFromRelativePath(relativePath)
  const withoutExtension = fileName.replace(/\.[A-Za-z0-9]+$/, '').trim()
  const safe = withoutExtension.replace(/[\[\]\r\n]+/g, ' ').trim()
  return safe || 'image'
}

export function normalizeMarkdownImageExtensionFromMime(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase()
  if (normalized === 'image/jpeg') return 'jpg'
  if (normalized === 'image/png') return 'png'
  if (normalized === 'image/gif') return 'gif'
  if (normalized === 'image/webp') return 'webp'
  if (normalized === 'image/bmp') return 'bmp'
  if (normalized === 'image/svg+xml') return 'svg'
  if (normalized === 'image/tiff') return 'tiff'
  return 'png'
}

export function parseImageFileFromClipboardEvent(event: ClipboardEvent): File | null {
  const clipboardData = event.clipboardData
  const items = clipboardData?.items
  if (!items || items.length <= 0) return null

  for (const item of items) {
    if (!item.type.startsWith('image/')) continue
    const imageFile = item.getAsFile()
    if (imageFile) return imageFile
  }
  return null
}

function trimMarkdownUrlWrapper(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('<') && trimmed.endsWith('>') && trimmed.length > 2) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

function stripMarkdownImageDestinationSuffix(rawDestination: string): string {
  const compact = rawDestination.trim()
  if (!compact) return ''
  const firstWhitespace = compact.search(/\s/)
  if (firstWhitespace >= 0) {
    return compact.slice(0, firstWhitespace)
  }
  return compact
}

export function resolveMarkdownImageSrc(rawSrc: string, projectRootPath: string, activeFilePath: string | null): string {
  const trimmed = stripMarkdownImageDestinationSuffix(trimMarkdownUrlWrapper(rawSrc))
  if (!trimmed) return ''

  const absoluteFileUrl = normalizeAbsoluteMarkdownFileUrl(trimmed)
  if (absoluteFileUrl) {
    return absoluteFileUrl
  }

  const lower = trimmed.toLowerCase()
  if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('data:') || lower.startsWith('blob:') || lower.startsWith('file:')) {
    return trimmed
  }

  if (isWindowsAbsolutePath(trimmed) || trimmed.startsWith('/')) {
    const directAbsoluteFileUrl = toFileUrlFromAbsolutePath(trimmed)
    return directAbsoluteFileUrl || trimmed
  }

  if (!projectRootPath) return trimmed

  const activeDirectory = activeFilePath ? dirnameFromRelativePath(activeFilePath) : ''
  const relativeToProject = activeDirectory ? joinPosixPaths(activeDirectory, trimmed) : joinPosixPaths(trimmed)

  const absolutePath = joinProjectPath(projectRootPath, relativeToProject)
  const projectAbsoluteFileUrl = toFileUrlFromAbsolutePath(absolutePath)
  return projectAbsoluteFileUrl || trimmed
}

export function resolveMonacoTheme(themeMode: 'system' | 'light' | 'dark'): 'vs' | 'vs-dark' {
  if (themeMode === 'dark') return 'vs-dark'
  if (themeMode === 'light') return 'vs'
  return 'vs'
}

function normalizeSyntaxLanguage(value: string | null | undefined): string {
  const raw = (value ?? '').trim().toLowerCase()
  if (!raw) return 'text'

  if (raw === 'ts') return 'typescript'
  if (raw === 'tsx') return 'tsx'
  if (raw === 'js') return 'javascript'
  if (raw === 'jsx') return 'jsx'
  if (raw === 'sh' || raw === 'shell') return 'bash'
  if (raw === 'yml') return 'yaml'
  if (raw === 'md') return 'markdown'
  if (raw === 'py') return 'python'
  if (raw === 'rb') return 'ruby'
  if (raw === 'rs') return 'rust'
  if (raw === 'kt') return 'kotlin'
  if (raw === 'cs') return 'csharp'
  if (raw === 'ps1') return 'powershell'
  return raw
}

function extractCodeLanguageFromClassName(className?: string): string | null {
  const match = /language-([A-Za-z0-9_+-]+)/.exec(className ?? '')
  return match?.[1] ?? null
}

function extractPlainTextFromReactNode(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) {
    return node.map((child) => extractPlainTextFromReactNode(child)).join('')
  }
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode }
    return extractPlainTextFromReactNode(props.children)
  }
  return ''
}

function extractCodeBlockFromPreChildren(children: ReactNode): { codeText: string; language: string } | null {
  const childNodes = Children.toArray(children)
  if (childNodes.length !== 1) return null

  const onlyChild = childNodes[0]
  if (!isValidElement(onlyChild)) {
    return null
  }

  const codeProps = onlyChild.props as {
    className?: string
    children?: ReactNode
    node?: { tagName?: string }
  }
  if (codeProps.node?.tagName !== 'code' && onlyChild.type !== 'code') {
    return null
  }

  const codeText = extractPlainTextFromReactNode(codeProps.children).replace(/\n$/, '')
  const language = normalizeSyntaxLanguage(extractCodeLanguageFromClassName(codeProps.className))
  return { codeText, language }
}

export function formatCodeLanguageLabel(language: string, t: ReturnType<typeof useI18n>['t']): string {
  const normalized = normalizeSyntaxLanguage(language)
  if (normalized === 'text') {
    return t('codeMarkdown.plainText')
  }
  if (normalized === 'bash') {
    return 'Bash'
  }
  if (normalized === 'javascript') {
    return 'JavaScript'
  }
  if (normalized === 'typescript') {
    return 'TypeScript'
  }
  if (normalized === 'jsx') {
    return 'JSX'
  }
  if (normalized === 'tsx') {
    return 'TSX'
  }
  if (normalized === 'json') {
    return 'JSON'
  }
  if (normalized === 'yaml') {
    return 'YAML'
  }
  if (normalized === 'markdown') {
    return 'Markdown'
  }
  if (normalized === 'python') {
    return 'Python'
  }
  if (normalized === 'csharp') {
    return 'C#'
  }
  if (normalized === 'cpp') {
    return 'C++'
  }
  if (normalized === 'plaintext') {
    return t('codeMarkdown.plainText')
  }
  return normalized.toUpperCase()
}

function countTextLines(value: string): number {
  if (!value) return 0
  let count = 1
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) === 10) count += 1
  }
  return count
}

export function shouldDisableMarkdownSyntaxHighlight(markdown: string): boolean {
  if (markdown.length > MARKDOWN_DISABLE_SYNTAX_HIGHLIGHT_CHAR_THRESHOLD) return true
  return countTextLines(markdown) > MARKDOWN_DISABLE_SYNTAX_HIGHLIGHT_LINE_THRESHOLD
}

function canHighlightMarkdownCodeBlock(codeText: string): boolean {
  if (codeText.length > MARKDOWN_CODE_BLOCK_DISABLE_HIGHLIGHT_CHAR_THRESHOLD) return false
  return countTextLines(codeText) <= MARKDOWN_CODE_BLOCK_DISABLE_HIGHLIGHT_LINE_THRESHOLD
}

function parseSourceLineAttribute(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

export function revealMarkdownPreviewSourceLine(container: HTMLElement, lineNumber: number): boolean {
  const targetLine = Math.max(1, Math.floor(lineNumber))
  const candidates = Array.from(container.querySelectorAll<HTMLElement>(MARKDOWN_PREVIEW_SOURCE_LINE_SELECTOR))

  if (candidates.length <= 0) return false

  let containing: { element: HTMLElement; lineSpan: number } | null = null
  let nextClosest: { element: HTMLElement; startLine: number } | null = null
  let previousClosest: { element: HTMLElement; endLine: number } | null = null

  for (const element of candidates) {
    const startLine = parseSourceLineAttribute(element.getAttribute('data-source-start-line'))
    const endLine = parseSourceLineAttribute(element.getAttribute('data-source-end-line'))
    if (startLine == null || endLine == null) continue

    if (startLine <= targetLine && targetLine <= endLine) {
      const lineSpan = Math.max(0, endLine - startLine)
      if (!containing || lineSpan <= containing.lineSpan) {
        containing = { element, lineSpan }
      }
      continue
    }

    if (startLine > targetLine && (!nextClosest || startLine < nextClosest.startLine)) {
      nextClosest = { element, startLine }
    }

    if (endLine < targetLine && (!previousClosest || endLine > previousClosest.endLine)) {
      previousClosest = { element, endLine }
    }
  }

  const target = containing?.element ?? nextClosest?.element ?? previousClosest?.element
  if (!target) return false

  const highlighted = container.querySelectorAll<HTMLElement>(`.${MARKDOWN_PREVIEW_REVEAL_HIGHLIGHT_CLASS}`)
  highlighted.forEach((element) => {
    element.classList.remove(MARKDOWN_PREVIEW_REVEAL_HIGHLIGHT_CLASS)
  })

  target.classList.add(MARKDOWN_PREVIEW_REVEAL_HIGHLIGHT_CLASS)
  window.setTimeout(() => {
    target.classList.remove(MARKDOWN_PREVIEW_REVEAL_HIGHLIGHT_CLASS)
  }, MARKDOWN_PREVIEW_REVEAL_HIGHLIGHT_DURATION_MS)
  target.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
  return true
}

function shouldOpenInSystemBrowser(href: string): boolean {
  const value = href.trim().toLowerCase()
  return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('file://') || value.startsWith('mailto:') || value.startsWith('tel:')
}

function AsyncMarkdownImage({ resolvedSrc, alt, props }: { resolvedSrc: string; alt: string; props: Omit<JSX.IntrinsicElements['img'], 'src' | 'alt'> }) {
  const [imageRef, isNearViewport] = useMarkdownNearViewport<HTMLElement>(MARKDOWN_CODE_BLOCK_PRELOAD_ROOT_MARGIN)
  const [displaySrc, setDisplaySrc] = useState(() => (resolvedSrc.startsWith('data:') || resolvedSrc.startsWith('blob:') || resolvedSrc.startsWith('http://') || resolvedSrc.startsWith('https://') ? resolvedSrc : ''))

  useEffect(() => {
    let cancelled = false

    if (resolvedSrc.startsWith('data:') || resolvedSrc.startsWith('blob:') || resolvedSrc.startsWith('http://') || resolvedSrc.startsWith('https://')) {
      setDisplaySrc(resolvedSrc)
      return () => {
        cancelled = true
      }
    }

    if (!resolvedSrc) {
      setDisplaySrc('')
      return () => {
        cancelled = true
      }
    }

    if (!isNearViewport) {
      return () => {
        cancelled = true
      }
    }

    setDisplaySrc('')
    void window.electronAPI
      .readLocalImageAsDataUrl(resolvedSrc)
      .then((dataUrl) => {
        if (cancelled) return
        setDisplaySrc(dataUrl)
      })
      .catch(() => {
        if (cancelled) return
        setDisplaySrc('')
      })

    return () => {
      cancelled = true
    }
  }, [isNearViewport, resolvedSrc])

  if (!displaySrc) {
    return (
      <span ref={imageRef} className="code-markdown-image-placeholder text-xs text-[color:var(--color-muted-foreground)]">
        [image unavailable]
      </span>
    )
  }

  return <img ref={imageRef} {...props} src={displaySrc} alt={alt} loading="lazy" />
}

type MarkdownCodeBlockProps = {
  codeText: string
  language: string
  themeMode: 'light' | 'dark'
  enableSyntaxHighlight: boolean
  forceRenderAllBlocks?: boolean
  onCodeBlockExpand?: (payload: MarkdownCodeBlockExpandPayload) => void
  onStructuredBlockClick?: (payload: MarkdownStructuredBlockClickPayload) => void
  sourceLineProps?: SourceLineDataProps
}

function StandardMarkdownCodeBlock({ codeText, language, themeMode, enableSyntaxHighlight, onCodeBlockExpand, sourceLineProps }: MarkdownCodeBlockProps) {
  const { t } = useI18n()
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle')
  // Regular code blocks render their tokenized DOM immediately. The per-block
  // size guard keeps pathological generated blocks on the lightweight path.
  const shouldRenderSyntax = enableSyntaxHighlight && canHighlightMarkdownCodeBlock(codeText)

  useEffect(() => {
    if (copyStatus === 'idle') return
    const timer = window.setTimeout(() => {
      setCopyStatus('idle')
    }, 1500)
    return () => {
      window.clearTimeout(timer)
    }
  }, [copyStatus])

  const handleCopy = useCallback(async () => {
    const ok = await copyTextToClipboard(codeText)
    setCopyStatus(ok ? 'success' : 'error')
  }, [codeText])
  const handleExpand = useCallback(() => {
    onCodeBlockExpand?.({ codeText, language })
  }, [codeText, language, onCodeBlockExpand])
  const canExpand = typeof onCodeBlockExpand === 'function'

  const copyLabel = copyStatus === 'success' ? t('codeMarkdown.copied') : copyStatus === 'error' ? t('codeMarkdown.copyFailed') : t('codeMarkdown.copy')
  const expandLabel = t('codeMarkdown.expand')
  const codeLanguageLabel = formatCodeLanguageLabel(language, t)

  return (
    <div className="code-markdown-syntax-wrap" {...sourceLineProps}>
      <div className="code-markdown-code-toolbar">
        <span className="code-markdown-code-language" title={codeLanguageLabel}>
          {codeLanguageLabel}
        </span>
        <div className="code-markdown-code-actions">
          {canExpand && (
            <button type="button" className="code-markdown-code-action-btn" onClick={handleExpand} title={expandLabel} aria-label={expandLabel}>
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            className={`code-markdown-copy-btn ${copyStatus === 'success' ? 'is-success' : copyStatus === 'error' ? 'is-error' : ''}`}
            onClick={() => {
              void handleCopy()
            }}
            title={copyLabel}
          >
            {copyStatus === 'success' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copyLabel}</span>
          </button>
        </div>
      </div>

      {shouldRenderSyntax ? (
        <SyntaxHighlighter
          language={language}
          style={themeMode === 'dark' ? oneDark : oneLight}
          PreTag="div"
          className="code-markdown-syntax-block"
          customStyle={{ margin: 0, borderRadius: 10, paddingTop: 44 }}
          codeTagProps={{
            style: {
              fontFamily: "'JetBrains Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace",
            },
          }}
        >
          {codeText}
        </SyntaxHighlighter>
      ) : (
        <pre className="code-markdown-plain-block">
          <code className={`language-${language}`}>{codeText}</code>
        </pre>
      )}
    </div>
  )
}

function MarkdownCodeBlock(props: MarkdownCodeBlockProps) {
  if (props.language === 'mermaid') {
    return <MermaidBlock codeText={props.codeText} forceRenderAllBlocks={props.forceRenderAllBlocks} onStructuredBlockClick={props.onStructuredBlockClick} themeMode={props.themeMode} sourceLineProps={props.sourceLineProps} shouldIgnoreActivation={shouldIgnoreStructuredBlockActivation} />
  }

  return <StandardMarkdownCodeBlock {...props} />
}

type CreateMarkdownComponentsOptions = {
  activeRelativePath: string | null
  activeInternalHref?: string | null
  enableMarkdownSyntaxHighlight: boolean
  forceRenderAllBlocks?: boolean
  lineOffset?: number
  onCodeBlockExpand?: (payload: MarkdownCodeBlockExpandPayload) => void
  onInternalLinkClick?: (href: string) => void
  onProjectFileLinkClick?: (relativePath: string) => void
  onStructuredBlockClick?: (payload: MarkdownStructuredBlockClickPayload) => void
  projectPath: string
  themeMode: 'light' | 'dark'
}

function isTranscriptReferenceHref(value: string): boolean {
  return value.trim().toLowerCase().startsWith('transcript-ref://')
}

function resolveProjectRelativeMarkdownLink(href: string, activeRelativePath: string | null): string | null {
  const encodedPath = href.trim().split(/[?#]/, 1)[0]?.replace(/\\/g, '/') ?? ''
  const path = decodeMarkdownUrlPathSafely(encodedPath)
  if (!path || path.startsWith('/') || path.startsWith('//') || isWindowsAbsolutePath(path) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)) {
    return null
  }

  const segments = activeRelativePath ? normalizePathSegments(dirnameFromRelativePath(activeRelativePath)) : []
  for (const segment of path.split('/')) {
    const normalized = segment.trim()
    if (!normalized || normalized === '.') continue
    if (normalized === '..') {
      if (segments.length === 0) return null
      segments.pop()
      continue
    }
    segments.push(normalized)
  }

  return segments.join('/') || null
}

export function createMarkdownComponents({
  activeRelativePath,
  activeInternalHref = null,
  enableMarkdownSyntaxHighlight,
  forceRenderAllBlocks = false,
  lineOffset = 0,
  onCodeBlockExpand,
  onInternalLinkClick,
  onProjectFileLinkClick,
  onStructuredBlockClick,
  projectPath,
  themeMode,
}: CreateMarkdownComponentsOptions): Components {
  return {
    div: createStructuredBlockComponent('div', lineOffset, onStructuredBlockClick),
    h1: createSourceTrackedBlockComponent('h1', lineOffset),
    h2: createSourceTrackedBlockComponent('h2', lineOffset),
    h3: createSourceTrackedBlockComponent('h3', lineOffset),
    h4: createSourceTrackedBlockComponent('h4', lineOffset),
    h5: createSourceTrackedBlockComponent('h5', lineOffset),
    h6: createSourceTrackedBlockComponent('h6', lineOffset),
    p: createSourceTrackedBlockComponent('p', lineOffset),
    blockquote: createSourceTrackedBlockComponent('blockquote', lineOffset),
    ul: createSourceTrackedBlockComponent('ul', lineOffset),
    ol: createSourceTrackedBlockComponent('ol', lineOffset),
    li: createSourceTrackedBlockComponent('li', lineOffset),
    table: createStructuredBlockComponent('table', lineOffset, onStructuredBlockClick),
    thead: createSourceTrackedBlockComponent('thead', lineOffset),
    tbody: createSourceTrackedBlockComponent('tbody', lineOffset),
    tr: createSourceTrackedBlockComponent('tr', lineOffset),
    th: createSourceTrackedBlockComponent('th', lineOffset),
    td: createSourceTrackedBlockComponent('td', lineOffset),
    hr: createSourceTrackedBlockComponent('hr', lineOffset),
    pre({ children, node }) {
      const sourceLineProps = getSourceLineDataProps(node, lineOffset)
      const codeBlock = extractCodeBlockFromPreChildren(children)
      if (!codeBlock) {
        return <pre {...sourceLineProps}>{children}</pre>
      }

      return (
        <MarkdownCodeBlock
          codeText={codeBlock.codeText}
          language={codeBlock.language}
          themeMode={themeMode}
          enableSyntaxHighlight={enableMarkdownSyntaxHighlight}
          forceRenderAllBlocks={forceRenderAllBlocks}
          onCodeBlockExpand={onCodeBlockExpand}
          onStructuredBlockClick={onStructuredBlockClick}
          sourceLineProps={sourceLineProps}
        />
      )
    },
    img({ src, alt, node: _node, ...props }) {
      const rawSrc = typeof src === 'string' ? src : ''
      const resolvedSrc = resolveMarkdownImageSrc(rawSrc, projectPath, activeRelativePath)
      if (!resolvedSrc) {
        return null
      }
      return <AsyncMarkdownImage resolvedSrc={resolvedSrc} alt={alt || ''} props={props} />
    },
    a({ href, children, className, ...props }) {
      const link = typeof href === 'string' ? href.trim() : ''
      const internal = Boolean(link) && isTranscriptReferenceHref(link)
      const canConsumeInternal = internal && typeof onInternalLinkClick === 'function'
      const projectFilePath = onProjectFileLinkClick ? resolveProjectRelativeMarkdownLink(link, activeRelativePath) : null
      const external = Boolean(link) && shouldOpenInSystemBrowser(link)
      const resolvedClassName = [className, internal ? 'code-markdown-transcript-ref rounded-[8px] px-1.5 py-0.5 transition-all duration-150' : '', internal && activeInternalHref === link ? 'is-active bg-[color:var(--color-warning-background)] text-[color:var(--color-foreground)]' : ''].filter(Boolean).join(' ')

      if (internal && !canConsumeInternal) {
        return (
          <span className={resolvedClassName || undefined} title={link}>
            {children}
          </span>
        )
      }

      return (
        <a
          {...props}
          className={resolvedClassName || undefined}
          href={link || href}
          target={external ? '_blank' : props.target}
          rel={external ? 'noopener noreferrer' : props.rel}
          onClick={(event) => {
            props.onClick?.(event)
            if (event.defaultPrevented) return
            if (canConsumeInternal) {
              event.preventDefault()
              onInternalLinkClick(link)
              return
            }
            if (projectFilePath) {
              event.preventDefault()
              onProjectFileLinkClick?.(projectFilePath)
              return
            }
            if (!external) return
            event.preventDefault()
            void window.electronAPI.openExternal(link)
          }}
        >
          {children}
        </a>
      )
    },
    code({ className, children, node: _node, ...props }) {
      const mergedClassName = className ? `code-markdown-inline-code ${className}` : 'code-markdown-inline-code'
      return (
        <code className={mergedClassName} {...props}>
          {children}
        </code>
      )
    },
  }
}

export function fileNameFromRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/')
  const segments = normalized.split('/')
  return segments[segments.length - 1] || relativePath
}
