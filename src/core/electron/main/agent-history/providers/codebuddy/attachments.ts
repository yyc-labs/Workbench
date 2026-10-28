import attachmentRules from './attachments.json'

type AttachmentRule = { blockTypes: string[]; sourceField: string; nameField?: string; renderTag: string }
type ProviderRule = { messageTypeField: string; messageTypes: string[]; contentField: string; attachments: AttachmentRule[] }

function getPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => (current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined), value)
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Convert configured structured attachment blocks to the renderer's safe, known tag format. */
export function appendConfiguredAgentHistoryAttachments(row: unknown): string {
  if (!row || typeof row !== 'object') return ''
  const config = attachmentRules as ProviderRule
  if (!config.messageTypes.includes(String(getPath(row, config.messageTypeField)))) return ''
  const blocks = getPath(row, config.contentField)
  if (!Array.isArray(blocks)) return ''
  const tags: string[] = []
  for (const block of blocks) {
    for (const rule of config.attachments) {
      if (!rule.blockTypes.includes(String(getPath(block, 'type')))) continue
      const source = getPath(block, rule.sourceField)
      if (typeof source !== 'string' || !source.trim()) continue
      const name = rule.nameField ? getPath(block, rule.nameField) : undefined
      const attrs = [`path="${escapeAttribute(source)}"`, ...(typeof name === 'string' && name ? [`name="${escapeAttribute(name)}"`] : [])]
      tags.push(`<${rule.renderTag} ${attrs.join(' ')} />`)
    }
  }
  return tags.length ? `${tags.join('\n')}\n` : ''
}
