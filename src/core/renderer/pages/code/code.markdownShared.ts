const MARKDOWN_PREVIEW_SOURCE_LINE_SELECTOR = '[data-source-start-line][data-source-end-line]'
const MARKDOWN_PREVIEW_REVEAL_HIGHLIGHT_CLASS = 'code-markdown-source-reveal'
const MARKDOWN_PREVIEW_REVEAL_HIGHLIGHT_DURATION_MS = 1800

export const MARKDOWN_PREVIEW_SCROLL_ROOT_SELECTOR = '.code-markdown-preview-scroll-root'

type HastNodeLike = { value?: unknown; children?: HastNodeLike[] }

export function extractHastText(node: HastNodeLike | null | undefined): string {
  if (!node) return ''
  if (typeof node.value === 'string') return node.value
  if (!Array.isArray(node.children)) return ''
  return node.children.map((child) => extractHastText(child)).join('')
}

/** GitHub-style heading slug: lowercase, strip punctuation, whitespace -> hyphen, keep unicode letters/digits. */
export function slugifyMarkdownHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s-]/gu, '')
    .replace(/\s/g, '-')
}

export function scrollMarkdownPreviewToAnchor(container: HTMLElement, href: string): boolean {
  const anchor = href.trim().replace(/^#/, '')
  if (!anchor) return false

  let decoded = anchor
  try {
    decoded = decodeURIComponent(anchor)
  } catch {
    // Anchor is not valid percent-encoding — fall back to the raw value.
  }

  const id = slugifyMarkdownHeading(decoded)
  if (!id) return false

  const target = container.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
  if (!target) return false

  target.scrollIntoView({ behavior: 'auto', block: 'start', inline: 'nearest' })
  return true
}

export type MarkdownHeadingItem = {
  depth: number
  text: string
  /** 1-based line number in the full document (frontmatter offset already applied). */
  lineNumber: number
  slug: string
}

const MARKDOWN_FENCED_CODE_PATTERN = /^\s{0,3}(`{3,}|~{3,})/
const MARKDOWN_ATX_HEADING_PATTERN = /^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/

/** Extract ATX headings (`#`–`######`) outside fenced code blocks, with document line numbers. */
export function extractMarkdownHeadings(markdownBody: string, lineOffset = 0): MarkdownHeadingItem[] {
  const headings: MarkdownHeadingItem[] = []
  let fenceMarker: string | null = null

  const lines = markdownBody.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const fenceMatch = line.match(MARKDOWN_FENCED_CODE_PATTERN)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!fenceMarker) {
        fenceMarker = marker
      } else if (marker[0] === fenceMarker[0] && marker.length >= fenceMarker.length) {
        fenceMarker = null
      }
      continue
    }
    if (fenceMarker) continue

    const headingMatch = line.match(MARKDOWN_ATX_HEADING_PATTERN)
    if (!headingMatch) continue

    const text = headingMatch[2].trim()
    if (!text) continue

    headings.push({
      depth: headingMatch[1].length,
      text,
      lineNumber: index + 1 + lineOffset,
      slug: slugifyMarkdownHeading(text),
    })
  }

  return headings
}

export function fileNameFromRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/')
  const segments = normalized.split('/')
  return segments[segments.length - 1] || relativePath
}

function parseSourceLineAttribute(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function findMarkdownPreviewSourceElement(container: HTMLElement, targetLine: number): { element: HTMLElement; startLine: number; endLine: number } | null {
  const candidates = Array.from(container.querySelectorAll<HTMLElement>(MARKDOWN_PREVIEW_SOURCE_LINE_SELECTOR))
  let containing: { element: HTMLElement; startLine: number; endLine: number; lineSpan: number } | null = null
  let nextClosest: { element: HTMLElement; startLine: number; endLine: number } | null = null
  let previousClosest: { element: HTMLElement; startLine: number; endLine: number } | null = null

  for (const element of candidates) {
    const startLine = parseSourceLineAttribute(element.getAttribute('data-source-start-line'))
    const endLine = parseSourceLineAttribute(element.getAttribute('data-source-end-line'))
    if (startLine == null || endLine == null) continue

    if (startLine <= targetLine && targetLine <= endLine) {
      const lineSpan = Math.max(0, endLine - startLine)
      if (!containing || lineSpan <= containing.lineSpan) {
        containing = { element, startLine, endLine, lineSpan }
      }
      continue
    }

    if (startLine > targetLine && (!nextClosest || startLine < nextClosest.startLine)) {
      nextClosest = { element, startLine, endLine }
    }

    if (endLine < targetLine && (!previousClosest || endLine > previousClosest.endLine)) {
      previousClosest = { element, startLine, endLine }
    }
  }

  const target = containing ?? nextClosest ?? previousClosest
  return target ? { element: target.element, startLine: target.startLine, endLine: target.endLine } : null
}

function elementScrollTopWithinContainer(container: HTMLElement, element: HTMLElement): number {
  return element.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
}

export function scrollMarkdownPreviewToSourceLine(container: HTMLElement, lineNumber: number): boolean {
  const targetLine = Math.max(1, Math.floor(lineNumber))
  const target = findMarkdownPreviewSourceElement(container, targetLine)
  if (!target) return false

  const firstSourceElement = container.querySelector<HTMLElement>(MARKDOWN_PREVIEW_SOURCE_LINE_SELECTOR)
  if (target.element === firstSourceElement && targetLine <= target.startLine) {
    container.scrollTop = 0
    return true
  }

  const lineSpan = Math.max(1, target.endLine - target.startLine)
  const lineProgress = Math.min(1, Math.max(0, (targetLine - target.startLine) / lineSpan))
  const targetTop = elementScrollTopWithinContainer(container, target.element) + target.element.getBoundingClientRect().height * lineProgress
  container.scrollTop = Math.max(0, targetTop)
  return true
}

export function getMarkdownPreviewSourceLineAtScrollTop(container: HTMLElement): number | null {
  const viewportTop = container.getBoundingClientRect().top
  const candidates = Array.from(container.querySelectorAll<HTMLElement>(MARKDOWN_PREVIEW_SOURCE_LINE_SELECTOR))
  let closest: { element: HTMLElement; startLine: number; endLine: number; distance: number } | null = null

  for (const element of candidates) {
    const startLine = parseSourceLineAttribute(element.getAttribute('data-source-start-line'))
    const endLine = parseSourceLineAttribute(element.getAttribute('data-source-end-line'))
    if (startLine == null || endLine == null) continue

    const rect = element.getBoundingClientRect()
    const distance = rect.top <= viewportTop && rect.bottom >= viewportTop ? 0 : Math.min(Math.abs(rect.top - viewportTop), Math.abs(rect.bottom - viewportTop))
    if (!closest || distance < closest.distance || (distance === closest.distance && endLine - startLine < closest.endLine - closest.startLine)) {
      closest = { element, startLine, endLine, distance }
    }
  }

  if (!closest) return null
  const rect = closest.element.getBoundingClientRect()
  const progress = rect.height > 0 ? Math.min(1, Math.max(0, (viewportTop - rect.top) / rect.height)) : 0
  return Math.round(closest.startLine + (closest.endLine - closest.startLine) * progress)
}

export function revealMarkdownPreviewSourceLine(container: HTMLElement, lineNumber: number): boolean {
  const targetLine = Math.max(1, Math.floor(lineNumber))
  const target = findMarkdownPreviewSourceElement(container, targetLine)?.element
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
