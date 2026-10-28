import type { AgentHistoryRenderingConfig, AgentHistoryRenderMode, AgentHistoryTagRule } from '../../shared/types/agentHistoryRendering'
import { DEFAULT_AGENT_HISTORY_RENDERING_CONFIG, DEFAULT_AGENT_HISTORY_TAG_RULES } from '../../shared/types/agentHistoryRendering'

const STORAGE_KEY = 'workbench:agent-history-rendering:v1'

export type AgentHistoryMessageSegment = { kind: 'text'; text: string } | { kind: 'tag'; tagName: string; attributes: Record<string, string>; content: string; raw: string; mode: AgentHistoryRenderMode; rule: AgentHistoryTagRule }

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const pattern = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g
  for (const match of source.matchAll(pattern))
    attributes[match[1]] = (match[2] ?? match[3] ?? match[4] ?? '')
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
  return attributes
}

function getRule(tagName: string, config: AgentHistoryRenderingConfig): AgentHistoryTagRule | null {
  const normalized = tagName.toLowerCase()
  const customRule = (config?.customRules ?? []).find((rule) => rule.tagNames.some((name) => name.toLowerCase() === normalized))
  if (customRule) return customRule.enabled ? customRule : null
  return DEFAULT_AGENT_HISTORY_TAG_RULES.find((rule) => rule.enabled && rule.tagNames.some((name) => name.toLowerCase() === normalized)) ?? null
}

export function loadAgentHistoryRenderingConfig(): AgentHistoryRenderingConfig {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<AgentHistoryRenderingConfig>
    return { ...DEFAULT_AGENT_HISTORY_RENDERING_CONFIG, customRules: Array.isArray(parsed.customRules) ? parsed.customRules : [] }
  } catch {
    return DEFAULT_AGENT_HISTORY_RENDERING_CONFIG
  }
}

export function saveAgentHistoryRenderingConfig(config: AgentHistoryRenderingConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // Preferences are best effort in restricted WebViews.
  }
}

export function createCustomAgentHistoryRule(tagName: string, mode: AgentHistoryRenderMode): AgentHistoryTagRule | null {
  const normalized = tagName.trim().replace(/^<|>$/g, '')
  if (!/^[A-Za-z][\w:.-]*$/.test(normalized)) return null
  return { id: `custom:${normalized.toLowerCase()}`, tagNames: [normalized], category: 'custom', mode, enabled: true }
}

export function segmentAgentHistoryMessage(text: string, config?: AgentHistoryRenderingConfig): AgentHistoryMessageSegment[] {
  const segments: AgentHistoryMessageSegment[] = []
  const pattern = /<([A-Za-z][\w:.-]*)([^<>]*?)(\/?)>/g
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const start = match.index ?? 0
    const tagName = match[1]
    const rule = getRule(tagName, config ?? DEFAULT_AGENT_HISTORY_RENDERING_CONFIG)
    if (!rule) continue
    if (start > cursor) segments.push({ kind: 'text', text: text.slice(cursor, start) })
    const attributes = parseAttributes(match[2])
    const isSelfClosing = match[3] === '/'
    let end = start + match[0].length
    let content = ''
    if (!isSelfClosing) {
      const closing = new RegExp(`</${tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>`, 'i').exec(text.slice(end))
      if (!closing) continue
      content = text.slice(end, end + closing.index)
      end += closing.index + closing[0].length
    }
    segments.push({ kind: 'tag', tagName, attributes, content, raw: text.slice(start, end), mode: rule.mode, rule })
    cursor = end
    pattern.lastIndex = end
  }
  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) })
  return segments.length > 0 ? segments : [{ kind: 'text', text }]
}
