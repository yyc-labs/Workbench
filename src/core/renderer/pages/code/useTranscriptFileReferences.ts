import { useEffect, useMemo, useRef, useState } from 'react'
import type { TranscriptFileReference, TranscriptSessionSummary } from '../../../shared/types'

type UseTranscriptFileReferencesOptions = {
  activePane: 'code' | 'aicommit'
  projectId: string
  relativePath: string | null
  transcriptListStatus: 'idle' | 'loading' | 'ready' | 'error'
  transcriptSummaries: TranscriptSessionSummary[]
}

type TranscriptReferenceCacheEntry = {
  revision: string
  references: TranscriptFileReference[]
}

const EMPTY_TRANSCRIPT_FILE_REFERENCES: TranscriptFileReference[] = []

function toCacheKey(projectId: string, relativePath: string): string {
  return `${projectId}\u0000${relativePath}`
}

export function useTranscriptFileReferences({ activePane, projectId, relativePath, transcriptListStatus, transcriptSummaries }: UseTranscriptFileReferencesOptions): TranscriptFileReference[] {
  const [referencesByCacheKey, setReferencesByCacheKey] = useState<Record<string, TranscriptFileReference[]>>({})
  const cacheRef = useRef(new Map<string, TranscriptReferenceCacheEntry>())
  const transcriptRevision = useMemo(() => transcriptSummaries.map((summary) => `${summary.id}:${summary.updatedAt}:${summary.referenceCount}`).join('|'), [transcriptSummaries])
  const transcriptRevisionRef = useRef(transcriptRevision)
  transcriptRevisionRef.current = transcriptRevision
  const hasTranscriptReferences = transcriptSummaries.some((summary) => summary.referenceCount > 0)
  const normalizedPath = relativePath?.trim() ?? ''
  const cacheKey = normalizedPath ? toCacheKey(projectId, normalizedPath) : ''

  useEffect(() => {
    if (activePane !== 'code' || transcriptListStatus !== 'ready' || !normalizedPath || !cacheKey) return

    const cached = cacheRef.current.get(cacheKey)
    if (cached?.revision === transcriptRevision) {
      setReferencesByCacheKey((current) => (current[cacheKey] === cached.references ? current : { ...current, [cacheKey]: cached.references }))
      return
    }

    if (!hasTranscriptReferences) {
      cacheRef.current.set(cacheKey, { revision: transcriptRevision, references: EMPTY_TRANSCRIPT_FILE_REFERENCES })
      setReferencesByCacheKey((current) => (current[cacheKey] === EMPTY_TRANSCRIPT_FILE_REFERENCES ? current : { ...current, [cacheKey]: EMPTY_TRANSCRIPT_FILE_REFERENCES }))
      return
    }

    let disposed = false
    void window.electronAPI
      .listProjectTranscriptFileReferences(projectId, normalizedPath)
      .then((references) => {
        if (transcriptRevisionRef.current !== transcriptRevision) return
        cacheRef.current.set(cacheKey, { revision: transcriptRevision, references })
        if (disposed) return
        setReferencesByCacheKey((current) => ({ ...current, [cacheKey]: references }))
      })
      .catch(() => {
        if (transcriptRevisionRef.current !== transcriptRevision) return
        cacheRef.current.set(cacheKey, { revision: transcriptRevision, references: EMPTY_TRANSCRIPT_FILE_REFERENCES })
        if (disposed) return
        setReferencesByCacheKey((current) => ({ ...current, [cacheKey]: EMPTY_TRANSCRIPT_FILE_REFERENCES }))
      })

    return () => {
      disposed = true
    }
  }, [activePane, cacheKey, hasTranscriptReferences, normalizedPath, projectId, transcriptListStatus, transcriptRevision])

  return cacheKey ? (referencesByCacheKey[cacheKey] ?? EMPTY_TRANSCRIPT_FILE_REFERENCES) : EMPTY_TRANSCRIPT_FILE_REFERENCES
}
