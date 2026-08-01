export type MarkdownDocumentDisplayMode = 'edit' | 'preview' | 'split'

export type MarkdownDocumentHistoryEntry = {
  path: string
  normalizedPath: string
  displayName: string
  lastOpenedAt: number
  lastKnownMtimeMs?: number
  missing?: boolean
}

export type MarkdownDocumentReadResult = {
  path: string
  content: string
  size: number
  mtimeMs: number
  encoding: 'utf-8'
}

export type MarkdownDocumentWriteResult = {
  path: string
  size: number
  mtimeMs: number
}

export type MarkdownDocumentOpenRequest = { path: string }
