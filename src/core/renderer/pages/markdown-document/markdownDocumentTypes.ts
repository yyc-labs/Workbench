export type MarkdownDocumentDisplayMode = 'rich' | 'source' | 'preview' | 'split'

export type MarkdownDocumentCompatibilityLevel = 'full' | 'normalized' | 'source-only'

export type MarkdownDocumentComplexityLevel = 'normal' | 'reduced' | 'source-first'

export type MarkdownDocumentCompatibility = {
  level: MarkdownDocumentCompatibilityLevel
  reasons: string[]
}

export type MarkdownDocumentComplexity = {
  bytes: number
  lines: number
  topLevelBlocks: number
  codeFenceCount: number
  mermaidCount: number
  tableRowEstimate: number
  imageCount: number
  level: MarkdownDocumentComplexityLevel
}
