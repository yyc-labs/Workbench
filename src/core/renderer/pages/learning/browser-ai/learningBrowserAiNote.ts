import type { BrowserAiTaskRecord } from '../../../../shared/types'

/** Keeps browser answers useful after their task history is removed, without copying source content. */
export function createLearningNoteFromBrowserAiRecord(record: BrowserAiTaskRecord): string {
  const sourceDate = new Date(record.completedAt ?? record.updatedAt).toLocaleString()
  const sourceLabels = record.sources
    .filter((source) => source.included)
    .map((source) => source.label)
    .join(', ')
  return [
    '## Conclusion',
    '',
    record.answer ?? '',
    '',
    '## Key points',
    '',
    '- ',
    '',
    '## Questions to verify',
    '',
    '- ',
    '',
    '## Source',
    '',
    `- Browser AI task: ${record.title}`,
    `- Site: ${record.site.name} (${record.site.url})`,
    `- Completed: ${sourceDate}`,
    sourceLabels ? `- Selected context: ${sourceLabels}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
