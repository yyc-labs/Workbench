export type CursorRuleType = 'Always' | 'Auto Attached' | 'Agent Requested' | 'Manual'

export interface CursorRuleFrontmatterMeta {
  description?: string
  globs: string[]
  alwaysApply?: boolean
  ruleType: CursorRuleType
}

export interface MarkdownFrontmatterMeta {
  title?: string
  description?: string
}

export interface MarkdownCustomFrontmatterMeta {
  key: string
  value: string
}

export interface ParsedMarkdownDocument {
  hasFrontmatter: boolean
  markdownBodyLineOffset: number
  markdownBody: string
  ruleMetadata: CursorRuleFrontmatterMeta | null
  markdownMetadata: MarkdownFrontmatterMeta | null
  customMetadata: MarkdownCustomFrontmatterMeta[]
}

type FrontmatterKv = Record<string, string>

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length < 2) return trimmed
  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseInlineList(value: string): string[] {
  const trimmed = value.trim()
  if (!trimmed) return []

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim()
    if (!inner) return []
    return inner
      .split(',')
      .map((item) => stripWrappingQuotes(item))
      .map((item) => item.trim())
      .filter(Boolean)
  }

  return [stripWrappingQuotes(trimmed)].filter(Boolean)
}

function parseFrontmatter(rawFrontmatter: string): { kv: FrontmatterKv; globs: string[] } {
  const lines = rawFrontmatter.replace(/\r/g, '').split('\n')
  const kv: FrontmatterKv = {}
  let globs: string[] = []

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const keyValue = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(trimmed)
    if (!keyValue) continue

    const key = keyValue[1].toLowerCase()
    const value = keyValue[2].trim()

    if (key === 'globs') {
      if (value) {
        globs = parseInlineList(value)
        continue
      }

      const collected: string[] = []
      let j = i + 1
      while (j < lines.length) {
        const nextRaw = lines[j]
        const nextTrimmed = nextRaw.trim()
        if (!nextTrimmed) {
          j += 1
          continue
        }
        if (/^\s*-\s+/.test(nextRaw)) {
          const item = nextRaw.replace(/^\s*-\s+/, '').trim()
          const normalized = stripWrappingQuotes(item)
          if (normalized) collected.push(normalized)
          j += 1
          continue
        }
        break
      }
      globs = collected
      i = Math.max(i, j - 1)
      continue
    }

    kv[key] = stripWrappingQuotes(value)
  }

  return { kv, globs }
}

function parseCustomMetadata(kv: FrontmatterKv): MarkdownCustomFrontmatterMeta[] {
  const knownKeys = new Set(['description', 'globs', 'alwaysapply', 'title'])
  return Object.entries(kv)
    .filter(([key]) => !knownKeys.has(key))
    .map(([key, value]) => ({ key, value }))
}

function resolveRuleType(meta: Omit<CursorRuleFrontmatterMeta, 'ruleType'>): CursorRuleType {
  if (meta.alwaysApply === true) return 'Always'
  if (meta.globs.length > 0) return 'Auto Attached'
  if ((meta.description ?? '').trim()) return 'Agent Requested'
  return 'Manual'
}

function parseRuleMetadata(kv: FrontmatterKv, globs: string[]): CursorRuleFrontmatterMeta {
  const alwaysRaw = (kv.alwaysapply ?? '').trim().toLowerCase()
  const alwaysApply = alwaysRaw === 'true' ? true : alwaysRaw === 'false' ? false : undefined
  const description = kv.description?.trim() || undefined
  const baseMeta = { description, globs, alwaysApply }
  return {
    ...baseMeta,
    ruleType: resolveRuleType(baseMeta),
  }
}

function parseMarkdownMetadata(kv: FrontmatterKv): MarkdownFrontmatterMeta | null {
  const title = kv.title?.trim() || undefined
  const description = kv.description?.trim() || undefined
  if (!title && !description) return null
  return { title, description }
}

function countLines(value: string): number {
  if (!value) return 0
  return value.split('\n').length
}

export function parseMarkdownDocument(source: string): ParsedMarkdownDocument {
  const normalized = source.replace(/\r\n/g, '\n')
  const frontmatterMatch = normalized.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/)
  if (!frontmatterMatch) {
    return {
      hasFrontmatter: false,
      markdownBodyLineOffset: 0,
      markdownBody: source,
      ruleMetadata: null,
      markdownMetadata: null,
      customMetadata: [],
    }
  }

  const frontmatterRaw = frontmatterMatch[1]
  const { kv, globs } = parseFrontmatter(frontmatterRaw)
  return {
    hasFrontmatter: true,
    markdownBodyLineOffset: Math.max(0, countLines(frontmatterMatch[0]) - 1),
    markdownBody: normalized.slice(frontmatterMatch[0].length),
    ruleMetadata: parseRuleMetadata(kv, globs),
    markdownMetadata: parseMarkdownMetadata(kv),
    customMetadata: parseCustomMetadata(kv),
  }
}
