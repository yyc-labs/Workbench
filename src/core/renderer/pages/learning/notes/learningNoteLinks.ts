import type { LearningNoteSummary } from '../../../../shared/types'

const NOTE_LINK_PATTERN = /\[\[([^\]]+)\]\]/g

export function extractLearningNoteLinkTitles(content: string): string[] {
  return [...new Set([...content.matchAll(NOTE_LINK_PATTERN)].map((match) => match[1].trim()).filter(Boolean))]
}

export function resolveLearningNoteLinks(content: string, notes: LearningNoteSummary[]): LearningNoteSummary[] {
  const titles = new Set(extractLearningNoteLinkTitles(content).map((title) => title.toLocaleLowerCase()))
  return notes.filter((note) => titles.has(note.title.toLocaleLowerCase()))
}
