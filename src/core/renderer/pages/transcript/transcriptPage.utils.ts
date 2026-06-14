const TRANSCRIPT_DECORATIVE_RULE_MIN_LENGTH = 48
const PROJECT_PAGE_CONTEXT_MENU_IGNORE_SELECTOR = [
  'button',
  'a',
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '.monaco-editor',
  '.xterm',
  '[role="dialog"]',
].join(', ')

export const TRANSCRIPT_SPLIT_BREAKPOINT_PX = 960
export const TRANSCRIPT_SPLIT_QUERY = `(max-width: ${TRANSCRIPT_SPLIT_BREAKPOINT_PX}px)`
export const PROJECT_HEADER_COLLAPSED_STORAGE_KEY = 'app:project-header-collapsed'

export function normalizeTranscriptDisplayMarkdown(markdown: string): string {
  if (!markdown) return ''
  return markdown.replace(
    new RegExp(`^[\\t ]*[─━═-]{${TRANSCRIPT_DECORATIVE_RULE_MIN_LENGTH},}[\\t ]*$`, 'gm'),
    '---'
  )
}

export function sliceMarkdownLines(markdown: string, startLine: number, endLine: number): string {
  if (!markdown) return ''
  const lines = markdown.split('\n')
  const safeStartLine = Math.max(1, Math.floor(startLine))
  const safeEndLine = Math.max(safeStartLine, Math.floor(endLine))
  return lines.slice(safeStartLine - 1, safeEndLine).join('\n').trim()
}

export function readProjectHeaderCollapsed(): boolean {
  try {
    return localStorage.getItem(PROJECT_HEADER_COLLAPSED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function shouldSkipProjectPageContextMenu(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(PROJECT_PAGE_CONTEXT_MENU_IGNORE_SELECTOR))
}
