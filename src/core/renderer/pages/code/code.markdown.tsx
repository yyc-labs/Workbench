import { Children, createElement, isValidElement, useCallback, useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from 'react'
import { Check, Copy } from 'lucide-react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import type { Components, ExtraProps } from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { Element as HastElement } from 'hast'
import { joinProjectPath } from './code.pathActions'
import { copyTextToClipboard } from './code.clipboard'
import {
  ArchitectureDiagramBlock,
  parseArchitectureDiagramProp,
} from './code.markdownArchitectureDiagram'
import { BoxDiagramBlock, parseBoxDiagramLinesProp } from './code.markdownBoxDiagram'
import { useI18n } from '../../i18n'

const MARKDOWN_DISABLE_SYNTAX_HIGHLIGHT_CHAR_THRESHOLD = 180_000
const MARKDOWN_DISABLE_SYNTAX_HIGHLIGHT_LINE_THRESHOLD = 3500
const MARKDOWN_CODE_BLOCK_DISABLE_HIGHLIGHT_CHAR_THRESHOLD = 40_000
const MARKDOWN_CODE_BLOCK_DISABLE_HIGHLIGHT_LINE_THRESHOLD = 700
const MARKDOWN_CODE_BLOCK_PRELOAD_ROOT_MARGIN = '320px 0px'
const MARKDOWN_MERMAID_RENDER_ID_PREFIX = 'code-markdown-mermaid'
export const MARKDOWN_PASTE_IMAGE_DIRECTORY = '.attachments'
const MARKDOWN_PREVIEW_SOURCE_LINE_SELECTOR = '[data-source-start-line][data-source-end-line]'
const MARKDOWN_PREVIEW_REVEAL_HIGHLIGHT_CLASS = 'code-markdown-source-reveal'
const MARKDOWN_PREVIEW_REVEAL_HIGHLIGHT_DURATION_MS = 1800

type SourceTrackedMarkdownNode = Pick<HastElement, 'position'>

type SourceLineDataProps = {
  'data-source-start-line': number
  'data-source-end-line': number
}

export type MarkdownStructuredBlockKind =
  | 'table'
  | 'box-flow'
  | 'vertical-flow'
  | 'box-diagram'
  | 'architecture-diagram'

export type MarkdownStructuredBlockClickPayload = {
  kind: MarkdownStructuredBlockKind
  startLine: number
  endLine: number
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

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value)
}

function toFileUrlFromAbsolutePath(absolutePath: string): string {
  const normalized = absolutePath.trim().replace(/\\/g, '/')
  if (!normalized) return ''
  if (normalized.startsWith('//')) {
    return `file:${encodeURI(normalized)}`
  }
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${encodeURI(normalized)}`
  }
  if (normalized.startsWith('/')) {
    return `file://${encodeURI(normalized)}`
  }
  return ''
}

export function resolveMarkdownImageSrc(rawSrc: string, projectRootPath: string, activeFilePath: string | null): string {
  const trimmed = stripMarkdownImageDestinationSuffix(trimMarkdownUrlWrapper(rawSrc))
  if (!trimmed) return ''

  const lower = trimmed.toLowerCase()
  if (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('data:') ||
    lower.startsWith('blob:') ||
    lower.startsWith('file:')
  ) {
    return trimmed
  }

  if (isWindowsAbsolutePath(trimmed) || trimmed.startsWith('/')) {
    const absoluteFileUrl = toFileUrlFromAbsolutePath(trimmed)
    return absoluteFileUrl || trimmed
  }

  if (!projectRootPath) return trimmed

  const activeDirectory = activeFilePath ? dirnameFromRelativePath(activeFilePath) : ''
  const relativeToProject = activeDirectory
    ? joinPosixPaths(activeDirectory, trimmed)
    : joinPosixPaths(trimmed)

  const absolutePath = joinProjectPath(projectRootPath, relativeToProject)
  const absoluteFileUrl = toFileUrlFromAbsolutePath(absolutePath)
  return absoluteFileUrl || trimmed
}

