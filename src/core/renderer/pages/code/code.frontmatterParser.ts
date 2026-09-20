export type CursorRuleType = 'Always' | 'Auto Attached' | 'Agent Requested' | 'Manual'

export interface CursorRuleFrontmatterMeta {
  description?: string
  globs: string[]
  alwaysApply?: boolean
  ruleType: CursorRuleType
}

export interface MarkdownFrontmatterEntry {
  key: string
  value: string
}

export interface ParsedMarkdownDocument {
  hasFrontmatter: boolean
  markdownBodyLineOffset: number
  markdownBody: string
  ruleMetadata: CursorRuleFrontmatterMeta | null
  frontmatterEntries: MarkdownFrontmatterEntry[]
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

function upsertFrontmatterEntry(entries: MarkdownFrontmatterEntry[], originalKey: string, value: string): void {
  const lowerKey = originalKey.toLowerCase()
  const existingIndex = entries.findIndex((entry) => entry.key.toLowerCase() === lowerKey)
  if (existingIndex >= 0) {
    entries[existingIndex] = { key: originalKey, value }
    return
  }
  entries.push({ key: originalKey, value })
}

function parseFrontmatter(rawFrontmatter: string): { kv: FrontmatterKv; globs: string[]; entries: MarkdownFrontmatterEntry[] } {
  const lines = rawFrontmatter.replace(/\r/g, '').split('\n')
  const kv: FrontmatterKv = {}
  const entries: MarkdownFrontmatterEntry[] = []
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
        upsertFrontmatterEntry(entries, keyValue[1], stripWrappingQuotes(value))
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
      upsertFrontmatterEntry(entries, keyValue[1], collected.join(', '))
      i = Math.max(i, j - 1)
      continue
    }

    kv[key] = stripWrappingQuotes(value)
    upsertFrontmatterEntry(entries, keyValue[1], kv[key])
  }

  return { kv, globs, entries }
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
      frontmatterEntries: [],
    }
  }

  const frontmatterRaw = frontmatterMatch[1]
  const { kv, globs, entries } = parseFrontmatter(frontmatterRaw)
  return {
    hasFrontmatter: true,
    markdownBodyLineOffset: Math.max(0, countLines(frontmatterMatch[0]) - 1),
    markdownBody: normalized.slice(frontmatterMatch[0].length),
    ruleMetadata: parseRuleMetadata(kv, globs),
    frontmatterEntries: entries,
  }
}
