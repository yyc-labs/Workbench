import type {
  BrowserAiContextPreview,
  BrowserAiContextSource,
  BrowserAiErrorCode,
  BrowserAiRunTaskPayload,
} from '../../../shared/types'

export const MAX_BROWSER_AI_SOURCE_CHARS = 24_000
export const MAX_BROWSER_AI_CONTEXT_CHARS = 90_000

const SOURCE_ORDER: BrowserAiContextSource['kind'][] = [
  'skill',
  'personal-context',
  'learning-note',
  'task',
]

const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:\\[^\n\r<>"|?*]+/g
const WSL_PATH_PATTERN = /(?<![\w/])\/mnt\/[a-zA-Z]\/[^\n\r<>"|?*]+/g

export class BrowserAiContextError extends Error {
  readonly code: BrowserAiErrorCode

  constructor(code: BrowserAiErrorCode, message: string) {
    super(message)
    this.name = 'BrowserAiContextError'
    this.code = code
  }
}

function normalizeContent(value: string): string {
  return value
    .replace(/\0/g, '')
    .replace(WINDOWS_PATH_PATTERN, '[local-path]')
    .replace(WSL_PATH_PATTERN, '[local-path]')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]{3,}/g, '  ')
    .trim()
}

function kindTag(kind: BrowserAiContextSource['kind']): string {
  return kind.replace(/-/g, '_')
}

function normalizeSource(source: BrowserAiContextSource): BrowserAiContextSource {
  return {
    ...source,
    label: source.label.trim() || 'Untitled source',
    content: normalizeContent(source.content),
    included: Boolean(source.included),
  }
}

function orderedSources(sources: BrowserAiContextSource[]): BrowserAiContextSource[] {
  return sources
    .map(normalizeSource)
    .filter((source) => source.included && source.content)
    .sort((left, right) => SOURCE_ORDER.indexOf(left.kind) - SOURCE_ORDER.indexOf(right.kind))
}

function summaryFor(source: BrowserAiContextSource, content: string) {
  return {
    kind: source.kind,
    label: source.label,
    included: source.included,
    sensitive: source.kind === 'personal-context',
    characterCount: content.length,
  } as const
}

export function composeBrowserAiContext(payload: BrowserAiRunTaskPayload): BrowserAiContextPreview {
  const task = normalizeContent(payload.task || '')
  if (!task) {
    throw new BrowserAiContextError('CONTEXT_INVALID', 'A task question is required.')
  }

  const sources = orderedSources(payload.sources ?? []).filter((source) => source.kind !== 'task')
  const blocks: string[] = []
  const summaries = sources.map((source) => {
    if (source.content.length > MAX_BROWSER_AI_SOURCE_CHARS) {
      throw new BrowserAiContextError(
        'CONTEXT_TOO_LARGE',
        `Source "${source.label}" exceeds the ${MAX_BROWSER_AI_SOURCE_CHARS}-character limit.`,
      )
    }
    blocks.push(`<${kindTag(source.kind)}>\n${source.content}\n</${kindTag(source.kind)}>`) 
    return summaryFor(source, source.content)
  })

  const responseFormat = normalizeContent(payload.responseFormat || '')
  blocks.push(`<task>\n${task}\n</task>`)
  if (responseFormat) {
    if (responseFormat.length > MAX_BROWSER_AI_SOURCE_CHARS) {
      throw new BrowserAiContextError('CONTEXT_TOO_LARGE', 'The response format is too long.')
    }
    blocks.push(`<response_format>\n${responseFormat}\n</response_format>`)
  }
  const prompt = blocks.join('\n\n')
  if (prompt.length > MAX_BROWSER_AI_CONTEXT_CHARS) {
    throw new BrowserAiContextError(
      'CONTEXT_TOO_LARGE',
      `The combined context exceeds the ${MAX_BROWSER_AI_CONTEXT_CHARS}-character limit.`,
    )
  }

  return {
    prompt,
    characterCount: prompt.length,
    sourceLabels: [...summaries.map((source) => source.label), 'Current task'],
    sources: [
      ...summaries,
      {
        kind: 'task',
        label: 'Current task',
        included: true,
        sensitive: false,
        characterCount: task.length,
      },
    ],
    site: payload.site,
  }
}