export function transformMarkdownUrl(url: string): string {
  const trimmed = url.trim()
  if (trimmed.toLowerCase().startsWith('transcript-ref://')) {
    return trimmed
  }
  if (isWindowsAbsolutePath(trimmed)) {
    return trimmed
  }
  return defaultUrlTransform(trimmed)
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

function getSourceLineDataProps(
  node: SourceTrackedMarkdownNode | null | undefined,
  lineOffset: number
): SourceLineDataProps | undefined {
  const startLine = node?.position?.start.line
  const endLine = node?.position?.end.line
  if (typeof startLine !== 'number' || typeof endLine !== 'number') {
    return undefined
  }

  return {
    'data-source-start-line': Math.max(1, Math.floor(startLine) + lineOffset),
    'data-source-end-line': Math.max(1, Math.floor(endLine) + lineOffset),
  }
}

type MarkdownBlockProps<TagName extends keyof JSX.IntrinsicElements> =
  JSX.IntrinsicElements[TagName] & ExtraProps

function createSourceTrackedBlockComponent<TagName extends keyof JSX.IntrinsicElements>(
  tagName: TagName,
  lineOffset: number
): NonNullable<Components[TagName]> {
  return function SourceTrackedBlock({
    children,
    node,
    ...props
  }: MarkdownBlockProps<TagName>) {
    const sourceLineProps = getSourceLineDataProps(node as HastElement | undefined, lineOffset)
    return createElement(tagName, { ...props, ...sourceLineProps }, children)
  } as NonNullable<Components[TagName]>
}

function normalizeMarkdownClassNames(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.split(/\s+/).map((item) => item.trim()).filter(Boolean)
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeMarkdownClassNames(item))
  }
  return []
}

function resolveStructuredBlockKind(
  tagName: 'div' | 'table',
  className: unknown
): MarkdownStructuredBlockKind | null {
  if (tagName === 'table') {
    return 'table'
  }

  const classNames = new Set(normalizeMarkdownClassNames(className))
  if (classNames.has('code-markdown-box-flow')) {
    return 'box-flow'
  }
  if (classNames.has('code-markdown-vertical-flow')) {
    return 'vertical-flow'
  }
  if (classNames.has('code-markdown-architecture-diagram')) {
    return 'architecture-diagram'
  }
  if (classNames.has('code-markdown-box-diagram')) {
    return 'box-diagram'
  }
  return null
}

function shouldIgnoreStructuredBlockActivation(
  target: EventTarget | null,
  currentTarget: EventTarget | null
): boolean {
  const selection = window.getSelection()
  if (selection && !selection.isCollapsed && selection.toString().trim()) {
    return true
  }

  if (!(target instanceof Element) || !(currentTarget instanceof Element)) {
    return false
  }

  const interactiveAncestor = target.closest(
    'a,button,input,select,textarea,summary,[role="button"],[role="link"]'
  )
  return Boolean(
    interactiveAncestor
    && interactiveAncestor !== currentTarget
    && currentTarget.contains(interactiveAncestor)
  )
}

