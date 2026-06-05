import { Children, isValidElement, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Check, Copy } from 'lucide-react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import type { Components } from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { joinProjectPath } from './code.pathActions'
import { copyTextToClipboard } from './code.clipboard'

const MARKDOWN_DISABLE_SYNTAX_HIGHLIGHT_CHAR_THRESHOLD = 180_000
const MARKDOWN_DISABLE_SYNTAX_HIGHLIGHT_LINE_THRESHOLD = 3500
const MARKDOWN_CODE_BLOCK_DISABLE_HIGHLIGHT_CHAR_THRESHOLD = 40_000
const MARKDOWN_CODE_BLOCK_DISABLE_HIGHLIGHT_LINE_THRESHOLD = 700
const MARKDOWN_CODE_BLOCK_PRELOAD_ROOT_MARGIN = '320px 0px'
export const MARKDOWN_PASTE_IMAGE_DIRECTORY = '.attachments'

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

  const codeText = String(codeProps.children ?? '').replace(/\n$/, '')
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
}

function MarkdownCodeBlock({ codeText, language, themeMode, enableSyntaxHighlight }: MarkdownCodeBlockProps) {
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

  const copyLabel = copyStatus === 'success' ? 'Copied' : copyStatus === 'error' ? 'Copy failed' : 'Copy'

  return (
    <div ref={containerRef} className="code-markdown-syntax-wrap">
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

type CreateMarkdownComponentsOptions = {
  activeRelativePath: string | null
  enableMarkdownSyntaxHighlight: boolean
  projectPath: string
  themeMode: 'light' | 'dark'
}

export function createMarkdownComponents({
  activeRelativePath,
  enableMarkdownSyntaxHighlight,
  projectPath,
  themeMode,
}: CreateMarkdownComponentsOptions): Components {
  return {
    pre({ children }) {
      const codeBlock = extractCodeBlockFromPreChildren(children)
      if (!codeBlock) {
        return <pre>{children}</pre>
      }

      return (
        <MarkdownCodeBlock
          codeText={codeBlock.codeText}
          language={codeBlock.language}
          themeMode={themeMode}
          enableSyntaxHighlight={enableMarkdownSyntaxHighlight}
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
    a({ href, children, ...props }) {
      const link = typeof href === 'string' ? href.trim() : ''
      const external = Boolean(link) && shouldOpenInSystemBrowser(link)

      return (
        <a
          {...props}
          href={link || href}
          target={external ? '_blank' : props.target}
          rel={external ? 'noopener noreferrer' : props.rel}
          onClick={(event) => {
            props.onClick?.(event)
            if (event.defaultPrevented) return
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
