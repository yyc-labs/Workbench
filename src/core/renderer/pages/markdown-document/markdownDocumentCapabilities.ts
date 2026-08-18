import type { MarkdownDocumentCompatibility, MarkdownDocumentComplexity, MarkdownDocumentComplexityLevel, MarkdownDocumentDisplayMode } from './markdownDocumentTypes'

const FENCE = String.fromCharCode(96)
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/
const FENCED_CODE_RE = new RegExp('^' + FENCE + FENCE + FENCE, 'm')
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/m
const IMAGE_RE = /!\[[^\]]*]\(([^)]+)\)/g
const MERMAID_FENCE_RE = new RegExp('^' + FENCE + FENCE + FENCE + 'mermaid\\s*$', 'gim')
const RAW_HTML_RE = /<(?!\/?(?:br|hr|img|a|span|p|div|table|thead|tbody|tr|td|th|code|pre)\b|!--)[A-Za-z][^>]*>/m
const BLOCK_SEPARATOR_RE = /\n{2,}/g

function countLines(value: string): number {
  if (!value) return 0
  let count = 1
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) count += 1
  }
  return count
}

function countMatches(source: string, pattern: RegExp): number {
  const flags = pattern.flags.indexOf('g') >= 0 ? pattern.flags : pattern.flags + 'g'
  const matcher = new RegExp(pattern.source, flags)
  let count = 0
  while (matcher.exec(source)) count += 1
  return count
}

function countTopLevelBlocks(markdown: string): number {
  const trimmed = markdown.trim()
  if (!trimmed) return 0
  return trimmed.split(BLOCK_SEPARATOR_RE).filter(Boolean).length
}

export function classifyMarkdownDocumentCompatibility(markdown: string): MarkdownDocumentCompatibility {
  const reasons: string[] = []

  if (FRONTMATTER_RE.test(markdown)) reasons.push('frontmatter')
  if (RAW_HTML_RE.test(markdown)) reasons.push('raw-html')
  if (markdown.indexOf(String.fromCharCode(96).repeat(3)) >= 0 && markdown.indexOf('~~~') >= 0) reasons.push('mixed-fences')
  if (markdown.indexOf('|---') >= 0 && markdown.indexOf('::') >= 0) reasons.push('table-alignment-markers')
  if (markdown.indexOf('┼') >= 0 || markdown.indexOf('│') >= 0) reasons.push('box-drawing-table')

  if (reasons.indexOf('raw-html') >= 0 || reasons.indexOf('box-drawing-table') >= 0) {
    return { level: 'source-only', reasons }
  }

  if (reasons.length > 0) {
    return { level: 'normalized', reasons }
  }

  return { level: 'full', reasons }
}

export function classifyMarkdownDocumentComplexity(markdown: string): MarkdownDocumentComplexity {
  const bytes = new TextEncoder().encode(markdown).length
  const lines = countLines(markdown)
  const topLevelBlocks = countTopLevelBlocks(markdown)
  const codeFenceCount = countMatches(markdown, FENCED_CODE_RE)
  const mermaidCount = countMatches(markdown, MERMAID_FENCE_RE)
  const tableRowEstimate = countMatches(markdown, TABLE_ROW_RE)
  const imageCount = countMatches(markdown, IMAGE_RE)

  let level: MarkdownDocumentComplexityLevel = 'normal'
  if (bytes > 5_000_000 || lines > 100_000 || (topLevelBlocks > 5_000 && (codeFenceCount > 500 || tableRowEstimate > 5_000))) {
    level = 'source-first'
  } else if (bytes > 1_000_000 || lines > 20_000 || codeFenceCount > 100 || mermaidCount > 20 || tableRowEstimate > 1_000 || imageCount > 100) {
    level = 'reduced'
  }

  return {
    bytes,
    lines,
    topLevelBlocks,
    codeFenceCount,
    mermaidCount,
    tableRowEstimate,
    imageCount,
    level,
  }
}

export function inferMarkdownDocumentDisplayMode(_markdown: string): MarkdownDocumentDisplayMode {
  return 'preview'
}