function createStructuredBlockComponent<TagName extends 'div' | 'table'>(
  tagName: TagName,
  lineOffset: number,
  onStructuredBlockClick?: (payload: MarkdownStructuredBlockClickPayload) => void
): NonNullable<Components[TagName]> {
  return function StructuredMarkdownBlock({
    children,
    node,
    ...props
  }: MarkdownBlockProps<TagName>) {
    const sourceLineProps = getSourceLineDataProps(node as HastElement | undefined, lineOffset)
    const rawClassName = (props as { className?: unknown }).className
    const structuredBlockKind = resolveStructuredBlockKind(tagName, rawClassName)

    if (!structuredBlockKind || !sourceLineProps) {
      return createElement(tagName, { ...props, ...sourceLineProps }, children)
    }

    if (!onStructuredBlockClick) {
      if (
        tagName === 'div'
        && structuredBlockKind === 'architecture-diagram'
        && normalizeMarkdownClassNames(rawClassName).includes('code-markdown-architecture-diagram')
      ) {
        const diagram = parseArchitectureDiagramProp(
          (props as { ['data-architecture-diagram']?: unknown })['data-architecture-diagram']
        )
        if (diagram) {
          return (
            <ArchitectureDiagramBlock
              {...props}
              {...sourceLineProps}
              className={rawClassName as string | undefined}
              diagram={diagram}
            />
          )
        }
      }
      if (
        tagName === 'div'
        && structuredBlockKind === 'box-diagram'
        && normalizeMarkdownClassNames(rawClassName).includes('code-markdown-box-diagram')
      ) {
        const diagramLines = parseBoxDiagramLinesProp(
          (props as { ['data-diagram-lines']?: unknown })['data-diagram-lines']
        )
        return (
          <BoxDiagramBlock
            {...props}
            {...sourceLineProps}
            className={rawClassName as string | undefined}
            lines={diagramLines}
          />
        )
      }
      return createElement(tagName, { ...props, ...sourceLineProps }, children)
    }

    const resolvedClassName = [
      ...normalizeMarkdownClassNames(rawClassName),
      'code-markdown-zoomable-structure',
    ].join(' ')

    const activate = () => {
      onStructuredBlockClick({
        kind: structuredBlockKind,
        startLine: sourceLineProps['data-source-start-line'],
        endLine: sourceLineProps['data-source-end-line'],
      })
    }

    const ariaLabel = `Open larger ${structuredBlockKind} preview`
    const title = (props as { title?: string }).title
    const resolvedTitle = [title, 'Click to enlarge'].filter(Boolean).join('\n')

    if (
      tagName === 'div'
      && structuredBlockKind === 'architecture-diagram'
      && normalizeMarkdownClassNames(rawClassName).includes('code-markdown-architecture-diagram')
    ) {
      const diagram = parseArchitectureDiagramProp(
        (props as { ['data-architecture-diagram']?: unknown })['data-architecture-diagram']
      )
      if (diagram) {
        return (
          <ArchitectureDiagramBlock
            {...props}
            {...sourceLineProps}
            className={resolvedClassName || undefined}
            diagram={diagram}
            tabIndex={0}
            title={resolvedTitle || undefined}
            aria-label={ariaLabel}
            data-structured-block-kind={structuredBlockKind}
            role="button"
            onClick={(event) => {
              if (shouldIgnoreStructuredBlockActivation(event.target, event.currentTarget)) {
                return
              }
              activate()
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') {
                return
              }
              event.preventDefault()
              activate()
            }}
          />
        )
      }
    }

    if (
      tagName === 'div'
      && structuredBlockKind === 'box-diagram'
      && normalizeMarkdownClassNames(rawClassName).includes('code-markdown-box-diagram')
    ) {
      const diagramLines = parseBoxDiagramLinesProp(
        (props as { ['data-diagram-lines']?: unknown })['data-diagram-lines']
      )
      return (
        <BoxDiagramBlock
          {...props}
          {...sourceLineProps}
          className={resolvedClassName || undefined}
          lines={diagramLines}
          tabIndex={0}
          title={resolvedTitle || undefined}
          aria-label={ariaLabel}
          data-structured-block-kind={structuredBlockKind}
          role="button"
          onClick={(event) => {
            if (shouldIgnoreStructuredBlockActivation(event.target, event.currentTarget)) {
              return
            }
            activate()
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') {
              return
            }
            event.preventDefault()
            activate()
          }}
        />
      )
    }

    return createElement(tagName, {
      ...props,
      ...sourceLineProps,
      className: resolvedClassName || undefined,
      tabIndex: 0,
      title: resolvedTitle || undefined,
      'aria-label': ariaLabel,
      'data-structured-block-kind': structuredBlockKind,
      ...(tagName === 'div' ? { role: 'button' as const } : {}),
      onClick: (event: ReactMouseEvent<HTMLElement>) => {
        if (shouldIgnoreStructuredBlockActivation(event.target, event.currentTarget)) {
          return
        }
        activate()
      },
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return
        }
        event.preventDefault()
        activate()
      },
    }, children)
  } as NonNullable<Components[TagName]>
}

