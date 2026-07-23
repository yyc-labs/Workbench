/** Transcript and sharing domain contract. */
export type TranscriptSourceType = 'process-output' | 'tmux-capture' | 'agent-hook' | 'manual-markdown' | 'imported-file'
export type TranscriptCaptureInitialTextSource = 'selection' | 'clipboard' | 'empty'

export interface TranscriptCaptureInitialText {
  text: string
  source: TranscriptCaptureInitialTextSource
}

export type TranscriptViewerMode = 'preview' | 'editor' | 'split'

export interface TranscriptMessageRange {
  startOffset: number
  endOffset: number
  startLine: number
  endLine: number
}

export interface TranscriptReference {
  id: string
  sessionId: string
  relativePath: string
  lineNumber?: number
  column?: number
  label: string
  rawText: string
  href: string
  messageRange: TranscriptMessageRange
}

export interface TranscriptFileReference {
  transcriptId: string
  transcriptTitle: string
  reference: Pick<TranscriptReference, 'id' | 'relativePath' | 'lineNumber' | 'column'>
}

export interface TranscriptSession {
  id: string
  projectId: string
  sourceType: TranscriptSourceType
  title: string
  rawText: string
  markdownText: string
  references: TranscriptReference[]
  createdAt: number
  updatedAt: number
}

export type {
  TranscriptExternalImportPayload,
  TranscriptGatewayImportPayload,
  TranscriptImportedEvent,
  TranscriptImportPayload,
  TranscriptImportProjectTarget,
  TranscriptSessionSummary,
  TranscriptShareBindingMode,
  TranscriptShareEntry,
  TranscriptShareHost,
  TranscriptShareHostKind,
  TranscriptShareImage,
  TranscriptShareListResult,
  TranscriptShareStartPayload,
  TranscriptShareStartResult,
  TranscriptUpdatePayload,
} from '../types'