function parseSourceLineAttribute(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

export function revealMarkdownPreviewSourceLine(container: HTMLElement, lineNumber: number): boolean {
  const targetLine = Math.max(1, Math.floor(lineNumber))
  const candidates = Array.from(
    container.querySelectorAll<HTMLElement>(MARKDOWN_PREVIEW_SOURCE_LINE_SELECTOR)
  )

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

function useNearViewport<T extends Element>(rootMargin: string): [RefObject<T>, boolean] {
  const ref = useRef<T | null>(null)
  const [isNearViewport, setIsNearViewport] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    if (typeof IntersectionObserver === 'undefined') {
      setIsNearViewport(true)
      return
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) {
        setIsNearViewport(true)
      }
    }, {
      root: null,
      rootMargin,
      threshold: 0.01,
    })

    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [rootMargin])

  return [ref as RefObject<T>, isNearViewport]
}

function shouldOpenInSystemBrowser(href: string): boolean {
  const value = href.trim().toLowerCase()
  return (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('mailto:') ||
    value.startsWith('tel:')
  )
}

type MarkdownCodeBlockProps = {
  codeText: string
  language: string
  themeMode: 'light' | 'dark'
  enableSyntaxHighlight: boolean
  sourceLineProps?: SourceLineDataProps
}

type MermaidModule = typeof import('mermaid')

let mermaidModulePromise: Promise<MermaidModule> | null = null

async function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid')
  }
  return mermaidModulePromise
}

async function renderMermaidDiagram(id: string, codeText: string, themeMode: 'light' | 'dark'): Promise<string> {
  const mermaidModule = await loadMermaid()
  const mermaid = mermaidModule.default

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: themeMode === 'dark' ? 'dark' : 'default',
    flowchart: {
      htmlLabels: false,
    },
  })

  const { svg } = await mermaid.render(id, codeText)
  return svg
}

function MermaidBlock({
  codeText,
  themeMode,
  sourceLineProps,
}: Pick<MarkdownCodeBlockProps, 'codeText' | 'themeMode' | 'sourceLineProps'>) {
  const { t } = useI18n()
  const diagramId = useId().replace(/:/g, '-')
  const [svgMarkup, setSvgMarkup] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isRendering, setIsRendering] = useState(true)

  useEffect(() => {
    let cancelled = false
    setIsRendering(true)
    setErrorMessage(null)

    void renderMermaidDiagram(`${MARKDOWN_MERMAID_RENDER_ID_PREFIX}-${diagramId}`, codeText, themeMode)
      .then((svg) => {
        if (cancelled) return
        setSvgMarkup(svg)
        setErrorMessage(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : t('codeMarkdown.unknownRenderError')
        setSvgMarkup('')
        setErrorMessage(message)
      })
      .finally(() => {
        if (cancelled) return
        setIsRendering(false)
      })

    return () => {
      cancelled = true
    }
  }, [codeText, diagramId, themeMode])

  return (
    <div className="code-markdown-mermaid-wrap" {...sourceLineProps}>
      <div className="code-markdown-mermaid-header">
        <span className="code-markdown-mermaid-badge">{t('codeMarkdown.mermaid')}</span>
        {isRendering && <span className="code-markdown-mermaid-status">{t('codeMarkdown.rendering')}</span>}
        {!isRendering && errorMessage && <span className="code-markdown-mermaid-status is-error">{t('codeMarkdown.renderFailed')}</span>}
      </div>
      {svgMarkup ? (
        <div
          className="code-markdown-mermaid-diagram"
          dangerouslySetInnerHTML={{ __html: svgMarkup }}
        />
      ) : (
        <pre className="code-markdown-plain-block">
          <code className="language-mermaid">{codeText}</code>
        </pre>
      )}
      {errorMessage && (
        <div className="code-markdown-mermaid-error" title={errorMessage}>
          {errorMessage}
        </div>
      )}
    </div>
  )
}

function StandardMarkdownCodeBlock({
  codeText,
  language,
  themeMode,
  enableSyntaxHighlight,
  sourceLineProps,
}: MarkdownCodeBlockProps) {
  const { t } = useI18n()
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [containerRef, isNearViewport] = useNearViewport<HTMLDivElement>(MARKDOWN_CODE_BLOCK_PRELOAD_ROOT_MARGIN)
  const shouldRenderSyntax = enableSyntaxHighlight && canHighlightMarkdownCodeBlock(codeText) && isNearViewport

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

  const copyLabel = copyStatus === 'success' ? t('codeMarkdown.copied') : copyStatus === 'error' ? t('codeMarkdown.copyFailed') : t('codeMarkdown.copy')

  return (
    <div ref={containerRef} className="code-markdown-syntax-wrap" {...sourceLineProps}>
      <button
        type="button"
        className={`code-markdown-copy-btn ${
          copyStatus === 'success' ? 'is-success' : copyStatus === 'error' ? 'is-error' : ''
        }`}
        onClick={() => {
          void handleCopy()
        }}
        title={copyLabel}
      >
        {copyStatus === 'success' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        <span>{copyLabel}</span>
      </button>

      {shouldRenderSyntax ? (
        <SyntaxHighlighter
          language={language}
          style={themeMode === 'dark' ? oneDark : oneLight}
          PreTag="div"
          className="code-markdown-syntax-block"
          customStyle={{ margin: 0, borderRadius: 10, paddingTop: 38 }}
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
    return (
      <MermaidBlock
        codeText={props.codeText}
        themeMode={props.themeMode}
        sourceLineProps={props.sourceLineProps}
      />
    )
  }

  return <StandardMarkdownCodeBlock {...props} />
}

type CreateMarkdownComponentsOptions = {
  activeRelativePath: string | null
  activeInternalHref?: string | null
  enableMarkdownSyntaxHighlight: boolean
  lineOffset?: number
  onInternalLinkClick?: (href: string) => void
  onStructuredBlockClick?: (payload: MarkdownStructuredBlockClickPayload) => void
  projectPath: string
  themeMode: 'light' | 'dark'
}

function isTranscriptReferenceHref(value: string): boolean {
  return value.trim().toLowerCase().startsWith('transcript-ref://')
}

export function createMarkdownComponents({
  activeRelativePath,
  activeInternalHref = null,
  enableMarkdownSyntaxHighlight,
  lineOffset = 0,
  onInternalLinkClick,
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
      return <img {...props} src={resolvedSrc} alt={alt || ''} loading="lazy" />
    },
    a({ href, children, className, ...props }) {
      const link = typeof href === 'string' ? href.trim() : ''
      const internal = Boolean(link) && isTranscriptReferenceHref(link)
      const canConsumeInternal = internal && typeof onInternalLinkClick === 'function'
      const external = Boolean(link) && shouldOpenInSystemBrowser(link)
      const resolvedClassName = [
        className,
        internal ? 'code-markdown-transcript-ref rounded-[8px] px-1.5 py-0.5 transition-all duration-150' : '',
        internal && activeInternalHref === link
          ? 'is-active bg-[color:var(--color-warning-background)] text-[color:var(--color-foreground)]'
          : '',
      ].filter(Boolean).join(' ')

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
      return <code className={mergedClassName} {...props}>{children}</code>
    },
  }
}

export function fileNameFromRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/')
  const segments = normalized.split('/')
  return segments[segments.length - 1] || relativePath
}
